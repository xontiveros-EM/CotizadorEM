-- ACTUALIZACIÓN EM AGENCY V3. Ejecutar en el proyecto xguieynlzqutjhehqdnk.
-- Requiere la base original ya instalada. NO volver a ejecutar schema.sql.
-- Conserva cotizaciones, folios, miembros, catálogo y archivos existentes.
-- Puede repetirse: no reinicia consecutivos ni asigna folios al historial.
begin;
alter table public.quotes add column if not exists is_sample boolean not null default false;
alter table public.quotes add column if not exists deleted_at timestamptz;
alter table public.quotes add column if not exists quote_number bigint;
alter table public.quotes add column if not exists oc_folio text;
alter table public.quotes add column if not exists oc_number bigint;
alter table public.quotes add column if not exists oc_created_at timestamptz;
alter table public.quotes add column if not exists seller_name text;
alter table public.quotes add column if not exists seller_email text;
alter table public.quotes add column if not exists seller_whatsapp text;
alter table public.quotes alter column folio drop not null;
create unique index if not exists quotes_oc_folio_unique on public.quotes(oc_folio) where oc_folio is not null;
create unique index if not exists quotes_quote_number_unique on public.quotes(quote_number) where quote_number is not null;
create unique index if not exists quotes_oc_number_unique on public.quotes(oc_number) where oc_number is not null;
create index if not exists quotes_active_created_idx on public.quotes(created_at desc,id) where deleted_at is null;
do $$ begin
 if not exists(select 1 from pg_constraint where conname='quotes_v3_sample_integrity' and conrelid='public.quotes'::regclass) then
  alter table public.quotes add constraint quotes_v3_sample_integrity check ((not is_sample and folio is not null) or (is_sample and folio is null and quote_number is null and oc_folio is null and oc_number is null and status='borrador'));
 end if;
 if not exists(select 1 from pg_constraint where conname='quotes_v3_oc_integrity' and conrelid='public.quotes'::regclass) then
  alter table public.quotes add constraint quotes_v3_oc_integrity check ((oc_folio is null and oc_number is null and oc_created_at is null) or (oc_folio is not null and oc_number is not null and oc_number>0 and oc_created_at is not null and not is_sample));
 end if;
end $$;
create table if not exists private.document_counters (
 kind text primary key check(kind in ('quote','oc')),
 prefix text not null,
 last_number bigint not null default 0 check(last_number between 0 and 999999999999),
 padding integer not null default 0 check(padding between 0 and 12),
 configured boolean not null default false
);
alter table private.document_counters enable row level security;
revoke all on private.document_counters from public,anon,authenticated,service_role;
insert into private.document_counters(kind,prefix,last_number) values ('quote','',0),('oc','OC ',2710) on conflict(kind) do nothing;

create or replace function private.get_document_numbering_impl()
returns jsonb language plpgsql stable security definer set search_path=''
as $$ declare result jsonb; begin
 if auth.uid() is null or not private.is_staff() then raise exception 'Acceso exclusivo para el equipo autorizado' using errcode='42501'; end if;
 select jsonb_build_object('quote_prefix',q.prefix,'quote_last_number',q.last_number,'quote_padding',q.padding,'quote_configured',q.configured,
 'oc_prefix',o.prefix,'oc_last_number',o.last_number,'oc_padding',o.padding,'oc_configured',o.configured)
 into result from private.document_counters q cross join private.document_counters o where q.kind='quote' and o.kind='oc';
 return result;
end $$;
create or replace function public.get_document_numbering() returns jsonb language sql stable security invoker set search_path=''
as $$ select private.get_document_numbering_impl() $$;

create or replace function private.save_document_numbering_impl(p_quote_prefix text,p_quote_last_number bigint,p_quote_padding integer,p_oc_prefix text,p_oc_last_number bigint,p_oc_padding integer)
returns jsonb language plpgsql security definer set search_path=''
as $$ declare r private.document_counters; next_prefix text; next_number bigint; next_padding integer; max_used bigint; begin
 if auth.uid() is null or not private.is_staff() then raise exception 'Acceso exclusivo para el equipo autorizado' using errcode='42501'; end if;
 -- Consistent lock order serializes configuration with folio assignment.
 for r in select * from private.document_counters order by kind for update loop
  if r.kind='quote' then next_prefix:=coalesce(p_quote_prefix,'');next_number:=p_quote_last_number;next_padding:=p_quote_padding;
   select coalesce(max(quote_number),0) into max_used from public.quotes;
  else next_prefix:=coalesce(p_oc_prefix,'');next_number:=p_oc_last_number;next_padding:=p_oc_padding;
   select coalesce(max(oc_number),0) into max_used from public.quotes;
  end if;
  if length(next_prefix)>40 or next_prefix ~ '[[:cntrl:]]' or next_number is null or next_number not between 0 and 999999999999 or next_padding is null or next_padding not between 0 and 10 then
   raise exception 'Prefijo o consecutivo inválido' using errcode='22023';
  end if;
  if length(trim(next_prefix))=0 then
   if r.configured then raise exception 'No se puede desactivar una serie ya confirmada' using errcode='22023'; end if;
   continue;
  end if;
  if (r.configured and next_number<r.last_number) or next_number<max_used then
   raise exception 'No se puede retroceder el consecutivo ni reutilizar números' using errcode='22023';
  end if;
  update private.document_counters set prefix=next_prefix,last_number=next_number,padding=next_padding,configured=true where kind=r.kind;
 end loop;
 return private.get_document_numbering_impl();
