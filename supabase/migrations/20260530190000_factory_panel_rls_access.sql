-- =============================================================================
-- 工場タブレット（工場 ID + パスワード・anon キー）向け RLS 補完
-- Realtime（orders UPDATE）も SELECT 権限のある行のみ届くため、ヘッダー認証を追加
-- =============================================================================

create or replace function public.current_factory_panel_id()
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
  p_id := nullif(trim(hdr ->> 'x-factory-id'), '');
  p_pass := nullif(trim(hdr ->> 'x-factory-password'), '');
  if p_id is null or p_pass is null then
    return null;
  end if;
  select f.id::text into v_id
  from public.factories f
  where trim(f.id::text) = p_id
    and trim(coalesce(f.login_password, '')) = p_pass
  limit 1;
  return v_id;
exception
  when others then
    return null;
end;
$$;

create or replace function public.is_factory_panel_request()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_factory_panel_id() is not null;
$$;

comment on function public.is_factory_panel_request() is
  '工場タブレット（x-factory-id / x-factory-password ヘッダーが factories と一致）';

-- Auth プロファイル or パネルヘッダーの工場 ID（text）
create or replace function public.effective_factory_actor_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    nullif(trim(public.current_factory_panel_id()), ''),
    nullif(trim(public.current_factory_id()::text), '')
  );
$$;

create or replace function public.factory_can_access_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_project_id is null then false
    when public.is_app_admin() then true
    when not public.is_app_factory() and not public.is_factory_panel_request() then false
    else exists (
      select 1
      from public.projects p
      where p.id = p_project_id
        and (
          trim(p.main_factory_id::text) = public.effective_factory_actor_id()
          or coalesce(p.sub_factory_ids, '[]'::jsonb) @> jsonb_build_array(public.effective_factory_actor_id())
        )
    )
  end;
$$;

create or replace function public.factory_can_access_order(p_order public.orders)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_order is null then false
    when public.is_app_admin() then true
    when not public.is_app_factory() and not public.is_factory_panel_request() then false
    when p_order.status = 'pending_association' then false
    else (
      public.factory_matches_text(public.effective_factory_actor_id(), p_order.factory_site_id)
      or trim(p_order.preferred_factory_id::text) = public.effective_factory_actor_id()
      or (
        public.effective_factory_actor_id() is not null
        and public.effective_factory_actor_id() = any (public.order_association_factory_ids(p_order))
      )
      or (
        p_order.project_id is not null
        and public.factory_can_access_project(p_order.project_id)
      )
      or coalesce(p_order.rejected_factory_ids, '[]'::jsonb) @> jsonb_build_array(public.effective_factory_actor_id())
    )
  end;
$$;

-- Realtime UPDATE で old レコード比較を可能にする（任意・推奨）
alter table public.orders replica identity full;

-- 工場タブレット: 閲覧可能な注文のみ（factory_can_access_order と同等ロジックをパネル ID で）
drop policy if exists "orders_factory_panel_all" on public.orders;
create policy "orders_factory_panel_all"
  on public.orders
  for all
  to anon
  using (
    public.is_factory_panel_request()
    and public.factory_can_access_order(orders)
  )
  with check (
    public.is_factory_panel_request()
    and public.factory_can_access_order(orders)
  );

drop policy if exists "projects_factory_panel_select" on public.projects;
create policy "projects_factory_panel_select"
  on public.projects
  for select
  to anon
  using (
    public.is_factory_panel_request()
    and public.factory_can_access_project(id)
  );

drop policy if exists "schedules_factory_panel_all" on public.schedules;
create policy "schedules_factory_panel_all"
  on public.schedules
  for all
  to anon
  using (
    public.is_factory_panel_request()
    and public.factory_matches_text(public.current_factory_panel_id(), factory_site_id)
  )
  with check (
    public.is_factory_panel_request()
    and public.factory_matches_text(public.current_factory_panel_id(), factory_site_id)
  );

drop policy if exists "factories_factory_panel_select" on public.factories;
create policy "factories_factory_panel_select"
  on public.factories
  for select
  to anon
  using (public.is_factory_panel_request());

drop policy if exists "customers_factory_panel_select_linked" on public.customers;
create policy "customers_factory_panel_select_linked"
  on public.customers
  for select
  to anon
  using (
    public.is_factory_panel_request()
    and (
      exists (
        select 1
        from public.projects p
        where p.customer_id = customers.id
          and public.factory_can_access_project(p.id)
      )
      or exists (
        select 1
        from public.orders o
        where o.customer_id = customers.id
          and public.factory_can_access_order(o)
      )
    )
  );

drop policy if exists "holidays_factory_panel_select" on public.holidays;
create policy "holidays_factory_panel_select"
  on public.holidays
  for select
  to anon
  using (public.is_factory_panel_request());

drop policy if exists "system_settings_factory_panel_select" on public.system_settings;
create policy "system_settings_factory_panel_select"
  on public.system_settings
  for select
  to anon
  using (public.is_factory_panel_request());

revoke all on function public.current_factory_panel_id() from public;
revoke all on function public.is_factory_panel_request() from public;
grant execute on function public.current_factory_panel_id() to authenticated, anon;
grant execute on function public.is_factory_panel_request() to authenticated, anon;
