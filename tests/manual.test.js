import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {quoteSheetRow} from '../supabase/functions/_shared/sheets.js';

test('enlace de Sheets conserva la carpeta de GitHub Pages',()=>{
 const row=quoteSheetRow({id:'11111111-1111-4111-8111-111111111111',subtotal:1,discount_amount:0,total:1},'https://xontiveros-em.github.io/CotizadorEM/?old=1#old');
 assert.equal(row[14],'https://xontiveros-em.github.io/CotizadorEM/?quote=11111111-1111-4111-8111-111111111111');
});
test('archivo único para el editor genera PDF y mantiene comprobación de sesión',async()=>{
 let source=await fs.readFile(new URL('../manual/quote-documents.ts',import.meta.url),'utf8');
 assert.ok(!/from ['"]\.\.?\//.test(source),'Debe funcionar sin archivos relativos');
 source=source.replace("'npm:@supabase/supabase-js@2.119.0'",JSON.stringify(import.meta.resolve('@supabase/supabase-js')))
 .replace("'npm:pdf-lib@1.17.1'",JSON.stringify(import.meta.resolve('pdf-lib')));
 let handler;const priorDeno=globalThis.Deno;
 globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://test.supabase.co',ALLOWED_ORIGIN:'https://em.example.test',SUPABASE_ANON_KEY:'test',SUPABASE_SERVICE_ROLE_KEY:'test'}[key])},serve:fn=>{handler=fn;}};
 try{
  await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(source,{mode:'strip'})).toString('base64'));
  assert.equal((await handler(new Request('https://test/quote-documents',{method:'POST'}))).status,401);
  assert.equal((await handler(new Request('https://test/quote-documents',{method:'POST',headers:{Origin:'https://other.test'}}))).status,403);
  const previous=globalThis.fetch;
  globalThis.fetch=async(url,options={})=>{
   const p=new URL(url).pathname;
   if(p==='/auth/v1/user')return Response.json({id:'11111111-1111-4111-8111-111111111111',aud:'authenticated'});
   if(p==='/rest/v1/quotes'&&(!options.method||options.method==='GET'))return Response.json({id:'22222222-2222-4222-8222-222222222222',folio:'COT-2026-000001',status:'borrador',company_name:'Cotizador EM Agency',client_name:'Cliente Prueba',updated_at:'2026-11-09T12:00:00Z',created_at:'2026-11-09T12:00:00Z',valid_until:'2026-12-01',subtotal:100,total:100,discount_amount:0});
   if(p==='/rest/v1/quote_items')return Response.json([{instagram_handle:'prueba',service:'IG Story',quantity:1,unit_price:100,line_total:100}]);
   if(p==='/rest/v1/company_settings')return Response.json({id:1,name:'Cotizador EM Agency'});
   if(p.includes('/object/sign/'))return Response.json({signedURL:'/object/sign/quote-pdfs/test.pdf?token=test'});
   if(p.includes('/storage/'))return Response.json({Key:'test.pdf'});
   return new Response(null,{status:204});
  };
  try{
   const response=await handler(new Request('https://test/quote-documents',{method:'POST',headers:{Authorization:'Bearer test-jwt','Content-Type':'application/json'},body:JSON.stringify({quote_id:'22222222-2222-4222-8222-222222222222',action:'sync'})}));
   assert.equal(response.status,200);const data=await response.json();assert.ok(data.pdf_url);assert.equal(data.sync_status,'pending');
  }finally{globalThis.fetch=previous;}
 }finally{if(priorDeno===undefined)delete globalThis.Deno;else globalThis.Deno=priorDeno;}
});

