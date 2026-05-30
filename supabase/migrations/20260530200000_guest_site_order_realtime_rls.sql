-- =============================================================================
-- ゲスト専用発注 URL（x-site-order-token ヘッダー）向け RLS 補完
-- Realtime UPDATE をカスタマー（未ログイン現場）でも受信できるようにする
-- =============================================================================

create or replace function public.current_site_order_panel_token()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  hdr json;
  p_token text;
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
  p_token := nullif(trim(hdr ->> 'x-site-order-token'), '');
  if p_token is null or not public.is_valid_site_order_token(p_token) then
    return null;
  end if;
  return p_token;
exception
  when others then
    return null;
end;
$$;

create or replace function public.is_guest_site_order_panel_request()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_site_order_panel_token() is not null;
$$;

comment on function public.is_guest_site_order_panel_request() is
  '物件専用発注URL（x-site-order-token ヘッダーが有効な url_token）';

create or replace function public.guest_can_access_order(p_order public.orders)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_token text;
  v_ctx jsonb;
  v_customer_id uuid;
  v_project_id uuid;
begin
  if p_order is null then
    return false;
  end if;
  v_token := public.current_site_order_panel_token();
  if v_token is null then
    return false;
  end if;
  v_ctx := public.get_site_order_context_by_token(v_token);
  if v_ctx is null then
    return false;
  end if;
  v_customer_id := public.safe_text_to_uuid(v_ctx->'customer'->>'id');
  if v_customer_id is null or p_order.customer_id is distinct from v_customer_id then
    return false;
  end if;
  if v_ctx->>'match' = 'project' and v_ctx->'project' is not null then
    v_project_id := public.safe_text_to_uuid(v_ctx->'project'->>'id');
    if v_project_id is not null and p_order.project_id is distinct from v_project_id then
      return false;
    end if;
  end if;
  return true;
end;
$$;

create or replace function public.guest_site_order_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select public.safe_text_to_uuid(
    (public.get_site_order_context_by_token(public.current_site_order_panel_token())->'customer'->>'id')
  );
$$;

create or replace function public.guest_can_access_project(p_project_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_token text;
  v_ctx jsonb;
  v_customer_id uuid;
  v_project_id uuid;
begin
  if p_project_id is null then
    return false;
  end if;
  v_token := public.current_site_order_panel_token();
  if v_token is null then
    return false;
  end if;
  v_ctx := public.get_site_order_context_by_token(v_token);
  if v_ctx is null then
    return false;
  end if;
  v_customer_id := public.safe_text_to_uuid(v_ctx->'customer'->>'id');
  if v_customer_id is null then
    return false;
  end if;
  if v_ctx->>'match' = 'project' and v_ctx->'project' is not null then
    v_project_id := public.safe_text_to_uuid(v_ctx->'project'->>'id');
    return v_project_id is not null and p_project_id = v_project_id;
  end if;
  return exists (
    select 1
    from public.projects p
    where p.id = p_project_id
      and p.customer_id = v_customer_id
  );
end;
$$;

-- Realtime UPDATE で old レコード比較（未設定環境向け・冪等）
do $$
begin
  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'orders'
      and c.relreplident <> 'f'
  ) then
    alter table public.orders replica identity full;
  end if;
end $$;

drop policy if exists "orders_guest_site_order_select" on public.orders;
create policy "orders_guest_site_order_select"
  on public.orders
  for select
  to anon
  using (
    public.is_guest_site_order_panel_request()
    and public.guest_can_access_order(orders)
  );

drop policy if exists "customers_guest_site_order_select" on public.customers;
create policy "customers_guest_site_order_select"
  on public.customers
  for select
  to anon
  using (
    public.is_guest_site_order_panel_request()
    and id = public.guest_site_order_customer_id()
  );

drop policy if exists "projects_guest_site_order_select" on public.projects;
create policy "projects_guest_site_order_select"
  on public.projects
  for select
  to anon
  using (
    public.is_guest_site_order_panel_request()
    and public.guest_can_access_project(id)
  );

drop policy if exists "factories_guest_site_order_select" on public.factories;
create policy "factories_guest_site_order_select"
  on public.factories
  for select
  to anon
  using (public.is_guest_site_order_panel_request());

revoke all on function public.current_site_order_panel_token() from public;
revoke all on function public.is_guest_site_order_panel_request() from public;
revoke all on function public.guest_can_access_order(public.orders) from public;
revoke all on function public.guest_site_order_customer_id() from public;
revoke all on function public.guest_can_access_project(uuid) from public;
grant execute on function public.current_site_order_panel_token() to authenticated, anon;
grant execute on function public.is_guest_site_order_panel_request() to authenticated, anon;
grant execute on function public.guest_can_access_order(public.orders) to authenticated, anon;
grant execute on function public.guest_site_order_customer_id() to authenticated, anon;
grant execute on function public.guest_can_access_project(uuid) to authenticated, anon;
