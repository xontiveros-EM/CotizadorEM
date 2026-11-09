import {createClient} from '@supabase/supabase-js';
import {calculateTotals,validateQuoteInput,parseCatalogJson,effectiveStatus} from './domain.js';
const defaults={id:1,name:'Cotizador EM Agency',currency:'MXN',tax_rate:0,validity_days:15,terms:'Precios en pesos mexicanos (MXN). No incluye IVA.',logo_url:(import.meta.env.BASE_URL||'/')+'brand/em-agency.png'};
const url=import.meta.env.VITE_SUPABASE_URL,key=import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,expected=import.meta.env.VITE_EXPECTED_SUPABASE_PROJECT_REF;
let configError='';
if(url||key||expected){try{
 const parsed=new URL(url);
 if(!key||!expected||parsed.protocol!=='https:'||parsed.hostname!==expected+'.supabase.co'||['nksqpoigywfegcbvfhoa','tantlgswituiwkxfgmsr'].includes(expected))throw Error();
 if(key.startsWith('eyJ')){const claims=JSON.parse(atob(key.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')));if(claims.role!=='anon')throw Error();}
 else if(!key.startsWith('sb_publishable_'))throw Error();
}catch{configError='La conexión requiere la URL, clave pública y referencia del proyecto nuevo de EM Agency. Revisa la configuración.';}}
export {configError};
export const client=!configError&&url&&key?createClient(url,key):null;
export const isCloud=Boolean(client);
const storageKey='em-agency-cotizador-local-v1';
let seeded=false;
const empty=()=>({company:{...defaults},accounts:[],rates:[],quotes:[],items:[],events:[],sync:[]});
let local;try{local=JSON.parse(localStorage.getItem(storageKey))||empty();if(!local.company.logo_url)local.company.logo_url=defaults.logo_url;}catch{local=empty();}
function persist(){localStorage.setItem(storageKey,JSON.stringify(local));}
function checked({data,error}){if(error)throw error;return data;}
export async function loadData(){
 if(!client){if(import.meta.env.DEV&&!seeded){seeded=true;try{const response=await fetch((import.meta.env.BASE_URL||'/')+'data/catalogo-em-2026.json');if(response.ok&&response.headers.get('content-type')?.includes('json')){const catalog=parseCatalogJson(await response.text());if(catalog.accounts?.length&&catalog.rates?.length&&!local.accounts.length)await importCatalog(catalog);}}catch{/* Local input remains optional. */}}return structuredClone(local);}
 const tables=['company_settings','instagram_accounts','rates','quotes','quote_items','quote_events','sheet_sync'];
 const result=await Promise.all(tables.map(async t=>{let rows=[],offset=0;while(true){let q=client.from(t).select('*');if(t==='quotes'||t==='quote_events')q=q.order('created_at',{ascending:false});q=q.order(t==='sheet_sync'?'quote_id':'id',{ascending:true});const page=checked(await q.range(offset,offset+999));rows.push(...page);if(page.length<1000)return {data:rows,error:null};offset+=1000;}}));
 const d=result.map(checked);
 if(!d[0].length)throw Error('Tu usuario aún no tiene acceso al equipo de EM Agency. Solicita el alta al administrador.');
 return {company:d[0][0],accounts:d[1],rates:d[2],quotes:d[3],items:d[4],events:d[5],sync:d[6]};
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
 if(!rates.length)return;
 checked(await client.from('rates').upsert(rates,{onConflict:'instagram_account_id,service,currency'}));
}
export async function saveCompany(values){
 const v=Object.fromEntries(Object.entries(values).filter(([key])=>['name','validity_days','terms','logo_url'].includes(key)));
 if(client)checked(await client.from('company_settings').update(v).eq('id',1));else{local.company={...local.company,...v};persist();}
}
export async function uploadLogo(file){
 if(!['image/png','image/jpeg'].includes(file.type)||file.size>2*1024*1024)throw Error('Usa un logo PNG o JPG de hasta 2 MB.');
 if(!client)return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});
 const path='logos/'+crypto.randomUUID()+(file.type==='image/png'?'.png':'.jpg');
 checked(await client.storage.from('brand-assets').upload(path,file,{contentType:file.type,upsert:false}));
 return client.storage.from('brand-assets').getPublicUrl(path).data.publicUrl;
}
export async function createQuote(input,requestId){
 const d=await loadData(),clean=validateQuoteInput(input,d.rates);
 if(client){const {totals,...v}=clean;const result=checked(await client.rpc('create_quote',{p_request_id:requestId,p_client_name:v.client_name,p_client_email:v.client_email,p_client_company:v.client_company,p_campaign:v.campaign,p_valid_until:v.valid_until,p_discount_amount:v.discount_amount,p_notes:v.notes,p_items:v.items}));return Array.isArray(result)?result[0]:result;}
 const existing=local.quotes.find(q=>q.request_id===requestId);if(existing)return structuredClone(existing);
 const id=crypto.randomUUID(),now=new Date().toISOString();
 const items=clean.items.map((x,position)=>{const r=d.rates.find(y=>y.id===x.rate_id),a=d.accounts.find(y=>y.id===r.instagram_account_id);return{id:crypto.randomUUID(),quote_id:id,rate_id:r.id,instagram_handle:a.handle,service:r.service,quantity:x.quantity,unit_price:Number(r.unit_price),line_total:calculateTotals([{unit_price:r.unit_price,quantity:x.quantity}]).total,position};});
 const {items:unused,totals,...fields}=clean;
 const q={...fields,...totals,id,request_id:requestId,folio:'VISTA-'+id.slice(0,8).toUpperCase(),status:'borrador',currency:'MXN',tax_rate:0,company_name:d.company.name,terms:d.company.terms,logo_url:d.company.logo_url,created_at:now,updated_at:now,pdf_path:null};
 local.quotes.unshift(q);local.items.push(...items);local.events.push({id:crypto.randomUUID(),quote_id:id,from_status:null,to_status:'borrador',note:'Creada en vista local',created_at:now});persist();return structuredClone(q);
}
export const transitions={borrador:['enviada','cancelada'],enviada:['aceptada','rechazada','cancelada'],aceptada:[],rechazada:[],cancelada:[]};
export async function changeStatus(id,status,note){
 if(client)return checked(await client.rpc('set_quote_status',{p_quote_id:id,p_status:status,p_note:note}));
 const q=local.quotes.find(x=>x.id===id);if(!q||!transitions[q.status]?.includes(status))throw Error('Cambio de estado no permitido.');
 if(['enviada','aceptada'].includes(status)&&effectiveStatus(q)==='vencida')throw Error('La cotización está vencida.');
 const from=q.status;q.status=status;q.updated_at=new Date().toISOString();local.events.push({id:crypto.randomUUID(),quote_id:id,from_status:from,to_status:status,note,created_at:q.updated_at});persist();
}
export async function documents(id,action='pdf'){
 if(!client)throw Error('La sincronización requiere conectar el proyecto de EM Agency.');
 const r=checked(await client.functions.invoke('quote-documents',{body:{quote_id:id,action}}));if(r.error&&!r.pdf_url)throw Error(r.error);return r;
}

