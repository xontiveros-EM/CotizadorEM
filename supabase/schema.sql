-- Cotizador EM Agency. Run ONCE against a NEW, empty Supabase project.
-- Setup source, not an applied migration. Do not run against TSI/Tanabi.
begin;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to authenticated, service_role;

create table private.staff_members (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table private.staff_members enable row level security;
revoke all on private.staff_members from public, anon, authenticated;

create function private.is_staff()
returns boolean language sql stable security definer set search_path = ''
as $$
  select auth.uid() is not null and exists (
    select 1 from private.staff_members s where s.user_id = auth.uid() and s.active
  )
$$;
revoke all on function private.is_staff() from public, anon;
grant execute on function private.is_staff() to authenticated, service_role;

create table public.company_settings (
  id integer primary key default 1 check (id = 1),
  name text not null default 'Cotizador EM Agency' check (length(trim(name)) between 1 and 150),
  currency text not null default 'MXN' check (currency = 'MXN'),
  tax_rate numeric(5,2) not null default 0 check (tax_rate = 0),
  validity_days integer not null default 15 check (validity_days between 1 and 365),
  terms text not null default 'Precios en pesos mexicanos (MXN). No incluye IVA.' check (length(terms) <= 10000),
  logo_url text check (logo_url is null or length(logo_url) <= 2000)
);
insert into public.company_settings (id) values (1);

create table public.instagram_accounts (
  id uuid primary key default gen_random_uuid(),
  handle text not null unique check (handle ~ '^@?[A-Za-z0-9_.]{1,30}$'),
  display_name text not null check (length(trim(display_name)) between 1 and 200),
  category text not null default '' check (length(category) <= 200),
  followers bigint check (followers >= 0),
  active boolean not null default true
);
create unique index instagram_accounts_normalized_handle_idx
  on public.instagram_accounts (lower(ltrim(handle, '@')));

create table public.rates (
  id uuid primary key default gen_random_uuid(),
  instagram_account_id uuid not null references public.instagram_accounts(id) on delete restrict,
  service text not null check (length(trim(service)) between 1 and 300),
  unit_price numeric(14,2) not null check (unit_price >= 0 and unit_price <> 'NaN'::numeric),
  currency text not null default 'MXN' check (currency = 'MXN'),
  active boolean not null default true,
  unique (instagram_account_id, service, currency)
);
create index rates_account_idx on public.rates (instagram_account_id);

create sequence private.quote_folio_seq as bigint start with 1;
revoke all on sequence private.quote_folio_seq from public, anon, authenticated;

create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  request_payload jsonb not null,
  folio text not null unique,
  created_by uuid references auth.users(id) on delete set null,
  client_name text not null check (length(trim(client_name)) between 1 and 200),
  client_email text not null default '' check (length(client_email) <= 320),
  client_company text not null default '' check (length(client_company) <= 200),
  campaign text not null default '' check (length(campaign) <= 300),
  status text not null default 'borrador' check (status in ('borrador','enviada','aceptada','rechazada','cancelada')),
  company_name text not null,
  terms text not null,
  logo_url text,
  currency text not null check (currency = 'MXN'),
  tax_rate numeric(5,2) not null default 0 check (tax_rate = 0),
  subtotal numeric(14,2) not null check (subtotal >= 0 and subtotal <> 'NaN'::numeric),
  discount_amount numeric(14,2) not null default 0 check (discount_amount >= 0 and discount_amount <= subtotal),
  tax_amount numeric(14,2) not null default 0 check (tax_amount = 0),
  total numeric(14,2) not null check (total = subtotal - discount_amount),
  valid_until date not null,
  notes text not null default '' check (length(notes) <= 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  pdf_path text
);
create index quotes_created_at_idx on public.quotes (created_at desc, id);
create index quotes_status_date_idx on public.quotes (status, valid_until);
create index quotes_creator_idx on public.quotes (created_by);

create table public.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete restrict,
  rate_id uuid references public.rates(id) on delete set null,
  position integer not null check (position > 0),
  instagram_handle text not null,
  service text not null,
  quantity integer not null check (quantity between 1 and 100000),
  unit_price numeric(14,2) not null check (unit_price >= 0 and unit_price <> 'NaN'::numeric),
  line_total numeric(14,2) not null check (line_total = unit_price * quantity),
  unique (quote_id, position)
);
create index quote_items_rate_idx on public.quote_items (rate_id);

create table public.quote_events (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references public.quotes(id) on delete restrict,
  actor_id uuid references auth.users(id) on delete set null,
  from_status text,
  to_status text not null,
  note text not null default '' check (length(note) <= 5000),
  created_at timestamptz not null default now()
);
create index quote_events_quote_date_idx on public.quote_events (quote_id, created_at, id);
create index quote_events_actor_idx on public.quote_events (actor_id);

