const SHEETS_ROOT = 'https://sheets.googleapis.com/v4/spreadsheets';
export const SHEET_HEADERS = ['ID', 'Folio', 'Fecha', 'Cliente', 'Empresa', 'Correo', 'Campaña', 'Estado', 'Vigencia', 'Moneda', 'Subtotal', 'Descuento', 'Total', 'IVA', 'PDF', 'Actualización', 'Vendedor', 'Correo vendedor', 'WhatsApp vendedor', 'Tipo', 'Orden de compra', 'Fecha OC', 'Eliminada el'];

function base64url(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function limitedFetch(url, init = {}) {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10000) });
  const json = await response.json();
  if (!response.ok) throw new Error('Google rechazó la operación (' + response.status + '). Revisa que Google Sheets API esté habilitada y que la hoja esté compartida con la cuenta de servicio como Editor.');
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
  const unsigned = header + '.' + claims;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(unsigned));
  const result = await limitedFetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: unsigned + '.' + base64url(new Uint8Array(signature)) }),
  });
  if (!result.access_token) throw new Error('Google no entregó un acceso válido.');
  return result.access_token;
}

export function quoteSheetRow(quote, appUrl) {
  const link = new URL(appUrl);
  link.search = ''; link.hash = ''; link.searchParams.set('quote', quote.id);
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const status = quote.deleted_at ? 'Eliminada' : ['borrador', 'enviada'].includes(quote.status) && quote.valid_until < today ? 'vencida' : quote.status;
  return [
    quote.id, quote.folio || '', quote.created_at || '', quote.client_name || '', quote.client_company || '',
    quote.client_email || '', quote.campaign || '', status || '', quote.valid_until || '',
    'MXN', Number(quote.subtotal), Number(quote.discount_amount), Number(quote.total),
    'No incluye IVA.', quote.deleted_at ? '' : link.toString(), quote.updated_at || '',
    quote.seller_name || '', quote.seller_email || '', quote.seller_whatsapp || '',
    quote.is_sample ? 'Muestra' : 'Real', quote.oc_folio || '', quote.oc_created_at || '', quote.deleted_at || '',
  ];
}

/** Caller must hold the global database lease for the whole read/modify operation. */
export async function upsertSheetQuote({ sheetId, tab, accessToken, quote, appUrl }) {
  if (quote.is_sample) throw new Error('Las cotizaciones de muestra no se sincronizan con la hoja comercial.');
  if (!/^[A-Za-z0-9_-]+$/.test(sheetId)) throw new Error('ID de Google Sheets inválido.');
  const tabName = String(tab || 'Cotizaciones');
  if (!tabName.trim() || tabName.length > 100 || /[\[\]:*?/\\]/.test(tabName)) throw new Error('Nombre de pestaña de Google Sheets inválido.');
  const spreadsheet = SHEETS_ROOT + '/' + encodeURIComponent(sheetId);
  const auth = { Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' };
  // A brand-new spreadsheet normally has Hoja 1. Create our dedicated tab once,
  // without renaming or overwriting any existing user sheets.
  const metadata = await limitedFetch(spreadsheet + '?fields=sheets.properties', { headers: auth });
  if (!(metadata.sheets || []).some(sheet => sheet.properties?.title === tabName)) {
    await limitedFetch(spreadsheet + ':batchUpdate', {
      method: 'POST', headers: auth, body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tabName } } }] }),
    });
  }
  const sheetName = "'" + tabName.replace(/'/g, "''") + "'";
  const root = spreadsheet + '/values/';
  const index = await limitedFetch(root + encodeURIComponent(sheetName + '!A:A'), { headers: auth });
  const rows = index.values || [];
  if (rows.length && String(rows[0]?.[0] || '') !== SHEET_HEADERS[0]) {
    throw new Error('La pestaña debe estar vacía o tener ID en A1. Usa una pestaña dedicada al cotizador.');
  }
  const matching = rows.map((row, i) => String(row?.[0] || '') === quote.id ? i + 1 : 0).filter(Boolean);
  if (matching.length > 1) throw new Error('Hay IDs duplicados en Google Sheets. Corrige esas filas antes de sincronizar.');
  // A deleted quote that was never synchronized must not create a new commercial row.
  if (quote.deleted_at && !matching.length) return { row: null, deleted: true };
  await limitedFetch(root + encodeURIComponent(sheetName + '!A1:W1') + '?valueInputOption=RAW', {
    method: 'PUT', headers: auth, body: JSON.stringify({ values: [SHEET_HEADERS] }),
  });
  const rowNumber = matching[0] || Math.max(2, rows.length + 1);
  await limitedFetch(root + encodeURIComponent(sheetName + '!A' + rowNumber + ':W' + rowNumber) + '?valueInputOption=RAW', {
    method: 'PUT', headers: auth, body: JSON.stringify({ values: [quoteSheetRow(quote, appUrl)] }),
  });
  return { row: rowNumber, deleted: Boolean(quote.deleted_at) };
}