import { createHash } from 'node:crypto';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
export class InputError extends Error {}
const parser = new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,parseAttributeValue:false,processEntities:false,trimValues:true});
export function prepareInvoice(bytes, ksefNumber, environment, acquiredAt) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) throw new InputError('Missing XML.');
  if (!/^\d{10}-\d{8}-[A-Fa-f0-9]{12}-[A-Fa-f0-9]{2}$/.test(ksefNumber ?? '')) throw new InputError('Invalid KSeF number.');
  let encoding = 'utf-8';
  if ((bytes[0]===0xff && bytes[1]===0xfe) || (bytes[0]===0x3c && bytes[1]===0)) encoding='utf-16le';
  if ((bytes[0]===0xfe && bytes[1]===0xff) || (bytes[0]===0 && bytes[1]===0x3c)) encoding='utf-16be';
  let text;
  try {text = new TextDecoder(encoding,{fatal:true}).decode(bytes);} catch {throw new InputError('Invalid XML encoding.');}
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new InputError('DTD and entities are not allowed.');
  if (XMLValidator.validate(text) !== true) throw new InputError('Malformed XML.');
  let parsed;
  try {parsed = parser.parse(text);} catch {throw new InputError('Malformed XML.');}
  const invoice = parsed.Faktura;
  const form = invoice?.Naglowek?.KodFormularza?.['@_kodSystemowy'];
  if (!['FA (1)','FA (2)','FA (3)'].includes(form)) throw new InputError('Supported formats: FA (1), FA (2), FA (3).');
  const nip = invoice?.Podmiot1?.DaneIdentyfikacyjne?.NIP;
  const date = invoice?.Fa?.P_1;
  const invoiceNumber = invoice?.Fa?.P_2;
  if (typeof nip!=='string' || !/^\d{10}$/.test(nip) || typeof date!=='string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !invoiceNumber) throw new InputError('Missing seller NIP, issue date or invoice number.');
  if (!Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0,10)!==date) throw new InputError('Invalid issue date.');
  if (!/^-?\d+(?:\.\d{1,2})?$/.test(invoice?.Fa?.P_15 ?? '')) throw new InputError('Missing or invalid gross amount P_15.');
  if (!ksefNumber.startsWith(nip+'-')) throw new InputError('KSeF number does not match seller NIP.');
  if (acquiredAt !== undefined && (typeof acquiredAt!=='string' || !/^\d{4}-\d{2}-\d{2}T/.test(acquiredAt) || !Number.isFinite(Date.parse(acquiredAt)))) throw new InputError('Invalid acquiredAt timestamp.');
  const hashes = createHash('sha256').update(bytes).digest();
  const host = {production:'https://qr.ksef.mf.gov.pl',demo:'https://qr-demo.ksef.mf.gov.pl',test:'https://qr-test.ksef.mf.gov.pl'}[environment];
  if (!host) throw new Error('Invalid KSEF_ENVIRONMENT.');
  const [year,month,day]=date.split('-');
  return {xmlBase64:bytes.toString('base64'),ksefNumber,acquiredAt,qrUrl:`${host}/invoice/${nip}/${day}-${month}-${year}/${hashes.toString('base64url')}`,xmlSha256:hashes.toString('hex'),form};
}