create table public.sheet_sync (
  quote_id uuid primary key references public.quotes(id) on delete restrict,
  status text not null default 'pending' check (status in ('pending','processing','synced','error')),
  error text,
  attempts integer not null default 0 check (attempts >= 0),
  last_synced_at timestamptz,
  updated_at timestamptz not null default now()
);
create index sheet_sync_pending_idx on public.sheet_sync (updated_at) where status in ('pending','error');

-- Private storage for a global Google Sheets lease. An Edge Function must take
-- this lock before finding/updating/appending rows, then release its own token.
create table private.integration_locks (
  name text primary key,
  token uuid,
  expires_at timestamptz not null default '-infinity'
);
alter table private.integration_locks enable row level security;
insert into private.integration_locks (name) values ('google_sheets');
revoke all on private.integration_locks from public, anon, authenticated;
grant select, update on private.integration_locks to service_role;

create function public.acquire_sheet_lock(p_token uuid, p_lease_seconds integer default 120)
returns boolean language plpgsql security invoker set search_path = ''
as $$
declare acquired boolean := false;
begin
  if p_token is null or p_lease_seconds is null or p_lease_seconds not between 15 and 300 then
    raise exception 'Lease inválida' using errcode = '22023';
  end if;
  update private.integration_locks
    set token = p_token, expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds)
    where name = 'google_sheets' and expires_at <= clock_timestamp()
    returning true into acquired;
  return coalesce(acquired, false);
end
$$;
create function public.release_sheet_lock(p_token uuid)
returns boolean language plpgsql security invoker set search_path = ''
as $$
declare released boolean := false;
begin
  update private.integration_locks set token = null, expires_at = '-infinity'
    where name = 'google_sheets' and token = p_token returning true into released;
  return coalesce(released, false);
end
$$;
revoke all on function public.acquire_sheet_lock(uuid,integer), public.release_sheet_lock(uuid) from public, anon, authenticated;
grant execute on function public.acquire_sheet_lock(uuid,integer), public.release_sheet_lock(uuid) to service_role;

-- The authorization check precedes every privileged write. Only the public
-- SECURITY INVOKER wrappers are exposed to the Data API.
create function private.create_quote_impl(
  p_request_id uuid, p_client_name text, p_client_email text,
  p_client_company text, p_campaign text, p_valid_until date,
  p_discount_amount numeric, p_notes text, p_items jsonb
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
    'notes', coalesce(p_notes,''), 'items', p_items
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
  v_sequence := nextval('private.quote_folio_seq');
  insert into public.quotes (
    request_id, request_payload, folio, created_by, client_name, client_email,
    client_company, campaign, company_name, terms, logo_url, currency, tax_rate,
    subtotal, discount_amount, tax_amount, total, valid_until, notes
  ) values (
    p_request_id, v_payload, 'COT-' || extract(year from v_today)::text || '-' ||
      lpad(v_sequence::text, greatest(6,length(v_sequence::text)), '0'),
    v_actor, trim(p_client_name), trim(coalesce(p_client_email,'')),
    trim(coalesce(p_client_company,'')), trim(coalesce(p_campaign,'')),
    v_settings.name, v_settings.terms, v_settings.logo_url, v_settings.currency, 0,
    v_subtotal, v_discount, 0, v_subtotal - v_discount, v_valid_until, coalesce(p_notes,'')
  ) returning * into v_quote;
  insert into public.quote_items (quote_id,rate_id,position,instagram_handle,service,quantity,unit_price,line_total)
    select v_quote.id, x.rate_id, x.position, x.instagram_handle, x.service, x.quantity, x.unit_price, x.line_total
    from jsonb_to_recordset(v_lines) as x(rate_id uuid,position integer,instagram_handle text,service text,quantity integer,unit_price numeric,line_total numeric);
  insert into public.quote_events (quote_id,actor_id,from_status,to_status,note)
    values (v_quote.id,v_actor,null,'borrador','Cotización creada');
  insert into public.sheet_sync (quote_id) values (v_quote.id);
  return v_quote;
end
$$;
revoke all on function private.create_quote_impl(uuid,text,text,text,text,date,numeric,text,jsonb) from public, anon;
grant execute on function private.create_quote_impl(uuid,text,text,text,text,date,numeric,text,jsonb) to authenticated;

create function public.create_quote(
  p_request_id uuid, p_client_name text, p_client_email text,
  p_client_company text, p_campaign text, p_valid_until date,
  p_discount_amount numeric, p_notes text, p_items jsonb
)
returns public.quotes language sql security invoker set search_path = ''
as $$
  select private.create_quote_impl(p_request_id,p_client_name,p_client_email,p_client_company,
    p_campaign,p_valid_until,p_discount_amount,p_notes,p_items)
$$;
revoke all on function public.create_quote(uuid,text,text,text,text,date,numeric,text,jsonb) from public, anon;
grant execute on function public.create_quote(uuid,text,text,text,text,date,numeric,text,jsonb) to authenticated;

create function private.set_quote_status_impl(p_quote_id uuid,p_status text,p_note text default '')
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
revoke all on function private.set_quote_status_impl(uuid,text,text) from public, anon;
grant execute on function private.set_quote_status_impl(uuid,text,text) to authenticated;
create function public.set_quote_status(p_quote_id uuid,p_status text,p_note text default '')
returns public.quotes language sql security invoker set search_path = ''
as $$ select private.set_quote_status_impl(p_quote_id,p_status,p_note) $$;
revoke all on function public.set_quote_status(uuid,text,text) from public, anon;
grant execute on function public.set_quote_status(uuid,text,text) to authenticated;

-- All application tables are private to registered staff. Signing up alone
-- does not create membership. Members share this one company's work queue.
alter table public.company_settings enable row level security;
alter table public.instagram_accounts enable row level security;
alter table public.rates enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.quote_events enable row level security;
alter table public.sheet_sync enable row level security;

revoke all on public.company_settings,public.instagram_accounts,public.rates,public.quotes,
  public.quote_items,public.quote_events,public.sheet_sync from public,anon,authenticated;
grant select on public.company_settings,public.instagram_accounts,public.rates,public.quotes,
  public.quote_items,public.quote_events,public.sheet_sync to authenticated;
grant insert,update on public.instagram_accounts,public.rates to authenticated;
grant update (name,validity_days,terms,logo_url) on public.company_settings to authenticated;
grant select,insert,update,delete on public.company_settings,public.instagram_accounts,public.rates,
  public.quotes,public.quote_items,public.quote_events,public.sheet_sync to service_role;

create policy settings_read on public.company_settings for select to authenticated using ((select private.is_staff()));
create policy settings_update on public.company_settings for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy accounts_read on public.instagram_accounts for select to authenticated using ((select private.is_staff()));
create policy accounts_insert on public.instagram_accounts for insert to authenticated with check ((select private.is_staff()));
create policy accounts_update on public.instagram_accounts for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy rates_read on public.rates for select to authenticated using ((select private.is_staff()));
create policy rates_insert on public.rates for insert to authenticated with check ((select private.is_staff()));
create policy rates_update on public.rates for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy quotes_read on public.quotes for select to authenticated using ((select private.is_staff()));
create policy items_read on public.quote_items for select to authenticated using ((select private.is_staff()));
create policy events_read on public.quote_events for select to authenticated using ((select private.is_staff()));
create policy sync_read on public.sheet_sync for select to authenticated using ((select private.is_staff()));

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types) values
  ('quote-pdfs','quote-pdfs',false,10485760,array['application/pdf']),
  ('brand-assets','brand-assets',true,2097152,array['image/png','image/jpeg'])
