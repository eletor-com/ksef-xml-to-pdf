import {readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const base=process.env.CONVERTER_URL || 'http://127.0.0.1:3080';
const key=process.env.API_KEY;
if (!key) throw new Error('Set API_KEY.');
const original=await readFile('test/fixtures/mf-fa3.xml');
const number='5265877635-20251031-000000000001-00';
const headers={'Authorization':`Bearer ${key}`,'Content-Type':'application/xml','X-KSeF-Number':number};
let healthy=false;
for (let i=0;i<30;i++){
 try {healthy=(await fetch(`${base}/healthz`)).status===200;} catch {}
 if(healthy)break;
 await new Promise(resolve=>setTimeout(resolve,1000));
}
assert.equal(healthy,true,'Renderer must become healthy.');
const unauth=await fetch(`${base}/convert`,{method:'POST',headers:{'Content-Type':'application/xml'},body:original});assert.equal(unauth.status,401);
const invalid=await fetch(`${base}/convert`,{method:'POST',headers,body:'<Faktura>'});assert.equal(invalid.status,400);
const dtd=await fetch(`${base}/convert`,{method:'POST',headers,body:'<!DOCTYPE x><Faktura/>'});assert.equal(dtd.status,400);
const invalidJson=await fetch(`${base}/convert`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({xmlBase64:'?!',ksefNumber:number})});assert.equal(invalidJson.status,400);
await mkdir('output/pdf',{recursive:true});
const cases=[['mf-fa3',original]];
const minimal=`<?xml version="1.0" encoding="utf-8"?>
<Faktura xmlns="http://crd.gov.pl/wzor/2025/06/25/13775/">
<Naglowek><KodFormularza kodSystemowy="FA (3)" wersjaSchemy="1-0E">FA</KodFormularza><WariantFormularza>3</WariantFormularza><DataWytworzeniaFa>2025-10-31T10:00:00Z</DataWytworzeniaFa><SystemInfo>TEST konwertera ELETOR</SystemInfo></Naglowek>
<Podmiot1><DaneIdentyfikacyjne><NIP>5265877635</NIP><Nazwa>Sprzedawca testowy — Łódź</Nazwa></DaneIdentyfikacyjne><Adres><KodKraju>PL</KodKraju><AdresL1>ul. Żółta 1, 00-001 Warszawa</AdresL1></Adres></Podmiot1>
<Podmiot2><DaneIdentyfikacyjne><NIP>1111111111</NIP><Nazwa>Nabywca testowy — Gdańsk</Nazwa></DaneIdentyfikacyjne><Adres><KodKraju>PL</KodKraju><AdresL1>ul. Długa 2, 80-001 Gdańsk</AdresL1></Adres><JST>2</JST><GV>2</GV></Podmiot2>
<Fa><KodWaluty>PLN</KodWaluty><P_1>2025-10-31</P_1><P_2>TEST/ŁÓDŹ/2025/1</P_2><P_13_1>100.00</P_13_1><P_14_1>23.00</P_14_1><P_15>123.00</P_15>
<Adnotacje><P_16>2</P_16><P_17>2</P_17><P_18>2</P_18><P_18A>2</P_18A><Zwolnienie><P_19N>1</P_19N></Zwolnienie><NoweSrodkiTransportu><P_22N>1</P_22N></NoweSrodkiTransportu><P_23>2</P_23><PMarzy><P_PMarzyN>1</P_PMarzyN></PMarzy></Adnotacje><RodzajFaktury>VAT</RodzajFaktury>
<FaWiersz><NrWierszaFa>1</NrWierszaFa><P_7>Zażółć gęślą jaźń — usługa testowa</P_7><P_8A>szt.</P_8A><P_8B>1</P_8B><P_9A>100.00</P_9A><P_11>100.00</P_11><P_12>23</P_12></FaWiersz>
<Platnosc><TerminPlatnosci><Termin>2025-11-14</Termin></TerminPlatnosci><FormaPlatnosci>6</FormaPlatnosci></Platnosc></Fa></Faktura>`;
cases.push(['standard',Buffer.from(minimal)]);
const correction=minimal.replace('<RodzajFaktury>VAT</RodzajFaktury>','<RodzajFaktury>KOR</RodzajFaktury><PrzyczynaKorekty>Zwrot towaru</PrzyczynaKorekty><DaneFaKorygowanej><DataWystFaKorygowanej>2025-10-01</DataWystFaKorygowanej><NrFaKorygowanej>TEST/2025/0</NrFaKorygowanej><NrKSeFN>1</NrKSeFN></DaneFaKorygowanej>').replace(/>(100\.00|23\.00|123\.00)</g, '>-$1<');
cases.push(['correction',Buffer.from(correction)]);
const advance=minimal.replace('<RodzajFaktury>VAT</RodzajFaktury>','<RodzajFaktury>ZAL</RodzajFaktury>');
cases.push(['advance',Buffer.from(advance)]);
const row=minimal.match(/<FaWiersz>[\s\S]*?<\/FaWiersz>/)[0];
const long=minimal.replace(row,Array.from({length:70},(_,i)=>row.replace('<NrWierszaFa>1</NrWierszaFa>',`<NrWierszaFa>${i+1}</NrWierszaFa>`).replace('usługa testowa',`usługa testowa numer ${i+1}`)).join('')).replace('<P_13_1>100.00','<P_13_1>7000.00').replace('<P_14_1>23.00','<P_14_1>1610.00').replace('<P_15>123.00','<P_15>8610.00');
cases.push(['multipage',Buffer.from(long)]);
for (const [name,xml] of cases){
 const response=await fetch(`${base}/convert`,{method:'POST',headers,body:xml});
 if (!response.ok) throw new Error(`${name}: HTTP ${response.status}: ${await response.text()}`);
 const pdf=Buffer.from(await response.arrayBuffer());
 assert.equal(pdf.subarray(0,5).toString(),'%PDF-');
 assert.equal(response.headers.get('x-xml-sha256'),createHash('sha256').update(xml).digest('hex'));
 await writeFile(`output/pdf/${name}.pdf`,pdf);
 await writeFile(`output/pdf/${name}.xml`,xml);
 console.log(`${name}: PDF OK (${pdf.length} bytes)`);
}
const jsonResponse=await fetch(`${base}/convert`,{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({xmlBase64:Buffer.from(minimal).toString('base64'),ksefNumber:number})});
assert.equal(jsonResponse.status,200);assert.equal(Buffer.from(await jsonResponse.arrayBuffer()).subarray(0,5).toString(),'%PDF-');
const utf16=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(minimal.replace('encoding="utf-8"','encoding="utf-16"'),'utf16le')]);
const utfResponse=await fetch(`${base}/convert`,{method:'POST',headers,body:utf16});assert.equal(utfResponse.status,200);
assert.equal(utfResponse.headers.get('x-xml-sha256'),createHash('sha256').update(utf16).digest('hex'));
console.log('PASS: health, authentication, invalid input, JSON, UTF-16, VAT, correction, advance and multipage.');
