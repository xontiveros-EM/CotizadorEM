import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import {money,calculateTotals,parseCatalogCsv,parseCatalogJson,escapeHtml,effectiveStatus} from '../src/domain.js';

const original=await fs.readFile(new URL('../src/main.js',import.meta.url),'utf8');
const appCode=original.replace(/^import .*\n/gm,'').replace(/import\.meta\.env/g,'env');
const end=appCode.lastIndexOf('\nstart().catch');
assert.ok(end>0,'Main app entry point must be present');
const fixture=()=>({
 company:{name:'EM Agency',validity_days:15,terms:'No incluye IVA.'},
 profile:{full_name:'Vendedora EM',email:'vendedora@example.test'},
 numbering:{quote_prefix:'EM ',quote_last_number:100,quote_padding:0,quote_configured:true,oc_prefix:'OC ',oc_last_number:2710,oc_padding:0,oc_configured:true},
 accounts:[{id:'a1',handle:'talento',active:true}],rates:[{id:'r1',instagram_account_id:'a1',service:'IG Reel',unit_price:200,active:true}],
 quotes:[
  {id:'real',is_sample:false,folio:'EM 101',status:'aceptada',total:100,subtotal:100,discount_amount:0,client_name:'Cliente real',valid_until:'2099-01-01',created_at:'2026-11-09T18:00:00Z',logo_url:'/CotizadorEM/brand/em-agency.png'},
  {id:'sample',is_sample:true,folio:null,status:'borrador',total:900,subtotal:900,discount_amount:0,client_name:'Cliente muestra',valid_until:'2099-01-01',created_at:'2026-11-09T18:00:00Z'},
  {id:'deleted',is_sample:false,folio:'EM 99',status:'aceptada',deleted_at:'2026-11-09T18:00:00Z',total:5000,client_name:'Cliente eliminado',valid_until:'2099-01-01',created_at:'2026-11-09T18:00:00Z'},
 ],items:[{quote_id:'real',rate_id:'r1',instagram_handle:'talento',service:'IG Reel',quantity:2,unit_price:50,line_total:100}],events:[],sync:[]
});
function harness(cloud=true){
 const state={fixture:fixture(),downloads:[],pdfInputs:[],documentCalls:[],confirmations:[],messages:[],dialog:null};
 const message={hidden:true,setAttribute(name,value){this[name]=value;}};
 const toast={textContent:'',className:''};
 const app={innerHTML:'',listeners:{},setAttribute(){},removeAttribute(){},addEventListener(type,fn){this.listeners[type]=fn;},append(el){if(el.tag==='dialog')state.dialog=el;}};
 const document={
  querySelector(selector){
   if(selector==='#app')return app;if(selector==='#toast')return toast;if(selector==='#quote-dialog')return state.dialog;
   if(selector==='#quote-dialog[open]')return state.dialog?.open?state.dialog:null;return null;
  },
  createElement(tag){
   const el={tag,innerHTML:'',setAttribute(){},addEventListener(){},querySelector(s){return s==='#detail-message'?message:{prepend(){}};},showModal(){this.open=true;},close(){this.open=false;},remove(){if(tag==='dialog')state.dialog=null;},click(){state.downloads.push(this.download);}};
   return el;
  },
  body:{classList:{add(){},remove(){}},append(){}}
 };
 class AppURL extends URL{static createObjectURL(blob){state.blob=blob;return 'blob:em-test';}static revokeObjectURL(){}}
 const context=vm.createContext({
  env:{BASE_URL:'/CotizadorEM/'},document,window:{confirm(text){state.confirmations.push(text);return true;}},
  location:{href:'https://xontiveros-em.github.io/CotizadorEM/'},history:{replaceState(){}},
  crypto:globalThis.crypto,Intl,URL:AppURL,Blob,TextDecoder,Uint8Array,Date,Number,String,Boolean,structuredClone,
  setTimeout(){return 1;},clearTimeout(){},isCloud:cloud,client:null,configError:'',
  money,calculateTotals,parseCatalogCsv,parseCatalogJson,e:escapeHtml,effectiveStatus,
  transitions:{borrador:['enviada','cancelada'],enviada:['aceptada','rechazada','cancelada'],aceptada:[],rechazada:[],cancelada:[]},
  loadData:async()=>state.fixture,documents:async(id,action)=>{state.documentCalls.push([id,action]);throw Error('Función no instalada');},
  generateQuotePdf:async input=>{state.pdfInputs.push(input);return new TextEncoder().encode('%PDF-test');},
  fetch:async()=>{throw Error('Network unavailable');},
  importCatalog:async()=>{},saveCompany:async()=>{},uploadLogo:async()=>{},createQuote:async()=>{},
  changeStatus:async()=>{},deleteQuote:async()=>{},convertQuoteToOc:async()=>({oc_folio:'OC 2711'}),
  saveMyProfile:async()=>{},saveNumbering:async()=>{},fixture:state.fixture,
 });
 vm.runInContext(appCode.slice(0,end),context,{filename:'main.js'});
 vm.runInContext('data=fixture;',context);
 return {state,context,app,toast,message,run:code=>vm.runInContext(code,context)};
}