end $$;
create or replace function public.save_document_numbering(p_quote_prefix text,p_quote_last_number bigint,p_quote_padding integer,p_oc_prefix text,p_oc_last_number bigint,p_oc_padding integer)
returns jsonb language sql security invoker set search_path=''
as $$ select private.save_document_numbering_impl(p_quote_prefix,p_quote_last_number,p_quote_padding,p_oc_prefix,p_oc_last_number,p_oc_padding) $$;

create or replace function private.create_quote_v3_impl(
  p_request_id uuid, p_client_name text, p_client_email text,
  p_client_company text, p_campaign text, p_valid_until date,
  p_discount_amount numeric, p_notes text, p_items jsonb, p_is_sample boolean, p_seller_whatsapp text
)
returns public.quotes language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_settings public.company_settings;
  v_quote public.quotes;
  v_payload jsonb;
  v_item jsonb;
  v_rate public.rates;
  v_handle text;
  v_quantity integer;
  v_subtotal numeric := 0;
  v_discount numeric := coalesce(p_discount_amount, 0);
  v_lines jsonb := '[]'::jsonb;
  v_today date := (now() at time zone 'America/Mexico_City')::date;
  v_valid_until date;
  v_position integer := 0;
  v_sequence bigint;
  v_folio text;
  v_counter private.document_counters;
  v_seller_name text;
  v_seller_email text;
