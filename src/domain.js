const MXN_FORMAT = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
const HEADERS = ['handle', 'display_name', 'category', 'followers', 'service', 'unit_price', 'currency'];
const MEXICO_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' });

function cents(value, label) {
  if (value === null || value === undefined || typeof value === 'boolean' || (typeof value === 'string' && !value.trim())) throw new Error(label + ': indica un importe válido.');
  const number = Number(value);
  const scaled = number * 100;
  const rounded = Math.round(scaled);
  if (!Number.isFinite(number) || number < 0 || !Number.isSafeInteger(rounded) || Math.abs(scaled - rounded) > 0.00001) {
    throw new Error(label + ': usa un importe positivo o cero, con máximo dos decimales.');
  }
  if (rounded > 99999999999999) throw new Error(label + ': el importe es demasiado grande.');
  return rounded;
}

function integer(value, min, max, label) {
  if ((typeof value === 'string' && !/^\d+$/.test(value.trim())) || value === '' || value === null || typeof value === 'boolean') {
    throw new Error(label + ': indica un número entero entre ' + min + ' y ' + max + '.');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(label + ': indica un número entero entre ' + min + ' y ' + max + '.');
  return parsed;
}

export function money(amount, currency = 'MXN') {
  const number = Number(amount);
  if (!Number.isFinite(number)) return '—';
  return currency === 'MXN' ? MXN_FORMAT.format(number) : new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(number);
}

export function calculateTotals(items, discountAmount = 0) {
  if (!Array.isArray(items) || items.length > 100) throw new Error('La cotización admite un máximo de 100 conceptos.');
  let subtotalCents = 0;
  items.forEach((item, index) => {
    const quantity = integer(item.quantity, 1, 10000, 'Cantidad del concepto ' + (index + 1));
    const line = cents(item.unit_price, 'Precio del concepto ' + (index + 1)) * quantity;
    subtotalCents += line;
    if (!Number.isSafeInteger(line) || !Number.isSafeInteger(subtotalCents) || subtotalCents > 99999999999999) throw new Error('El importe de la cotización es demasiado grande.');
  });
  const discountCents = cents(discountAmount, 'Descuento');
  if (discountCents > subtotalCents) throw new Error('El descuento no puede superar el subtotal.');
  return { subtotal: subtotalCents / 100, discount_amount: discountCents / 100, tax_amount: 0, total: (subtotalCents - discountCents) / 100 };
}

export function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function dateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return null;
  const parsed = new Date(value + 'T12:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null;
}

function mexicoToday() {
  const parts = Object.fromEntries(MEXICO_DATE.formatToParts(new Date()).map(part => [part.type, part.value]));
  return parts.year + '-' + parts.month + '-' + parts.day;
}

export function effectiveStatus(quote) {
  if (quote.deleted_at) return 'eliminada';
  if (quote.is_sample) return 'muestra';
  const validity = dateOnly(quote.valid_until);
  if (!validity || !['borrador', 'enviada'].includes(quote.status)) return quote.status;
  const today = mexicoToday();
  return validity < today ? 'vencida' : quote.status;
}

function textField(value, label, max, required = false) {
  if (value !== undefined && value !== null && typeof value !== 'string') throw new Error(label + ': indica texto válido.');
  const result = (value ?? '').trim();
  if (required && !result) throw new Error(label + ': este dato es obligatorio.');
  if (result.length > max) throw new Error(label + ': máximo ' + max + ' caracteres.');
  return result;
}

export function validateQuoteInput(input, rates) {
  if (!input || typeof input !== 'object') throw new Error('Los datos de la cotización no son válidos.');
  if (input.is_sample !== undefined && typeof input.is_sample !== 'boolean') throw new Error('Selecciona cotización real o de muestra.');
  const whatsapp = textField(input.seller_whatsapp, 'WhatsApp del vendedor', 40);
  if (whatsapp && (!/^[+()\d .-]+$/.test(whatsapp) || !/^\d{7,15}$/.test(whatsapp.replace(/\D/g, '')))) throw new Error('El WhatsApp debe incluir entre 7 y 15 dígitos; puedes usar +, espacios y guiones.');
  const clientName = textField(input.client_name, 'Cliente', 200, true);
  const email = textField(input.client_email, 'Correo', 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('El correo del cliente no es válido.');
  if (!dateOnly(input.valid_until)) throw new Error('La fecha de vigencia no es válida.');
  const today = mexicoToday();
  const lastDate = new Date(today + 'T12:00:00Z');
  lastDate.setUTCDate(lastDate.getUTCDate() + 3650);
  if (input.valid_until < today || input.valid_until > lastDate.toISOString().slice(0, 10)) throw new Error('La vigencia debe comenzar hoy o después, dentro de los próximos 3,650 días.');
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 100) throw new Error('Agrega entre 1 y 100 conceptos a la cotización.');
  const available = new Map((rates ?? []).map(rate => [String(rate.id), rate]));
  const pricedItems = [];
  const items = input.items.map((item, index) => {
    const rate = available.get(String(item.rate_id));
    if (!rate || rate.active === false) throw new Error('El concepto ' + (index + 1) + ' no tiene una tarifa activa.');
    if (rate.currency && rate.currency !== 'MXN') throw new Error('El concepto ' + (index + 1) + ' debe tener una tarifa en MXN.');
    const quantity = integer(item.quantity, 1, 10000, 'Cantidad del concepto ' + (index + 1));
    pricedItems.push({ quantity, unit_price: rate.unit_price });
    return { rate_id: rate.id, quantity };
  });
  const totals = calculateTotals(pricedItems, input.discount_amount ?? 0);
  return {
    is_sample: input.is_sample === true,
    seller_whatsapp: whatsapp,
    client_name: clientName,
    client_email: email,
    client_company: textField(input.client_company, 'Empresa', 200),
    campaign: textField(input.campaign, 'Campaña', 300),
    valid_until: input.valid_until,
    discount_amount: totals.discount_amount,
    notes: textField(input.notes, 'Notas', 5000),
    items,
    totals,
  };
}

function csvDelimiter(source) {
  let quoted = false;
  let commas = 0;
  let semicolons = 0;
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (character === '"') {
      if (quoted && source[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (character === '\n' || character === '\r') break;
      if (character === ',') commas++;
      if (character === ';') semicolons++;
    }
  }
  return semicolons > commas ? ';' : ',';
}

function csvRows(source, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let closedQuote = false;
  const pushField = () => { row.push(field); field = ''; closedQuote = false; };
  const pushRow = () => { pushField(); if (row.some(value => value.trim() !== '')) rows.push(row); row = []; };
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"') {
        if (source[index + 1] === '"') { field += '"'; index++; }
        else { quoted = false; closedQuote = true; }
      } else field += character;
      continue;
    }
    if (character === delimiter) { pushField(); continue; }
    if (character === '\r' || character === '\n') {
      if (character === '\r' && source[index + 1] === '\n') index++;
      pushRow();
      continue;
    }
    if (character === '"') {
      if (field.length || closedQuote) throw new Error('El CSV contiene comillas mal colocadas. Guarda el archivo como CSV UTF-8.');
      quoted = true;
    } else {
      if (closedQuote && !/\s/.test(character)) throw new Error('El CSV contiene texto después de cerrar comillas.');
      if (!closedQuote) field += character;
    }
  }
  if (quoted) throw new Error('El CSV contiene un campo con comillas sin cerrar.');
  pushRow();
  return rows;
}

