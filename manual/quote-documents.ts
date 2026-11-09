// Versión de un solo archivo para el editor de Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';


const INK = rgb(0.06, 0.06, 0.06);
const MUTED = rgb(0.42, 0.42, 0.42);
const ACCENT = rgb(0.04, 0.04, 0.04);
const LIGHT = rgb(0.955, 0.955, 0.955);
const PAPER = [595.28, 841.89];
const MARGIN = 42;

// Standard PDF fonts support Spanish/Western European text. Unsupported glyphs
// are transliterated instead of breaking document generation (for example emoji).
export function pdfText(value) {
  return String(value ?? '').normalize('NFC').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
    .replace(/[^\x20-\x7e\xa0-\xff\n\t]/gu, '?');
}

export function wrapPdfText(value, font, size, width) {
  const output = [];
  for (const paragraph of pdfText(value).split(/\r?\n/)) {
    const words = paragraph.trim().split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const trial = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(trial, size) <= width) { line = trial; continue; }
      if (line) output.push(line);
      line = '';
      for (const char of word) {
        if (line && font.widthOfTextAtSize(line + char, size) > width) {
          output.push(line); line = '';
        }
        line += char;
      }
    }
    output.push(line);
  }
  return output.length ? output : [''];
}

const money = value => new Intl.NumberFormat('es-MX', {
  style: 'currency', currency: 'MXN', minimumFractionDigits: 2,
}).format(Number(value || 0));

function dateText(value) {
  if (!value) return '-';
  const text = String(value);
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(text) ? text + 'T12:00:00Z' : text);
  return Number.isNaN(date.getTime()) ? pdfText(value) : new Intl.DateTimeFormat('es-MX', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'America/Mexico_City',
  }).format(date);
}

function decodeDataLogo(url) {
  const match = /^data:image\/(png|jpeg|jpg);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(url || '');
  if (!match || match[2].length > 2800000) return null;
  const raw = atob(match[2]);
  return { bytes: Uint8Array.from(raw, char => char.charCodeAt(0)), type: match[1] };
}

/**
 * Generate an A4 quote from immutable saved values. No prices are recalculated.
 * @param {{quote: any, items: any[], company?: any, logoBytes?: Uint8Array, logoType?: string}} input
 */
