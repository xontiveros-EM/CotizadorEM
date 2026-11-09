import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFArray, decodePDFRawStream } from 'pdf-lib';
import { generateQuotePdf } from '../src/pdf.js';
import { quoteSheetRow, upsertSheetQuote } from '../supabase/functions/_shared/sheets.js';

const quote = {
  id: '8d0a3b12-2d73-4d03-ae58-62f0cfce11bc', folio: 'COT-2026-000001',
  company_name: 'Cotizador EM Agency', client_name: 'María Pérez',
  client_company: 'Empresa de prueba', client_email: 'cliente@example.test',
  campaign: 'Campaña de prueba', status: 'borrador', currency: 'MXN', tax_rate: 0,
  created_at: '2026-11-09T12:00:00Z', updated_at: '2026-11-09T12:00:00Z',
  valid_until: '2026-11-30', subtotal: 1500, discount_amount: 0, tax_amount: 0,
  total: 1500, terms: 'Precios en pesos mexicanos (MXN). No incluye IVA.',
};
const item = { instagram_handle: '@cuenta_prueba', service: 'Reel de Instagram', quantity: 1, unit_price: 1500, line_total: 1500 };

function contentText(document) {
  return document.getPages().map(page => {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map(ref => document.context.lookup(ref)) : [document.context.lookup(contents)];
    return streams.map(stream => new TextDecoder().decode(decodePDFRawStream(stream).decode())).join('\n');
  }).join('\n');
}
const hex = string => Buffer.from(string, 'latin1').toString('hex').toUpperCase();

test('PDF conserva MXN, importe guardado y leyenda de IVA; admite logo PNG', async () => {
  const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF9sAAAAASUVORK5CYII=';
  const bytes = await generateQuotePdf({ quote: { ...quote, logo_url: logo }, items: [item] });
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 1);
  const text = contentText(document);
  assert.ok(text.includes(hex('No incluye IVA.')));
  assert.ok(text.includes(hex('TOTAL MXN')));
  assert.ok(text.includes(hex('$1,500.00')));
  assert.equal(document.getPages()[0].getSize().width, 595.28);
});

test('PDF pagina cien conceptos y textos largos sin perder el último concepto', async () => {
  const items = Array.from({ length: 100 }, (_, index) => ({ ...item, service: `Servicio ${index + 1} - ${'Descripción extensa con acentos y palabras '.repeat(3)}` }));
  const bytes = await generateQuotePdf({ quote: { ...quote, notes: 'Observación'.repeat(600) }, items });
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 8);
  assert.ok(contentText(document).includes(hex('Servicio 100')));
  assert.ok(contentText(document).includes(hex(quote.folio)));
});

test('PDF local muestra aviso y caracteres no soportados no rompen el documento', async () => {
  const bytes = await generateQuotePdf({ quote: { ...quote, folio: 'VISTA-0001', client_name: 'María 🚀', created_at: '2026-11-10T01:00:00Z' }, items: [item] });
  const document = await PDFDocument.load(bytes);
  assert.ok(contentText(document).includes(hex('VISTA LOCAL - sin folio definitivo')));
  assert.ok(contentText(document).includes(hex('Fecha: 09 nov 2026')));
});

test('Sheets conserva ID, MXN y enlace permanente autenticado', () => {
  const row = quoteSheetRow(quote, 'https://em.example.test/?old=1#test');
  assert.equal(row[0], quote.id);
  assert.equal(row[9], 'MXN');
  assert.equal(row[13], 'No incluye IVA.');
  assert.equal(row[14], `https://em.example.test/?quote=${quote.id}`);
});

test('Sheets reintenta actualizando la misma fila y escribe datos como RAW', async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, ...options });
    return Response.json(options.method === 'PUT' ? { updatedRows: 1 } : { values: [['ID'], [quote.id]] });
  };
  try {
    const params = { sheetId: 'test-sheet', tab: 'Cotizaciones', accessToken: 'test-token', quote: { ...quote, client_name: '=HYPERLINK("bad")' }, appUrl: 'https://em.example.test/' };
    await upsertSheetQuote(params);
    await upsertSheetQuote(params);
    const writes = calls.filter(call => call.method === 'PUT');
    assert.equal(writes.length, 2);
    assert.equal(writes[0].url, writes[1].url);
    assert.ok(decodeURIComponent(writes[0].url).includes('A2:P2?valueInputOption=RAW'));
    assert.equal(JSON.parse(writes[0].body).values[0][3], '=HYPERLINK("bad")');
  } finally { globalThis.fetch = originalFetch; }
});

test('Sheets rechaza IDs duplicados para evitar sobrescrituras ambiguas', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ values: [['ID'], [quote.id], [quote.id]] });
  try {
    await assert.rejects(upsertSheetQuote({ sheetId: 'test', accessToken: 'test', quote, appUrl: 'https://em.example.test' }), /duplicados/);
  } finally { globalThis.fetch = originalFetch; }
});

test('Edge rechaza solicitudes sin sesión y desde un origen ajeno', async () => {
  let handler;
  const values = { SUPABASE_URL: 'https://test.supabase.co', ALLOWED_ORIGIN: 'https://em.example.test', SUPABASE_ANON_KEY: 'test-public-key', SUPABASE_SERVICE_ROLE_KEY: 'test-private-key' };
  globalThis.Deno = {
    env: { get: key => values[key] },
    serve: fn => { handler = fn; },
  };
  await import('../supabase/functions/quote-documents/index.ts');
  try {
    const unauthorized = await handler(new Request('https://test/quote-documents', { method: 'POST' }));
    assert.equal(unauthorized.status, 401);
    const forbiddenOrigin = await handler(new Request('https://test/quote-documents', { method: 'POST', headers: { Origin: 'https://evil.example.test' } }));
    assert.equal(forbiddenOrigin.status, 403);
    const originalFetch = globalThis.fetch;
    const calls = [];
    globalThis.fetch = async (url, options = {}) => {
      const target = new URL(url);
      calls.push({ path: target.pathname, ...options });
      if (target.pathname === '/auth/v1/user') return Response.json({ id: '4f305fbb-5a29-4c87-9287-5e2c0eeddfab', aud: 'authenticated' });
      if (target.pathname === '/rest/v1/quotes' && (!options.method || options.method === 'GET')) return Response.json(quote);
      if (target.pathname === '/rest/v1/quote_items') return Response.json([item]);
      if (target.pathname === '/rest/v1/company_settings') return Response.json({ id: 1, name: quote.company_name });
      if (target.pathname.includes('/object/sign/')) return Response.json({ signedURL: '/object/sign/quote-pdfs/test.pdf?token=test' });
      if (target.pathname.includes('/storage/')) return Response.json({ Key: 'test.pdf' });
      return new Response(null, { status: 204 });
    };
    try {
      const ready = await handler(new Request('https://test/quote-documents', {
        method: 'POST', headers: { Authorization: 'Bearer test-jwt', 'Content-Type': 'application/json' },
        body: JSON.stringify({ quote_id: quote.id, action: 'sync' }),
      }));
      assert.equal(ready.status, 200);
      const payload = await ready.json();
      assert.ok(payload.pdf_url.includes('token=test'));
      assert.equal(payload.sync_status, 'pending');
      assert.match(payload.error, /Falta conectar Google Sheets/);
      assert.ok(calls.some(call => call.path.includes('/storage/v1/object/quote-pdfs/') && call.method === 'POST'));
    } finally { globalThis.fetch = originalFetch; }
  } finally { delete globalThis.Deno; }
});