begin
  if v_actor is null or not private.is_staff() then
    raise exception 'Acceso exclusivo para el equipo autorizado' using errcode = '42501';
  end if;
  if p_request_id is null then
    raise exception 'Falta la clave de solicitud' using errcode = '22023';
  end if;
  v_payload := jsonb_build_object(
    'client_name', trim(coalesce(p_client_name,'')), 'client_email', trim(coalesce(p_client_email,'')),
    'client_company', trim(coalesce(p_client_company,'')), 'campaign', trim(coalesce(p_campaign,'')),
    'valid_until', p_valid_until, 'discount_amount', v_discount,
    'notes', coalesce(p_notes,''), 'items', p_items,
    'is_sample', coalesce(p_is_sample,false), 'seller_whatsapp', trim(coalesce(p_seller_whatsapp,''))
  );
  -- Serializes concurrent retries before the unique check. The sequence is
  -- consumed only for a new valid quotation, never for a successful retry.
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  select * into v_quote from public.quotes where request_id = p_request_id;
  if found then
    if v_quote.created_by is distinct from v_actor or v_quote.request_payload is distinct from v_payload then
      raise exception 'La solicitud ya existe con otros datos' using errcode = '22023';
    end if;
    return v_quote;
  end if;
  select trim(coalesce(nullif(raw_user_meta_data->>'full_name',''),raw_user_meta_data->>'name','')),trim(coalesce(email,''))
    into v_seller_name,v_seller_email from auth.users where id=v_actor;
  if length(coalesce(v_seller_name,'')) not between 1 and 200 or length(coalesce(v_seller_email,'')) not between 3 and 320 then
    raise exception 'Completa tu nombre en Mi perfil antes de crear una cotización' using errcode='22023';
  end if;
  if length(trim(coalesce(p_seller_whatsapp,'')))>40
    or trim(coalesce(p_seller_whatsapp,'')) !~ '^[+0-9 ().-]*$'
    or (trim(coalesce(p_seller_whatsapp,''))<>'' and length(regexp_replace(p_seller_whatsapp,'[^0-9]','','g')) not between 7 and 15) then
    raise exception 'WhatsApp inválido: incluye entre 7 y 15 dígitos; puedes usar +, espacios, puntos, paréntesis y guiones' using errcode='22023';
  end if;
  if length(trim(coalesce(p_client_name,''))) not between 1 and 200
    or length(coalesce(p_client_email,'')) > 320
    or length(coalesce(p_client_company,'')) > 200
    or length(coalesce(p_campaign,'')) > 300
    or length(coalesce(p_notes,'')) > 10000 then
    raise exception 'Datos del cliente o campaña inválidos' using errcode = '22023';
  end if;
  if v_discount::text in ('NaN','Infinity','-Infinity') or v_discount < 0 or v_discount <> round(v_discount,2) then
    raise exception 'Descuento inválido: usa pesos con máximo dos decimales' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Se requiere una lista de servicios' using errcode = '22023';
  end if;
  if jsonb_array_length(p_items) not between 1 and 100 then
    raise exception 'La cotización debe incluir entre 1 y 100 servicios' using errcode = '22023';
  end if;
  select * into strict v_settings from public.company_settings where id = 1 for share;
  v_valid_until := coalesce(p_valid_until, v_today + v_settings.validity_days);
  if v_valid_until < v_today or v_valid_until > v_today + 3650 then
    raise exception 'Vigencia inválida' using errcode = '22023';
  end if;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object' or jsonb_typeof(v_item->'quantity') <> 'number'
      or coalesce(v_item->>'rate_id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'Servicio o cantidad inválidos' using errcode = '22023';
    end if;
    if (v_item->>'quantity')::numeric not between 1 and 100000
      or (v_item->>'quantity')::numeric <> trunc((v_item->>'quantity')::numeric) then
      raise exception 'La cantidad debe ser entera entre 1 y 100000' using errcode = '22023';
    end if;
    v_quantity := ((v_item->>'quantity')::numeric)::integer;
    select r.* into v_rate from public.rates r
      where r.id = (v_item->>'rate_id')::uuid and r.active for share;
    if not found or v_rate.currency <> v_settings.currency then
      raise exception 'Tarifa no disponible o moneda diferente' using errcode = '22023';
    end if;
    select a.handle into v_handle from public.instagram_accounts a
      where a.id = v_rate.instagram_account_id and a.active for share;
    if not found then
      raise exception 'Cuenta de Instagram no disponible' using errcode = '22023';
    end if;
    v_position := v_position + 1;
    v_subtotal := v_subtotal + v_rate.unit_price * v_quantity;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'rate_id', v_rate.id, 'position', v_position, 'instagram_handle', v_handle,
      'service', v_rate.service, 'quantity', v_quantity, 'unit_price', v_rate.unit_price,
      'line_total', v_rate.unit_price * v_quantity
    ));
  end loop;
  if v_subtotal > 999999999999.99 or v_discount > v_subtotal then
    raise exception 'El total excede el límite o el descuento supera el subtotal' using errcode = '22023';
  end if;
  if not coalesce(p_is_sample,false) then
    select * into strict v_counter from private.document_counters where kind='quote' for update;
    if not v_counter.configured then
      raise exception 'Configura y confirma el prefijo y último número de cotización de la agencia' using errcode='55000';
    end if;
    if v_counter.last_number>=999999999999 then raise exception 'Se agotó el consecutivo de cotizaciones' using errcode='22023'; end if;
    v_sequence:=v_counter.last_number+1;
    v_folio:=v_counter.prefix || lpad(v_sequence::text,greatest(v_counter.padding,length(v_sequence::text)),'0');
    if exists(select 1 from public.quotes where folio=v_folio) then
      raise exception 'El siguiente folio ya existe. Revisa el último número de la agencia' using errcode='23505';
    end if;
    update private.document_counters set last_number=v_sequence where kind='quote';
  end if;
  insert into public.quotes (
    request_id, request_payload, folio, created_by, client_name, client_email,
    client_company, campaign, company_name, terms, logo_url, currency, tax_rate,
    subtotal, discount_amount, tax_amount, total, valid_until, notes,
    is_sample,quote_number,seller_name,seller_email,seller_whatsapp
  ) values (
    p_request_id, v_payload, v_folio,
    v_actor, trim(p_client_name), trim(coalesce(p_client_email,'')),
    trim(coalesce(p_client_company,'')), trim(coalesce(p_campaign,'')),
    v_settings.name, v_settings.terms, v_settings.logo_url, v_settings.currency, 0,
    v_subtotal, v_discount, 0, v_subtotal - v_discount, v_valid_until, coalesce(p_notes,''),
    coalesce(p_is_sample,false),v_sequence,v_seller_name,v_seller_email,trim(coalesce(p_seller_whatsapp,''))
  ) returning * into v_quote;
  insert into public.quote_items (quote_id,rate_id,position,instagram_handle,service,quantity,unit_price,line_total)
    select v_quote.id, x.rate_id, x.position, x.instagram_handle, x.service, x.quantity, x.unit_price, x.line_total
    from jsonb_to_recordset(v_lines) as x(rate_id uuid,position integer,instagram_handle text,service text,quantity integer,unit_price numeric,line_total numeric);
  insert into public.quote_events (quote_id,actor_id,from_status,to_status,note)
    values (v_quote.id,v_actor,null,'borrador',case when v_quote.is_sample then 'Cotización de muestra creada, sin folio oficial' else 'Cotización creada' end);
  if not v_quote.is_sample then insert into public.sheet_sync (quote_id) values (v_quote.id); end if;
  return v_quote;