export async function generateQuotePdf({ quote, items, company = {}, logoBytes, logoType }) {
  if (!quote || !Array.isArray(items)) throw new Error('Cotización incompleta.');
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const companyName = quote.company_name || company.name || 'Cotizador EM Agency';
  const folio = quote.folio || 'VISTA PREVIA';
  doc.setTitle(`${folio} - ${companyName}`);
  doc.setAuthor(companyName);
  doc.setSubject('Cotización en MXN. No incluye IVA.');
  let logo = null;
  const localLogo = decodeDataLogo(quote.logo_url || company.logo_url);
  const imageBytes = logoBytes || localLogo?.bytes;
  const imageType = logoType || localLogo?.type;
  if (imageBytes?.length) {
    if (imageBytes.length > 2 * 1024 * 1024) throw new Error('El logo supera 2 MB.');
    try {
      logo = imageType === 'png' ? await doc.embedPng(imageBytes) : await doc.embedJpg(imageBytes);
    } catch { throw new Error('El logo debe ser un archivo PNG o JPG válido.'); }
  }
  let logoBounds = logo ? { x: 0, y: 0, width: logo.width, height: logo.height } : null;
  // pdf-lib 1.17.1 retains the decoded PNG alpha channel until save(). Reading
  // its bounds lets us position the original intact logo despite blank margins.
  const alpha = logo?.embedder?.image?.alphaChannel;
  if (alpha) {
    let left = logo.width, top = logo.height, rightEdge = -1, bottom = -1;
    for (let row = 0; row < logo.height; row++) {
      for (let col = 0; col < logo.width; col++) {
        if (alpha[row * logo.width + col] > 0) {
          left = Math.min(left, col); top = Math.min(top, row);
          rightEdge = Math.max(rightEdge, col); bottom = Math.max(bottom, row);
        }
      }
    }
    if (rightEdge >= left) logoBounds = { x: left, y: top, width: rightEdge - left + 1, height: bottom - top + 1 };
  }
  let page, y;
  const width = PAPER[0] - MARGIN * 2;
  const line = (text, x, top, size = 10, font = regular, color = INK) => {
    page.drawText(pdfText(text), { x, y: top, size, font, color });
  };
  const right = (text, edge, top, size = 10, font = regular, color = INK) => {
    const safe = pdfText(text);
    line(safe, edge - font.widthOfTextAtSize(safe, size), top, size, font, color);
  };
  const drawLogo = (boxX, boxY, boxWidth, boxHeight, opacity = 1) => {
    if (!logo || !logoBounds) return;
    const scale = Math.min(boxWidth / logoBounds.width, boxHeight / logoBounds.height);
    page.drawImage(logo, {
      x: boxX - logoBounds.x * scale,
      y: boxY - (logo.height - logoBounds.y - logoBounds.height) * scale,
      width: logo.width * scale, height: logo.height * scale, opacity,
    });
  };
  const newPage = () => {
    page = doc.addPage(PAPER);
    page.drawRectangle({ x: 0, y: PAPER[1] - 7, width: PAPER[0], height: 7, color: ACCENT });
    if (logo) drawLogo(100, 290, 395, 238, 0.035);
    if (logo) {
      drawLogo(MARGIN, PAPER[1] - 96, 132, 68);
      line('EM AGENCY', MARGIN, PAPER[1] - 105, 7, bold);
    } else {
      const nameLines = wrapPdfText(companyName, bold, 16, width - 190);
      nameLines.slice(0, 2).forEach((name, index) => line(name, MARGIN, PAPER[1] - 48 - index * 20, 16, bold));
    }
    right('PROPUESTA COMERCIAL', PAPER[0] - MARGIN, PAPER[1] - 44, 10, bold, ACCENT);
    right(folio, PAPER[0] - MARGIN, PAPER[1] - 64, 11, bold);
    page.drawLine({ start: { x: MARGIN, y: PAPER[1] - 112 }, end: { x: PAPER[0] - MARGIN, y: PAPER[1] - 112 }, thickness: 0.7, color: INK });
    y = PAPER[1] - 135;
  };
  const ensure = height => { if (y - height < 66) newPage(); };
  const paragraph = (value, { size = 10, font = regular, color = INK, indent = 0 } = {}) => {
    for (const text of wrapPdfText(value, font, size, width - indent)) {
      ensure(size + 5); line(text, MARGIN + indent, y, size, font, color); y -= size + 5;
    }
  };
  newPage();
  paragraph('Conectamos marcas y creadores.', { size: 22, font: bold });
  paragraph('PROPUESTA DE COLABORACIÓN  /  INSTAGRAM', { size: 8, color: MUTED });
  y -= 10;
  if (String(folio).startsWith('VISTA-')) {
    paragraph('VISTA LOCAL - sin folio definitivo', { size: 11, font: bold, color: ACCENT });
    y -= 7;
  }
  paragraph(`Fecha: ${dateText(quote.created_at)}  |  Vigencia: ${dateText(quote.valid_until)}`, { size: 9, color: MUTED });
  y -= 10;
  paragraph(quote.client_name || 'Cliente', { size: 15, font: bold });
  if (quote.client_company) paragraph(quote.client_company, { color: MUTED });
  if (quote.client_email) paragraph(quote.client_email, { size: 9, color: MUTED });
  if (quote.campaign) { y -= 7; paragraph(`Campaña: ${quote.campaign}`, { font: bold }); }
  y -= 20;

  const cols = [MARGIN, 297, 341, 435, PAPER[0] - MARGIN];
  const tableHeader = () => {
    ensure(29);
    page.drawRectangle({ x: MARGIN, y: y - 10, width, height: 27, color: INK });
    line('SERVICIO / CUENTA', MARGIN + 9, y, 8, bold, rgb(1, 1, 1));
    right('CANT.', 329, y, 8, bold, rgb(1, 1, 1));
    right('PRECIO', 425, y, 8, bold, rgb(1, 1, 1));
    right('IMPORTE', cols[4] - 9, y, 8, bold, rgb(1, 1, 1));
    y -= 33;
  };
  tableHeader();
  for (const [index, item] of items.entries()) {
    const desc = wrapPdfText(`${item.service || ''}\n${item.instagram_handle || ''}`, regular, 9, 240);
    const wholeRowHeight = Math.max(32, desc.length * 13 + 12);
    if (wholeRowHeight <= 630 && y - wholeRowHeight < 66) { newPage(); tableHeader(); }
    // Split even very long descriptions safely across pages, repeating numbers only once.
    let cursor = 0;
    while (cursor < desc.length) {
      if (y - 36 < 66) { newPage(); tableHeader(); }
      const availableLines = Math.max(1, Math.floor((y - 78) / 13));
      const chunk = desc.slice(cursor, cursor + availableLines);
      const rowHeight = Math.max(32, chunk.length * 13 + 12);
      if (index % 2 === 0) page.drawRectangle({ x: MARGIN, y: y - rowHeight + 12, width, height: rowHeight, color: LIGHT });
      chunk.forEach((text, row) => line(text, MARGIN + 8, y - row * 13, 9));
      if (cursor === 0) {
        right(String(item.quantity ?? 1), 329, y, 9);
        right(money(item.unit_price), 425, y, 9);
        right(money(item.line_total), cols[4] - 9, y, 9, bold);
      }
      y -= rowHeight;
      cursor += chunk.length;
    }
  }
  y -= 12;
  ensure(110);
  const amountLine = (label, amount, { strong = false, color = INK } = {}) => {
    line(label, 333, y, strong ? 12 : 10, strong ? bold : regular, color);
    right(money(amount), PAPER[0] - MARGIN - 9, y, strong ? 12 : 10, strong ? bold : regular, color);
    y -= strong ? 25 : 20;
  };
  if (Number(quote.discount_amount) > 0) {
    amountLine('Subtotal', quote.subtotal);
    amountLine('Descuento', -Number(quote.discount_amount));
  }
  amountLine('TOTAL MXN', quote.total, { strong: true, color: ACCENT });
  paragraph('No incluye IVA.', { size: 10, font: bold, color: ACCENT, indent: 291 });
  y -= 17;
  if (quote.notes) {
    paragraph('Observaciones', { font: bold });
    paragraph(quote.notes, { size: 9, color: MUTED }); y -= 12;
  }
  const terms = quote.terms ?? company.terms;
  if (terms) {
    paragraph('Condiciones', { font: bold });
    paragraph(terms, { size: 9, color: MUTED });
  }
  const pages = doc.getPages();
  pages.forEach((sheet, index) => {
    sheet.drawLine({ start: { x: MARGIN, y: 46 }, end: { x: PAPER[0] - MARGIN, y: 46 }, thickness: 0.5, color: rgb(0.82, 0.83, 0.84) });
    sheet.drawText(pdfText(`${folio} | MXN | No incluye IVA.`), { x: MARGIN, y: 31, size: 8, font: regular, color: MUTED });
    const count = `${index + 1} / ${pages.length}`;
    sheet.drawText(count, { x: PAPER[0] - MARGIN - regular.widthOfTextAtSize(count, 8), y: 31, size: 8, font: regular, color: MUTED });
  });
  return doc.save();
}

