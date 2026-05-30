-- =============================================================================
-- カスタマー発注画面（電話番号 + パスワード・anon キー）向け RLS 補完
-- =============================================================================

create or replace function public.current_customer_panel_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  hdr json;
  p_phone text;
  p_pass text;
  v_id uuid;
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
  p_phone := nullif(trim(hdr ->> 'x-customer-phone'), '');
  p_pass := nullif(trim(hdr ->> 'x-customer-password'), '');
  if p_phone is null or p_pass is null then
    return null;
  end if;
  select c.id into v_id
  from public.customers c
  where trim(coalesce(c.phone_number, '')) = p_phone
    and trim(coalesce(c.login_password, '')) = p_pass
  limit 1;
  return v_id;
exception
  when others then
    return null;
end;
$$;

create or replace function public.is_customer_panel_request()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_customer_panel_id() is not null;
$$;

comment on function public.is_customer_panel_request() is
  'カスタマー発注画面（x-customer-phone / x-customer-password ヘッダーが customers と一致）';

create or replace function public.login_customer(p_phone text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_company_name text;
  v_phone_number text;
  v_manager_name text;
  v_url_token text;
begin
  select
    c.id,
    c.company_name,
    c.phone_number,
    c.manager_name,
    c.url_token::text
  into v_id, v_company_name, v_phone_number, v_manager_name, v_url_token
  from public.customers c
  where trim(coalesce(c.phone_number, '')) = trim(coalesce(p_phone, ''))
    and trim(coalesce(c.login_password, '')) = trim(coalesce(p_password, ''))
  limit 1;
  if v_id is null then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_id::text,
    'company_name', v_company_name,
    'name', coalesce(v_company_name, ''),
    'phone_number', v_phone_number,
    'manager_name', v_manager_name,
    'url_token', v_url_token
  );
end;
$$;

revoke all on function public.current_customer_panel_id() from public;
revoke all on function public.is_customer_panel_request() from public;
revoke all on function public.login_customer(text, text) from public;
grant execute on function public.current_customer_panel_id() to authenticated, anon;
grant execute on function public.is_customer_panel_request() to authenticated, anon;
grant execute on function public.login_customer(text, text) to authenticated, anon;

-- カスタマー: 自社行のみ
drop policy if exists "customers_customer_panel_select" on public.customers;
create policy "customers_customer_panel_select"
  on public.customers
  for select
  to anon
  using (
    public.is_customer_panel_request()
    and id = public.current_customer_panel_id()
  );

-- カスタマー: 自社物件
drop policy if exists "projects_customer_panel_all" on public.projects;
create policy "projects_customer_panel_all"
  on public.projects
  for all
  to anon
  using (
    public.is_customer_panel_request()
    and customer_id = public.current_customer_panel_id()
  )
  with check (
    public.is_customer_panel_request()
    and customer_id = public.current_customer_panel_id()
  );

-- カスタマー: 自社注文
drop policy if exists "orders_customer_panel_all" on public.orders;
create policy "orders_customer_panel_all"
  on public.orders
  for all
  to anon
  using (
    public.is_customer_panel_request()
    and customer_id = public.current_customer_panel_id()
  )
  with check (
    public.is_customer_panel_request()
    and customer_id = public.current_customer_panel_id()
  );

-- カスタマー: 工場一覧（発注画面で工場名表示）
drop policy if exists "factories_customer_panel_select" on public.factories;
create policy "factories_customer_panel_select"
  on public.factories
  for select
  to anon
  using (public.is_customer_panel_request());

-- カスタマー: スケジュール・休日・システム設定（参照のみ）
drop policy if exists "schedules_customer_panel_select" on public.schedules;
create policy "schedules_customer_panel_select"
  on public.schedules
  for select
  to anon
  using (public.is_customer_panel_request());

drop policy if exists "holidays_customer_panel_select" on public.holidays;
create policy "holidays_customer_panel_select"
  on public.holidays
  for select
  to anon
  using (public.is_customer_panel_request());

drop policy if exists "system_settings_customer_panel_select" on public.system_settings;
create policy "system_settings_customer_panel_select"
  on public.system_settings
  for select
  to anon
  using (public.is_customer_panel_request());
