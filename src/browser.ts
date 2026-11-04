import { generateInvoice } from '../upstream/mf/src/lib-public/generate-invoice';
(window as any).renderInvoice = async (input: {xmlBase64: string; ksefNumber: string; qrUrl: string; acquiredAt?: string}) => {
  const xml = Uint8Array.from(atob(input.xmlBase64), c => c.charCodeAt(0));
  const file = new File([xml], 'invoice.xml', {type:'application/xml'});
  return await generateInvoice(file, {nrKSeF:input.ksefNumber,qrCode:input.qrUrl,acDate:input.acquiredAt,isMobile:false}, 'base64');
};