export function parseCatalogCsv(text) {
  if (typeof text !== 'string') throw new Error('El catálogo debe ser un archivo CSV UTF-8.');
  const source = text.replace(/^\uFEFF/, '');
  const delimiter = csvDelimiter(source);
  const rows = csvRows(source, delimiter);
  if (!rows.length) throw new Error('El catálogo está vacío. Usa la plantilla y agrega tus cuentas y tarifas.');
  const headers = rows.shift().map(value => value.trim().toLowerCase());
  if (new Set(headers).size !== headers.length || headers.length !== HEADERS.length || HEADERS.some(header => !headers.includes(header))) {
    throw new Error('El CSV debe tener estas columnas: ' + HEADERS.join(', ') + '.');
  }
  if (!rows.length) throw new Error('La plantilla no contiene tarifas. Agrega al menos una cuenta y servicio.');
  if (rows.length > 10000) throw new Error('Importa como máximo 10,000 tarifas por archivo.');
  const accounts = new Map();
  const rates = [];
  const uniqueRates = new Set();
  rows.forEach((cells, index) => {
    const rowLabel = 'Registro ' + (index + 2);
    if (cells.length !== headers.length) throw new Error(rowLabel + ': el número de columnas no coincide con el encabezado.');
    const row = Object.fromEntries(headers.map((header, position) => [header, cells[position].trim()]));
    const handle = row.handle.replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?$/.test(handle) || handle.includes('..')) throw new Error(rowLabel + ': la cuenta de Instagram no es válida (máximo 30 caracteres, sin URL).');
    const displayName = textField(row.display_name, rowLabel + ', nombre', 200, true);
    const category = textField(row.category, rowLabel + ', categoría', 100);
    const followers = row.followers === '' ? null : integer(row.followers, 0, 2147483647, rowLabel + ', seguidores');
    const service = textField(row.service, rowLabel + ', servicio', 200, true);
    if (row.currency.toUpperCase() !== 'MXN') throw new Error(rowLabel + ': la moneda debe ser MXN.');
    const priceText = delimiter === ';' && /^\d+,\d{1,2}$/.test(row.unit_price) ? row.unit_price.replace(',', '.') : row.unit_price;
    if (!/^\d+(?:\.\d{1,2})?$/.test(priceText)) throw new Error(rowLabel + ': el precio debe ser un número sin separadores de miles, con máximo dos decimales.');
    const unitPrice = cents(priceText, rowLabel + ', precio') / 100;
    const account = { handle, display_name: displayName, category, followers, active: true };
    const existing = accounts.get(handle);
    if (existing && (existing.display_name !== displayName || existing.category !== category || existing.followers !== followers)) throw new Error(rowLabel + ': los datos de @' + handle + ' no coinciden con otra fila de la misma cuenta.');
    accounts.set(handle, account);
    const key = handle + '\u0000' + service.toLocaleLowerCase('es-MX');
    if (uniqueRates.has(key)) throw new Error(rowLabel + ': la tarifa de @' + handle + ' / ' + service + ' está duplicada.');
    uniqueRates.add(key);
    rates.push({ handle, service, unit_price: unitPrice, currency: 'MXN', active: true });
  });
  return { accounts: [...accounts.values()], rates };
}