end
$$;
create or replace function private.set_quote_status_impl(p_quote_id uuid,p_status text,p_note text default '')
returns public.quotes language plpgsql security definer set search_path = ''
as $$
declare v_actor uuid := auth.uid(); v_quote public.quotes; v_previous text;
begin
  if v_actor is null or not private.is_staff() then
    raise exception 'Acceso exclusivo para el equipo autorizado' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('borrador','enviada','aceptada','rechazada','cancelada')
    or length(coalesce(p_note,'')) > 5000 then
    raise exception 'Estado o nota inválidos' using errcode = '22023';
  end if;
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'Cotización no encontrada' using errcode = 'P0002';
  end if;
  if v_quote.deleted_at is not null then raise exception 'La cotización está eliminada' using errcode='22023'; end if;
  if v_quote.is_sample then raise exception 'Las muestras no participan en el seguimiento comercial' using errcode='22023'; end if;
  if v_quote.status = p_status then return v_quote; end if;
  if not ((v_quote.status = 'borrador' and p_status in ('enviada','cancelada'))
    or (v_quote.status = 'enviada' and p_status in ('aceptada','rechazada','cancelada'))) then
    raise exception 'Transición de estado no permitida' using errcode = '22023';
  end if;
  if p_status in ('enviada','aceptada')
    and v_quote.valid_until < (now() at time zone 'America/Mexico_City')::date then
    raise exception 'La cotización está vencida' using errcode = '22023';
  end if;
  v_previous := v_quote.status;
  update public.quotes set status = p_status,updated_at = clock_timestamp()
    where id = p_quote_id returning * into v_quote;
  insert into public.quote_events (quote_id,actor_id,from_status,to_status,note)
    values (p_quote_id,v_actor,v_previous,p_status,coalesce(p_note,''));
  insert into public.sheet_sync (quote_id,status,error,updated_at)
    values (p_quote_id,'pending',null,clock_timestamp())
    on conflict (quote_id) do update set status = 'pending',error = null,updated_at = excluded.updated_at;
  return v_quote;
end
$$;

create or replace function public.create_quote_v3(p_request_id uuid,p_client_name text,p_client_email text,p_client_company text,p_campaign text,p_valid_until date,p_discount_amount numeric,p_notes text,p_items jsonb,p_is_sample boolean,p_seller_whatsapp text)
returns public.quotes language sql security invoker set search_path=''
as $$ select private.create_quote_v3_impl(p_request_id,p_client_name,p_client_email,p_client_company,p_campaign,p_valid_until,p_discount_amount,p_notes,p_items,p_is_sample,p_seller_whatsapp) $$;

-- Old clients must refresh instead of using the obsolete COT-year sequence.
create or replace function public.create_quote(p_request_id uuid,p_client_name text,p_client_email text,p_client_company text,p_campaign text,p_valid_until date,p_discount_amount numeric,p_notes text,p_items jsonb)
returns public.quotes language plpgsql security invoker set search_path=''
as $$ begin raise exception 'Actualiza la página para usar las cotizaciones y folios de EM Agency V3' using errcode='55000'; end $$;
revoke all on function private.create_quote_impl(uuid,text,text,text,text,date,numeric,text,jsonb) from public,anon,authenticated;

