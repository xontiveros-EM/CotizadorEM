import { createClient } from '@supabase/supabase-js';
import { generateQuotePdf } from '../_shared/pdf.js';
import { googleAccessToken, upsertSheetQuote } from '../_shared/sheets.js';

const env = (name: string) => Deno.env.get(name) || '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const dbUrl = env('SUPABASE_URL');

function trustedAppUrl() {
  const url = new URL(env('APP_URL'));
  if (url.protocol !== 'https:' && !(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.protocol === 'http:')) throw new Error('Configura APP_URL con la dirección HTTPS del cotizador.');
  return url.toString();
}

async function logoForPdf(url: string | null, admin: ReturnType<typeof createClient>) {
  if (!url) return {};
  const logo = new URL(url);
  const base = new URL(dbUrl);
  const prefix = '/storage/v1/object/public/brand-assets/';
  if (logo.origin !== base.origin || !logo.pathname.startsWith(prefix) || logo.search || logo.hash) {
    throw new Error('El logo debe estar en el bucket brand-assets de este proyecto.');
  }
  const path = decodeURIComponent(logo.pathname.slice(prefix.length));
  if (!path || path.split('/').some(piece => piece === '..')) throw new Error('Ruta de logo inválida.');
  const { data, error } = await admin.storage.from('brand-assets').download(path);
  if (error || !data) throw new Error('No se pudo cargar el logo guardado.');
  if (data.size > 2 * 1024 * 1024) throw new Error('El logo supera 2 MB.');
  const bytes = new Uint8Array(await data.arrayBuffer());
  const png = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if (!png && !jpeg) throw new Error('El logo debe ser PNG o JPG.');
  return { logoBytes: bytes, logoType: png ? 'png' : 'jpeg' };
}

Deno.serve(async (request: Request) => {
  const allowedOrigin = env('ALLOWED_ORIGIN');
  const origin = request.headers.get('Origin');
  const cors: Record<string, string> = {
    'Access-Control-Allow-Origin': allowedOrigin || 'null',
    'Access-Control-Allow-Headers': 'authorization, apikey, x-client-info, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Vary': 'Origin',
  };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
  if (origin && (!allowedOrigin || origin !== allowedOrigin)) return reply({ error: 'Origen no autorizado.' }, 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return reply({ error: 'Método no permitido.' }, 405);
  const authorization = request.headers.get('Authorization') || '';
  if (!authorization.startsWith('Bearer ')) return reply({ error: 'Inicia sesión para consultar la cotización.' }, 401);
  try {
    const key = env('SUPABASE_PUBLISHABLE_KEY') || env('SUPABASE_ANON_KEY');
    if (!dbUrl || !key || !env('SUPABASE_SERVICE_ROLE_KEY')) return reply({ error: 'Falta configurar el proyecto Supabase.' }, 503);
    const client = createClient(dbUrl, key, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: auth, error: authError } = await client.auth.getUser(authorization.slice(7));
    if (authError || !auth.user) return reply({ error: 'Sesión inválida o vencida.' }, 401);
    const body = await request.json();
    if (!UUID.test(body.quote_id || '') || !['pdf', 'sync'].includes(body.action)) return reply({ error: 'Solicitud inválida.' }, 400);
    const { data: quote, error: quoteError } = await client.from('quotes').select('*').eq('id', body.quote_id).single();
    if (quoteError || !quote) return reply({ error: 'No tienes acceso a esta cotización.' }, 404);
    const [{ data: items, error: itemError }, { data: company, error: companyError }] = await Promise.all([
      client.from('quote_items').select('*').eq('quote_id', quote.id).order('position'),
      client.from('company_settings').select('*').eq('id', 1).single(),
    ]);
    if (itemError || companyError || !items || !company) throw new Error('No se pudo leer la cotización completa.');
    const admin = createClient(dbUrl, env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
    const image = await logoForPdf(quote.logo_url, admin);
    const bytes = await generateQuotePdf({ quote, items, company, ...image });
    const version = String(quote.updated_at).replace(/[^0-9]/g, '');
    const pdfPath = `${quote.id}/${version || '1'}.pdf`;
    const { error: uploadError } = await admin.storage.from('quote-pdfs').upload(pdfPath, bytes, { contentType: 'application/pdf', upsert: true });
    if (uploadError) throw new Error('No se pudo guardar el PDF.');
    const { error: pathError } = await admin.from('quotes').update({ pdf_path: pdfPath }).eq('id', quote.id).eq('updated_at', quote.updated_at);
    if (pathError) throw new Error('No se pudo registrar el PDF.');
    const { data: signed, error: signError } = await admin.storage.from('quote-pdfs').createSignedUrl(pdfPath, 600);
    if (signError || !signed?.signedUrl) throw new Error('No se pudo abrir el PDF.');
    const result: Record<string, unknown> = { pdf_url: signed.signedUrl, pdf_path: pdfPath, sync_status: 'pending' };
    if (body.action === 'pdf') {
      const { data: existingSync } = await client.from('sheet_sync').select('status').eq('quote_id', quote.id).maybeSingle();
      result.sync_status = existingSync?.status || 'pending';
      return reply(result);
    }
    const googleEmail = env('GOOGLE_SERVICE_ACCOUNT_EMAIL');
    const googleKey = env('GOOGLE_PRIVATE_KEY');
    const googleSheet = env('GOOGLE_SHEET_ID');
    if (!googleEmail || !googleKey || !googleSheet || !env('APP_URL')) {
      await admin.from('sheet_sync').upsert({ quote_id: quote.id, status: 'pending', error: 'Falta conectar Google Sheets.', updated_at: new Date().toISOString() });
      result.error = 'El PDF está listo. Falta conectar Google Sheets.';
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
      // All external calls have a 12-second timeout; this operation ends well
      // before the 120-second lease can expire.
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
    return reply({ error: message }, 400);
  }
});
