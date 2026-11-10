import { createClient } from '@supabase/supabase-js';
import { generateQuotePdf } from '../_shared/pdf.js';
import { googleAccessToken, upsertSheetQuote } from '../_shared/sheets.js';

const env = (name: string) => Deno.env.get(name) || '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dbUrl = env('SUPABASE_URL');
const DEFAULT_APP_URL = 'https://xontiveros-em.github.io/CotizadorEM/';
const DEFAULT_SHEET_ID = '1xHk3d5HBF458_2jKFSj7rhIvRN9VNto40vJ6tgx6ipI';
const DEFAULT_ORIGINS = ['https://xontiveros-em.github.io', 'http://127.0.0.1:4173', 'http://localhost:4173'];

function configuredKey(single: string, collection: string, legacy: string) {
  if (env(single)) return env(single);
  if (env(collection)) {
    try {
      const keys = JSON.parse(env(collection));
      const key = keys.default || Object.values(keys)[0];
      if (typeof key === 'string' && key) return key;
    } catch { throw new Error('La configuración de claves del servidor no es válida.'); }
  }
  return env(legacy);
}

function trustedAppUrl() {
  const url = new URL(env('APP_URL') || DEFAULT_APP_URL);
  if (url.protocol !== 'https:' && !(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol === 'http:')) throw new Error('Configura APP_URL con la dirección HTTPS del cotizador.');
  return url.toString();
}

async function logoForPdf(url: string | null, admin: ReturnType<typeof createClient>) {
  // The supplied EM logo is embedded in the shared generator. Historical quotes
  // can contain a GitHub Pages relative path; these use that exact embedded logo.
  if (!url || /^\/?(?:CotizadorEM\/)?brand\/em-agency\.png$/.test(url)) return {};
  const logo = new URL(url, DEFAULT_APP_URL);
  if (logo.origin === new URL(DEFAULT_APP_URL).origin && logo.pathname === '/CotizadorEM/brand/em-agency.png' && !logo.search && !logo.hash) return {};
  const base = new URL(dbUrl);
  const prefix = '/storage/v1/object/public/brand-assets/';
  if (logo.origin !== base.origin || !logo.pathname.startsWith(prefix) || logo.search || logo.hash) {
    throw new Error('El logo debe estar en el bucket brand-assets de este proyecto. Selecciona de nuevo el logo en Configuración.');
  }
  const path = decodeURIComponent(logo.pathname.slice(prefix.length));
  if (!path || path.split('/').some(piece => piece === '..')) throw new Error('Ruta de logo inválida.');
  const { data, error } = await admin.storage.from('brand-assets').download(path);
  if (error || !data) throw new Error('No se pudo cargar el logo guardado. Selecciona de nuevo el logo en Configuración.');
  if (data.size > 2 * 1024 * 1024) throw new Error('El logo supera 2 MB.');
  const bytes = new Uint8Array(await data.arrayBuffer());
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!png && !jpeg) throw new Error('El logo debe ser PNG o JPG.');
  return { logoBytes: bytes, logoType: png ? 'png' : 'jpeg' };
}