test('Dashboard separates samples and deleted quotes from actual accepted totals',()=>{
 const h=harness(),html=h.run('renderQuotes()');
 assert.match(html,/Cotizaciones reales/);assert.ok(html.includes(money(100)));
 assert.ok(!html.includes('Cliente muestra'));assert.ok(!html.includes('Cliente eliminado'));
 const sampleHtml=h.run("kindFilter='sample';renderQuotes()");assert.ok(sampleHtml.includes('Cliente muestra'));assert.ok(!sampleHtml.includes('Cliente real'));
 const deletedHtml=h.run("kindFilter='deleted';renderQuotes()");assert.ok(deletedHtml.includes('Cliente eliminado'));assert.ok(!deletedHtml.includes('Cliente real'));
});

test('Real quotation requires confirmed numbering, while samples and automatic seller remain available',()=>{
 const h=harness();h.run('data.numbering.quote_configured=false;draft=freshDraft();');
 const realHtml=h.run('renderNew()');assert.match(realHtml,/Configurar numeración/);assert.match(realHtml,/type="submit" disabled/);
 const sampleHtml=h.run('draft.is_sample=true;renderNew()');assert.match(sampleHtml,/Guardar muestra/);assert.doesNotMatch(sampleHtml,/type="submit" disabled/);
 assert.match(sampleHtml,/Vendedora EM/);assert.match(sampleHtml,/vendedora@example.test/);assert.match(sampleHtml,/name="seller_whatsapp"/);
});

test('Local preview only enables sample creation',()=>{
 const h=harness(false);const html=h.run('draft=freshDraft();renderNew()');
 assert.equal(h.run('draft.is_sample'),true);assert.match(html,/value="real"[^>]*disabled/);assert.match(html,/Guardar muestra/);
});

test('Reusing a quote prepares a new sample and uses current rates instead of historical prices',()=>{
 const h=harness();const before=h.run('requestId');h.run("reuseQuote('real')");
 assert.equal(h.run('draft.is_sample'),true);assert.notEqual(h.run('requestId'),before);
 assert.equal(h.run('draft.items[0].rate_id'),'r1');assert.equal(h.run('draft.items[0].quantity'),2);
 assert.equal(h.run('draft.items[0].unit_price'),undefined);assert.equal(h.run('data.rates[0].unit_price'),200);
 assert.equal(h.run('draft.seller_whatsapp'),'');
});

test('Loading example always creates a sample based on available catalogue rates',()=>{
 const h=harness();h.run('loadExample()');assert.equal(h.run('draft.is_sample'),true);
 assert.match(h.run('draft.notes'),/ficticios/);assert.equal(h.run('draft.items[0].rate_id'),'r1');
});

test('Samples never reach automatic or manual commercial Sheets sync',async()=>{
 const h=harness();await h.run("tryAutoSync(data.quotes.find(q=>q.id==='sample'))");
 assert.equal(h.state.documentCalls.length,0);
 await assert.rejects(h.run("syncQuote('sample')"),/muestras no se envían/);assert.equal(h.state.documentCalls.length,0);
});

test('Missing server PDF still downloads a browser-generated PDF and exposes pending integration',async()=>{
 const h=harness();await h.run("downloadPdf('real')");
 assert.equal(h.state.downloads.length,1);assert.equal(h.state.downloads[0],'EM-101.pdf');
 assert.equal(h.state.pdfInputs.length,1);assert.equal(h.state.pdfInputs[0].quote.id,'real');
 assert.equal(await h.state.blob.text(),'%PDF-test');assert.match(h.toast.textContent,/PDF descargado desde este navegador/);assert.match(h.toast.textContent,/Función no instalada/);
});

test('Errors remain visible inside an open detail dialog',()=>{
 const h=harness();h.run("showDetail('real');toast('Error de prueba',true)");
 assert.equal(h.message.textContent,'Error de prueba');assert.equal(h.message.role,'alert');assert.equal(h.message.hidden,false);
 assert.match(h.state.dialog.innerHTML,/VENDEDOR/);assert.match(h.state.dialog.innerHTML,/Convertir en orden de compra/);
});

test('Sample and deleted details expose no state transition or OC conversion and deleted PDF is denied',async()=>{
 const h=harness();h.run("showDetail('sample')");assert.doesNotMatch(h.state.dialog.innerHTML,/id="status-form"/);assert.doesNotMatch(h.state.dialog.innerHTML,/data-action="convert-oc"/);
 h.run("showDetail('deleted')");assert.doesNotMatch(h.state.dialog.innerHTML,/data-action="pdf"/);await assert.rejects(h.run("downloadPdf('deleted')"),/eliminada/);
});
