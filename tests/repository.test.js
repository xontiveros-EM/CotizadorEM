import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const source=await fs.readFile(new URL('../src/repository.js',import.meta.url),'utf8');
let serial=0;
async function repository(env={},cloud=null,memory=new Map()){
 globalThis.localStorage={getItem:key=>memory.get(key)||null,setItem:(key,value)=>memory.set(key,value)};
 globalThis.__emMockClient=cloud;
 const code=source.replace("import {createClient} from '@supabase/supabase-js';","const createClient=()=>globalThis.__emMockClient;")
 .replace("'./domain.js'",JSON.stringify(new URL('../src/domain.js',import.meta.url).href)).replaceAll('import.meta.env',JSON.stringify({DEV:false,...env}));
 return import('data:text/javascript;base64,'+Buffer.from(code+'\n//'+serial++).toString('base64'));
}
const cloudEnv={VITE_SUPABASE_URL:'https://new-em-project.supabase.co',VITE_EXPECTED_SUPABASE_PROJECT_REF:'new-em-project',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_example'};
const catalog={accounts:[{handle:'talento_ejemplo',display_name:'Talento de prueba',category:'Prueba',followers:null,active:true}],rates:[{handle:'talento_ejemplo',service:'IG Reel',unit_price:14285.71,currency:'MXN',active:true}]};
function deadline(){const d=new Date();d.setDate(d.getDate()+30);return d.toISOString().slice(0,10);}
function input(rate){return {is_sample:true,client_name:'Marca de prueba',client_email:'',client_company:'',campaign:'Prueba',valid_until:deadline(),discount_amount:0,notes:'',seller_whatsapp:'+52 55 1234 5678',items:[{rate_id:rate,quantity:2}]};}
test('muestras locales no llevan folio, conservan precios y vendedor; reintento no crea otra',async()=>{
 const repo=await repository();await repo.importCatalog(catalog);await repo.saveMyProfile({full_name:'Vendedora de muestra'});
 const d=await repo.loadData(),request=crypto.randomUUID(),fields=input(d.rates[0].id);
 const q=await repo.createQuote(fields,request);
 assert.equal(q.total,28571.42);assert.equal(q.tax_amount,0);assert.equal(q.folio,null);assert.equal(q.is_sample,true);
 assert.equal(q.seller_name,'Vendedora de muestra');assert.equal(q.seller_whatsapp,'+52 55 1234 5678');
 await repo.importCatalog({...catalog,rates:[{...catalog.rates[0],unit_price:20000,active:false}]});
 await repo.saveMyProfile({full_name:'Otro nombre posterior'});
 assert.equal((await repo.createQuote(fields,request)).id,q.id);
 assert.equal((await repo.loadData()).quotes[0].seller_name,'Vendedora de muestra');
 assert.equal((await repo.loadData()).items[0].unit_price,14285.71);
 await assert.rejects(()=>repo.createQuote({...fields,client_name:'Otro cliente'},request),/otros datos/);
 await assert.rejects(()=>repo.changeStatus(q.id,'enviada',''),/muestras/);
 await assert.rejects(()=>repo.convertQuoteToOc(q.id),/Supabase/);
 const deleted=await repo.deleteQuote(q.id);assert.ok(deleted.deleted_at);
 assert.equal((await repo.deleteQuote(q.id)).deleted_at,deleted.deleted_at);
 const saved=await repo.loadData();assert.equal(saved.quotes.length,1);assert.equal(saved.events.length,2);
});
test('vista local no emite números reales ni confía datos comerciales del formulario',async()=>{
 const repo=await repository();await repo.importCatalog(catalog);await repo.saveMyProfile({full_name:'Ejemplo'});
 const d=await repo.loadData();
 await assert.rejects(()=>repo.createQuote({...input(d.rates[0].id),is_sample:false},crypto.randomUUID()),/vista local/);
 const q=await repo.createQuote({...input(d.rates[0].id),folio:'OC 2711',seller_name:'Suplantación',total:0,oc_folio:'OC 9999'},crypto.randomUUID());
 assert.equal(q.folio,null);assert.equal(q.oc_folio,null);assert.equal(q.seller_name,'Ejemplo');assert.equal(q.total,28571.42);
});
test('configuración solo cambia campos permitidos; perfil pide nombre completo',async()=>{
 const repo=await repository();await repo.saveCompany({name:'EM Prueba',currency:'USD',tax_rate:16,validity_days:20});
 const d=await repo.loadData();assert.equal(d.company.currency,'MXN');assert.equal(d.company.tax_rate,0);assert.equal(d.company.name,'EM Prueba');
 await assert.rejects(()=>repo.saveMyProfile({full_name:''}),/nombre completo/);
});
test('conexión rechaza proyectos anteriores, claves secretas y nombres de función inválidos',async()=>{
 for(const env of [
  {...cloudEnv,VITE_SUPABASE_URL:'https://tantlgswituiwkxfgmsr.supabase.co',VITE_EXPECTED_SUPABASE_PROJECT_REF:'tantlgswituiwkxfgmsr'},
  {...cloudEnv,VITE_SUPABASE_PUBLISHABLE_KEY:'sb_secret_do-not-use'},
  {...cloudEnv,VITE_SUPABASE_URL:'https://wrong.supabase.co'},
  {...cloudEnv,VITE_DOCUMENTS_FUNCTION:'../../other'},
 ]){const repo=await repository(env);assert.ok(repo.configError);assert.equal(repo.client,null);}
});
test('documentos usa super-worker instalado; fallback únicamente en función inexistente',async()=>{
 const calls=[];
 const client={functions:{invoke:async(name)=>{calls.push(name);return calls.length===1?{error:{context:Response.json({code:'NOT_FOUND',message:'Requested function was not found'},{status:404})}}:{data:{pdf_url:'https://files.example.test/quote.pdf'}};}}};
 const repo=await repository(cloudEnv,client);
 assert.ok((await repo.documents('quote-id')).pdf_url);
 assert.deepEqual(calls,['super-worker','quote-documents']);
 calls.length=0;client.functions.invoke=async(name)=>{calls.push(name);return {error:{context:Response.json({error:'Usuario sin acceso'},{status:403})}};};
 await assert.rejects(()=>repo.documents('quote-id'),/Usuario sin acceso/);assert.deepEqual(calls,['super-worker']);
});
test('respuesta de función vacía o plantilla falla de forma visible; Sheets pendiente conserva PDF',async()=>{
 const client={functions:{invoke:async()=>({data:'Hello!'})}};
 const repo=await repository(cloudEnv,client);
 await assert.rejects(()=>repo.documents('quote-id'),/respuesta vacía/);
 client.functions.invoke=async()=>({data:{pdf_url:'https://files.example.test/quote.pdf',sync_status:'pending',error:'Faltan credenciales de Google'}});
 const result=await repo.documents('quote-id','sync');assert.equal(result.sync_status,'pending');assert.match(result.error,/Google/);
});


test('crear en Supabase envía solo campos del contrato v3 y vendedor se resuelve en servidor',async()=>{
 const calls=[],id=crypto.randomUUID(),r=crypto.randomUUID();
 const tables={company_settings:[{id:1}],instagram_accounts:[{id,handle:'talento_ejemplo',active:true}],rates:[{id:r,instagram_account_id:id,unit_price:100,currency:'MXN',active:true}],quotes:[],quote_items:[],quote_events:[],sheet_sync:[]};
 const cloud={from(table){const q={select(){return q;},order(){return q;},async range(){return {data:tables[table]};}};return q;},
 auth:{getUser:async()=>({data:{user:{id:crypto.randomUUID(),email:'vendedor@example.test',user_metadata:{full_name:'Nombre real'}}}})},
 rpc:async(name,args)=>{calls.push([name,args]);return {data:name==='get_document_numbering'?{quote_prefix:'COT-',quote_configured:true}:{id:'saved'}};}};
 const repo=await repository(cloudEnv,cloud);
 const state=await repo.loadData();assert.equal(state.profile.email,'vendedor@example.test');assert.equal(state.profile.full_name,'Nombre real');
 await repo.createQuote({...input(r),is_sample:false,seller_name:'Falso',seller_email:'falso@example.test',folio:'OC 1'},crypto.randomUUID());
 const [,args]=calls.find(([name])=>name==='create_quote_v3');
 assert.equal(args.p_is_sample,false);assert.equal(args.p_seller_whatsapp,'+52 55 1234 5678');
 assert.ok(!('p_seller_name'in args));assert.ok(!('p_seller_email'in args));assert.ok(!('p_folio'in args));
});


test('una cotización sin acceso no provoca fallback a una función distinta',async()=>{
 const calls=[];const client={functions:{invoke:async(name)=>{calls.push(name);return {error:{context:Response.json({code:'QUOTE_NOT_FOUND',error:'No tienes acceso a esta cotización.'},{status:404})}};}}};
 const repo=await repository(cloudEnv,client);await assert.rejects(()=>repo.documents('quote-id'),/No tienes acceso/);assert.deepEqual(calls,['super-worker']);
});

test('las vistas locales antiguas se reconocen como muestras sin conservar folios aleatorios oficiales',async()=>{
 const memory=new Map([['em-agency-cotizador-local-v1',JSON.stringify({company:{name:'EM'},accounts:[],rates:[],items:[],events:[],sync:[],quotes:[{id:'old',folio:'VISTA-A1B2C3D4',status:'aceptada'}]})]]);
 const repo=await repository({},null,memory),state=await repo.loadData();assert.equal(state.quotes[0].is_sample,true);assert.equal(state.quotes[0].folio,null);assert.equal(state.quotes[0].legacy_preview_folio,'VISTA-A1B2C3D4');
});
