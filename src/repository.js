import {createClient} from '@supabase/supabase-js';
import {calculateTotals,validateQuoteInput,parseCatalogJson,effectiveStatus} from './domain.js';
const defaults={id:1,name:'Cotizador EM Agency',currency:'MXN',tax_rate:0,validity_days:15,terms:'Precios en pesos mexicanos (MXN). No incluye IVA.',logo_url:(import.meta.env.BASE_URL||'/')+'brand/em-agency.png'};
const defaultNumbering=()=>({quote_prefix:'',quote_last_number:0,quote_padding:0,quote_configured:false,oc_prefix:'OC ',oc_last_number:2710,oc_padding:0,oc_configured:false});
const url=import.meta.env.VITE_SUPABASE_URL,key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,expected=import.meta.env.VITE_EXPECTED_SUPABASE_PROJECT_REF;
const documentsFunction=import.meta.env.VITE_DOCUMENTS_FUNCTION||'super-worker';
let configError='';
if(url||key||expected){try{
 const parsed=new URL(url);
 if(!key||!expected||parsed.protocol!=='https:'||parsed.hostname!==expected+'.supabase.co'||['nksqpoigywfegcbvfhoa','tantlgswituiwkxfgmsr'].includes(expected))throw Error();
 if(key.startsWith('eyJ')){const claims=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(claims.role!=='anon')throw Error();}
 else if(!key.startsWith('sb_publishable_'))throw Error();
}catch{configError='La conexión requiere la URL, clave pública y referencia del proyecto nuevo de EM Agency. Revisa la configuración.';}}
if(!/^[a-zA-Z0-9_-]+$/.test(documentsFunction))configError='Revisa el nombre de la función de documentos de EM Agency.';
export {configError};
export const client=!configError&&url&&key?createClient(url,key):null;
export const isCloud=Boolean(client);
const storageKey='em-agency-cotizador-local-v1';
let seeded=false;
const empty=()=>({company:{...defaults},accounts:[],rates:[],quotes:[],items:[],events:[],sync:[],profile:{full_name:'',email:'vista-local@example.test'},numbering:defaultNumbering(),user:null});
let local;try{local=JSON.parse(localStorage.getItem(storageKey))||empty();if(!local.company.logo_url)local.company.logo_url=defaults.logo_url;local.profile||={full_name:'',email:'vista-local@example.test'};local.numbering||=defaultNumbering();}catch{local=empty();}
// Las vistas locales antiguas nunca fueron documentos oficiales.
for(const q of local.quotes||[]){if(/^VISTA-/.test(q.folio||'')){q.legacy_preview_folio=q.folio;q.folio=null;q.is_sample=true;q.status='borrador';}}
function persist(){localStorage.setItem(storageKey,JSON.stringify(local));}
function checked({data,error}){if(error)throw error;return data;}
function one(value){return Array.isArray(value)?value[0]:value;}
function missingRpc(error){return ['PGRST202','42883'].includes(error?.code);}
function upgradeError(error){if(missingRpc(error))return Error('Falta aplicar la actualización de Supabase: manual/actualizar-cotizador-v3.sql. No vuelvas a ejecutar schema.sql.');return error;}
async function rpc(name,args){const result=await client.rpc(name,args);if(result.error)throw upgradeError(result.error);return one(result.data);}
export async function loadData(){
 if(!client){
  if(import.meta.env.DEV&&!seeded){seeded=true;try{const response=await fetch((import.meta.env.BASE_URL||'/')+'data/catalogo-em-2026.json');if(response.ok&&response.headers.get('content-type')?.includes('json')){const catalog=parseCatalogJson(await response.text());if(catalog.accounts?.length&&catalog.rates?.length&&!local.accounts.length)await importCatalog(catalog);}}catch{/* Catálogo local opcional. */}}
  return structuredClone(local);
 }
 const tables=['company_settings','instagram_accounts','rates','quotes','quote_items','quote_events','sheet_sync'];
 const rowsPromise=Promise.all(tables.map(async t=>{let rows=[],offset=0;while(true){let q=client.from(t).select('*');if(t==='quotes'||t==='quote_events')q=q.order('created_at',{ascending:false});q=q.order(t==='sheet_sync'?'quote_id':'id',{ascending:true});const page=checked(await q.range(offset,offset+999));rows.push(...page);if(page.length<1000)return rows;offset+=1000;}}));
 const [d,authResult,numberingResult]=await Promise.all([rowsPromise,client.auth.getUser(),client.rpc('get_document_numbering')]);
 const auth=checked(authResult),user=auth.user;
 if(!d[0].length)throw Error('Tu usuario aún no tiene acceso al equipo de EM Agency. Solicita el alta al administrador.');
 if(numberingResult.error&&!missingRpc(numberingResult.error))throw numberingResult.error;
 const name=user?.user_metadata?.full_name||user?.user_metadata?.name||'';
 return {company:d[0][0],accounts:d[1],rates:d[2],quotes:d[3],items:d[4],events:d[5],sync:d[6],user,
  profile:{full_name:typeof name==='string'?name:'',email:user?.email||''},
  numbering:numberingResult.error?defaultNumbering():one(numberingResult.data),upgradeRequired:Boolean(numberingResult.error)};
}
export async function importCatalog(catalog){
 if(!client){
  for(const a of catalog.accounts){const old=local.accounts.find(x=>x.handle===a.handle);if(old)Object.assign(old,a);else local.accounts.push({...a,id:crypto.randomUUID()});}
  for(const r of catalog.rates){const a=local.accounts.find(x=>x.handle===r.handle),{handle,...v}=r;const old=local.rates.find(x=>x.instagram_account_id===a.id&&x.service===r.service&&x.currency===r.currency);if(old)Object.assign(old,v);else local.rates.push({...v,id:crypto.randomUUID(),instagram_account_id:a.id});}
  persist();return;
 }
 checked(await client.from('instagram_accounts').upsert(catalog.accounts,{onConflict:'handle'}));
 const accounts=checked(await client.from('instagram_accounts').select('id,handle').in('handle',catalog.accounts.map(a=>a.handle)));
 const rates=catalog.rates.map(({handle,...r})=>({...r,instagram_account_id:accounts.find(a=>a.handle===handle).id}));
 if(rates.length)checked(await client.from('rates').upsert(rates,{onConflict:'instagram_account_id,service,currency'}));
}
export async function saveCompany(values){
 const v=Object.fromEntries(Object.entries(values).filter(([key])=>['name','validity_days','terms','logo_url'].includes(key)));
 if(client)checked(await client.from('company_settings').update(v).eq('id',1));else{local.company={...local.company,...v};persist();}
}
export async function saveMyProfile({full_name}){
 if(typeof full_name!=='string'||!full_name.trim()||full_name.trim().length>180)throw Error('Indica tu nombre completo, de máximo 180 caracteres.');
 if(client)return checked(await client.auth.updateUser({data:{full_name:full_name.trim()}}));
 local.profile={...local.profile,full_name:full_name.trim()};persist();return structuredClone(local.profile);
}
export async function saveNumbering(values){
 if(!client)throw Error('Los consecutivos oficiales se configuran en Supabase; la vista local solo permite muestras.');
 const keys=['quote_prefix','oc_prefix'],numbers=['quote_last_number','quote_padding','oc_last_number','oc_padding'];
 const args={};
 for(const key of keys){if(typeof values[key]!=='string'||values[key].length>40||/[\r\n\t]/.test(values[key]))throw Error('Usa un prefijo de máximo 40 caracteres, en una sola línea.');args['p_'+key]=values[key];}
 for(const key of numbers){const n=Number(values[key]);if(values[key]===''||!Number.isSafeInteger(n)||n<0||n>(key.endsWith('padding')?10:999999999999))throw Error('Indica consecutivos enteros y una cantidad de dígitos de 0 a 10.');args['p_'+key]=n;}
 return rpc('save_document_numbering',args);
}
export async function uploadLogo(file){
 if(!['image/png','image/jpeg'].includes(file.type)||file.size>2*1024*1024)throw Error('Usa un logo PNG o JPG de hasta 2 MB.');
 if(!client)return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
 const path='logos/'+crypto.randomUUID()+(file.type==='image/png'?'.png':'.jpg');
 checked(await client.storage.from('brand-assets').upload(path,file,{contentType:file.type,upsert:false}));
 return client.storage.from('brand-assets').getPublicUrl(path).data.publicUrl;
}
function requestFields(input){
 return {client_name:String(input.client_name??'').trim(),client_email:String(input.client_email??'').trim(),client_company:String(input.client_company??'').trim(),campaign:String(input.campaign??'').trim(),valid_until:input.valid_until,discount_amount:Number(input.discount_amount||0),notes:String(input.notes??'').trim(),is_sample:input.is_sample===true,seller_whatsapp:String(input.seller_whatsapp??'').trim(),items:(input.items||[]).map(x=>({rate_id:x.rate_id,quantity:Number(x.quantity)}))};
}
export async function createQuote(input,requestId){
 if(!/^[0-9a-f-]{36}$/i.test(requestId||''))throw Error('No se pudo identificar el guardado. Vuelve a abrir una nueva cotización.');
 const d=await loadData(),known=d.quotes.find(q=>q.request_id===requestId);
 const clean=known?requestFields(input):validateQuoteInput(input,d.rates);
 if(client){return rpc('create_quote_v3',{p_request_id:requestId,p_client_name:clean.client_name,p_client_email:clean.client_email,p_client_company:clean.client_company,p_campaign:clean.campaign,p_valid_until:clean.valid_until,p_discount_amount:clean.discount_amount,p_notes:clean.notes,p_items:clean.items,p_is_sample:clean.is_sample,p_seller_whatsapp:clean.seller_whatsapp});}
 const payload=requestFields(clean);
 if(known){if(JSON.stringify(known.request_payload)!==JSON.stringify(payload))throw Error('Este guardado ya se utilizó con otros datos. Inicia una nueva cotización.');return structuredClone(known);}
 if(!clean.is_sample)throw Error('Las cotizaciones reales y las órdenes de compra requieren Supabase. En vista local guarda una muestra.');
 if(!d.profile.full_name)throw Error('Completa tu nombre en Configuración antes de guardar.');
 const id=crypto.randomUUID(),now=new Date().toISOString();
 const items=clean.items.map((x,position)=>{const r=d.rates.find(y=>y.id===x.rate_id),a=d.accounts.find(y=>y.id===r.instagram_account_id);if(!a?.active)throw Error('La cuenta de Instagram ya no está disponible.');return {id:crypto.randomUUID(),quote_id:id,rate_id:r.id,instagram_handle:a.handle,service:r.service,quantity:x.quantity,unit_price:Number(r.unit_price),line_total:calculateTotals([{unit_price:r.unit_price,quantity:x.quantity}]).total,position};});
 const {items:unused,totals,...fields}=clean;
 const q={...fields,...totals,id,request_id:requestId,request_payload:payload,folio:null,quote_number:null,oc_folio:null,oc_number:null,oc_created_at:null,deleted_at:null,status:'borrador',currency:'MXN',tax_rate:0,seller_name:d.profile.full_name,seller_email:d.profile.email,seller_whatsapp:clean.seller_whatsapp,company_name:d.company.name,terms:d.company.terms,logo_url:d.company.logo_url,created_at:now,updated_at:now,pdf_path:null};
 local.quotes.unshift(q);local.items.push(...items);local.events.push({id:crypto.randomUUID(),quote_id:id,from_status:null,to_status:'borrador',note:'Cotización de muestra creada en vista local; sin folio oficial',created_at:now});persist();return structuredClone(q);
}
export const transitions={borrador:['enviada','cancelada'],enviada:['aceptada','rechazada','cancelada'],aceptada:[],rechazada:[],cancelada:[]};
export async function changeStatus(id,status,note){
 if(client)return rpc('set_quote_status',{p_quote_id:id,p_status:status,p_note:note});
 const q=local.quotes.find(x=>x.id===id);if(q?.is_sample)throw Error('Las muestras no cambian de estado comercial. Úsalas como base de una cotización real.');
 if(!q||q.deleted_at||!transitions[q.status]?.includes(status))throw Error('Cambio de estado no permitido.');
 if(['enviada','aceptada'].includes(status)&&effectiveStatus(q)==='vencida')throw Error('La cotización está vencida.');
 const from=q.status;q.status=status;q.updated_at=new Date().toISOString();local.events.push({id:crypto.randomUUID(),quote_id:id,from_status:from,to_status:status,note,created_at:q.updated_at});persist();return structuredClone(q);
}
export async function convertQuoteToOc(id){
 if(!client)throw Error('Las órdenes de compra oficiales requieren Supabase.');
 return rpc('convert_quote_to_oc',{p_quote_id:id});
}
export async function deleteQuote(id){
 if(client)return rpc('delete_quote',{p_quote_id:id});
 const q=local.quotes.find(x=>x.id===id);
 if(!q)throw Error('Cotización no encontrada.');
 if(q.oc_folio)throw Error('Esta cotización ya está vinculada a una orden de compra y debe conservarse.');
 if(q.deleted_at)return structuredClone(q);
 q.deleted_at=new Date().toISOString();q.updated_at=q.deleted_at;
 local.events.push({id:crypto.randomUUID(),quote_id:id,from_status:q.status,to_status:q.status,note:'Eliminada del listado; se conserva el historial',created_at:q.updated_at});persist();return structuredClone(q);
}
async function invokeDocuments(name,body){
 const result=await client.functions.invoke(name,{body});
 if(!result.error)return result;
 const context=result.error.context;
 let details={};if(context?.clone){try{details=await context.clone().json();}catch{/* La respuesta puede no ser JSON. */}}
 return {...result,status:context?.status,details};
}
export async function documents(id,action='pdf'){
 if(!client)throw Error('La sincronización requiere conectar el proyecto de EM Agency.');
 let result=await invokeDocuments(documentsFunction,{quote_id:id,action});
 if(result.error&&result.details?.code==='NOT_FOUND'){
  const alternative=documentsFunction==='super-worker'?'quote-documents':'super-worker';
  result=await invokeDocuments(alternative,{quote_id:id,action});
 }
 if(result.error){
  const message=result.details?.error||result.details?.message;
  if(result.details?.code==='NOT_FOUND')throw Error('No se encontró la función de documentos. Actualiza super-worker con el archivo manual de esta entrega.');
  throw Error(message||'No se pudo contactar la función de documentos. Comprueba que super-worker tenga la versión actualizada y vuelve a intentar.');
 }
 const value=result.data;
 if(!value||typeof value!=='object')throw Error('La función de documentos devolvió una respuesta vacía. Actualiza super-worker.');
 if(value.error&&!value.pdf_url)throw Error(value.error);
 return value;
}