export function priceWithCommission(basePrice, commissionPercent) {
  const baseCents = cents(basePrice, 'Costo del talento');
  const percentagePoints = cents(commissionPercent, 'Comisión');
  if (percentagePoints >= 10000) throw new Error('La comisión debe ser menor a 100%.');
  const denominator = 10000n - BigInt(percentagePoints);
  const numerator = BigInt(baseCents) * 10000n;
  const result = (2n * numerator + denominator) / (2n * denominator);
  if (result > 99999999999999n) throw new Error('El precio con comisión es demasiado grande.');
  return Number(result) / 100;
}


export function parseCatalogJson(text) {
  let input;
  try { input = JSON.parse(text); } catch { throw new Error('El catálogo JSON no es válido. Revisa el formato del archivo.'); }
  if (!input || typeof input !== 'object' || Array.isArray(input) || !Array.isArray(input.accounts) || !Array.isArray(input.rates)) throw new Error('El JSON debe contener las listas accounts y rates.');
  if (!input.accounts.length || input.accounts.length > 10000 || input.rates.length > 10000) throw new Error('El catálogo admite entre 1 y 10,000 cuentas y un máximo de 10,000 tarifas.');
  function handleOf(value, label) {
    if (typeof value !== 'string') throw new Error(label + ': indica el usuario de Instagram.');
    const handle = value.trim().replace(/^@/, '').toLowerCase();
    if (!/^[a-z0-9_](?:[a-z0-9_.]{0,28}[a-z0-9_])?$/.test(handle) || handle.includes('..')) throw new Error(label + ': la cuenta de Instagram no es válida.');
    return handle;
  }
  function activeOf(value, label) {
    if (value !== undefined && typeof value !== 'boolean') throw new Error(label + ': active debe ser true o false.');
    return value === undefined ? true : value;
  }
  const handles = new Set();
  const accounts = input.accounts.map((account, index) => {
    const label = 'Cuenta ' + (index + 1);
    if (!account || typeof account !== 'object' || Array.isArray(account)) throw new Error(label + ': los datos no son válidos.');
    const handle = handleOf(account.handle, label);
    if (handles.has(handle)) throw new Error(label + ': @' + handle + ' está duplicada.');
    handles.add(handle);
    const followers = account.followers === undefined || account.followers === null ? null : (typeof account.followers === 'number' ? integer(account.followers, 0, 2147483647, label + ', seguidores') : (() => { throw new Error(label + ': seguidores debe ser un entero o null.'); })());
    return { handle, display_name: textField(account.display_name, label + ', nombre', 200, true), category: textField(account.category, label + ', categoría', 200), followers, active: activeOf(account.active, label) };
  });
  const keys = new Set();
  const rates = input.rates.map((rate, index) => {
    const label = 'Tarifa ' + (index + 1);
    if (!rate || typeof rate !== 'object' || Array.isArray(rate)) throw new Error(label + ': los datos no son válidos.');
    const handle = handleOf(rate.handle, label);
    if (!handles.has(handle)) throw new Error(label + ': @' + handle + ' no aparece en accounts.');
    const service = textField(rate.service, label + ', servicio', 300, true);
    const key = handle + '\u0000' + service.toLocaleLowerCase('es-MX');
    if (keys.has(key)) throw new Error(label + ': la cuenta y el servicio están duplicados.');
    keys.add(key);
    if (rate.currency !== 'MXN') throw new Error(label + ': la moneda debe ser MXN.');
    if (typeof rate.unit_price !== 'number') throw new Error(label + ': unit_price debe ser un número en pesos.');
    return { handle, service, unit_price: cents(rate.unit_price, label + ', precio') / 100, currency: 'MXN', active: activeOf(rate.active, label) };
  });
  return { accounts, rates };
}


export function quoteLabel(quote) {
  return quote.is_sample ? 'Muestra sin folio' : (quote.folio || 'Pendiente de folio');
}
export function isRealQuote(quote) { return !quote.is_sample && !quote.deleted_at; }