on conflict (id) do nothing;
create policy quote_pdfs_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'quote-pdfs' and (select private.is_staff()));
create policy brand_assets_staff_read on storage.objects for select to authenticated
  using (bucket_id = 'brand-assets' and (select private.is_staff()));
create policy brand_assets_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'brand-assets' and (select private.is_staff()));
create policy brand_assets_staff_update on storage.objects for update to authenticated
  using (bucket_id = 'brand-assets' and (select private.is_staff()))
  with check (bucket_id = 'brand-assets' and (select private.is_staff()));


-- The quote row lock makes version verification and integration-state update
-- one atomic operation with respect to set_quote_status.
create function public.finish_sheet_sync(
  p_quote_id uuid, p_quote_updated_at timestamptz, p_error text default null
)
returns text language plpgsql security invoker set search_path = ''
as $$
declare v_quote public.quotes; v_status text; v_error text;
begin
  select * into v_quote from public.quotes where id = p_quote_id for update;
  if not found then
    raise exception 'Cotización no encontrada' using errcode = 'P0002';
  end if;
  if v_quote.updated_at is distinct from p_quote_updated_at then
    v_status := 'pending';
    v_error := 'La cotización cambió durante la sincronización. Reintenta.';
  elsif p_error is not null then
    v_status := 'error';
    v_error := left(p_error,2000);
  else
    v_status := 'synced';
    v_error := null;
  end if;
  insert into public.sheet_sync (quote_id,status,error,last_synced_at,updated_at)
    values (p_quote_id,v_status,v_error,
      case when v_status = 'synced' then clock_timestamp() else null end,clock_timestamp())
    on conflict (quote_id) do update
      set status = excluded.status,error = excluded.error,
      last_synced_at = coalesce(excluded.last_synced_at,public.sheet_sync.last_synced_at),
      updated_at = excluded.updated_at;
  return v_status;
end
$$;
revoke all on function public.finish_sheet_sync(uuid,timestamptz,text) from public,anon,authenticated;
grant execute on function public.finish_sheet_sync(uuid,timestamptz,text) to service_role;

commit;