Deno.serve(async (request: Request) => {
  const configuredOrigin = env('ALLOWED_ORIGIN');
  const allowedOrigins = configuredOrigin ? [configuredOrigin] : DEFAULT_ORIGINS;
  const origin = request.headers.get('Origin');
  const originAllowed = origin !== null && allowedOrigins.includes(origin);
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': originAllowed ? origin! : allowedOrigins[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type, x-retry-count, traceparent, tracestate, baggage',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin',
  };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  if (origin !== null && !originAllowed) return reply({ error: 'Origen no autorizado.', code: 'ORIGIN_FORBIDDEN' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply({ error: 'Método no permitido.' }, 405);
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return reply({ error: 'Inicia sesión para consultar la cotización.' }, 401);
  try {
    const key = configuredKey('SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_PUBLISHABLE_KEYS', 'SUPABASE_ANON_KEY');
    const secret = configuredKey('SUPABASE_SECRET_KEY', 'SUPABASE_SECRET_KEYS', 'SUPABASE_SERVICE_ROLE_KEY');
    if (!dbUrl || !key || !secret) return reply({ error: 'Falta configurar el proyecto Supabase.', code: 'SUPABASE_CONFIGURATION' }, 503);
    const client = createClient(dbUrl, key, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await client.auth.getUser(authorization.slice(7));
    if (authError || !auth.user) return reply({ error: 'Sesión inválida o vencida.' }, 401);
    const body = await request.json();
    if (!UUID.test(body.quote_id || '') || !['pdf', 'sync'].includes(body.action)) return reply({ error: 'Solicitud inválida.' }, 400);
    // This read is always user-scoped and protected by the staff RLS policy.
    const { data: quote, error: quoteError } = await client.from('quotes').select('*').eq('id', body.quote_id).single();
    if (quoteError || !quote) return reply({ error: 'No tienes acceso a esta cotización.', code: 'QUOTE_NOT_FOUND' }, 404);
    if (quote.deleted_at && body.action === 'pdf') return reply({ error: 'Esta cotización fue eliminada. Su folio queda reservado en el historial.', code: 'QUOTE_DELETED' }, 410);
    if (quote.is_sample && body.action === 'sync') return reply({ sync_status: 'not_applicable', message: 'Las cotizaciones de muestra no se envían a la hoja comercial.' });
    const admin = createClient(dbUrl, secret, { auth: { persistSession: false, autoRefreshToken: false } });
    const result: Record<string, unknown> = { sync_status: 'pending' };
    if (!quote.deleted_at) {
      const [{ data: items, error: itemError }, { data: company, error: companyError }] = await Promise.all([
        client.from('quote_items').select('*').eq('quote_id', quote.id).order('position'),
        client.from('company_settings').select('*').eq('id', 1).single(),
      ]);
      if (itemError || companyError || !items || !company) throw new Error('No se pudo leer la cotización completa.');
      const image = await logoForPdf(quote.logo_url, admin);
      const bytes = await generateQuotePdf({ quote, items, company, ...image });
      const version = String(quote.updated_at).replace(/[^0-9]/g, '');
      const pdfPath = quote.id + '/' + (version || '1') + '.pdf';
      const { error: uploadError } = await admin.storage.from('quote-pdfs').upload(pdfPath, bytes, { contentType: 'application/pdf', upsert: true });
      if (uploadError) throw new Error('No se pudo guardar el PDF en Supabase.');
      const { data: saved, error: pathError } = await admin.from('quotes').update({ pdf_path: pdfPath }).eq('id', quote.id).eq('updated_at', quote.updated_at).is('deleted_at', null).select('id').maybeSingle();
      if (pathError) throw new Error('No se pudo registrar el PDF.');
      if (!saved) throw new Error('La cotización cambió mientras se preparaba el PDF. Ábrela de nuevo e intenta descargar.');
      const { data: signed, error: signError } = await admin.storage.from('quote-pdfs').createSignedUrl(pdfPath, 600);
      if (signError || !signed?.signedUrl) throw new Error('No se pudo abrir el PDF.');
      result.pdf_url = signed.signedUrl;
      result.pdf_path = pdfPath;
    }
    if (body.action === 'pdf') {
      const { data: existingSync } = await client.from('sheet_sync').select('status').eq('quote_id', quote.id).maybeSingle();
      result.sync_status = quote.is_sample ? 'not_applicable' : existingSync?.status || 'pending';
      return reply(result);
    }
    const googleEmail = env('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    const googleKey = env('GOOGLE_PRIVATE_KEY');
    const googleSheet = env('GOOGLE_SHEET_ID') || DEFAULT_SHEET_ID;
    if (!googleEmail || !googleKey) {
      const message = 'Falta conectar Google Sheets: configura GOOGLE_SERVICE_ACCOUNT_EMAIL y GOOGLE_PRIVATE_KEY en Secrets de Supabase y comparte la hoja con esa cuenta como Editor.';
      await admin.from('sheet_sync').upsert({ quote_id: quote.id, status: 'pending', error: message, updated_at: new Date().toISOString() });
      result.error = message;
      return reply(result);
    }
    const appUrl = trustedAppUrl();
    const token = crypto.randomUUID();
    const { data: acquired, error: acquireError } = await admin.rpc('acquire_sheet_lock', { p_token: token, p_lease_seconds: 120 });
    if (acquireError) throw new Error('No se pudo reservar la sincronización.');
    if (!acquired) {
      result.sync_status = 'processing';
      result.error = 'Hay otra sincronización en curso. Reintenta en unos segundos.';
      return reply(result);
    }
    try {
      const started = Date.now();
      const { data: sync } = await admin.from('sheet_sync').select('attempts').eq('quote_id', quote.id).maybeSingle();
      const { error: processingError } = await admin.from('sheet_sync').upsert({ quote_id: quote.id, status: 'processing', attempts: (sync?.attempts || 0) + 1, error: null, updated_at: new Date().toISOString() });
      if (processingError) throw new Error('No se pudo registrar el intento de sincronización.');
      const accessToken = await googleAccessToken(googleEmail, googleKey);
      // At most six Google requests, each with a 10-second timeout, fit the lease.
      if (Date.now() - started > 30000) throw new Error('La sincronización tardó demasiado. Reintenta.');
      await upsertSheetQuote({ sheetId: googleSheet, tab: env('GOOGLE_SHEET_TAB') || 'Cotizaciones', accessToken, quote, appUrl });
      const { data: finalStatus, error: savedError } = await admin.rpc('finish_sheet_sync', {
        p_quote_id: quote.id, p_quote_updated_at: quote.updated_at, p_error: null,
      });
      if (savedError) throw new Error('La fila se guardó, pero no se pudo confirmar la sincronización. Reintenta.');
      result.sync_status = finalStatus;
      if (finalStatus === 'pending') result.error = 'Hay un cambio pendiente de sincronizar.';
    } catch (error) {
      const message = error instanceof Error ? error.message : 'No se pudo sincronizar Google Sheets.';
      const { data: errorStatus } = await admin.rpc('finish_sheet_sync', {
        p_quote_id: quote.id, p_quote_updated_at: quote.updated_at, p_error: message,
      });
      result.sync_status = errorStatus || 'error'; result.error = message;
    } finally {
      await admin.rpc('release_sheet_lock', { p_token: token });
    }
    return reply(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'No se pudo generar el documento.';
    return reply({ error: message, code: 'DOCUMENT_ERROR' }, 400);
  }
});