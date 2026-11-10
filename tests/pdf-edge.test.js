import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFArray, decodePDFRawStream } from 'pdf-lib';
import { generateQuotePdf } from '../src/pdf.js';
import { quoteSheetRow, upsertSheetQuote, SHEET_HEADERS } from '../supabase/functions/_shared/sheets.js';

const quote = {
  id: '8d0a3b12-2d73-4d03-ae58-62f0cfce11bc', folio: 'COT-2026-000001',
  company_name: 'Cotizador EM Agency', client_name: 'María Pérez',
  client_company: 'Empresa de prueba', client_email: 'cliente@example.test',
  campaign: 'Campaña de prueba', status: 'borrador', currency: 'MXN', tax_rate: 0,
  created_at: '2026-11-09T12:00:00Z', updated_at: '2026-11-09T12:00:00Z',
  valid_until: '2099-11-30', subtotal: 1500, discount_amount: 0, tax_amount: 0,
  total: 1500, terms: 'Precios en pesos mexicanos (MXN). No incluye IVA.',
  seller_name: 'Ana Vendedora', seller_email: 'ana@example.test', seller_whatsapp: '+52 55 1234 5678',
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

test('PDF conserva precio e IVA y utiliza el logo original con marca de agua sin depender de Internet', async () => {
  const bytes = await generateQuotePdf({ quote: { ...quote, logo_url: '/CotizadorEM/brand/em-agency.png', oc_folio: 'OC 2711' }, items: [item] });
  const document = await PDFDocument.load(bytes);
  assert.equal(document.getPageCount(), 1);
  const text = contentText(document);
  for (const label of ['No incluye IVA.', 'TOTAL MXN', '$1,500.00', 'Ana Vendedora', 'ana@example.test', '+52 55 1234 5678', 'Orden de compra: OC 2711', 'Cotización de origen: COT-2026-000001']) assert.ok(text.includes(hex(label)), label);
  assert.equal(document.getPages()[0].getSize().width, 595.28);
  assert.ok((text.match(/ Do/g) || []).length >= 2, 'logo y marca de agua');
});

test('muestra PDF sin folio oficial ni OC y cotizaciones eliminadas no generan PDF', async () => {
  const bytes = await generateQuotePdf({ quote: { ...quote, is_sample: true, folio: null, oc_folio: 'OC 9999' }, items: [item] });
  const document = await PDFDocument.load(bytes);
  const text = contentText(document);
  assert.ok(text.includes(hex('COTIZACIÓN DE MUESTRA')));
  assert.ok(text.includes(hex('sin folio oficial')));
  assert.ok(!text.includes(hex('OC 9999')));
  await assert.rejects(generateQuotePdf({ quote: { ...quote, deleted_at: quote.updated_at }, items: [item] }), /eliminada/);
});

test('PDF pagina cien conceptos y textos largos sin perder el último concepto', async () => {
  const items = Array.from({ length: 100 }, (_, index) => ({ ...item, service: 'Servicio ' + (index + 1) + ' - ' + 'Descripción extensa con acentos y palabras '.repeat(3) }));
  const bytes = await generateQuotePdf({ quote: { ...quote, notes: 'Observación'.repeat(600) }, items });
  const document = await PDFDocument.load(bytes);
  assert.ok(document.getPageCount() >= 8);
  assert.ok(contentText(document).includes(hex('Servicio 100')));
  assert.ok(contentText(document).includes(hex(quote.folio)));
});

test('PDF local conserva aviso y admite caracteres fuera de Helvetica', async () => {
  const bytes = await generateQuotePdf({ quote: { ...quote, folio: 'VISTA-0001', client_name: 'María 🚀', created_at: '2026-11-10T01:00:00Z' }, items: [item] });
  const document = await PDFDocument.load(bytes);
  assert.ok(contentText(document).includes(hex('VISTA LOCAL - sin folio definitivo')));
  assert.ok(contentText(document).includes(hex('Fecha: 09 nov 2026')));
});

test('Sheets conserva ID, vendedor, OC y enlace permanente autenticado; indica eliminadas', () => {
  const row = quoteSheetRow({ ...quote, oc_folio: 'OC 2711' }, 'https://em.example.test/?old=1#test');
  assert.equal(row.length, 23);
  assert.equal(row[0], quote.id);
  assert.equal(row[9], 'MXN');
  assert.equal(row[13], 'No incluye IVA.');
  assert.equal(row[14], 'https://em.example.test/?quote=' + quote.id);
  assert.deepEqual(row.slice(16, 21), [quote.seller_name, quote.seller_email, quote.seller_whatsapp, 'Real', 'OC 2711']);
  const deleted = quoteSheetRow({ ...quote, deleted_at: quote.updated_at }, 'https://em.example.test/');
  assert.equal(deleted[7], 'Eliminada');
  assert.equal(deleted[14], '');
  assert.equal(deleted[22], quote.updated_at);
});

function mockSheets({ rows = [['ID'], [quote.id]], missingTab = false } = {}) {
  const calls = [];
  return { calls, fetch: async (url, options = {}) => {
    const target = new URL(url);
    calls.push({ url: String(url), ...options });
    if (target.searchParams.has('fields')) return Response.json({ sheets: [{ properties: { title: missingTab ? 'Hoja 1' : 'Cotizaciones' } }] });
    if (target.pathname.endsWith(':batchUpdate')) return Response.json({ replies: [{}] });
    if (options.method === 'PUT') return Response.json({ updatedRows: 1 });
    return Response.json({ values: rows });
  } };
}

test('Sheets actualiza misma fila como RAW sin duplicar y crea pestaña si falta', async () => {
  const original = globalThis.fetch;
  const mock = mockSheets({ missingTab: true });
  globalThis.fetch = mock.fetch;
  try {
    const params = { sheetId: 'test-sheet', tab: 'Cotizaciones', accessToken: 'test-token', quote: { ...quote, client_name: '=HYPERLINK("bad")' }, appUrl: 'https://em.example.test/' };
    await upsertSheetQuote(params);
    await upsertSheetQuote(params);
    const writes = mock.calls.filter(call => call.method === 'PUT' && decodeURIComponent(call.url).includes('A2:W2'));
    assert.equal(writes.length, 2);
    assert.equal(writes[0].url, writes[1].url);
    assert.ok(writes[0].url.endsWith('?valueInputOption=RAW'));
    assert.equal(JSON.parse(writes[0].body).values[0][3], '=HYPERLINK("bad")');
    assert.ok(mock.calls.some(call => call.method === 'POST' && JSON.parse(call.body).requests[0].addSheet.properties.title === 'Cotizaciones'));
    assert.deepEqual(JSON.parse(mock.calls.find(call => call.method === 'PUT' && decodeURIComponent(call.url).includes('A1:W1')).body).values[0], SHEET_HEADERS);
  } finally { globalThis.fetch = original; }
});

test('Sheets rechaza muestras y duplicados; elimina la fila comercial sin crear una si nunca existió', async () => {
  const original = globalThis.fetch;
  const params = { sheetId: 'test', accessToken: 'test', quote, appUrl: 'https://em.example.test/' };
  globalThis.fetch = () => { throw Error('Las muestras no deben llamar Google'); };
  try {
    await assert.rejects(upsertSheetQuote({ ...params, quote: { ...quote, is_sample: true } }), /muestra/);
    const duplicate = mockSheets({ rows: [['ID'], [quote.id], [quote.id]] });
    globalThis.fetch = duplicate.fetch;
    await assert.rejects(upsertSheetQuote(params), /duplicados/);
    const absent = mockSheets({ rows: [['ID']] });
    globalThis.fetch = absent.fetch;
    assert.equal((await upsertSheetQuote({ ...params, quote: { ...quote, deleted_at: quote.updated_at } })).row, null);
    assert.ok(!absent.calls.some(call => call.method === 'PUT'));
    const present = mockSheets();
    globalThis.fetch = present.fetch;
    await upsertSheetQuote({ ...params, quote: { ...quote, deleted_at: quote.updated_at } });
    const row = JSON.parse(present.calls.find(call => call.method === 'PUT' && decodeURIComponent(call.url).includes('A2:W2')).body).values[0];
    assert.equal(row[7], 'Eliminada');
    assert.equal(row[14], '');
  } finally { globalThis.fetch = original; }
});

async function edgeHandler(values) {
  let handler;
  globalThis.Deno = { env: { get: key => values[key] }, serve: fn => { handler = fn; } };
  await import('../supabase/functions/quote-documents/index.ts?test=' + crypto.randomUUID());
  return handler;
}
function mockSupabase(savedQuote = quote, allowRead = true) {
  const calls = [];
  return { calls, fetch: async (url, options = {}) => {
    const target = new URL(url);
    calls.push({ path: target.pathname, ...options });
    if (target.pathname === '/auth/v1/user') return Response.json({ id: '4f305fbb-5a29-4c87-9287-5e2c0eeddfab', aud: 'authenticated' });
    if (target.pathname === '/rest/v1/quotes' && (!options.method || options.method === 'GET')) return allowRead ? Response.json(savedQuote) : Response.json({ code: 'PGRST116', message: 'Not found' }, { status: 406 });
    if (target.pathname === '/rest/v1/quotes' && options.method === 'PATCH') return Response.json({ id: savedQuote.id });
    if (target.pathname === '/rest/v1/quote_items') return Response.json([item]);
    if (target.pathname === '/rest/v1/company_settings') return Response.json({ id: 1, name: quote.company_name });
    if (target.pathname.includes('/object/sign/')) return Response.json({ signedURL: '/object/sign/quote-pdfs/test.pdf?token=test' });
    if (target.pathname.includes('/storage/')) return Response.json({ Key: 'test.pdf' });
    return new Response(null, { status: 204 });
  } };
}
const requestFor = action => new Request('https://test/quote-documents', { method: 'POST', headers: { Authorization: 'Bearer test-jwt', 'Content-Type': 'application/json' }, body: JSON.stringify({ quote_id: quote.id, action }) });

test('Edge valida sesión, origen y RLS antes de acceso administrativo; admite nuevas claves', async () => {
  const previousDeno = globalThis.Deno, previousFetch = globalThis.fetch;
  const values = { SUPABASE_URL: 'https://test.supabase.co', ALLOWED_ORIGIN: 'https://em.example.test', SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: 'test-public-key' }), SUPABASE_SECRET_KEYS: JSON.stringify({ default: 'test-private-key' }) };
  try {
    const handler = await edgeHandler(values);
    assert.equal((await handler(new Request('https://test/quote-documents', { method: 'POST' }))).status, 401);
    assert.equal((await handler(new Request('https://test/quote-documents', { method: 'POST', headers: { Origin: 'https://evil.example.test' } }))).status, 403);
    const denied = mockSupabase(quote, false);
    globalThis.fetch = denied.fetch;
    assert.equal((await handler(requestFor('pdf'))).status, 404);
    assert.ok(!denied.calls.some(call => call.path.includes('/storage/')));
    const allowed = mockSupabase({ ...quote, logo_url: '/CotizadorEM/brand/em-agency.png' });
    globalThis.fetch = allowed.fetch;
    const ready = await handler(requestFor('sync'));
    assert.equal(ready.status, 200);
    const payload = await ready.json();
    assert.ok(payload.pdf_url.includes('token=test'));
    assert.equal(payload.sync_status, 'pending');
    assert.match(payload.error, /GOOGLE_SERVICE_ACCOUNT_EMAIL/);
    assert.ok(allowed.calls.some(call => call.path.includes('/storage/v1/object/quote-pdfs/') && call.method === 'POST'));
  } finally { globalThis.fetch = previousFetch; if (previousDeno === undefined) delete globalThis.Deno; else globalThis.Deno = previousDeno; }
});

