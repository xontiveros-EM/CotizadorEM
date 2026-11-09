import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { generateQuotePdf } from '../src/pdf.js';

const quote = {
  id: '8d0a3b12-2d73-4d03-ae58-62f0cfce11bc', folio: 'VISTA-0001',
  company_name: 'Cotizador EM Agency', client_name: 'María Pérez',
  client_company: 'Empresa de prueba', client_email: 'cliente@example.test',
  campaign: 'Campaña de lanzamiento · ejemplo ficticio', status: 'borrador', currency: 'MXN',
  created_at: '2026-11-09T12:00:00Z', updated_at: '2026-11-09T12:00:00Z',
  valid_until: '2026-11-30', subtotal: 3500, discount_amount: 500, total: 3000,
  notes: 'Los datos y precios de este documento son ficticios y se utilizan exclusivamente para revisar el formato.',
  terms: 'Precios en pesos mexicanos (MXN). No incluye IVA. La contratación queda sujeta a disponibilidad y aceptación de la cotización.',
};
const items = [
  { instagram_handle: '@cuenta_ejemplo_1', service: 'Reel de Instagram', quantity: 1, unit_price: 1500, line_total: 1500 },
  { instagram_handle: '@cuenta_ejemplo_2', service: 'Historia de Instagram', quantity: 2, unit_price: 1000, line_total: 2000 },
];
await mkdir(new URL('../tmp/pdfs/', import.meta.url), { recursive: true });
await writeFile(new URL('../tmp/pdfs/vista-cotizacion.pdf', import.meta.url), await generateQuotePdf({ quote, items }));
const longItems = Array.from({ length: 100 }, (_, index) => ({ ...items[0], service: `Servicio ${index + 1} con una descripción que se distribuye entre varias líneas de forma automática`, line_total: 1500 }));
await writeFile(new URL('../tmp/pdfs/vista-cotizacion-larga.pdf', import.meta.url), await generateQuotePdf({ quote: { ...quote, subtotal: 150000, total: 149500 }, items: longItems }));
const logo = await readFile(new URL('../public/brand/em-agency.png', import.meta.url)).catch(() => null);
if (logo) {
  const official = {
    ...quote, folio: 'VISTA-DISENO-001', client_name: 'Cliente de muestra', client_company: '', client_email: '',
    campaign: 'Campaña de creadores · propuesta de diseño', subtotal: 45714.28, discount_amount: 0, total: 45714.28,
    notes: 'Documento de diseño con un cliente de muestra. No corresponde a una cotización emitida.',
    terms: 'Precios en pesos mexicanos (MXN). No incluye IVA. Las colaboraciones están sujetas a disponibilidad de la creadora y a la aprobación de los entregables.',
  };
  const officialItems = [
    { instagram_handle: '@anapao.jimenez', service: 'IG Story · Ana Pao Jiménez', quantity: 1, unit_price: 10000, line_total: 10000 },
    { instagram_handle: '@anapao.jimenez', service: 'IG Post · Ana Pao Jiménez', quantity: 1, unit_price: 14285.71, line_total: 14285.71 },
    { instagram_handle: '@anapao.jimenez', service: 'IG Reel · Ana Pao Jiménez', quantity: 1, unit_price: 21428.57, line_total: 21428.57 },
  ];
  await mkdir(new URL('../output/pdf/', import.meta.url), { recursive: true });
  await writeFile(new URL('../output/pdf/Propuesta-EM-Agency.pdf', import.meta.url), await generateQuotePdf({ quote: official, items: officialItems, logoBytes: logo, logoType: 'png' }));
  await writeFile(new URL('../tmp/pdfs/marca-agua-multipagina.pdf', import.meta.url), await generateQuotePdf({ quote: { ...official, subtotal: 1000000, total: 1000000 }, items: Array.from({ length: 100 }, (_, index) => ({ ...officialItems[0], service: `IG Story ${index + 1} · Ana Pao Jiménez` })), logoBytes: logo, logoType: 'png' }));
}
console.log('PDF de revisión creados en tmp/pdfs. Son documentos ficticios.');
