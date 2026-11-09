import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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
