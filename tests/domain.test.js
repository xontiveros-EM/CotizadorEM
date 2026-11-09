import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTotals, effectiveStatus, escapeHtml, money, parseCatalogCsv, validateQuoteInput } from '../src/domain.js';

const header = 'handle,display_name,category,followers,service,unit_price,currency';
const validRow = '@cuenta_demo,Cuenta de prueba,Cultura,1000,Reel,123.45,MXN';
const validInput = { client_name: ' Cliente ', client_email: 'cliente@example.com', client_company: 'Empresa', campaign: 'Campaña', valid_until: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10), discount_amount: 0, notes: '', items: [{ rate_id: 'rate-1', quantity: 3 }] };
const rates = [{ id: 'rate-1', unit_price: 0.1, active: true, currency: 'MXN' }];

test('totals calculate in cents with no VAT', () => {
  assert.deepEqual(calculateTotals([{ unit_price: 0.1, quantity: 3 }, { unit_price: 0.2, quantity: 3 }], 0.15), { subtotal: 0.9, discount_amount: 0.15, tax_amount: 0, total: 0.75 });
});

test('invalid quantity, amount, precision, discount and overflow fail', () => {
  for (const quantity of [0, -1, 0.5, 10001, NaN, true, '', null]) assert.throws(() => calculateTotals([{ unit_price: 1, quantity }]));
  for (const unit_price of [-1, NaN, Infinity, 1.005, '', null, true, ' ']) assert.throws(() => calculateTotals([{ unit_price, quantity: 1 }]));
  assert.throws(() => calculateTotals([{ unit_price: 1, quantity: 1 }], 1.01), /descuento/i);
  assert.throws(() => calculateTotals([{ unit_price: 90071992547400, quantity: 2 }]), /grande/i);
  assert.equal(calculateTotals([{ unit_price: 19.99, quantity: 3 }]).total, 59.97);
});

test('parse CSV normalizes account and separates multiple rates', () => {
  const output = parseCatalogCsv('\uFEFF' + header + '\r\n' + validRow + '\r\ncuenta_demo,Cuenta de prueba,Cultura,1000,Historia,20,MXN\r\n');
  assert.equal(output.accounts.length, 1);
  assert.equal(output.accounts[0].handle, 'cuenta_demo');
  assert.equal(output.rates.length, 2);
  assert.equal(output.rates[0].unit_price, 123.45);
});

test('CSV preserves escaped quotes, commas and multiline fields', () => {
  const output = parseCatalogCsv(header + '\ncuenta,"Cuenta, de ""prueba""",Cultura,12,"Servicio\ncon descripción",100.50,MXN');
  assert.equal(output.accounts[0].display_name, 'Cuenta, de "prueba"');
  assert.equal(output.rates[0].service, 'Servicio\ncon descripción');
});

test('semicolon CSV supports Excel decimal commas', () => {
  const output = parseCatalogCsv(header.replaceAll(',', ';') + '\ncuenta;Cuenta;Cultura;12;Servicio;100,50;MXN');
  assert.equal(output.rates[0].unit_price, 100.5);
});

test('empty templates, malformed rows and unsafe catalog values fail', () => {
  for (const text of ['', header, 'wrong,columns\nx,y', header + '\ncuenta,"Sin cierre,Cultura,1,Reel,10,MXN', header + '\n' + validRow + ',extra']) assert.throws(() => parseCatalogCsv(text));
  for (const row of [validRow.replace('123.45', '-1'), validRow.replace('123.45', 'NaN'), validRow.replace('123.45', '1.001'), validRow.replace('1000', '-10'), validRow.replace('MXN', 'USD'), validRow.replace('@cuenta_demo', 'https://instagram.com/cuenta'), validRow.replace('@cuenta_demo', 'cuenta..demo')]) assert.throws(() => parseCatalogCsv(header + '\n' + row));
});

