import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const source=await fs.readFile(new URL('../src/repository.js',import.meta.url),'utf8');
let serial=0;
async function localRepo(env={}){
 const memory=new Map();
 globalThis.localStorage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)};
 let code=source.replace("import {createClient} from '@supabase/supabase-js';","const createClient=()=>({configured:true});")
 .replace("'./domain.js'",JSON.stringify(new URL('../src/domain.js',import.meta.url).href)).replaceAll('import.meta.env',JSON.stringify({DEV:false,...env}));
 return import('data:text/javascript;base64,'+Buffer.from(code+'\n//'+serial++).toString('base64'));
}
const catalog={accounts:[{handle:'talento_ejemplo',display_name:'Talento de prueba',category:'Prueba',followers:null,active:true}],rates:[{handle:'talento_ejemplo',service:'IG Reel',unit_price:14285.71,currency:'MXN',active:true}]};
function deadline(){const d=new Date();d.setDate(d.getDate()+30);return d.toISOString().slice(0,10);}
test('flujo local guarda precios finales sin IVA y conserva snapshots al cambiar catálogo',async()=>{
 const repo=await localRepo();await repo.importCatalog(catalog);
 let d=await repo.loadData();
 const request=crypto.randomUUID();
 const input={client_name:'Marca de prueba',client_email:'',client_company:'',campaign:'Prueba',valid_until:deadline(),discount_amount:0,notes:'',items:[{rate_id:d.rates[0].id,quantity:2}]};
 const q=await repo.createQuote(input,request);
 assert.equal(q.total,28571.42);assert.equal(q.tax_amount,0);assert.match(q.folio,/^VISTA-/);
 assert.equal((await repo.createQuote(input,request)).id,q.id);
 await repo.importCatalog({...catalog,rates:[{...catalog.rates[0],unit_price:20000}]});
 d=await repo.loadData();assert.equal(d.items[0].unit_price,14285.71);assert.equal(d.quotes[0].total,28571.42);assert.equal(d.rates[0].unit_price,20000);
 await repo.changeStatus(q.id,'enviada','Enviada manualmente');await repo.changeStatus(q.id,'aceptada','Aprobada');
 await assert.rejects(()=>repo.changeStatus(q.id,'borrador',''),/no permitido/);
 d=await repo.loadData();assert.equal(d.events.length,3);assert.equal(d.quotes[0].status,'aceptada');
});
test('configuración local mantiene moneda e impuestos fijos y actualiza solo campos permitidos',async()=>{
 const repo=await localRepo();await repo.saveCompany({name:'EM Prueba',currency:'USD',tax_rate:16,validity_days:20});
 const d=await repo.loadData();assert.equal(d.company.currency,'MXN');assert.equal(d.company.tax_rate,0);assert.equal(d.company.name,'EM Prueba');assert.equal(d.company.validity_days,20);
});
test('conexión rechaza proyectos anteriores y claves secretas',async()=>{
 const previous=await localRepo({VITE_SUPABASE_URL:'https://tantlgswituiwkxfgmsr.supabase.co',VITE_EXPECTED_SUPABASE_PROJECT_REF:'tantlgswituiwkxfgmsr',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_example'});
 assert.ok(previous.configError);assert.equal(previous.client,null);
 const secret=await localRepo({VITE_SUPABASE_URL:'https://new-em-project.supabase.co',VITE_EXPECTED_SUPABASE_PROJECT_REF:'new-em-project',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_secret_do-not-use'});
 assert.ok(secret.configError);assert.equal(secret.client,null);
 const mismatch=await localRepo({VITE_SUPABASE_URL:'https://wrong.supabase.co',VITE_EXPECTED_SUPABASE_PROJECT_REF:'em-project',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_example'});
 assert.ok(mismatch.configError);
});