create or replace function private.convert_quote_to_oc_impl(p_quote_id uuid)
returns public.quotes language plpgsql security definer set search_path=''
as $$ declare q public.quotes;c private.document_counters;n bigint;f text;begin
 if auth.uid() is null or not private.is_staff() then raise exception 'Acceso exclusivo para el equipo autorizado' using errcode='42501';end if;
 select * into q from public.quotes where id=p_quote_id for update;
 if not found then raise exception 'Cotización no encontrada' using errcode='P0002';end if;
 if q.deleted_at is not null or q.is_sample then raise exception 'Solo se convierten cotizaciones reales activas' using errcode='22023';end if;
 if q.oc_folio is not null then return q;end if;
 if q.status<>'aceptada' or q.valid_until<(now() at time zone 'America/Mexico_City')::date then raise exception 'La cotización debe estar aceptada y vigente antes de generar la OC' using errcode='22023';end if;
 select * into strict c from private.document_counters where kind='oc' for update;
 if not c.configured then raise exception 'Confirma el último número de OC en Configuración' using errcode='55000';end if;
 if c.last_number>=999999999999 then raise exception 'Se agotó el consecutivo de OC' using errcode='22023';end if;
 n:=c.last_number+1;f:=c.prefix || lpad(n::text,greatest(c.padding,length(n::text)),'0');
 if exists(select 1 from public.quotes where oc_folio=f) then raise exception 'El siguiente número de OC ya existe' using errcode='23505';end if;
 update private.document_counters set last_number=n where kind='oc';
 update public.quotes set oc_folio=f,oc_number=n,oc_created_at=clock_timestamp(),updated_at=clock_timestamp(),pdf_path=null where id=p_quote_id returning * into q;
 insert into public.quote_events(quote_id,actor_id,from_status,to_status,note) values(p_quote_id,auth.uid(),q.status,q.status,'Convertida en orden de compra '||f||'. Se conserva la cotización '||q.folio);
 insert into public.sheet_sync(quote_id,status,error,updated_at) values(p_quote_id,'pending',null,clock_timestamp()) on conflict(quote_id) do update set status='pending',error=null,updated_at=excluded.updated_at;
 return q;
end $$;
create or replace function public.convert_quote_to_oc(p_quote_id uuid) returns public.quotes language sql security invoker set search_path=''
as $$ select private.convert_quote_to_oc_impl(p_quote_id) $$;

create or replace function private.delete_quote_impl(p_quote_id uuid)
returns public.quotes language plpgsql security definer set search_path=''
as $$ declare q public.quotes;begin
 if auth.uid() is null or not private.is_staff() then raise exception 'Acceso exclusivo para el equipo autorizado' using errcode='42501';end if;
 select * into q from public.quotes where id=p_quote_id for update;
 if not found then raise exception 'Cotización no encontrada' using errcode='P0002';end if;
 if q.deleted_at is not null then return q;end if;
 if q.oc_folio is not null then raise exception 'Esta cotización tiene una OC vinculada y debe conservarse' using errcode='22023';end if;
 update public.quotes set deleted_at=clock_timestamp(),updated_at=clock_timestamp(),pdf_path=null where id=p_quote_id returning * into q;
 insert into public.quote_events(quote_id,actor_id,from_status,to_status,note) values(p_quote_id,auth.uid(),q.status,q.status,case when q.is_sample then 'Muestra eliminada' else 'Cotización eliminada. Folio reservado y conservado en historial' end);
 if not q.is_sample then
  insert into public.sheet_sync(quote_id,status,error,updated_at) values(p_quote_id,'pending',null,clock_timestamp()) on conflict(quote_id) do update set status='pending',error=null,updated_at=excluded.updated_at;
 end if;
 return q;
end $$;
create or replace function public.delete_quote(p_quote_id uuid) returns public.quotes language sql security invoker set search_path=''
as $$ select private.delete_quote_impl(p_quote_id) $$;

-- Every privileged implementation authenticates the caller and checks staff membership.
revoke all on function private.get_document_numbering_impl(),private.save_document_numbering_impl(text,bigint,integer,text,bigint,integer),private.create_quote_v3_impl(uuid,text,text,text,text,date,numeric,text,jsonb,boolean,text),private.convert_quote_to_oc_impl(uuid),private.delete_quote_impl(uuid),private.set_quote_status_impl(uuid,text,text) from public,anon,authenticated;
grant execute on function private.get_document_numbering_impl(),private.save_document_numbering_impl(text,bigint,integer,text,bigint,integer),private.create_quote_v3_impl(uuid,text,text,text,text,date,numeric,text,jsonb,boolean,text),private.convert_quote_to_oc_impl(uuid),private.delete_quote_impl(uuid),private.set_quote_status_impl(uuid,text,text) to authenticated;
revoke all on function public.get_document_numbering(),public.save_document_numbering(text,bigint,integer,text,bigint,integer),public.create_quote_v3(uuid,text,text,text,text,date,numeric,text,jsonb,boolean,text),public.convert_quote_to_oc(uuid),public.delete_quote(uuid) from public,anon,authenticated;
grant execute on function public.get_document_numbering(),public.save_document_numbering(text,bigint,integer,text,bigint,integer),public.create_quote_v3(uuid,text,text,text,text,date,numeric,text,jsonb,boolean,text),public.convert_quote_to_oc(uuid),public.delete_quote(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