test('duplicate rates and conflicting account metadata fail', () => {
  assert.throws(() => parseCatalogCsv(header + '\n' + validRow + '\n' + validRow), /duplicada/i);
  assert.throws(() => parseCatalogCsv(header + '\n' + validRow + '\n' + validRow.replace('1000', '2000').replace('Reel', 'Historia')), /no coinciden/i);
});

test('validate quote normalizes and calculates with actual rate prices', () => {
  const output = validateQuoteInput(validInput, rates);
  assert.equal(output.client_name, 'Cliente');
  assert.equal(output.totals.total, 0.3);
  assert.equal(output.totals.tax_amount, 0);
});

test('validation rejects invalid dates, inactive rates, quantities and discount', () => {
  for (const valid_until of ['0000-01-01', '2027-02-29', '2027-02-30', '2027-13-01', '01/01/2027', '2027-1-01']) assert.throws(() => validateQuoteInput({ ...validInput, valid_until }, rates), /fecha/i);
  assert.throws(() => validateQuoteInput({ ...validInput, client_email: 'invalid' }, rates), /correo/i);
  assert.throws(() => validateQuoteInput({ ...validInput, client_name: ' ' }, rates), /obligatorio/i);
  assert.throws(() => validateQuoteInput({ ...validInput, items: [] }, rates));
  assert.throws(() => validateQuoteInput({ ...validInput, items: [{ rate_id: 'missing', quantity: 1 }] }, rates), /activa/i);
  assert.throws(() => validateQuoteInput(validInput, [{ ...rates[0], active: false }]), /activa/i);
  assert.throws(() => validateQuoteInput({ ...validInput, items: [{ rate_id: 'rate-1', quantity: 0.5 }] }, rates));
  assert.throws(() => validateQuoteInput({ ...validInput, discount_amount: 1 }, rates));
});

test('expiration does not override accepted quotes or invalid dates', () => {
  assert.equal(effectiveStatus({ status: 'borrador', valid_until: '2000-01-01' }), 'vencida');
  assert.equal(effectiveStatus({ status: 'enviada', valid_until: '2000-01-01' }), 'vencida');
  assert.equal(effectiveStatus({ status: 'aceptada', valid_until: '2000-01-01' }), 'aceptada');
  assert.equal(effectiveStatus({ status: 'borrador', valid_until: 'invalid' }), 'borrador');
  assert.equal(effectiveStatus({ status: 'enviada', valid_until: '2999-01-01' }), 'enviada');
});

test('HTML output escapes user-controlled content and currency is MXN', () => {
  assert.equal(escapeHtml('<img src="x" onerror=\'x\'>&'), '&lt;img src=&quot;x&quot; onerror=&#39;x&#39;&gt;&amp;');
  assert.match(money(100), /100\.00/);
  assert.equal(money(NaN), '—');
});


test('quote validity matches database range and monetary precision limit', () => {
  assert.throws(() => validateQuoteInput({ ...validInput, valid_until: '2000-01-01' }, rates), /vigencia/i);
  assert.throws(() => validateQuoteInput({ ...validInput, valid_until: '2999-01-01' }, rates), /vigencia/i);
  assert.throws(() => calculateTotals([{ unit_price: 600000000000, quantity: 2 }]), /grande/i);
  assert.equal(calculateTotals([{ unit_price: 999999999999.99, quantity: 1 }]).total, 999999999999.99);
  assert.equal(validateQuoteInput({ ...validInput, campaign: 'x'.repeat(300) }, rates).campaign.length, 300);
  assert.throws(() => validateQuoteInput({ ...validInput, campaign: 'x'.repeat(301) }, rates), /máximo/i);
});


test('validity and expiration follow CDMX day across UTC midnight', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2027-01-01T03:00:00Z') });
  assert.equal(validateQuoteInput({ ...validInput, valid_until: '2026-12-31' }, rates).valid_until, '2026-12-31');
  assert.throws(() => validateQuoteInput({ ...validInput, valid_until: '2026-12-30' }, rates), /vigencia/i);
  assert.equal(effectiveStatus({ status: 'enviada', valid_until: '2026-12-31' }), 'enviada');
  assert.equal(effectiveStatus({ status: 'enviada', valid_until: '2026-12-30' }), 'vencida');
});

