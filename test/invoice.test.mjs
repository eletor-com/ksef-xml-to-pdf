import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {prepareInvoice,InputError} from '../src/invoice.mjs';
const xml=readFileSync(new URL('./fixtures/mf-fa3.xml',import.meta.url));
const number='5265877635-20251031-000000000001-00';
test('FA3: production QR uses exact original bytes, date and seller NIP',()=>{
 const d=prepareInvoice(xml,number,'production');
 assert.equal(d.form,'FA (3)');
 assert.equal(d.qrUrl,`https://qr.ksef.mf.gov.pl/invoice/5265877635/31-10-2025/${createHash('sha256').update(xml).digest('base64url')}`);
 assert.deepEqual(Buffer.from(d.xmlBase64,'base64'),xml);
});
test('UTF-16 input retains exact bytes for QR',()=>{
 const bytes=Buffer.concat([Buffer.from([0xff,0xfe]),Buffer.from(xml.toString().replace('encoding="utf-8"','encoding="utf-16"'),'utf16le')]);
 const d=prepareInvoice(bytes,number,'test');assert.match(d.qrUrl,/qr-test/);
 assert.equal(d.xmlSha256,createHash('sha256').update(bytes).digest('hex'));
});
test('rejects DTD, malformed XML, unsupported form and mismatched seller',()=>{
 assert.throws(()=>prepareInvoice(Buffer.from('<!DOCTYPE x><Faktura/>'),number,'production'),InputError);
 assert.throws(()=>prepareInvoice(Buffer.from('<Faktura>'),number,'production'),InputError);
 assert.throws(()=>prepareInvoice(Buffer.from('<Faktura/>'),number,'production'),InputError);
 assert.throws(()=>prepareInvoice(xml,'1111111111-20251031-000000000001-00','production'),InputError);
});
test('rejects invalid calendar date and malformed acquisition timestamp',()=>{
 assert.throws(()=>prepareInvoice(Buffer.from(xml.toString().replace('2025-10-31','2025-02-31')),number,'production'),InputError);
 assert.throws(()=>prepareInvoice(xml,number,'production','invalid'),InputError);
});

test('rejects malformed gross amount instead of rendering incorrect values',()=>{
 assert.throws(()=>prepareInvoice(Buffer.from(xml.toString().replace('<P_15>33569.50</P_15>','<P_15>1-23.00</P_15>')),number,'production'),InputError);
});
