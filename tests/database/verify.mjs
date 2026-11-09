import {PGlite} from '@electric-sql/pglite';import fs from 'node:fs/promises';import assert from 'node:assert/strict';const db=new PGlite();
await db.exec("create role anon;create role authenticated;create role service_role bypassrls;create schema auth;create schema storage;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;grant usage on schema auth,storage to anon,authenticated,service_role;grant execute on function auth.uid() to anon,authenticated,service_role;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);alter table storage.objects enable row level security;");

await db.exec(await fs.readFile(new URL('../../supabase/schema.sql',import.meta.url),'utf8'));
const staff='11111111-1111-4111-8111-111111111111',outsider='22222222-2222-4222-8222-222222222222';
const account='33333333-3333-4333-8333-333333333333',rate='44444444-4444-4444-8444-444444444444',request='55555555-5555-4555-8555-555555555555';
await db.query('insert into auth.users(id)values($1),($2)',[staff,outsider]);
await db.query('insert into private.staff_members(user_id)values($1)',[staff]);
await db.query("insert into instagram_accounts(id,handle,display_name,followers)values($1,'talento_prueba','Talento Prueba',null)",[account]);
await db.query("insert into rates(id,instagram_account_id,service,unit_price)values($1,$2,'IG Reel',14285.71)",[rate,account]);
let assertions=0;
async function role(name,user,fn){await db.exec('set role '+name);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[user||'']);try{return await fn();}finally{await db.exec('reset role');}}
const args=[request,'Cliente Prueba','','Marca','Campaña Prueba',null,0,'Sin IVA',JSON.stringify([{rate_id:rate,quantity:2}])];
const create=values=>db.query('select * from public.create_quote($1::uuid,$2::text,$3::text,$4::text,$5::text,$6::date,$7::numeric,$8::text,$9::jsonb)',values);
await role('anon',null,async()=>{await assert.rejects(()=>db.query('select * from quotes'));await assert.rejects(()=>create(args));assertions+=2;});
await role('authenticated',outsider,async()=>{assert.equal((await db.query('select * from quotes')).rows.length,0);await assert.rejects(()=>create(args));assertions+=2;});
let quote;
await role('authenticated',staff,async()=>{
 quote=(await create(args)).rows[0];
 assert.match(quote.folio,/^COT-\d{4}-\d{6,}$/);assert.equal(Number(quote.total),28571.42);assert.equal(Number(quote.tax_amount),0);assertions+=3;
 assert.equal((await create(args)).rows[0].id,quote.id);assertions++;
 await assert.rejects(()=>create([args[0],'Otro cliente',...args.slice(2)]));assertions++;
 await assert.rejects(()=>db.query('update quotes set total=0 where id=$1',[quote.id]));assertions++;
 await db.query('update rates set unit_price=20000 where id=$1',[rate]);
 assert.equal(Number((await db.query('select unit_price from quote_items where quote_id=$1',[quote.id])).rows[0].unit_price),14285.71);assertions++;
 const replay=(await create(args)).rows[0];assert.equal(replay.id,quote.id);assert.equal(Number(replay.total),28571.42);assertions+=2;
 await assert.rejects(()=>create([crypto.randomUUID(),...args.slice(1,6),999999,...args.slice(7)]));assertions++;
 assert.equal((await db.query("select * from public.set_quote_status($1,'enviada','Enviada manualmente')",[quote.id])).rows[0].status,'enviada');assertions++;
 assert.equal((await db.query("select * from public.set_quote_status($1,'aceptada','Aprobada')",[quote.id])).rows[0].status,'aceptada');assertions++;
 await assert.rejects(()=>db.query("select * from public.set_quote_status($1,'borrador','')",[quote.id]));assertions++;
 assert.equal(Number((await db.query('select count(*) from quote_events where quote_id=$1',[quote.id])).rows[0].count),3);assertions++;
 await assert.rejects(()=>db.query('select public.acquire_sheet_lock($1,120)',[crypto.randomUUID()]));assertions++;
 await assert.rejects(()=>db.query('select public.finish_sheet_sync($1,$2,null)',[quote.id,quote.updated_at]));assertions++;
 await assert.rejects(()=>db.query('update company_settings set tax_rate=16'));assertions++;
 await db.query("update company_settings set name='Marca posterior' where id=1");
 assert.equal((await db.query('select company_name from quotes where id=$1',[quote.id])).rows[0].company_name,'Cotizador EM Agency');assertions++;
});
await role('service_role',null,async()=>{
 const token=crypto.randomUUID(),other=crypto.randomUUID();
 assert.equal((await db.query('select public.acquire_sheet_lock($1,120) acquired',[token])).rows[0].acquired,true);assertions++;
 assert.equal((await db.query('select public.acquire_sheet_lock($1,120) acquired',[other])).rows[0].acquired,false);assertions++;
 assert.equal((await db.query('select public.release_sheet_lock($1) released',[other])).rows[0].released,false);assertions++;
 assert.equal((await db.query('select public.release_sheet_lock($1) released',[token])).rows[0].released,true);assertions++;
 assert.equal((await db.query('select public.finish_sheet_sync($1,$2,null) status',[quote.id,quote.updated_at])).rows[0].status,'pending');assertions++;
 const current=(await db.query('select updated_at::text as updated_at from quotes where id=$1',[quote.id])).rows[0];
 assert.equal((await db.query('select public.finish_sheet_sync($1,$2,null) status',[quote.id,current.updated_at])).rows[0].status,'synced');assertions++;
 assert.equal((await db.query("select public.finish_sheet_sync($1,$2,'Google sin permisos') status",[quote.id,current.updated_at])).rows[0].status,'error');assertions++;
});
assert.equal(Number((await db.query("select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and c.relrowsecurity")).rows[0].count),7);assertions++;
await db.close();console.log(JSON.stringify({engine:'PostgreSQL WASM (PGlite 0.5.16)',assertions,passed:true,remote_changes:false},null,2));

