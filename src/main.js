import './style.css';
import {money,calculateTotals,parseCatalogCsv,parseCatalogJson,escapeHtml as e,effectiveStatus} from './domain.js';
import {client,isCloud,configError,loadData,importCatalog,saveCompany,uploadLogo,createQuote,changeStatus,documents,transitions} from './repository.js';
import {generateQuotePdf} from './pdf.js';
const app=document.querySelector('#app');
const base=import.meta.env.BASE_URL||'/';
const brandLogo=base+'brand/em-agency.png';
const labels={borrador:'Borrador',enviada:'Enviada',aceptada:'Aceptada',rechazada:'Rechazada',cancelada:'Cancelada',vencida:'Vencida'};
let data=null,tab='quotes',search='',filter='all',catalogSearch='',selectedId=null,busy=false,draft=null;
let requestId=crypto.randomUUID(),toastTimer;
const dateText=v=>v?new Intl.DateTimeFormat('es-MX',{day:'numeric',month:'short',year:'numeric',timeZone:'America/Mexico_City'}).format(new Date(v.length===10?v+'T12:00:00-06:00':v)):'—';
const badge=q=>'<span class="badge '+effectiveStatus(q)+'">'+e(labels[effectiveStatus(q)]||q.status)+'</span>';
const syncText=s=>({synced:'Sincronizada',error:'Requiere reintento',processing:'Sincronizando',pending:'Pendiente'}[s]||'Pendiente');
function toast(message,error=false){const t=document.querySelector('#toast');clearTimeout(toastTimer);t.textContent=message;t.className='visible'+(error?' error':'');toastTimer=setTimeout(()=>{t.className='';},7000);}
async function action(fn){if(busy)return;busy=true;app.inert=true;app.setAttribute('aria-busy','true');document.body.classList.add('working');try{await fn();}catch(error){toast(error.message||'No se pudo completar la operación.',true);}finally{busy=false;app.inert=false;app.removeAttribute('aria-busy');document.body.classList.remove('working');}}
function deadline(){const d=new Date();d.setUTCDate(d.getUTCDate()+Number(data?.company.validity_days||15));return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
function freshDraft(){return {client_name:'',client_email:'',client_company:'',campaign:'',valid_until:deadline(),discount_amount:'0',notes:'',items:[{rate_id:'',quantity:1}]};}
function shell(body){
 const name=data?.company?.name||'Cotizador EM Agency';
 return '<div class="layout"><aside class="sidebar"><a class="brand" href="'+base+'" aria-label="Inicio EM Agency"><span class="brand-logo-wrap"><img src="'+brandLogo+'" alt="EM Agency" class="brand-logo"></span></a><div class="nav-label">ESPACIO DE TRABAJO</div><nav aria-label="Principal">'+[['quotes','▤','Cotizaciones'],['new','＋','Nueva cotización'],['catalog','◎','Catálogo de Instagram'],['settings','⚙','Configuración']].map(([id,icon,text])=>'<button class="nav-item '+(tab===id?'active':'')+'" data-nav="'+id+'"><span aria-hidden="true">'+icon+'</span>'+text+'</button>').join('')+'</nav><div class="sidebar-bottom"><span class="connection-dot"></span><div>'+ (isCloud?'Espacio conectado':'Vista local')+'<small>'+ (isCloud?'EM Agency':'Pendiente de conectar')+'</small></div></div></aside><div class="workspace"><header class="topbar"><span>'+e(name)+'</span><div><span class="currency-label">MXN · No incluye IVA</span>'+(isCloud?'<button class="text-button" data-action="logout">Cerrar sesión</button>':'<span class="avatar" aria-label="EM Agency">EM</span>')+'</div></header>'+(!isCloud?'<div class="local-notice"><span>◌</span><div><strong>Vista local de preparación</strong><span>Los datos se guardan en este navegador. Los folios definitivos y Google Sheets se activarán al conectar las cuentas nuevas.</span></div></div>':'')+'<main>'+body+'</main><footer>EM AGENCY <span>·</span> Cotizaciones en pesos mexicanos <span>·</span> No incluye IVA</footer></div></div>';
}
function render(){
 if(configError){app.innerHTML='<div class="login"><h1>Revisar conexión</h1><p>'+e(configError)+'</p></div>';return;}
 if(!data)return;
 let body='';
 if(tab==='quotes')body=renderQuotes();
 if(tab==='new')body=renderNew();
 if(tab==='catalog')body=renderCatalog();
 if(tab==='settings')body=renderSettings();
 app.innerHTML=shell(body);
}
function heading(eyebrow,title,description,button=''){return '<div class="page-heading"><div><span class="eyebrow">'+eyebrow+'</span><h1>'+title+'</h1><p>'+description+'</p></div>'+button+'</div>';}
function renderQuotes(){
 const quotes=data.quotes;
 const pending=quotes.filter(q=>['borrador','enviada'].includes(effectiveStatus(q)));
 const accepted=quotes.filter(q=>q.status==='aceptada');
 const all=quotes.filter(q=>(filter==='all'||effectiveStatus(q)===filter)&&[q.folio,q.client_name,q.client_company,q.campaign].some(v=>String(v||'').toLowerCase().includes(search.toLowerCase())));
 const total=accepted.reduce((sum,q)=>sum+Number(q.total),0);
 return heading('GESTIÓN COMERCIAL','Cada propuesta, bajo control.','Crea cotizaciones y sigue cada oportunidad desde un solo lugar.','<button class="button primary" data-nav="new">＋ Nueva cotización</button>')+
 '<div class="metrics"><div><span>Cotizaciones</span><strong>'+quotes.length+'</strong><small>En tu espacio de trabajo</small></div><div><span>En seguimiento</span><strong>'+pending.length+'</strong><small>Borradores y propuestas enviadas</small></div><div><span>Importe aceptado</span><strong>'+money(total)+'</strong><small>MXN · No incluye IVA</small></div></div>'+
 '<section class="panel"><div class="panel-toolbar"><div><h2>Tus cotizaciones <span class="count">'+quotes.length+'</span></h2><p>Historial, documentos y próximos pasos.</p></div><div class="tools"><label class="search"><span aria-hidden="true">⌕</span><input id="quote-search" placeholder="Buscar cliente o folio…" value="'+e(search)+'" aria-label="Buscar cotizaciones"></label><select id="status-filter" aria-label="Filtrar por estado"><option value="all">Todos los estados</option>'+Object.entries(labels).map(([id,l])=>'<option '+(filter===id?'selected':'')+' value="'+id+'">'+l+'</option>').join('')+'</select></div></div>'+
 (all.length?'<div class="table-scroll"><table><thead><tr><th>Folio / campaña</th><th>Cliente</th><th>Estado</th><th>Vigencia</th><th class="number">Total MXN</th><th></th></tr></thead><tbody>'+all.map(q=>'<tr><td><strong>'+e(q.folio)+'</strong><small>'+e(q.campaign||'Sin nombre de campaña')+'</small></td><td>'+e(q.client_name)+'<small>'+e(q.client_company||'')+'</small></td><td>'+badge(q)+'</td><td>'+dateText(q.valid_until)+'</td><td class="number">'+money(q.total)+'</td><td><button class="text-button" data-action="open" data-id="'+q.id+'">Ver cotización ↗</button></td></tr>').join('')+'</tbody></table></div>':
 '<div class="empty"><span class="empty-icon">↗</span><h3>'+(quotes.length?'No hay coincidencias':'Tu próxima propuesta comienza aquí')+'</h3><p>'+(quotes.length?'Prueba con otro cliente, folio o estado.':'Carga tu catálogo y convierte tus servicios de Instagram en una cotización con seguimiento.')+'</p><button class="button secondary" data-nav="'+(data.rates.length?'new':'catalog')+'">'+(data.rates.length?'Crear primera cotización':'Preparar catálogo')+' →</button></div>')+'</section>'+
 '<div class="note-row"><span>01 / Catálogo</span><span>02 / Cotización y folio</span><span>03 / PDF y seguimiento</span><span>04 / Google Sheets</span></div>';
}
function rateOptions(id){return '<option value="">Selecciona cuenta y servicio</option>'+data.rates.filter(r=>r.active&&data.accounts.some(a=>a.id===r.instagram_account_id&&a.active)).map(r=>{const a=data.accounts.find(a=>a.id===r.instagram_account_id);return '<option value="'+r.id+'" '+(r.id===id?'selected':'')+'>@'+e(a.handle)+' · '+e(r.service)+' · '+money(r.unit_price)+'</option>';}).join('');}
function formField(name,label,type='text',required=false,extra=''){return '<label class="field">'+label+'<input name="'+name+'" type="'+type+'" value="'+e(draft[name]||'')+'" '+(required?'required':'')+' '+extra+'></label>';}
function renderNew(){
 if(!draft)draft=freshDraft();
 const hasRates=data.rates.some(r=>r.active);
 return heading('NUEVA PROPUESTA','Dale forma a tu cotización.','Selecciona servicios del catálogo. Los precios se conservan en cada cotización.')+
 (!hasRates?'<div class="callout">Primero carga tu catálogo de cuentas y precios. <button class="text-button" data-nav="catalog">Ir al catálogo →</button></div>':'')+
 '<form id="quote-form"><div class="quote-grid"><div class="form-sections"><section class="panel form-panel"><h2><span class="step">01</span> Datos del cliente</h2><div class="fields">'+formField('client_name','Nombre del contacto *','text',true,'maxlength="180" autocomplete="name"')+formField('client_company','Empresa o marca','text',false,'maxlength="180" autocomplete="organization"')+formField('client_email','Correo electrónico','email',false,'maxlength="254" autocomplete="email"')+formField('campaign','Campaña o proyecto','text',false,'maxlength="240"')+'</div></section>'+
 '<section class="panel form-panel"><div class="section-title"><h2><span class="step">02</span> Servicios y cuentas</h2><span class="muted">'+draft.items.length+' / 100</span></div><div class="line-head"><span>Cuenta y servicio</span><span>Cantidad</span><span>Importe</span><span></span></div>'+
 draft.items.map((item,i)=>{const r=data.rates.find(r=>r.id===item.rate_id);return '<div class="quote-line"><select data-line-rate="'+i+'" aria-label="Cuenta y servicio '+(i+1)+'" required>'+rateOptions(item.rate_id)+'</select><input type="number" data-line-qty="'+i+'" aria-label="Cantidad '+(i+1)+'" min="1" max="10000" step="1" value="'+item.quantity+'" required><strong id="line-total-'+i+'">'+(r?money(Number(r.unit_price)*Number(item.quantity)):'—')+'</strong><button type="button" class="remove" data-action="remove-line" data-index="'+i+'" aria-label="Eliminar servicio '+(i+1)+'">×</button></div>';}).join('')+
 '<button type="button" class="text-button add-line" data-action="add-line" '+(!hasRates||draft.items.length>=100?'disabled':'')+'>＋ Agregar otro servicio</button></section>'+
 '<section class="panel form-panel"><h2><span class="step">03</span> Condiciones</h2><div class="fields">'+formField('valid_until','Válida hasta *','date',true)+formField('discount_amount','Descuento fijo (MXN)','number',false,'min="0" step="0.01"')+'<label class="field full">Notas para el cliente<textarea name="notes" maxlength="5000" rows="4" placeholder="Alcance, entregables o condiciones particulares…">'+e(draft.notes)+'</textarea></label></div></section></div>'+
 '<aside class="summary panel"><span class="eyebrow">RESUMEN DE PROPUESTA</span><h2>Todo listo para cotizar.</h2><div id="summary-amounts"></div><div class="tax-note"><strong>No incluye IVA.</strong><span>Todos los importes están expresados en pesos mexicanos.</span></div><p class="summary-copy">'+(isCloud?'El folio único se asigna al guardar. El PDF y Google Sheets se preparan a continuación.':'Se guardará una vista local. El folio definitivo se asignará al conectar Supabase.')+'</p><button class="button primary" type="submit" '+(!hasRates?'disabled':'')+'>Guardar cotización ↗</button></aside></div></form>';
}
function summary(){
 if(tab!=='new'||!draft)return;
 const el=document.querySelector('#summary-amounts');if(!el)return;
 try{const lines=draft.items.filter(x=>x.rate_id).map(x=>({unit_price:data.rates.find(r=>r.id===x.rate_id)?.unit_price,quantity:Number(x.quantity)}));const t=calculateTotals(lines,Number(draft.discount_amount||0));el.innerHTML='<div><span>Subtotal</span><strong>'+money(t.subtotal)+'</strong></div><div><span>Descuento</span><strong>− '+money(t.discount_amount)+'</strong></div><div class="grand-total"><span>Total MXN</span><strong>'+money(t.total)+'</strong></div>';}catch(err){el.innerHTML='<p class="validation">'+e(err.message)+'</p>';}
 draft.items.forEach((x,i)=>{const out=document.querySelector('#line-total-'+i),r=data.rates.find(r=>r.id===x.rate_id);if(out)out.textContent=r?money(Number(r.unit_price)*Number(x.quantity)):'—';});
}
function renderCatalog(){
 const accounts=data.accounts.filter(a=>a.active&&[a.handle,a.display_name,a.category].some(v=>String(v||'').toLowerCase().includes(catalogSearch.toLowerCase())));
 return heading('CATÁLOGO COMERCIAL','Las cuentas. Los servicios. Los precios.','Importa tu base de datos para mantener las tarifas en un solo lugar.')+
 '<section class="panel import-panel"><div><span class="eyebrow">TU BASE DE DATOS</span><h2>Importar cuentas y tarifas</h2><p>Archivo CSV en UTF-8 o catálogo JSON. Actualiza las tarifas por cuenta y servicio sin alterar cotizaciones anteriores.</p><a class="text-button" href="'+base+'templates/catalogo.csv" download>↓ Descargar plantilla</a></div><label class="button primary file-label">Seleccionar catálogo<input id="catalog-file" type="file" accept=".csv,.json,text/csv,application/json"></label></section>'+
 '<section class="panel"><div class="panel-toolbar"><div><h2>Cuentas de Instagram <span class="count">'+accounts.length+'</span></h2><p>'+data.rates.filter(r=>r.active).length+' tarifas disponibles · MXN · No incluye IVA</p></div><label class="search"><span aria-hidden="true">⌕</span><input id="catalog-search" placeholder="Buscar talento o cuenta…" value="'+e(catalogSearch)+'" aria-label="Buscar talento o cuenta"></label></div>'+
 (accounts.length?'<div class="account-grid">'+accounts.map(a=>'<article class="account-card"><div class="account-top"><span class="account-avatar">'+e((a.display_name||a.handle).slice(0,2).toUpperCase())+'</span><div><a href="https://www.instagram.com/'+encodeURIComponent(a.handle)+'/" target="_blank" rel="noopener noreferrer">@'+e(a.handle)+' ↗</a><small>'+e(a.display_name||a.handle)+'</small></div></div><span class="category">'+e(a.category||'Instagram')+' · '+(a.followers==null?'Seguidores no disponibles':Number(a.followers).toLocaleString('es-MX')+' seguidores')+'</span><div class="account-rates">'+data.rates.filter(r=>r.instagram_account_id===a.id&&r.active).map(r=>'<div><span>'+e(r.service)+'</span><strong>'+money(r.unit_price)+'</strong></div>').join('')+'</div></article>').join('')+'</div>':'<div class="empty"><span class="empty-icon">◎</span><h3>Tu catálogo está por llegar</h3><p>Necesitamos tu archivo de cuentas de Instagram y precios para cargar las tarifas reales.</p></div>')+'</section>';
}
function renderSettings(){
 const c=data.company;
 return heading('IDENTIDAD Y CONDICIONES','Una cotización con tu sello.','Configura la marca y las condiciones que aparecerán en las nuevas propuestas.')+
 '<form id="settings-form" class="settings-grid"><section class="panel form-panel"><h2>Datos de EM Agency</h2><div class="fields"><label class="field full">Nombre en el cotizador<input name="name" maxlength="150" required value="'+e(c.name)+'"></label><label class="field">Moneda<input value="Pesos mexicanos · MXN" readonly></label><label class="field">Vigencia inicial (días)<input name="validity_days" type="number" min="1" max="365" required value="'+Number(c.validity_days)+'"></label><label class="field full">Condiciones comerciales<textarea name="terms" rows="6" maxlength="8000">'+e(c.terms||'')+'</textarea><small>La leyenda “No incluye IVA” aparece siempre en el PDF.</small></label></div><button class="button primary" type="submit">Guardar configuración</button></section>'+
 '<section class="panel form-panel"><h2>Logo del documento</h2><div class="logo-preview">'+(c.logo_url?'<img src="'+e(c.logo_url)+'" alt="Logo de EM Agency">':'<span>Agrega tu logo</span>')+'</div><label class="button secondary file-label">Seleccionar logo<input id="logo-file" type="file" accept="image/png,image/jpeg"></label><p class="muted">PNG o JPG, hasta 2 MB. Usaremos el logo original que proporciones.</p><div class="settings-connections"><h3>Conexiones del proyecto</h3><p>GitHub y Supabase <strong>xontiveros-EM</strong></p><p>Google <strong>xontiveros@em.agency.com</strong></p><span class="badge '+(isCloud?'aceptada':'borrador')+'">'+(isCloud?'Supabase conectado':'Conexiones pendientes')+'</span></div></section></form>';
}
async function refresh(){data=await loadData();render();summary();}
function showDetail(id){
 const q=data.quotes.find(q=>q.id===id);
 if(!q){toast('No se encontró esta cotización o no tienes acceso.',true);return;}
 selectedId=id;
 document.querySelector('#quote-dialog')?.remove();
 const dialog=document.createElement('dialog');dialog.id='quote-dialog';dialog.setAttribute('aria-labelledby','detail-title');
 const items=data.items.filter(x=>x.quote_id===id).sort((a,b)=>(a.position||0)-(b.position||0));
 const events=data.events.filter(x=>x.quote_id===id).sort((a,b)=>a.created_at.localeCompare(b.created_at));
 const sync=data.sync.find(s=>s.quote_id===id);
 dialog.innerHTML='<div class="detail-heading"><div><span class="eyebrow">DETALLE DE COTIZACIÓN</span><h2 id="detail-title">'+e(q.folio)+'</h2>'+badge(q)+'</div><button class="remove" data-action="close-detail" aria-label="Cerrar detalle">×</button></div><div class="detail-content"><div class="detail-meta"><div><span>CLIENTE</span><strong>'+e(q.client_name)+'</strong><small>'+e(q.client_company||'')+'</small><small>'+e(q.client_email||'')+'</small></div><div><span>CAMPAÑA</span><strong>'+e(q.campaign||'—')+'</strong><small>Creada el '+dateText(q.created_at)+'</small><small>Válida hasta '+dateText(q.valid_until)+'</small></div></div><div class="table-scroll"><table><thead><tr><th>Cuenta / servicio</th><th>Cant.</th><th class="number">Precio</th><th class="number">Importe</th></tr></thead><tbody>'+items.map(i=>'<tr><td><strong>@'+e(i.instagram_handle)+'</strong><small>'+e(i.service)+'</small></td><td>'+i.quantity+'</td><td class="number">'+money(i.unit_price)+'</td><td class="number">'+money(i.line_total)+'</td></tr>').join('')+'</tbody></table></div><div class="detail-totals"><div>Subtotal <strong>'+money(q.subtotal)+'</strong></div><div>Descuento <strong>− '+money(q.discount_amount)+'</strong></div><div class="total">Total MXN <strong>'+money(q.total)+'</strong></div><small>No incluye IVA.</small></div>'+(q.notes?'<div class="detail-notes"><h3>Notas</h3><p>'+e(q.notes)+'</p></div>':'')+'<div class="detail-actions"><button class="button primary" data-action="pdf" data-id="'+id+'">↓ Descargar PDF</button><button class="button secondary" data-action="sync" data-id="'+id+'" '+(!isCloud?'disabled':'')+'>↻ Sincronizar con Sheets</button><span class="muted">'+(isCloud?syncText(sync?.status):'Google Sheets pendiente de conexión')+'</span></div>'+(sync?.error?'<p class="validation">'+e(sync.error)+'</p>':'')+
 ((transitions[q.status]||[]).length?'<form id="status-form"><h3>Actualizar seguimiento</h3><div class="status-fields"><select name="status" aria-label="Nuevo estado">'+transitions[q.status].map(s=>'<option value="'+s+'">'+labels[s]+'</option>').join('')+'</select><input name="note" placeholder="Nota de seguimiento" maxlength="2000" aria-label="Nota de seguimiento"><button class="button secondary" type="submit">Guardar estado</button></div></form>':'')+'<h3 class="history-title">Historial</h3><ol class="history">'+events.map(ev=>'<li><span class="history-dot"></span><div><strong>'+e(labels[ev.to_status]||ev.to_status)+'</strong><small>'+dateText(ev.created_at)+'</small><p>'+e(ev.note||'')+'</p></div></li>').join('')+'</ol></div>';
 app.append(dialog);dialog.showModal();
 const current=new URL(location.href);current.searchParams.set('quote',id);history.replaceState({},'',current);
}
function closeDetail(){document.querySelector('#quote-dialog')?.close();document.querySelector('#quote-dialog')?.remove();selectedId=null;const current=new URL(location.href);current.searchParams.delete('quote');history.replaceState({},'',current);}
async function syncQuote(id){
 const r=await documents(id,'sync');
 await refresh();showDetail(id);
 if(r.sync_status==='synced')toast('PDF y Google Sheets actualizados.');
 else toast('Cotización guardada. Google Sheets: '+syncText(r.sync_status)+(r.error?' · '+r.error:''),r.sync_status==='error');
}
async function downloadPdf(id){
 const q=data.quotes.find(q=>q.id===id);let blob;
 if(isCloud){const result=await documents(id,'pdf');if(!result.pdf_url)throw Error('El PDF no está disponible.');const res=await fetch(result.pdf_url);if(!res.ok)throw Error('No se pudo descargar el PDF.');blob=await res.blob();}
 else {let logo={};if(q.logo_url&&!q.logo_url.startsWith('data:')){const response=await fetch(q.logo_url);if(!response.ok)throw Error('No se pudo cargar el logo.');logo={logoBytes:new Uint8Array(await response.arrayBuffer()),logoType:'png'};}const bytes=await generateQuotePdf({...logo,quote:q,items:data.items.filter(x=>x.quote_id===id).sort((a,b)=>(a.position||0)-(b.position||0)),company:data.company});blob=new Blob([bytes],{type:'application/pdf'});}
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=q.folio.replace(/[^a-z0-9_-]/gi,'')+'.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);toast('PDF preparado.');
}
app.addEventListener('click',event=>{
 const nav=event.target.closest('[data-nav]');if(nav){tab=nav.dataset.nav;closeDetail();render();summary();return;}
 const b=event.target.closest('[data-action]');if(!b||b.disabled)return;
 const act=b.dataset.action;
 if(act==='open')showDetail(b.dataset.id);
 if(act==='close-detail')closeDetail();
 if(act==='add-line'){if(draft.items.length<100)draft.items.push({rate_id:'',quantity:1});render();summary();}
 if(act==='remove-line'){draft.items.splice(Number(b.dataset.index),1);if(!draft.items.length)draft.items.push({rate_id:'',quantity:1});render();summary();}
 if(act==='logout')action(async()=>{await client.auth.signOut();location.reload();});
 if(act==='pdf')action(()=>downloadPdf(b.dataset.id));
 if(act==='sync')action(()=>syncQuote(b.dataset.id));
});
app.addEventListener('input',event=>{
 const el=event.target;
 if(el.id==='catalog-search'){const pos=el.selectionStart;catalogSearch=el.value;render();const next=document.querySelector('#catalog-search');next.focus();next.setSelectionRange(pos,pos);return;}
 if(el.id==='quote-search'){const pos=el.selectionStart;search=el.value;render();const next=document.querySelector('#quote-search');next.focus();next.setSelectionRange(pos,pos);return;}
 if(el.closest('#quote-form')&&el.name){draft[el.name]=el.value;if(el.name==='discount_amount')summary();}
 if(el.hasAttribute('data-line-qty')){draft.items[Number(el.dataset.lineQty)].quantity=el.value;summary();}
});
app.addEventListener('change',event=>{
 const el=event.target;
 if(el.id==='status-filter'){filter=el.value;render();}
 if(el.hasAttribute('data-line-rate')){draft.items[Number(el.dataset.lineRate)].rate_id=el.value;summary();}
 if(el.id==='catalog-file'&&el.files[0])action(async()=>{const file=el.files[0];if(file.size>5*1024*1024)throw Error('El catálogo debe pesar menos de 5 MB.');const text=await file.text();const catalog=/\.json$/i.test(file.name)?parseCatalogJson(text):parseCatalogCsv(text);await importCatalog(catalog);await refresh();toast(catalog.accounts.length+' cuentas y '+catalog.rates.length+' tarifas importadas.');});
 if(el.id==='logo-file'&&el.files[0])action(async()=>{const logo_url=await uploadLogo(el.files[0]);await saveCompany({logo_url});await refresh();toast('Logo actualizado para las nuevas cotizaciones.');});
});
app.addEventListener('submit',event=>{
 event.preventDefault();
 const form=event.target;
 if(form.id==='quote-form')action(async()=>{const values=Object.fromEntries(new FormData(form));const quote=await createQuote({...values,items:draft.items.map(i=>({rate_id:i.rate_id,quantity:Number(i.quantity)}))},requestId);draft=null;requestId=crypto.randomUUID();tab='quotes';await refresh();showDetail(quote.id);toast(isCloud?'Cotización guardada con folio único.':'Vista local guardada. El folio definitivo está pendiente de conexión.');if(isCloud){try{await syncQuote(quote.id);}catch(err){toast('Cotización guardada; sincronización pendiente: '+err.message,true);}}});
 if(form.id==='settings-form')action(async()=>{const v=Object.fromEntries(new FormData(form));await saveCompany({...v,validity_days:Number(v.validity_days)});await refresh();toast('Configuración guardada.');});
 if(form.id==='status-form')action(async()=>{const v=Object.fromEntries(new FormData(form)),id=selectedId;await changeStatus(id,v.status,v.note);await refresh();showDetail(id);toast('Estado actualizado.');if(isCloud){try{await syncQuote(id);}catch(err){toast('Estado guardado; sincronización pendiente: '+err.message,true);}}});
 if(form.id==='login-form')action(async()=>{const v=Object.fromEntries(new FormData(form));const {error}=await client.auth.signInWithPassword({email:v.email,password:v.password});if(error)throw Error('No se pudo iniciar sesión. Revisa el correo y la contraseña de tu cuenta de EM Agency.');await start();});
});
async function start(){
 if(configError){render();return;}
 if(client){const {data:auth,error}=await client.auth.getSession();if(error)throw error;if(!auth.session){app.innerHTML='<div class="login"><div class="login-logo"><img src="'+brandLogo+'" alt="EM Agency"></div><span class="eyebrow">EM AGENCY</span><h1>Tu espacio de cotizaciones.</h1><p>Ingresa con la cuenta autorizada de tu equipo.</p><form id="login-form"><label class="field">Correo<input name="email" type="email" autocomplete="username" required></label><label class="field">Contraseña<input name="password" type="password" autocomplete="current-password" required></label><button type="submit" class="button primary">Ingresar →</button></form><small>Acceso exclusivo para el equipo de EM Agency.</small></div>';return;}}
 await refresh();const id=new URL(location.href).searchParams.get('quote');if(id)showDetail(id);
}
start().catch(error=>{app.innerHTML='<div class="login"><h1>No se pudo abrir el cotizador</h1><p>'+e(error.message)+'</p><button class="button secondary" onclick="location.reload()">Reintentar</button></div>';});