test('Edge no genera PDFs eliminados ni sincroniza muestras; borrado sincronizable sin PDF', async () => {
  const previousDeno = globalThis.Deno, previousFetch = globalThis.fetch;
  try {
    const handler = await edgeHandler({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'test-public', SUPABASE_SERVICE_ROLE_KEY: 'test-private' });
    const deleted = mockSupabase({ ...quote, deleted_at: quote.updated_at });
    globalThis.fetch = deleted.fetch;
    const refused = await handler(requestFor('pdf'));
    assert.equal(refused.status, 410);
    assert.equal((await refused.json()).code, 'QUOTE_DELETED');
    const sync = await handler(requestFor('sync'));
    assert.equal(sync.status, 200);
    assert.equal((await sync.json()).pdf_url, undefined);
    assert.ok(!deleted.calls.some(call => call.path.includes('/storage/')));
    const sample = mockSupabase({ ...quote, is_sample: true, folio: null });
    globalThis.fetch = sample.fetch;
    const skipped = await handler(requestFor('sync'));
    assert.equal((await skipped.json()).sync_status, 'not_applicable');
    assert.ok(!sample.calls.some(call => call.path.includes('/storage/') || call.path.includes('/sheet_sync')));
  } finally { globalThis.fetch = previousFetch; if (previousDeno === undefined) delete globalThis.Deno; else globalThis.Deno = previousDeno; }
});
test('Edge sincroniza con Google autenticado, confirma versión y libera bloqueo incluso ante error', async () => {
  const previousDeno = globalThis.Deno, previousFetch = globalThis.fetch;
  const keyPair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' }, true, ['sign', 'verify']);
  const privateKey = '-----BEGIN PRIVATE KEY-----\n' + Buffer.from(await crypto.subtle.exportKey('pkcs8', keyPair.privateKey)).toString('base64') + '\n-----END PRIVATE KEY-----';
  try {
    const handler = await edgeHandler({ SUPABASE_URL: 'https://test.supabase.co', SUPABASE_ANON_KEY: 'test-public', SUPABASE_SERVICE_ROLE_KEY: 'test-private', GOOGLE_SERVICE_ACCOUNT_EMAIL: 'service@example.test', GOOGLE_PRIVATE_KEY: privateKey });
    for (const denied of [false, true]) {
      const mock = mockSupabase(quote);
      const calls = [];
      globalThis.fetch = async (url, options = {}) => {
        const target = new URL(url);
        calls.push({ url: String(url), ...options });
        if (target.hostname === 'oauth2.googleapis.com') {
          const assertion = new URLSearchParams(options.body).get('assertion');
          const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url'));
          assert.equal(claims.iss, 'service@example.test');
          return Response.json({ access_token: 'google-access-token' });
        }
        if (target.hostname === 'sheets.googleapis.com') {
          assert.equal(new Headers(options.headers).get('Authorization'), 'Bearer google-access-token');
          assert.ok(target.pathname.includes('1xHk3d5HBF458_2jKFSj7rhIvRN9VNto40vJ6tgx6ipI'));
          if (denied) return Response.json({ error: { message: 'Forbidden' } }, { status: 403 });
          if (target.searchParams.has('fields')) return Response.json({ sheets: [{ properties: { title: 'Cotizaciones' } }] });
          return Response.json(options.method === 'PUT' ? { updatedRows: 1 } : { values: [['ID'], [quote.id]] });
        }
        if (target.pathname.endsWith('/rpc/acquire_sheet_lock')) return Response.json(true);
        if (target.pathname.endsWith('/rpc/finish_sheet_sync')) {
          const params = JSON.parse(options.body);
          assert.equal(params.p_quote_id, quote.id);
          assert.equal(params.p_quote_updated_at, quote.updated_at);
          assert.equal(Boolean(params.p_error), denied);
          return Response.json(denied ? 'error' : 'synced');
        }
        if (target.pathname.endsWith('/rpc/release_sheet_lock')) return Response.json(true);
        return mock.fetch(url, options);
      };
      const response = await handler(requestFor('sync'));
      assert.equal(response.status, 200);
      const result = await response.json();
      assert.equal(result.sync_status, denied ? 'error' : 'synced');
      assert.ok(result.pdf_url, 'El PDF sigue disponible cuando Google rechaza acceso');
      if (denied) assert.match(result.error, /Google rechazó/);
      assert.equal(calls.filter(call => call.url.includes('/rpc/release_sheet_lock')).length, 1);
      if (!denied) assert.ok(calls.some(call => call.method === 'PUT' && decodeURIComponent(call.url).includes('A2:W2')));
    }
  } finally { globalThis.fetch = previousFetch; if (previousDeno === undefined) delete globalThis.Deno; else globalThis.Deno = previousDeno; }
});