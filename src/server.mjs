import express from 'express';
import { chromium } from 'playwright';
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { prepareInvoice, InputError } from './invoice.mjs';
const env=process.env;
const port=Number(env.PORT || 3000);
const key=env.API_KEY;
if (!key || key.length<32) throw new Error('API_KEY must contain at least 32 characters.');
const environment=env.KSEF_ENVIRONMENT || 'production';
if (!['production','demo','test'].includes(environment)) throw new Error('Invalid KSEF_ENVIRONMENT.');
const upstream=JSON.parse(await readFile(new URL('../upstream.lock.json',import.meta.url),'utf8'));
const renderer=await readFile(new URL('../dist/renderer.js',import.meta.url),'utf8');
const browser=await chromium.launch({headless:true});
const maxPending=4;
let pending=0;
let tail=Promise.resolve();
let closing=false;
const app=express();app.disable('x-powered-by');
app.get('/healthz', (_req,res)=>res.status(!closing && browser.isConnected()?200:503).json({status:!closing && browser.isConnected()?'ok':'unavailable',renderer:'CIRFMF/ksef-pdf-generator',revision:upstream.commit}));
app.use((req,res,next)=>{
  const supplied=req.get('Authorization') ?? '';
  const actual=createHash('sha256').update(supplied).digest();
  const expected=createHash('sha256').update(`Bearer ${key}`).digest();
  if (!timingSafeEqual(actual,expected)) return res.status(401).json({error:'Unauthorized.'});
  res.set('Cache-Control','no-store');
  next();
});
app.use(express.raw({type:['application/xml','text/xml'],limit:'2mb'}));
app.use(express.json({limit:'3mb',strict:true}));
app.post('/convert',async(req,res,next)=>{
  let data;
  try {
    let bytes, number, acquiredAt;
    if (Buffer.isBuffer(req.body)) {bytes=req.body;number=req.get('X-KSeF-Number');acquiredAt=req.get('X-KSeF-Acquired-At');}
    else if (req.is('application/json') && req.body && typeof req.body.xmlBase64==='string') {
      const encoded=req.body.xmlBase64;
      if (!encoded || encoded.length%4!==0 || /[^A-Za-z0-9+/=]/.test(encoded) || Buffer.from(encoded,'base64').toString('base64')!==encoded) throw new InputError('Invalid base64.');
      bytes=Buffer.from(encoded,'base64');number=req.body.ksefNumber;acquiredAt=req.body.acquiredAt;
    } else return res.status(415).json({error:'Use application/xml with X-KSeF-Number or JSON with xmlBase64 and ksefNumber.'});
    if (bytes.length>2*1024*1024) return res.status(413).json({error:'XML exceeds 2 MiB.'});
    data=prepareInvoice(bytes,number,environment,acquiredAt);
  } catch(e) {return next(e);}
  if (closing || !browser.isConnected()) return res.status(503).json({error:'Renderer unavailable.'});
  if (pending>=maxPending) return res.set('Retry-After','10').status(429).json({error:'Renderer busy. Retry later.'});
  pending++;
  const previous=tail;
  let release;tail=new Promise(resolve=>{release=resolve;});
  await previous;
  let context;
  try {
    if (res.destroyed) return;
    context=await browser.newContext({serviceWorkers:'block'});
    await context.route('**/*',route=>route.abort());
    const page=await context.newPage();
    await page.setContent('<!doctype html><html lang="pl"><meta charset="utf-8"><body></body></html>');
    await page.addScriptTag({content:renderer});
    let timer;
    const pdfBase64=await Promise.race([
      page.evaluate(data=>window.renderInvoice(data),data),
      new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Render timeout')),60000);}),
    ]).finally(()=>clearTimeout(timer));
    const pdf=Buffer.from(pdfBase64,'base64');
    if (!pdf.subarray(0,5).equals(Buffer.from('%PDF-'))) throw new Error('Invalid renderer output');
    res.set({'Content-Type':'application/pdf','Content-Disposition':`attachment; filename="${data.ksefNumber}.pdf"`,'X-XML-SHA256':data.xmlSha256,'X-Renderer-Version':`mf-${upstream.commit.slice(0,7)}`}).send(pdf);
  } catch(e) {
    // Never log XML, tokens, document identifiers or browser exception messages.
    console.error(JSON.stringify({event:'conversion_failed',type:e.name}));
    if (!res.headersSent) res.status(422).json({error:'PDF conversion failed. Check supported invoice fields or retry.'});
  } finally {
    try {await context?.close();} catch {}
    pending--;release();
  }
});
app.use((err,_req,res,_next)=>{
  if (err instanceof InputError) return res.status(400).json({error:err.message});
  if (err.type==='entity.too.large') return res.status(413).json({error:'Request too large.'});
  if (err.type==='entity.parse.failed') return res.status(400).json({error:'Malformed JSON.'});
  console.error(JSON.stringify({event:'request_failed',type:err.name}));
  res.status(500).json({error:'Internal error.'});
});
const server=app.listen(port,'0.0.0.0',()=>console.log(JSON.stringify({event:'listening',port,environment})));
server.requestTimeout=90000;
server.headersTimeout=15000;
async function stop(){if(closing)return;closing=true;server.close();await browser.close();process.exit(0);}
process.on('SIGTERM',stop);process.on('SIGINT',stop);
