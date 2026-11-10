import { mkdir, writeFile } from 'node:fs/promises';
import { generateQuotePdf } from '../src/pdf.js';
const quote = {
  id: '8d0a3b12-2d73-4d03-ae58-62f0cfce11bc', folio: null, is_sample: true,
  company_name: 'Cotizador EM Agency', client_name: 'Cliente de ejemplo',
  client_company: 'Marca de ejemplo', client_email: 'cliente@example.test',
  campaign: 'Campaña de lanzamiento · ejemplo ficticio', status: 'borrador', currency: 'MXN',
  created_at: '2026-11-09T12:00:00Z', updated_at: '2026-11-09T12:00:00Z',
  valid_until: '2026-11-30', subtotal: 3500, discount_amount: 500, total: 3000,
  seller_name: 'Andrea Vendedora', seller_email: 'andrea@example.test', seller_whatsapp: '+52 55 1234 5678',
  notes: 'Datos y precios ficticios para revisar el diseño. No corresponde a una cotización emitida.',
  terms: 'Precios en pesos mexicanos (MXN). No incluye IVA. La contratación queda sujeta a disponibilidad y aceptación de la cotización.',
};
const items = [
  { instagram_handle: '@cuenta_ejemplo_1', service: 'Reel de Instagram', quantity: 1, unit_price: 1500, line_total: 1500 },
  { instagram_handle: '@cuenta_ejemplo_2', service: 'Historia de Instagram', quantity: 2, unit_price: 1000, line_total: 2000 },
];
await mkdir(new URL('../output/pdf/', import.meta.url), { recursive: true });
await mkdir(new URL('../tmp/pdfs/', import.meta.url), { recursive: true });
await writeFile(new URL('../output/pdf/Muestra-EM-Agency.pdf', import.meta.url), await generateQuotePdf({ quote, items }));
await writeFile(new URL('../output/pdf/Ejemplo-Cotizacion-OC-EM-Agency.pdf', import.meta.url), await generateQuotePdf({ quote: { ...quote, is_sample: false, folio: 'VISTA-OC-001', oc_folio: 'OC EJEMPLO 2711' }, items }));
const longItems = Array.from({ length: 100 }, (_, index) => ({ ...items[0], service: 'Servicio ' + (index + 1) + ' con una descripción que se distribuye entre varias líneas de forma automática', line_total: 1500 }));
await writeFile(new URL('../tmp/pdfs/muestra-larga-v3.pdf', import.meta.url), await generateQuotePdf({ quote: { ...quote, subtotal: 150000, total: 149500 }, items: longItems }));
console.log('Dos PDF ficticios de revisión creados en output/pdf; multipágina en tmp/pdfs.');