-- =============================================================================
-- 地図（Storage / orders / projects）と納入エリア設定の RLS 修正
-- =============================================================================
-- 問題:
--   1. storage.objects の maps バケットが authenticated のみ → anon キーアプリで
--      地図画像の読み書きが失敗し、地図エディタが真っ白になる
--   2. ゲスト専用発注は orders SELECT のみ → 地図保存（UPDATE）不可
--   3. get_dispatch_operational_settings の anon 実行権限が欠落している環境がある
-- =============================================================================

-- いずれかのパネル（管理・カスタマー・工場・ゲスト）が認証済みか
create or replace function public.is_any_panel_request()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_admin_panel_request()
    or public.is_customer_panel_request()
    or public.is_factory_panel_request()
    or public.is_guest_site_order_panel_request();
$$;

comment on function public.is_any_panel_request() is
  '管理・カスタマー・工場・ゲストのいずれかのパネル認証（ヘッダーまたは Realtime JWT）';

revoke all on function public.is_any_panel_request() from public;
grant execute on function public.is_any_panel_request() to authenticated, anon;

-- ゲスト JWT 対応（Realtime JWT でもゲスト判定できるように）
create or replace function public.is_guest_site_order_panel_request()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.current_site_order_panel_token() is not null;
$$;

-- ---------------------------------------------------------------------------
-- Storage: maps バケット（anon キー + パネル認証）
-- ---------------------------------------------------------------------------
drop policy if exists "maps_read_authenticated" on storage.objects;
drop policy if exists "maps_insert_authenticated" on storage.objects;
drop policy if exists "maps_update_authenticated" on storage.objects;
drop policy if exists "maps_public_read" on storage.objects;
drop policy if exists "maps_public_insert" on storage.objects;
drop policy if exists "maps_public_update" on storage.objects;
drop policy if exists "maps_read_anon" on storage.objects;
drop policy if exists "maps_read_authenticated_v2" on storage.objects;
drop policy if exists "maps_insert_panel" on storage.objects;
drop policy if exists "maps_update_panel" on storage.objects;

create policy "maps_read_anon"
  on storage.objects
  for select
  to anon
  using (bucket_id = 'maps');

create policy "maps_read_authenticated_v2"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'maps');

create policy "maps_insert_panel"
  on storage.objects
  for insert
  to anon
  with check (
    bucket_id = 'maps'
    and public.is_any_panel_request()
  );

create policy "maps_update_panel"
  on storage.objects
  for update
  to anon
  using (
    bucket_id = 'maps'
    and public.is_any_panel_request()
  )
  with check (
    bucket_id = 'maps'
    and public.is_any_panel_request()
  );

-- authenticated ロール（将来 Supabase Auth 利用時）向け
create policy "maps_insert_authenticated_panel"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'maps'
    and (
      public.is_any_panel_request()
      or public.is_app_admin()
      or public.is_app_factory()
      or public.is_app_customer()
    )
  );

create policy "maps_update_authenticated_panel"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'maps'
    and (
      public.is_any_panel_request()
      or public.is_app_admin()
      or public.is_app_factory()
      or public.is_app_customer()
    )
  )
  with check (
    bucket_id = 'maps'
    and (
      public.is_any_panel_request()
      or public.is_app_admin()
      or public.is_app_factory()
      or public.is_app_customer()
    )
  );

-- ---------------------------------------------------------------------------
-- ゲスト: 地図エディタ保存（orders UPDATE）
-- ---------------------------------------------------------------------------
drop policy if exists "orders_guest_site_order_update" on public.orders;
create policy "orders_guest_site_order_update"
  on public.orders
  for update
  to anon
  using (
    public.is_guest_site_order_panel_request()
    and public.guest_can_access_order(orders)
  )
  with check (
    public.is_guest_site_order_panel_request()
    and public.guest_can_access_order(orders)
  );

-- ゲスト: 関連 projects の map_annotations 参照（SELECT は既存ポリシー）
drop policy if exists "projects_guest_site_order_update" on public.projects;
create policy "projects_guest_site_order_update"
  on public.projects
  for update
  to anon
  using (
    public.is_guest_site_order_panel_request()
    and public.guest_can_access_project(id)
  )
  with check (
    public.is_guest_site_order_panel_request()
    and public.guest_can_access_project(id)
  );

-- ---------------------------------------------------------------------------
-- 納入エリア設定 RPC（anon / authenticated 両方から呼べるよう再付与）
-- ---------------------------------------------------------------------------
create or replace function public.get_dispatch_operational_settings()
returns table (
  id integer,
  admin_name text,
  phone_number text,
  allowed_delivery_areas jsonb,
  spot_threshold_volume numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.admin_name,
    s.phone_number,
    coalesce(
      nullif(s.allowed_delivery_areas, '[]'::jsonb),
      '["大分市","由布市","杵築市","別府市","中津市"]'::jsonb
    ),
    s.spot_threshold_volume
  from public.admin_settings s
  where s.id = 1;
$$;

revoke all on function public.get_dispatch_operational_settings() from public;
grant execute on function public.get_dispatch_operational_settings() to anon, authenticated;

comment on function public.get_dispatch_operational_settings() is
  '発注・工場・ゲスト向け運用設定（login_password 非公開、allowed_delivery_areas 空時はデフォルト）';
