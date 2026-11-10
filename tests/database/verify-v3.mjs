import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
let PGlite;
try { ({PGlite}=await import('@electric-sql/pglite')); }
catch { ({PGlite}=await import('../../.verification/node_modules/@electric-sql/pglite/dist/index.js')); }
const db=new PGlite();
let assertions=0;
function eq(a,b){assert.equal(a,b);assertions++;}
async function rejects(fn,code){await assert.rejects(fn,code?e=>e.code===code:undefined);assertions++;}
async function role(name,user,fn){await db.exec('set role '+name);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);try{return await fn();}finally{await db.exec('reset role');}}
const staff='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',staff2='66666666-6666-4666-8666-666666666666';
const account='33333333-3333-4333-8333-333333333333',rate='44444444-4444-4444-8444-444444444444';
const numbering=async()=>(await db.query('select public.get_document_numbering() as value')).rows[0].value;
const saveNumbering=(qPrefix='PRUEBA-',last=90,oPrefix='OC ',ocLast=2710)=>db.query('select public.save_document_numbering($1,$2,4,$3,$4,0) as value',[qPrefix,last,oPrefix,ocLast]);
const input=(sample=false,id=crypto.randomUUID())=>[id,'Cliente Prueba','cliente@example.test','Marca','Campaña',null,0,'Condiciones',JSON.stringify([{rate_id:rate,quantity:2}]),sample,'+52 55 1234 5678'];
const create=async values=>(await db.query('select * from public.create_quote_v3($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::date,$7::numeric,$8::text,$9::jsonb,$10::boolean,$11::text)',values)).rows[0];
const del=async id=>(await db.query('select * from public.delete_quote($1)',[id])).rows[0];
const convert=async id=>(await db.query('select * from public.convert_quote_to_oc($1)',[id])).rows[0];
const status=(id,s)=>db.query('select * from public.set_quote_status($1,$2,\'Prueba\')',[id,s]);
try {
await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth,storage to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;");
await db.exec(await fs.readFile(new URL('../../supabase/schema.sql',import.meta.url),'utf8'));
await db.query("insert into auth.users(id,email,raw_user_meta_data)values($1,'original@example.test','{\"full_name\":\"Vendedor Original\"}'),($2,'externo@example.test','{}'),($3,'otro@example.test','{\"name\":\"Otra Vendedora\"}')",[staff,other,staff2]);
await db.query('insert into private.staff_members(user_id)values($1),($2)',[staff,staff2]);
await db.query("insert into instagram_accounts(id,handle,display_name)values($1,'talento_prueba','Talento Prueba')",[account]);
await db.query("insert into rates(id,instagram_account_id,service,unit_price)values($1,$2,'IG Reel',14285.71)",[rate,account]);
let historical;
await role('authenticated',staff,async()=>{historical=(await db.query('select * from public.create_quote($1,$2,$3,$4,$5,$6,$7,$8,$9)',input().slice(0,9))).rows[0];});
const upgrade=await fs.readFile(new URL('../../manual/actualizar-cotizador-v3.sql',import.meta.url),'utf8');
await db.exec(upgrade);
await db.exec(upgrade);
eq((await db.query('select folio from quotes where id=$1',[historical.id])).rows[0].folio,historical.folio);
eq((await db.query('select seller_name from quotes where id=$1',[historical.id])).rows[0].seller_name,null);
await role('anon',null,async()=>{await rejects(()=>numbering(),'42501');await rejects(()=>create(input()),'42501');await rejects(()=>del(historical.id),'42501');});
await role('authenticated',other,async()=>{await rejects(()=>numbering(),'42501');await rejects(()=>saveNumbering(),'42501');await rejects(()=>create(input()),'42501');await rejects(()=>convert(historical.id),'42501');await rejects(()=>del(historical.id),'42501');eq((await db.query('select * from quotes')).rows.length,0);});
let sample,q1,q2,q3,request1;
await role('authenticated',staff,async()=>{
 eq((await numbering()).quote_configured,false);eq((await numbering()).oc_configured,false);eq((await numbering()).oc_last_number,2710);
 await rejects(()=>db.query('select * from private.document_counters'),'42501');
 await rejects(()=>db.query('select * from public.create_quote($1,$2,$3,$4,$5,$6,$7,$8,$9)',input().slice(0,9)),'55000');
 await rejects(()=>create(input()),'55000');
 const sampleArgs=input(true);
 for(const invalid of ['1234','+++','1234567890123456','55 ext 1234567']){
  const bad=input(true);bad[10]=invalid;await rejects(()=>create(bad),'22023');
 }
 const dotted=input(true);dotted[10]='+52 55.1234.5678';
 eq((await create(dotted)).seller_whatsapp,'+52 55.1234.5678');
 const blankWa=input(true);blankWa[10]='';eq((await create(blankWa)).seller_whatsapp,'');
 sample=await create(sampleArgs);
 eq(sample.is_sample,true);eq(sample.folio,null);eq(sample.quote_number,null);
 eq(Number(sample.total),28571.42);
 eq((await create(sampleArgs)).id,sample.id);
 eq((await numbering()).quote_last_number,0);eq((await numbering()).oc_last_number,2710);
 eq((await db.query('select count(*) n from sheet_sync where quote_id=$1',[sample.id])).rows[0].n,0);
 await rejects(()=>status(sample.id,'enviada'),'22023');await rejects(()=>convert(sample.id),'22023');
 const onlyOc=(await saveNumbering('',0)).rows[0].value;eq(onlyOc.quote_configured,false);eq(onlyOc.oc_configured,true);
 await saveNumbering();
 await rejects(()=>db.query("select public.save_document_numbering('PRUEBA-',90,11,'OC ',2710,0)"),'22023');
 await rejects(()=>db.query("select public.save_document_numbering('PRUEBA-',90,4,'OC ',2710,11)"),'22023');
 const before=await numbering();
 await rejects(()=>saveNumbering('PRUEBA-',90,'OC ',2709),'22023');
 eq((await numbering()).oc_last_number,before.oc_last_number);
 request1=input();
 q1=await create(request1);eq(q1.folio,'PRUEBA-0091');eq(q1.seller_name,'Vendedor Original');eq(q1.seller_email,'original@example.test');eq(q1.seller_whatsapp,'+52 55 1234 5678');
 q2=await create(input());eq(q2.folio,'PRUEBA-0092');eq((await numbering()).quote_last_number,92);
 eq((await create(request1)).id,q1.id);eq((await numbering()).quote_last_number,92);
 await rejects(()=>create([request1[0],'Otro',...request1.slice(2)]),'22023');
 await rejects(()=>convert(q1.id),'22023');
 await rejects(()=>db.query('update quotes set is_sample=true where id=$1',[q1.id]),'42501');
 await rejects(()=>db.query('delete from quotes where id=$1',[q1.id]),'42501');
 await status(q1.id,'enviada');await status(q1.id,'aceptada');
 q1=await convert(q1.id);eq(q1.folio,'PRUEBA-0091');eq(q1.oc_folio,'OC 2711');eq(Number(q1.oc_number),2711);
 eq((await convert(q1.id)).oc_folio,'OC 2711');eq((await numbering()).oc_last_number,2711);
 eq((await db.query("select count(*) n from quote_events where quote_id=$1 and note like 'Convertida%'",[q1.id])).rows[0].n,1);
 await rejects(()=>del(q1.id),'22023');
 const deleted=await del(q2.id);assert.ok(deleted.deleted_at);assertions++;eq(deleted.folio,'PRUEBA-0092');
 const countBefore=(await db.query('select count(*) n from quote_events where quote_id=$1',[q2.id])).rows[0].n;
 eq((await del(q2.id)).deleted_at.toISOString(),deleted.deleted_at.toISOString());eq((await db.query('select count(*) n from quote_events where quote_id=$1',[q2.id])).rows[0].n,countBefore);
 await rejects(()=>status(q2.id,'enviada'),'22023');await rejects(()=>convert(q2.id),'22023');
 q3=await create(input());eq(q3.folio,'PRUEBA-0093');
 await rejects(()=>saveNumbering('PRUEBA-',92,'OC ',2711),'22023');
 await rejects(()=>saveNumbering('',93,'OC ',2711),'22023');
 const ds=await del(sample.id);assert.ok(ds.deleted_at);assertions++;eq((await numbering()).quote_last_number,93);
});
await db.query("update auth.users set email='nuevo@example.test',raw_user_meta_data='{\"full_name\":\"Nombre Nuevo\"}' where id=$1",[staff]);
await db.query('update rates set unit_price=20000,active=false where id=$1',[rate]);
await role('authenticated',staff,async()=>{
 const replay=await create(request1);eq(replay.id,q1.id);eq(replay.seller_name,'Vendedor Original');eq(replay.seller_email,'original@example.test');eq(Number(replay.total),28571.42);
});
await role('authenticated',staff2,async()=>{await rejects(()=>create(request1),'22023');});
await db.query("update auth.users set raw_user_meta_data='{}' where id=$1",[staff]);
await role('authenticated',staff,async()=>{await rejects(()=>create(input(true)),'22023');});
await db.exec(upgrade);
await db.query("update quotes set status='aceptada',valid_until=current_date-2 where id=$1",[q3.id]);
await role('authenticated',staff,async()=>{
 await rejects(()=>convert(q3.id),'22023');
 eq((await numbering()).oc_last_number,2711);
 eq((await numbering()).quote_last_number,93);eq((await numbering()).oc_last_number,2711);
 eq((await db.query('select oc_folio from quotes where id=$1',[q1.id])).rows[0].oc_folio,'OC 2711');
});
eq((await db.query("select count(*) n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('get_document_numbering','save_document_numbering','create_quote_v3','convert_quote_to_oc','delete_quote') and p.prosecdef")).rows[0].n,0);
console.log(JSON.stringify({engine:'PostgreSQL WASM (PGlite 0.5.16)',version:'EM V3',assertions,passed:true,remote_changes:false},null,2));
} catch(error) { console.error(JSON.stringify({message:error.message,code:error.code,detail:error.detail,position:error.position,where:error.where,stack:error.stack?.split('\n').slice(0,4)},null,2));process.exitCode=1; }
finally {await db.close();}
