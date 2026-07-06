-- チャーター車両募集 Phase 1: 業者マスタ・車両登録・認証・RLS

-- =============================================================================
-- 1. charter_operators（個人チャーター業者マスタ）
-- =============================================================================
create table if not exists public.charter_operators (
  id text primary key default gen_random_uuid()::text,
  company_name text not null,
  contact_name text,
  phone text,
  login_password text not null,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.charter_operators is '個人チャーター業者マスタ（factoriesの個人版）';

-- =============================================================================
-- 2. charter_vehicles（車両登録・工場/チャーター共通）
-- =============================================================================
create table if not exists public.charter_vehicles (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('factory', 'charter_operator')),
  owner_id text not null,
  vehicle_type text not null check (vehicle_type in ('large', 'small')),
  vehicle_number text,
  door_number text,
  count integer not null default 1 check (count > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_charter_vehicles_owner on public.charter_vehicles (owner_type, owner_id);

comment on table public.charter_vehicles is 'チャーター供給側の車両登録（大型/小型、車両ナンバー、ドアナンバー、台数）';

-- =============================================================================
-- 3. RLSヘルパー関数（factory方式に準拠）
-- =============================================================================
create or replace function public.current_charter_panel_id()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  hdr json;
  p_id text;
  p_pass text;
  v_id text;
begin
  begin
    hdr := nullif(current_setting('request.headers', true), '')::json;
  exception
    when others then
      return null;
  end;
  if hdr is null then
    return null;
  end if;
  p_id := nullif(trim(hdr ->> 'x-charter-id'), '');
  p_pass := nullif(trim(hdr ->> 'x-charter-password'), '');
  if p_id is null or p_pass is null then
    return null;
  end if;
  select c.id::text into v_id
  from public.charter_operators c
  where trim(c.id::text) = p_id
    and trim(coalesce(c.login_password, '')) = p_pass
    and c.status = 'active'
  limit 1;
  return v_id;
exception
  when others then
    return null;
end;
$$;

create or replace function public.is_charter_panel_request()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_charter_panel_id() is not null;
$$;

comment on function public.is_charter_panel_request() is
  '個人チャーター業者タブレット（x-charter-id / x-charter-password ヘッダーが charter_operators と一致）';

revoke all on function public.current_charter_panel_id() from public;
revoke all on function public.is_charter_panel_request() from public;
grant execute on function public.current_charter_panel_id() to authenticated, anon;
grant execute on function public.is_charter_panel_request() to authenticated, anon;

-- =============================================================================
-- 4. login_charter RPC
-- =============================================================================
create or replace function public.login_charter(p_id text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_company_name text;
  v_contact_name text;
  v_phone text;
begin
  select c.id, c.company_name, c.contact_name, c.phone
  into v_id, v_company_name, v_contact_name, v_phone
  from public.charter_operators c
  where trim(c.id::text) = trim(coalesce(p_id, ''))
    and trim(coalesce(c.login_password, '')) = trim(coalesce(p_password, ''))
    and c.status = 'active';
  if not found then
    raise exception 'チャーター業者IDまたはパスワードが間違っています'
      using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'id', v_id,
    'company_name', v_company_name,
    'contact_name', v_contact_name,
    'phone', v_phone
  );
end;
$$;

revoke all on function public.login_charter(text, text) from public;
grant execute on function public.login_charter(text, text) to authenticated, anon;

-- =============================================================================
-- 5. RLSポリシー
-- =============================================================================
alter table public.charter_operators enable row level security;
alter table public.charter_vehicles enable row level security;

grant select, insert, update, delete on public.charter_operators to anon, authenticated;
grant select, insert, update, delete on public.charter_vehicles to anon, authenticated;

drop policy if exists "charter_operators_admin_panel" on public.charter_operators;
create policy "charter_operators_admin_panel"
  on public.charter_operators
  for all
  to anon
  using (public.is_admin_panel_request())
  with check (public.is_admin_panel_request());

drop policy if exists "charter_operators_self_select" on public.charter_operators;
create policy "charter_operators_self_select"
  on public.charter_operators
  for select
  to anon
  using (public.is_charter_panel_request() and id = public.current_charter_panel_id());

drop policy if exists "charter_operators_self_update" on public.charter_operators;
create policy "charter_operators_self_update"
  on public.charter_operators
  for update
  to anon
  using (public.is_charter_panel_request() and id = public.current_charter_panel_id())
  with check (public.is_charter_panel_request() and id = public.current_charter_panel_id());

drop policy if exists "charter_vehicles_admin_panel" on public.charter_vehicles;
create policy "charter_vehicles_admin_panel"
  on public.charter_vehicles
  for all
  to anon
  using (public.is_admin_panel_request())
  with check (public.is_admin_panel_request());

drop policy if exists "charter_vehicles_factory_own" on public.charter_vehicles;
create policy "charter_vehicles_factory_own"
  on public.charter_vehicles
  for all
  to anon
  using (
    public.is_factory_panel_request()
    and owner_type = 'factory'
    and owner_id = public.current_factory_panel_id()
  )
  with check (
    public.is_factory_panel_request()
    and owner_type = 'factory'
    and owner_id = public.current_factory_panel_id()
  );

drop policy if exists "charter_vehicles_charter_own" on public.charter_vehicles;
create policy "charter_vehicles_charter_own"
  on public.charter_vehicles
  for all
  to anon
  using (
    public.is_charter_panel_request()
    and owner_type = 'charter_operator'
    and owner_id = public.current_charter_panel_id()
  )
  with check (
    public.is_charter_panel_request()
    and owner_type = 'charter_operator'
    and owner_id = public.current_charter_panel_id()
  );