const SHEETS_ROOT = 'https://sheets.googleapis.com/v4/spreadsheets';
const HEADERS = ['ID', 'Folio', 'Fecha', 'Cliente', 'Empresa', 'Correo', 'Campaña', 'Estado', 'Vigencia', 'Moneda', 'Subtotal', 'Descuento', 'Total', 'IVA', 'PDF', 'Actualización'];

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function limitedFetch(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(12000) });
  const json = await response.json();
  if (!response.ok) throw new Error(`Google rechazó la operación (${response.status}). Revisa la cuenta de servicio y los permisos de la hoja.`);
  return json;
}

export async function googleAccessToken(email, privateKey) {
  const pem = privateKey.replace(/\\n/g, '\n').replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const bytes = Uint8Array.from(atob(pem), char => char.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', bytes, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const issuedAt = Math.floor(Date.now() / 1000);
  const encoder = new TextEncoder();
  const header = base64url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = base64url(encoder.encode(JSON.stringify({
    iss: email, scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token', iat: issuedAt, exp: issuedAt + 3600,
  })));
  const unsigned = `${header}.${claims}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned));
  const result = await limitedFetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${base64url(new Uint8Array(signature))}` }),
  });
  if (!result.access_token) throw new Error('Google no entregó un acceso válido.');
  return result.access_token;
}

export function quoteSheetRow(quote, appUrl) {
  const link = new URL(appUrl);
  link.search = ''; link.hash = ''; link.searchParams.set('quote', quote.id);
  return [
    quote.id, quote.folio, quote.created_at, quote.client_name, quote.client_company || '',
    quote.client_email || '', quote.campaign || '', quote.status, quote.valid_until,
    'MXN', Number(quote.subtotal), Number(quote.discount_amount), Number(quote.total),
    'No incluye IVA.', link.toString(), quote.updated_at,
  ];
}

/** Caller must hold the global database lease for the whole read/modify operation. */
export async function upsertSheetQuote({ sheetId, tab, accessToken, quote, appUrl }) {
  if (!/^[A-Za-z0-9_-]+$/.test(sheetId)) throw new Error('ID de Google Sheets inválido.');
  const sheetName = `'${String(tab || 'Cotizaciones').replace(/'/g, "''")}'`;
  const root = `${SHEETS_ROOT}/${encodeURIComponent(sheetId)}/values/`;
  const auth = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };
  const index = await limitedFetch(root + encodeURIComponent(`${sheetName}!A:A`), { headers: auth });
  const rows = index.values || [];
  if (rows.length && String(rows[0]?.[0] || '') !== HEADERS[0]) {
    throw new Error('La pestaña debe estar vacía o tener ID en A1. Usa una pestaña dedicada al cotizador.');
  }
  if (!rows.length) {
    await limitedFetch(root + encodeURIComponent(`${sheetName}!A1:P1`) + '?valueInputOption=RAW', {
      method: 'PUT', headers: auth, body: JSON.stringify({ values: [HEADERS] }),
    });
  }
  const matching = rows.map((row, i) => String(row?.[0] || '') === quote.id ? i + 1 : 0).filter(Boolean);
  if (matching.length > 1) throw new Error('Hay IDs duplicados en Google Sheets. Corrige esas filas antes de sincronizar.');
  const rowNumber = matching[0] || Math.max(2, rows.length + 1);
  await limitedFetch(root + encodeURIComponent(`${sheetName}!A${rowNumber}:P${rowNumber}`) + '?valueInputOption=RAW', {
    method: 'PUT', headers: auth, body: JSON.stringify({ values: [quoteSheetRow(quote, appUrl)] }),
  });
  return { row: rowNumber };
}


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
