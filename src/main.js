import './style.css';
import {money,calculateTotals,parseCatalogCsv,parseCatalogJson,escapeHtml as e,effectiveStatus} from './domain.js';
import {client,isCloud,configError,loadData,importCatalog,saveCompany,uploadLogo,createQuote,changeStatus,documents,transitions,deleteQuote,convertQuoteToOc,saveMyProfile,saveNumbering} from './repository.js';
import {generateQuotePdf} from './pdf.js';
const app=document.querySelector('#app');
const base=import.meta.env.BASE_URL||'/';
const brandLogo=base+'brand/em-agency.png';
const labels={borrador:'Borrador',enviada:'Enviada',aceptada:'Aceptada',rechazada:'Rechazada',cancelada:'Cancelada',vencida:'Vencida',muestra:'Muestra',eliminada:'Eliminada'};
let data=null,tab='quotes',search='',filter='all',kindFilter='real',catalogSearch='',selectedId=null,busy=false,draft=null;
let requestId=crypto.randomUUID(),toastTimer;
const dateText=v=>v?new Intl.DateTimeFormat('es-MX',{day:'numeric',month:'short',year:'numeric',timeZone:'America/Mexico_City'}).format(new Date(v.length===10?v+'T12:00:00-06:00':v)):'—';
const quoteTitle=q=>q.is_sample?'Muestra sin folio':(q.folio||'Pendiente de folio');
const realQuote=q=>!q.is_sample&&!q.deleted_at;
const sellerProfile=()=>({full_name:data?.profile?.full_name||'',email:data?.profile?.email||data?.user?.email||''});
const badge=q=>'<span class="badge '+effectiveStatus(q)+'">'+e(labels[effectiveStatus(q)]||q.status)+'</span>';
const syncText=s=>({synced:'Sincronizada',error:'Requiere reintento',processing:'Sincronizando',pending:'Pendiente'}[s]||'Pendiente');
function toast(message,error=false){
 const dialog=document.querySelector('#quote-dialog[open]');
 if(dialog){
  let box=dialog.querySelector('#detail-message');
  if(!box){box=document.createElement('div');box.id='detail-message';dialog.querySelector('.detail-content').prepend(box);}
  box.textContent=message;box.className='detail-message'+(error?' error':'');box.setAttribute('role',error?'alert':'status');box.hidden=false;return;
 }
 const t=document.querySelector('#toast');if(!t)return;clearTimeout(toastTimer);t.textContent=message;t.className='visible'+(error?' error':'');toastTimer=setTimeout(()=>{t.className='';},10000);
}
async function action(fn){
 if(busy)return;busy=true;app.inert=true;const activeDialog=document.querySelector('#quote-dialog[open]');if(activeDialog)activeDialog.inert=true;app.setAttribute('aria-busy','true');document.body.classList.add('working');
 try{await fn();}catch(error){toast(error.message||'No se pudo completar la operación.',true);}
 finally{busy=false;app.inert=false;const activeDialog=document.querySelector('#quote-dialog[open]');if(activeDialog)activeDialog.inert=false;app.removeAttribute('aria-busy');document.body.classList.remove('working');}
}
function deadline(){const d=new Date();d.setUTCDate(d.getUTCDate()+Number(data?.company.validity_days||15));return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Mexico_City',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);}
function freshDraft(){return {is_sample:!isCloud,seller_whatsapp:'',client_name:'',client_email:'',client_company:'',campaign:'',valid_until:deadline(),discount_amount:'0',notes:'',items:[{rate_id:'',quantity:1}]};}
function shell(body){
 const name=data?.company?.name||'Cotizador EM Agency';
 return '<div class="layout"><aside class="sidebar"><a class="brand" href="'+base+'" aria-label="Inicio EM Agency"><span class="brand-logo-wrap"><img src="'+brandLogo+'" alt="EM Agency" class="brand-logo"></span></a><div class="nav-label">ESPACIO DE TRABAJO</div><nav aria-label="Principal">'+[['quotes','▤','Cotizaciones'],['new','＋','Nueva cotización'],['catalog','◎','Catálogo de Instagram'],['settings','⚙','Configuración']].map(([id,icon,text])=>'<button class="nav-item '+(tab===id?'active':'')+'" data-nav="'+id+'"><span aria-hidden="true">'+icon+'</span>'+text+'</button>').join('')+'</nav><div class="sidebar-bottom"><span class="connection-dot"></span><div>'+ (isCloud?'Espacio conectado':'Vista local')+'<small>'+ (isCloud?'EM Agency':'Pendiente de conectar')+'</small></div></div></aside><div class="workspace"><header class="topbar"><span>'+e(name)+'</span><div><span class="currency-label">MXN · No incluye IVA</span>'+(isCloud?'<button class="text-button" data-action="logout">Cerrar sesión</button>':'<span class="avatar" aria-label="EM Agency">EM</span>')+'</div></header>'+(!isCloud?'<div class="local-notice"><span>◌</span><div><strong>Vista local de preparación</strong><span>En este navegador solo se guardan muestras sin folio oficial. Las cotizaciones reales, órdenes de compra y Google Sheets requieren Supabase.</span></div></div>':'')+'<main>'+body+'</main><footer>EM AGENCY <span>·</span> Cotizaciones en pesos mexicanos <span>·</span> No incluye IVA</footer></div></div>';
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
 const real=data.quotes.filter(realQuote),pending=real.filter(q=>['borrador','enviada'].includes(effectiveStatus(q))),accepted=real.filter(q=>q.status==='aceptada');
 const visible=data.quotes.filter(q=>kindFilter==='deleted'?Boolean(q.deleted_at):!q.deleted_at&&(kindFilter==='sample'?q.is_sample:!q.is_sample));
 const all=visible.filter(q=>(filter==='all'||effectiveStatus(q)===filter)&&[q.folio,q.oc_folio,q.client_name,q.client_company,q.campaign,q.seller_name].some(v=>String(v||'').toLowerCase().includes(search.toLowerCase())));
 const total=accepted.reduce((sum,q)=>sum+Number(q.total),0);
 return heading('GESTIÓN COMERCIAL','Cada propuesta, bajo control.','Cotizaciones, muestras y órdenes de compra vinculadas.','<button class="button primary" data-nav="new">＋ Nueva cotización</button>')+
 '<div class="metrics"><div><span>Cotizaciones reales</span><strong>'+real.length+'</strong><small>Las muestras y eliminadas se excluyen</small></div><div><span>En seguimiento</span><strong>'+pending.length+'</strong><small>Borradores y propuestas enviadas</small></div><div><span>Importe aceptado</span><strong>'+money(total)+'</strong><small>MXN · No incluye IVA</small></div></div>'+
 '<section class="panel"><div class="panel-toolbar"><div><h2>Tus cotizaciones <span class="count">'+visible.length+'</span></h2><p>Historial, documentos y próximos pasos.</p></div><div class="tools"><label class="search"><span aria-hidden="true">⌕</span><input id="quote-search" placeholder="Buscar cliente, cotización u OC…" value="'+e(search)+'" aria-label="Buscar cotizaciones"></label><select id="kind-filter" aria-label="Tipo de cotización">'+[['real','Reales'],['sample','Muestras'],['deleted','Eliminadas']].map(([id,label])=>'<option value="'+id+'" '+(kindFilter===id?'selected':'')+'>'+label+'</option>').join('')+'</select><select id="status-filter" aria-label="Filtrar por estado"><option value="all">Todos los estados</option>'+Object.entries(labels).filter(([id])=>!['muestra','eliminada'].includes(id)).map(([id,l])=>'<option '+(filter===id?'selected':'')+' value="'+id+'">'+l+'</option>').join('')+'</select></div></div>'+
 (all.length?'<div class="table-scroll"><table><thead><tr><th>Cotización / OC</th><th>Cliente</th><th>Estado</th><th>Vigencia</th><th class="number">Total MXN</th><th></th></tr></thead><tbody>'+all.map(q=>'<tr><td><strong>'+e(quoteTitle(q))+'</strong>'+(q.oc_folio?'<small class="oc-reference">'+e(q.oc_folio)+'</small>':'')+'<small>'+e(q.campaign||'Sin nombre de campaña')+'</small></td><td>'+e(q.client_name)+'<small>'+e(q.client_company||'')+'</small></td><td>'+badge(q)+'</td><td>'+dateText(q.valid_until)+'</td><td class="number">'+money(q.total)+'</td><td><button class="text-button" data-action="open" data-id="'+q.id+'">Ver cotización ↗</button></td></tr>').join('')+'</tbody></table></div>':
 '<div class="empty"><span class="empty-icon">↗</span><h3>'+(visible.length?'No hay coincidencias':kindFilter==='sample'?'Guarda ejemplos sin consumir folios':kindFilter==='deleted'?'No hay cotizaciones eliminadas':'Tu próxima propuesta comienza aquí')+'</h3><p>'+(visible.length?'Prueba con otro cliente, número o estado.':kindFilter==='sample'?'Las muestras se identifican en pantalla y PDF; puedes reutilizarlas para preparar una cotización real.':kindFilter==='deleted'?'Las cotizaciones eliminadas conservan su historial y sus números reservados.':'Carga tu catálogo y convierte tus servicios en una cotización con seguimiento.')+'</p>'+(kindFilter!=='deleted'?'<button class="button secondary" data-nav="'+(data.rates.length?'new':'catalog')+'">'+(data.rates.length?'Preparar cotización':'Preparar catálogo')+' →</button>':'')+'</div>')+'</section>'+
 '<div class="note-row"><span>01 / Catálogo</span><span>02 / Cotización</span><span>03 / PDF y orden de compra</span><span>04 / Google Sheets</span></div>';
}
function rateOptions(id){return '<option value="">Selecciona cuenta y servicio</option>'+data.rates.filter(r=>r.active&&data.accounts.some(a=>a.id===r.instagram_account_id&&a.active)).map(r=>{const a=data.accounts.find(a=>a.id===r.instagram_account_id);return '<option value="'+r.id+'" '+(r.id===id?'selected':'')+'>@'+e(a.handle)+' · '+e(r.service)+' · '+money(r.unit_price)+'</option>';}).join('');}
function formField(name,label,type='text',required=false,extra=''){return '<label class="field">'+label+'<input name="'+name+'" type="'+type+'" value="'+e(draft[name]||'')+'" '+(required?'required':'')+' '+extra+'></label>';}
function renderNew(){
 if(!draft)draft=freshDraft();
 const hasRates=data.rates.some(r=>r.active&&data.accounts.some(a=>a.id===r.instagram_account_id&&a.active)),profile=sellerProfile();
 const numberingReady=Boolean(data.numbering?.quote_configured),canSave=hasRates&&Boolean(profile.full_name)&&Boolean(profile.email)&&(draft.is_sample||isCloud&&numberingReady);
 return heading('NUEVA PROPUESTA','Dale forma a tu cotización.','Los servicios se toman del catálogo vigente y quedan guardados en cada propuesta.')+
 (!hasRates?'<div class="callout">Primero carga tu catálogo de cuentas y precios. <button class="text-button" data-nav="catalog">Ir al catálogo →</button></div>':'')+
 (data.upgradeRequired?'<div class="callout">Falta aplicar la actualización de Supabase para guardar estas funciones.</div>':'')+
 (!profile.full_name?'<div class="callout">Completa tu nombre una sola vez en tu perfil; el vendedor se tomará automáticamente. <button class="text-button" data-nav="settings">Completar perfil →</button></div>':'')+
 (!draft.is_sample&&!numberingReady?'<div class="callout">Confirma el prefijo y el último número de cotización de la agencia antes de emitir una real. <button class="text-button" data-nav="settings">Configurar numeración →</button></div>':'')+
 '<form id="quote-form"><div class="quote-grid"><div class="form-sections"><section class="panel form-panel"><h2>Tipo de cotización</h2><fieldset class="quote-type"><legend class="sr-only">Elige real o muestra</legend><label><input type="radio" name="quote_kind" value="real" '+(!draft.is_sample?'checked':'')+' '+(!isCloud?'disabled':'')+'><strong>Real</strong><small>Usa el consecutivo de la agencia y permite convertir a OC.</small></label><label><input type="radio" name="quote_kind" value="sample" '+(draft.is_sample?'checked':'')+'><strong>Muestra</strong><small>Sin número oficial, sin OC y fuera de Google Sheets comercial.</small></label></fieldset><button class="text-button" type="button" data-action="example" '+(!hasRates?'disabled':'')+'>Cargar ejemplo de muestra con tarifas del catálogo</button></section>'+
 '<section class="panel form-panel"><h2><span class="step">01</span> Datos del cliente</h2><div class="fields">'+formField('client_name','Nombre del contacto *','text',true,'maxlength="180" autocomplete="name"')+formField('client_company','Empresa o marca','text',false,'maxlength="180" autocomplete="organization"')+formField('client_email','Correo electrónico','email',false,'maxlength="254" autocomplete="email"')+formField('campaign','Campaña o proyecto','text',false,'maxlength="240"')+'</div></section>'+
 '<section class="panel form-panel"><h2>Vendedor de esta cotización</h2><div class="fields"><label class="field">Nombre automático<input value="'+e(profile.full_name)+'" readonly placeholder="Completa tu perfil"></label><label class="field">Correo de tu cuenta<input type="email" value="'+e(profile.email)+'" readonly></label>'+formField('seller_whatsapp','WhatsApp del vendedor','tel',false,'maxlength="40" autocomplete="tel" placeholder="+52 …"')+'</div><p class="muted">Nombre y correo se guardan con la cotización. Captura manualmente el WhatsApp que verá el cliente.</p></section>'+
 '<section class="panel form-panel"><div class="section-title"><h2><span class="step">02</span> Servicios y cuentas</h2><span class="muted">'+draft.items.length+' / 100</span></div><div class="line-head"><span>Cuenta y servicio</span><span>Cantidad</span><span>Importe</span><span></span></div>'+
 draft.items.map((item,i)=>{const r=data.rates.find(r=>r.id===item.rate_id);return '<div class="quote-line"><select data-line-rate="'+i+'" aria-label="Cuenta y servicio '+(i+1)+'" required>'+rateOptions(item.rate_id)+'</select><input type="number" data-line-qty="'+i+'" aria-label="Cantidad '+(i+1)+'" min="1" max="10000" step="1" value="'+e(item.quantity)+'" required><strong id="line-total-'+i+'">'+(r?money(Number(r.unit_price)*Number(item.quantity)):'—')+'</strong><button type="button" class="remove" data-action="remove-line" data-index="'+i+'" aria-label="Eliminar servicio '+(i+1)+'">×</button></div>';}).join('')+
 '<button type="button" class="text-button add-line" data-action="add-line" '+(!hasRates||draft.items.length>=100?'disabled':'')+'>＋ Agregar otro servicio</button></section>'+
 '<section class="panel form-panel"><h2><span class="step">03</span> Condiciones</h2><div class="fields">'+formField('valid_until','Válida hasta *','date',true)+formField('discount_amount','Descuento fijo (MXN)','number',false,'min="0" step="0.01"')+'<label class="field full">Notas para el cliente<textarea name="notes" maxlength="5000" rows="4" placeholder="Alcance, entregables o condiciones particulares…">'+e(draft.notes)+'</textarea></label></div></section></div>'+
 '<aside class="summary panel"><span class="eyebrow">'+(draft.is_sample?'COTIZACIÓN DE MUESTRA':'RESUMEN DE PROPUESTA')+'</span><h2>'+(draft.is_sample?'Un ejemplo sin folio.':'Todo listo para cotizar.')+'</h2><div id="summary-amounts"></div><div class="tax-note"><strong>No incluye IVA.</strong><span>Todos los importes están expresados en pesos mexicanos.</span></div><p class="summary-copy">'+(draft.is_sample?'Esta muestra no consume números de cotización ni de orden de compra. El PDF llevará una marca de muestra.':'El número de cotización se asigna al guardar. La orden de compra se asigna después de la aceptación, al convertirla.')+'</p><button class="button primary" type="submit" '+(!canSave||data.upgradeRequired?'disabled':'')+'>Guardar '+(draft.is_sample?'muestra':'cotización')+' ↗</button></aside></div></form>';
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
 const c=data.company,p=sellerProfile(),n=data.numbering||{};
 return heading('IDENTIDAD Y CONDICIONES','Una cotización con tu sello.','Configura tu perfil, la numeración de la agencia y las condiciones de las nuevas propuestas.')+
 '<div class="settings-grid settings-profile"><form id="profile-form" class="panel form-panel"><h2>Mi perfil de vendedor</h2><div class="fields"><label class="field full">Nombre completo<input name="full_name" maxlength="180" value="'+e(p.full_name)+'" required autocomplete="name"></label><label class="field full">Correo de la cuenta<input type="email" value="'+e(p.email)+'" readonly></label></div><p class="muted">Se tomará automáticamente en tus nuevas cotizaciones. Los documentos anteriores conservan los datos originales.</p><button class="button primary" type="submit">Guardar mi nombre</button></form>'+
 '<form id="numbering-form" class="panel form-panel"><h2>Numeración de la agencia</h2><p class="muted">Captura el último número utilizado, no el siguiente. Los prefijos conservan espacios y guiones. Los números ya asignados no se reutilizan.</p><div class="fields"><label class="field full">Prefijo exacto de cotización<input name="quote_prefix" maxlength="30" value="'+e(n.quote_prefix||'')+'" required placeholder="Prefijo utilizado por la agencia"></label><label class="field">Última cotización utilizada<input name="quote_last_number" type="number" step="1" min="0" value="'+(n.quote_configured?Number(n.quote_last_number):'')+'" required placeholder="0 si es una serie nueva"></label><label class="field">Dígitos mínimos<input name="quote_padding" type="number" step="1" min="0" max="10" value="'+Number(n.quote_padding||0)+'" required><small>0 = sin ceros iniciales</small></label><label class="field full">Prefijo exacto de orden de compra<input name="oc_prefix" maxlength="30" value="'+e(n.oc_prefix??'OC ')+'" required></label><label class="field">Última OC utilizada<input name="oc_last_number" type="number" step="1" min="0" value="'+Number(n.oc_last_number??2710)+'" required></label><label class="field">Dígitos mínimos de OC<input name="oc_padding" type="number" step="1" min="0" max="10" value="'+Number(n.oc_padding||0)+'" required></label></div><label class="confirm-numbering"><input name="confirm_numbering" type="checkbox" required> Confirmo que estos son los últimos números utilizados por la agencia.</label><p class="muted">'+(n.quote_configured&&n.oc_configured?'Numeración confirmada.':'Pendiente de confirmar. La última OC informada fue OC 2710.')+'</p><button class="button primary" type="submit" '+(!isCloud||data.upgradeRequired?'disabled':'')+'>Confirmar numeración</button></form></div>'+
 '<form id="settings-form" class="settings-grid"><section class="panel form-panel"><h2>Datos de EM Agency</h2><div class="fields"><label class="field full">Nombre en el cotizador<input name="name" maxlength="150" required value="'+e(c.name)+'"></label><label class="field">Moneda<input value="Pesos mexicanos · MXN" readonly></label><label class="field">Vigencia inicial (días)<input name="validity_days" type="number" min="1" max="365" required value="'+Number(c.validity_days)+'"></label><label class="field full">Condiciones comerciales<textarea name="terms" rows="6" maxlength="8000">'+e(c.terms||'')+'</textarea><small>La leyenda “No incluye IVA” aparece siempre en el PDF.</small></label></div><button class="button primary" type="submit">Guardar configuración</button></section>'+
 '<section class="panel form-panel"><h2>Logo del documento</h2><div class="logo-preview">'+(c.logo_url?'<img src="'+e(c.logo_url)+'" alt="Logo de EM Agency">':'<span>Agrega tu logo</span>')+'</div><label class="button secondary file-label">Seleccionar logo<input id="logo-file" type="file" accept="image/png,image/jpeg"></label><p class="muted">PNG o JPG, hasta 2 MB. El logo aparecerá también como marca de agua.</p><div class="settings-connections"><h3>Conexiones del proyecto</h3><p>GitHub y Supabase <strong>xontiveros-EM</strong></p><p>Google <strong>xontiveros@em.agency.com</strong></p><span class="badge '+(isCloud?'aceptada':'borrador')+'">'+(isCloud?'Supabase conectado':'Conexión pendiente')+'</span><p>Google Sheets se confirma al sincronizar una cotización real.</p><a class="text-button" href="https://docs.google.com/spreadsheets/d/1xHk3d5HBF458_2jKFSj7rhIvRN9VNto40vJ6tgx6ipI/edit" target="_blank" rel="noopener noreferrer">Abrir hoja de cotizaciones ↗</a></div></section></form>';
}
async function refresh(){data=await loadData();render();summary();}
function showDetail(id){
 const q=data.quotes.find(q=>q.id===id);
 if(!q){toast('No se encontró esta cotización o no tienes acceso.',true);return;}
 selectedId=id;document.querySelector('#quote-dialog')?.remove();
 const dialog=document.createElement('dialog');dialog.id='quote-dialog';dialog.setAttribute('aria-labelledby','detail-title');
 const items=data.items.filter(x=>x.quote_id===id).sort((a,b)=>(a.position||0)-(b.position||0)),events=data.events.filter(x=>x.quote_id===id).sort((a,b)=>a.created_at.localeCompare(b.created_at)),sync=data.sync.find(s=>s.quote_id===id);
 const active=!q.deleted_at,canConvert=realQuote(q)&&q.status==='aceptada'&&!q.oc_folio;
 dialog.innerHTML='<div class="detail-heading"><div><span class="eyebrow">'+(q.is_sample?'COTIZACIÓN DE MUESTRA':'DETALLE DE COTIZACIÓN')+'</span><h2 id="detail-title">'+e(quoteTitle(q))+'</h2>'+badge(q)+(q.oc_folio?'<p class="oc-reference">Orden de compra: <strong>'+e(q.oc_folio)+'</strong></p>':'')+'</div><button class="remove" data-action="close-detail" aria-label="Cerrar detalle">×</button></div><div class="detail-content"><div id="detail-message" class="detail-message" role="status" hidden></div>'+
 (q.is_sample?'<div class="callout">Ejemplo sin número oficial. No consume consecutivos ni se sincroniza con la hoja comercial.</div>':'')+(q.deleted_at?'<div class="callout">Eliminada el '+dateText(q.deleted_at)+'. Su número permanece reservado y se conserva el historial.</div>':'')+
 '<div class="detail-meta"><div><span>CLIENTE</span><strong>'+e(q.client_name)+'</strong><small>'+e(q.client_company||'')+'</small><small>'+e(q.client_email||'')+'</small></div><div><span>CAMPAÑA</span><strong>'+e(q.campaign||'—')+'</strong><small>Creada el '+dateText(q.created_at)+'</small><small>Válida hasta '+dateText(q.valid_until)+'</small>'+(q.oc_created_at?'<small>OC generada el '+dateText(q.oc_created_at)+'</small>':'')+'</div><div><span>VENDEDOR</span><strong>'+e(q.seller_name||'Sin dato histórico')+'</strong><small>'+e(q.seller_email||'')+'</small><small>'+e(q.seller_whatsapp?'WhatsApp: '+q.seller_whatsapp:'WhatsApp no capturado')+'</small></div></div>'+
 '<div class="table-scroll"><table><thead><tr><th>Cuenta / servicio</th><th>Cant.</th><th class="number">Precio</th><th class="number">Importe</th></tr></thead><tbody>'+items.map(i=>'<tr><td><strong>@'+e(i.instagram_handle)+'</strong><small>'+e(i.service)+'</small></td><td>'+i.quantity+'</td><td class="number">'+money(i.unit_price)+'</td><td class="number">'+money(i.line_total)+'</td></tr>').join('')+'</tbody></table></div><div class="detail-totals"><div>Subtotal <strong>'+money(q.subtotal)+'</strong></div><div>Descuento <strong>− '+money(q.discount_amount)+'</strong></div><div class="total">Total MXN <strong>'+money(q.total)+'</strong></div><small>No incluye IVA.</small></div>'+
 (q.notes?'<div class="detail-notes"><h3>Notas</h3><p>'+e(q.notes)+'</p></div>':'')+
 '<div class="detail-actions">'+(active?'<button class="button primary" data-action="pdf" data-id="'+id+'">↓ Descargar PDF</button><button class="button secondary" data-action="reuse" data-id="'+id+'">Usar como base</button>':'')+(!q.is_sample?'<button class="button secondary" data-action="sync" data-id="'+id+'" '+(!isCloud?'disabled':'')+'>↻ Sincronizar con Sheets</button><span class="muted">'+(isCloud?syncText(sync?.status):'Google Sheets pendiente de conexión')+'</span>':'')+'</div>'+
 (canConvert?'<div class="conversion-box"><h3>Convertir en orden de compra</h3><p>La cotización conserva su número y queda vinculada con una OC de la agencia.</p>'+(!data.numbering?.oc_configured?'<p class="validation">Primero confirma el último número de OC en Configuración.</p><button class="text-button" data-nav="settings">Configurar numeración →</button>':'<button class="button secondary" data-action="convert-oc" data-id="'+id+'">Convertir en orden de compra</button>')+'</div>':'')+
 (sync?.error&&!q.is_sample?'<p class="validation" role="alert">'+e(sync.error)+'</p>':'')+
 (realQuote(q)&&(transitions[q.status]||[]).length?'<form id="status-form"><h3>Actualizar seguimiento</h3><div class="status-fields"><select name="status" aria-label="Nuevo estado">'+transitions[q.status].map(s=>'<option value="'+s+'">'+labels[s]+'</option>').join('')+'</select><input name="note" placeholder="Nota de seguimiento" maxlength="2000" aria-label="Nota de seguimiento"><button class="button secondary" type="submit">Guardar estado</button></div></form>':'')+
 '<h3 class="history-title">Historial</h3><ol class="history">'+events.map(ev=>'<li><span class="history-dot"></span><div><strong>'+e(labels[ev.to_status]||ev.to_status)+'</strong><small>'+dateText(ev.created_at)+'</small><p>'+e(ev.note||'')+'</p></div></li>').join('')+'</ol>'+
 (active&&!q.oc_folio?'<div class="delete-section"><button class="text-button danger" data-action="delete-quote" data-id="'+id+'">Eliminar '+(q.is_sample?'muestra':'cotización')+'</button><p>Se retira del listado activo y conserva su historial.'+(!q.is_sample?' El número asignado no se reutiliza.':'')+'</p></div>':'')+'</div>';
 app.append(dialog);dialog.addEventListener('cancel',event=>{event.preventDefault();if(!busy)closeDetail();});dialog.showModal();dialog.inert=busy;
 const current=new URL(location.href);current.searchParams.set('quote',id);history.replaceState({},'',current);
}
function closeDetail(){document.querySelector('#quote-dialog')?.close();document.querySelector('#quote-dialog')?.remove();selectedId=null;const current=new URL(location.href);current.searchParams.delete('quote');history.replaceState({},'',current);}
async function tryAutoSync(q){
 if(!isCloud||q.is_sample)return {message:q.is_sample?(q.deleted_at?'Muestra retirada del listado activo.':'Muestra guardada sin consumir folios.'):'Guardado en vista local.',error:false};
 try{const r=await documents(q.id,'sync');if(r.sync_status==='synced')return {message:'Cotización y Google Sheets actualizados.',error:false};return {message:'El cambio quedó guardado. Google Sheets pendiente: '+(r.error||syncText(r.sync_status)),error:true};}
 catch(error){return {message:'El cambio quedó guardado. Google Sheets pendiente: '+error.message,error:true};}
}
async function syncQuote(id){
 const q=data.quotes.find(q=>q.id===id);if(!q||q.is_sample)throw Error('Las muestras no se envían a Google Sheets comercial.');
 const notice=await tryAutoSync(q);await refresh();showDetail(id);toast(notice.message,notice.error);
}
async function browserPdf(q){
 const input={quote:q,items:data.items.filter(x=>x.quote_id===q.id).sort((a,b)=>(a.position||0)-(b.position||0)),company:data.company};
 const logo=q.logo_url||'';
 if(logo&&!logo.startsWith('data:')&&!logo.endsWith('/brand/em-agency.png')){
  const response=await fetch(logo,{credentials:'omit'});if(!response.ok)throw Error('No se pudo cargar el logo guardado en la cotización.');
  const mime=response.headers.get('content-type')||'';
  if(!/image\/(png|jpeg)/i.test(mime))throw Error('El logo guardado debe ser PNG o JPG.');
  input.logoBytes=new Uint8Array(await response.arrayBuffer());input.logoType=/png/i.test(mime)?'png':'jpeg';
 }
 const bytes=await generateQuotePdf(input);return new Blob([bytes],{type:'application/pdf'});
}
async function downloadPdf(id){
 const q=data.quotes.find(q=>q.id===id);if(!q||q.deleted_at)throw Error('Esta cotización fue eliminada o no está disponible.');
 let blob,serverError,serverWarning;
 if(isCloud){
  try{
   const result=await documents(id,'pdf');serverWarning=result.error;if(!result.pdf_url)throw Error('El servidor no devolvió el PDF.');
   const response=await fetch(result.pdf_url,{credentials:'omit'});if(!response.ok)throw Error('No se pudo descargar el PDF del servidor.');
   const bytes=new Uint8Array(await response.arrayBuffer());
   if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('El servidor no devolvió un archivo PDF válido.');
   blob=new Blob([bytes],{type:'application/pdf'});
  }catch(error){serverError=error.message;blob=await browserPdf(q);}
 }else blob=await browserPdf(q);
 const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=(q.is_sample?'Cotizacion-de-muestra':quoteTitle(q)).replace(/[^a-z0-9_-]/gi,'-')+'.pdf';link.hidden=true;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
 toast(serverError?'PDF descargado desde este navegador. La copia en el servidor y la sincronización siguen pendientes: '+serverError:(serverWarning?'PDF descargado. Google Sheets pendiente: '+serverWarning:'PDF descargado correctamente.'),Boolean(serverError||serverWarning));
}
function reuseQuote(id){
 const q=data.quotes.find(x=>x.id===id);if(!q||q.deleted_at)throw Error('Esta cotización no está disponible para reutilizar.');
 const activeRate=id=>data.rates.some(r=>r.id===id&&r.active&&data.accounts.some(a=>a.id===r.instagram_account_id&&a.active));
 const lines=data.items.filter(x=>x.quote_id===id).sort((a,b)=>(a.position||0)-(b.position||0)).map(i=>({rate_id:activeRate(i.rate_id)?i.rate_id:'',quantity:i.quantity}));
 draft={...freshDraft(),is_sample:true,client_name:q.client_name,client_email:q.client_email||'',client_company:q.client_company||'',campaign:q.campaign||'',notes:q.notes||'',discount_amount:String(q.discount_amount||0),items:lines.length?lines:[{rate_id:'',quantity:1}]};
 requestId=crypto.randomUUID();tab='new';closeDetail();render();summary();toast('Nueva propuesta preparada como muestra. Revisa las tarifas actuales y elige Real si deseas emitirla.');
}
function loadExample(){
 const rates=data.rates.filter(r=>r.active&&data.accounts.some(a=>a.id===r.instagram_account_id&&a.active)).slice(0,2);
 if(!rates.length)throw Error('Primero carga un catálogo para utilizar sus precios reales.');
 draft={...freshDraft(),is_sample:true,client_name:'Cliente de ejemplo',client_company:'Marca de ejemplo',campaign:'Campaña de muestra',notes:'COTIZACIÓN DE MUESTRA. Cliente y campaña ficticios para revisar el formato.',items:rates.map(r=>({rate_id:r.id,quantity:1}))};
 requestId=crypto.randomUUID();render();summary();toast('Ejemplo listo con las tarifas vigentes del catálogo. Guárdalo como muestra.');
}
async function convertOc(id){
 const q=data.quotes.find(x=>x.id===id);if(!q||!realQuote(q)||q.status!=='aceptada')throw Error('Solo una cotización real aceptada puede convertirse en orden de compra.');
 const n=data.numbering;if(!n?.oc_configured)throw Error('Confirma la numeración de OC en Configuración.');
 const next=String(Number(n.oc_last_number)+1).padStart(Number(n.oc_padding||0),'0'),suggested=n.oc_prefix+next;
 if(!window.confirm('¿Convertir '+quoteTitle(q)+' en orden de compra? El siguiente número disponible es '+suggested+'. Si otra persona convierte una cotización antes, se asignará el siguiente disponible.'))return;
 const result=await convertQuoteToOc(id),notice=await tryAutoSync({...q,...result});await refresh();showDetail(id);toast('Orden de compra vinculada. '+notice.message,notice.error);
}
async function removeQuote(id){
 const q=data.quotes.find(x=>x.id===id);if(!q||q.deleted_at)return;if(q.oc_folio)throw Error('Esta cotización ya tiene una orden de compra vinculada y debe conservarse.');
 if(!window.confirm('¿Eliminar '+quoteTitle(q)+'? Se retirará del listado activo y conservará el historial.'+(q.is_sample?'':' Su número permanecerá reservado y no se reutilizará.')))return;
 await deleteQuote(id);const notice=await tryAutoSync({...q,deleted_at:new Date().toISOString()});kindFilter='deleted';filter='all';await refresh();showDetail(id);toast('Cotización eliminada. '+notice.message,notice.error);
}
app.addEventListener('click',event=>{
 if(busy)return;
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
 if(act==='reuse')action(()=>reuseQuote(b.dataset.id));
 if(act==='example')action(()=>loadExample());
 if(act==='convert-oc')action(()=>convertOc(b.dataset.id));
 if(act==='delete-quote')action(()=>removeQuote(b.dataset.id));
});
app.addEventListener('input',event=>{
 const el=event.target;
 if(el.id==='catalog-search'){const pos=el.selectionStart;catalogSearch=el.value;render();const next=document.querySelector('#catalog-search');next.focus();next.setSelectionRange(pos,pos);return;}
 if(el.id==='quote-search'){const pos=el.selectionStart;search=el.value;render();const next=document.querySelector('#quote-search');next.focus();next.setSelectionRange(pos,pos);return;}
 if(el.closest('#quote-form')&&el.name&&el.name!=='quote_kind'){draft[el.name]=el.value;if(el.name==='discount_amount')summary();}
 if(el.hasAttribute('data-line-qty')){draft.items[Number(el.dataset.lineQty)].quantity=el.value;summary();}
});
app.addEventListener('change',event=>{
 const el=event.target;
 if(el.id==='status-filter'){filter=el.value;render();}
 if(el.id==='kind-filter'){kindFilter=el.value;filter='all';render();}
 if(el.name==='quote_kind'){draft.is_sample=el.value==='sample';render();summary();}
 if(el.hasAttribute('data-line-rate')){draft.items[Number(el.dataset.lineRate)].rate_id=el.value;summary();}
 if(el.id==='catalog-file'&&el.files[0])action(async()=>{const file=el.files[0];if(file.size>5*1024*1024)throw Error('El catálogo debe pesar menos de 5 MB.');const text=await file.text();const catalog=/\.json$/i.test(file.name)?parseCatalogJson(text):parseCatalogCsv(text);await importCatalog(catalog);await refresh();toast(catalog.accounts.length+' cuentas y '+catalog.rates.length+' tarifas importadas.');});
 if(el.id==='logo-file'&&el.files[0])action(async()=>{const logo_url=await uploadLogo(el.files[0]);await saveCompany({logo_url});await refresh();toast('Logo actualizado para las nuevas cotizaciones.');});
});
app.addEventListener('submit',event=>{
 event.preventDefault();
 const form=event.target;
 if(form.id==='quote-form')action(async()=>{
  const values=Object.fromEntries(new FormData(form));
  const quote=await createQuote({...values,is_sample:draft.is_sample,items:draft.items.map(i=>({rate_id:i.rate_id,quantity:Number(i.quantity)}))},requestId);
  draft=null;requestId=crypto.randomUUID();tab='quotes';kindFilter=quote.is_sample?'sample':'real';filter='all';
  const notice=await tryAutoSync(quote);await refresh();showDetail(quote.id);toast(notice.message,notice.error);
 });
 if(form.id==='profile-form')action(async()=>{const values=Object.fromEntries(new FormData(form));await saveMyProfile({full_name:values.full_name});await refresh();toast('Nombre guardado para tus nuevas cotizaciones.');});
 if(form.id==='numbering-form')action(async()=>{const v=Object.fromEntries(new FormData(form));if(v.confirm_numbering!=='on')throw Error('Confirma los últimos números utilizados.');await saveNumbering({quote_prefix:v.quote_prefix,quote_last_number:Number(v.quote_last_number),quote_padding:Number(v.quote_padding),oc_prefix:v.oc_prefix,oc_last_number:Number(v.oc_last_number),oc_padding:Number(v.oc_padding)});await refresh();toast('Numeración de la agencia confirmada.');});
 if(form.id==='settings-form')action(async()=>{const v=Object.fromEntries(new FormData(form));await saveCompany({...v,validity_days:Number(v.validity_days)});await refresh();toast('Configuración guardada.');});
 if(form.id==='status-form')action(async()=>{const v=Object.fromEntries(new FormData(form)),id=selectedId,q=data.quotes.find(x=>x.id===id);await changeStatus(id,v.status,v.note);const notice=await tryAutoSync({...q,status:v.status});await refresh();showDetail(id);toast('Estado actualizado. '+notice.message,notice.error);});
 if(form.id==='login-form')action(async()=>{const v=Object.fromEntries(new FormData(form));const {error}=await client.auth.signInWithPassword({email:v.email,password:v.password});if(error)throw Error('No se pudo iniciar sesión. Revisa el correo y la contraseña de tu cuenta de EM Agency.');await start();});
});
async function start(){
 if(configError){render();return;}
 if(client){const {data:auth,error}=await client.auth.getSession();if(error)throw error;if(!auth.session){app.innerHTML='<div class="login"><div class="login-logo"><img src="'+brandLogo+'" alt="EM Agency"></div><span class="eyebrow">EM AGENCY</span><h1>Tu espacio de cotizaciones.</h1><p>Ingresa con la cuenta autorizada de tu equipo.</p><form id="login-form"><label class="field">Correo<input name="email" type="email" autocomplete="username" required></label><label class="field">Contraseña<input name="password" type="password" autocomplete="current-password" required></label><button type="submit" class="button primary">Ingresar →</button></form><small>Acceso exclusivo para el equipo de EM Agency.</small></div>';return;}}
 await refresh();const id=new URL(location.href).searchParams.get('quote');if(id)showDetail(id);
}
start().catch(error=>{app.innerHTML='<div class="login"><h1>No se pudo abrir el cotizador</h1><p>'+e(error.message)+'</p><button class="button secondary" onclick="location.reload()">Reintentar</button></div>';});