test('unknown followers remain null and a real zero remains zero', () => {
  const unknown = parseCatalogCsv(header + '\n' + validRow.replace(',1000,', ',,'));
  const zero = parseCatalogCsv(header + '\n' + validRow.replace(',1000,', ',0,'));
  assert.equal(unknown.accounts[0].followers, null);
  assert.equal(zero.accounts[0].followers, 0);
});

test('gross-margin commission rounds each client rate to cents without exposing fee', async () => {
  const { priceWithCommission } = await import('../src/domain.js');
  assert.equal(priceWithCommission(10000, 30), 14285.71);
  assert.equal(priceWithCommission(7000, 30), 10000);
  assert.equal(priceWithCommission(15000, 30), 21428.57);
  assert.equal(priceWithCommission(0.01, 60), 0.03);
  assert.equal(priceWithCommission(10.15, 0), 10.15);
  for (const fee of [-1, 100, NaN, Infinity]) assert.throws(() => priceWithCommission(10000, fee));
});


test('JSON preserves accounts without prices, unknown followers and sanitized payload', async () => {
  const { parseCatalogJson } = await import('../src/domain.js');
  const input = { metadata: { source: 'internal' }, accounts: [{ handle: '@Cuenta', display_name: 'Cuenta', category: 'Cultura', followers: null, active: true, secret: 'discard' }, { handle: 'otra', display_name: 'Otra cuenta' }], rates: [{ handle: 'cuenta', service: 'IG Story', unit_price: 14285.71, currency: 'MXN', active: true, base_price: 10000, commission: 30 }] };
  const catalog = parseCatalogJson(JSON.stringify(input));
  assert.equal(catalog.accounts.length, 2);
  assert.equal(catalog.accounts[1].followers, null);
  assert.equal(catalog.rates.length, 1);
  assert.equal(catalog.accounts[0].handle, 'cuenta');
  assert.equal(catalog.rates[0].unit_price, 14285.71);
  assert.equal('metadata' in catalog, false);
  assert.equal('secret' in catalog.accounts[0], false);
  assert.equal('base_price' in catalog.rates[0], false);
  assert.equal(parseCatalogJson(JSON.stringify({ accounts: input.accounts, rates: [] })).rates.length, 0);
});

test('JSON rejects duplicate profiles, duplicate services, unknown references and invalid prices', async () => {
  const { parseCatalogJson } = await import('../src/domain.js');
  const account = { handle: 'cuenta', display_name: 'Cuenta', followers: null, active: true };
  const rate = { handle: 'cuenta', service: 'IG Story', unit_price: 100, currency: 'MXN', active: true };
  const parse = value => parseCatalogJson(JSON.stringify(value));
  assert.throws(() => parseCatalogJson('{invalid'), /JSON/i);
  for (const value of [{}, [], { accounts: [], rates: [] }, { accounts: [account], rates: 'invalid' }]) assert.throws(() => parse(value));
  assert.throws(() => parse({ accounts: [account, { ...account, handle: '@CUENTA' }], rates: [] }), /duplicada/i);
  assert.throws(() => parse({ accounts: [account], rates: [rate, { ...rate, service: 'ig story' }] }), /duplicad/i);
  assert.throws(() => parse({ accounts: [account], rates: [{ ...rate, handle: 'otra' }] }), /accounts/i);
  for (const unit_price of [-1, '100', null, 1.001]) assert.throws(() => parse({ accounts: [account], rates: [{ ...rate, unit_price }] }));
  assert.throws(() => parse({ accounts: [account], rates: [{ ...rate, currency: 'USD' }] }), /MXN/i);
  for (const followers of [-1, 0.5, '100']) assert.throws(() => parse({ accounts: [{ ...account, followers }], rates: [] }));
  for (const active of ['false', 0, null]) assert.throws(() => parse({ accounts: [{ ...account, active }], rates: [] }));
});

