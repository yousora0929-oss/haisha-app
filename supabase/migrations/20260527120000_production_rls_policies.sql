-- =============================================================================
-- 本番用 RLS（行単位セキュリティ）— 監査・適用マイグレーション
--
-- 前提:
--   - Supabase Auth を使用し、JWT の auth.uid() でユーザーを識別する
--   - ロール・紐づけ ID は public.app_user_profiles に保持（推奨）
--     または JWT の app_metadata / user_metadata（role, customer_id, factory_id）
--   - 管理者は role=admin のプロファイル、または admin_settings.admin_auth_emails
--     に登録されたメールアドレス（auth.jwt() ->> 'email'）で判定
--
-- 適用前の注意:
--   1. 既存の anon 全許可ポリシーを削除するため、anon キーでの読み書きは不可になる
--   2. 各 Auth ユーザーに app_user_profiles を登録すること
--   3. service_role キーは RLS をバイパスする — サーバー専用に保管すること
--   4. 専用発注 URL（url_token）の未ログインアクセスは別途 Edge Function / RPC が必要
--   5. public.factories.id は text 型（例: 'FACTORY_01'）。app_user_profiles.factory_id も text
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- プロファイル（Auth ユーザー ↔ ロール ↔ 業者 / 工場）
-- -----------------------------------------------------------------------------
create table if not exists public.app_user_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  role text not null check (role in ('customer', 'factory', 'admin')),
  customer_id uuid references public.customers (id) on delete set null,
  factory_id text references public.factories (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_user_profiles_role_refs check (
    (role = 'customer' and customer_id is not null and factory_id is null)
    or (role = 'factory' and factory_id is not null and customer_id is null)
    or (role = 'admin' and customer_id is null and factory_id is null)
  )
);

comment on table public.app_user_profiles is 'Supabase Auth ユーザーとアプリロール（customer / factory / admin）の紐づけ';

create index if not exists app_user_profiles_customer_id_idx
  on public.app_user_profiles (customer_id)
  where customer_id is not null;

create index if not exists app_user_profiles_factory_id_idx
  on public.app_user_profiles (factory_id)
  where factory_id is not null;

create index if not exists app_user_profiles_role_idx on public.app_user_profiles (role);

-- 過去に uuid 型で作成された factory_id を text に矯正（factories.id が text の環境向け）
do $$
begin
  if exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = 'app_user_profiles'
      and c.column_name = 'factory_id'
      and c.udt_name = 'uuid'
  ) then
    alter table public.app_user_profiles drop constraint if exists app_user_profiles_factory_id_fkey;
    alter table public.app_user_profiles
      alter column factory_id type text using factory_id::text;
    alter table public.app_user_profiles
      add constraint app_user_profiles_factory_id_fkey
      foreign key (factory_id) references public.factories (id) on delete set null;
  end if;
end $$;

-- 管理者メール許可リスト（JWT email フォールバック用）
alter table public.admin_settings
  add column if not exists admin_auth_emails text[] not null default '{}'::text[];

comment on column public.admin_settings.admin_auth_emails is
  '管理者として扱うメールアドレス（auth.jwt email と照合・app_user_profiles 未設定時のフォールバック）';

-- -----------------------------------------------------------------------------
-- RLS ヘルパー関数（SECURITY DEFINER — プロファイル参照）
--
-- 【重要】CREATE POLICY より必ず先に実行すること。
-- is_app_admin() は app_role() に依存。factory_can_access_* は is_app_admin() に依存。
-- -----------------------------------------------------------------------------
create or replace function public.app_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.role from public.app_user_profiles p where p.user_id = auth.uid()),
    nullif(auth.jwt() -> 'app_metadata' ->> 'role', ''),
    nullif(auth.jwt() -> 'user_metadata' ->> 'role', ''),
    'none'
  );
$$;

comment on function public.app_role() is '現在ユーザーのアプリロール（customer / factory / admin / none）';

create or replace function public.current_customer_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.customer_id from public.app_user_profiles p where p.user_id = auth.uid() and p.role = 'customer'),
    nullif(auth.jwt() -> 'app_metadata' ->> 'customer_id', '')::uuid,
    nullif(auth.jwt() -> 'user_metadata' ->> 'customer_id', '')::uuid
  );
$$;

create or replace function public.current_factory_id()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(trim(p.factory_id), '') from public.app_user_profiles p where p.user_id = auth.uid() and p.role = 'factory'),
    nullif(trim(auth.jwt() -> 'app_metadata' ->> 'factory_id'), ''),
    nullif(trim(auth.jwt() -> 'user_metadata' ->> 'factory_id'), '')
  );
$$;

comment on function public.current_factory_id() is
  '現在ユーザーの工場 ID（factories.id と同じ text 型。例: FACTORY_01）';

create or replace function public.is_app_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when public.app_role() = 'admin' then true
    when lower(coalesce(auth.jwt() ->> 'email', '')) = any (
      select lower(trim(e))
      from unnest(coalesce((select s.admin_auth_emails from public.admin_settings s where s.id = 1), '{}'::text[])) as e
      where trim(e) <> ''
    ) then true
    else false
  end;
$$;

comment on function public.is_app_admin() is
  '管理者判定: app_user_profiles.role=admin または admin_settings.admin_auth_emails に JWT email が含まれる';

create or replace function public.is_app_customer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_role() = 'customer' and public.current_customer_id() is not null;
$$;

create or replace function public.is_app_factory()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.app_role() = 'factory' and public.current_factory_id() is not null;
$$;

drop function if exists public.factory_matches_text(uuid, text);

create or replace function public.factory_matches_text(p_factory_id text, p_site_text text)
returns boolean
language sql
immutable
as $$
  select nullif(trim(p_factory_id), '') is not null
    and p_site_text is not null
    and trim(p_site_text) <> ''
    and trim(p_factory_id) = trim(p_site_text);
$$;

-- 工場が物件マスタを閲覧・更新できるか（main_factory_id / sub_factory_ids）
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
    when not public.is_app_factory() then false
    else exists (
      select 1
      from public.projects p
      where p.id = p_project_id
        and (
          trim(p.main_factory_id::text) = public.current_factory_id()
          or coalesce(p.sub_factory_ids, '[]'::jsonb) @> jsonb_build_array(public.current_factory_id())
        )
    )
  end;
$$;

-- 組合承認で指定された手配先工場 ID（order_data）
create or replace function public.order_association_factory_ids(p_order public.orders)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select array_agg(distinct trim(x))
      from (
        select jsonb_array_elements_text(
          coalesce(p_order.order_data->'association_assigned_factory_ids', '[]'::jsonb)
        ) as x
        union all
        select jsonb_array_elements_text(
          coalesce(p_order.order_data->'associationAssignedFactoryIds', '[]'::jsonb)
        ) as x
      ) s
      where nullif(trim(x), '') is not null
    ),
    array[]::text[]
  );
$$;

-- 工場が注文を閲覧・更新できるか（受注工場・希望工場・組合指定・物件紐づけ・見送り履歴）
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
    when not public.is_app_factory() then false
    when p_order.status = 'pending_association' then false
    else (
      public.factory_matches_text(public.current_factory_id(), p_order.factory_site_id)
      or trim(p_order.preferred_factory_id::text) = public.current_factory_id()
      or (
        public.current_factory_id() is not null
        and public.current_factory_id() = any (public.order_association_factory_ids(p_order))
      )
      or (
        p_order.project_id is not null
        and public.factory_can_access_project(p_order.project_id)
      )
      or coalesce(p_order.rejected_factory_ids, '[]'::jsonb) @> jsonb_build_array(public.current_factory_id())
    )
  end;
$$;

-- 顧客が自分の業者 ID に紐づく行か
create or replace function public.customer_owns_row(p_customer_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_app_customer()
    and p_customer_id is not null
    and p_customer_id = public.current_customer_id();
$$;

revoke all on function public.app_role() from public;
revoke all on function public.current_customer_id() from public;
revoke all on function public.current_factory_id() from public;
revoke all on function public.is_app_admin() from public;
revoke all on function public.is_app_customer() from public;
revoke all on function public.is_app_factory() from public;
revoke all on function public.factory_matches_text(text, text) from public;
revoke all on function public.factory_can_access_project(uuid) from public;
revoke all on function public.order_association_factory_ids(public.orders) from public;
revoke all on function public.factory_can_access_order(public.orders) from public;
revoke all on function public.customer_owns_row(uuid) from public;

grant execute on function public.app_role() to authenticated;
grant execute on function public.current_customer_id() to authenticated;
grant execute on function public.current_factory_id() to authenticated;
grant execute on function public.is_app_admin() to authenticated;
grant execute on function public.is_app_customer() to authenticated;
grant execute on function public.is_app_factory() to authenticated;
grant execute on function public.factory_matches_text(text, text) to authenticated;
grant execute on function public.factory_can_access_project(uuid) to authenticated;
grant execute on function public.order_association_factory_ids(public.orders) to authenticated;
grant execute on function public.factory_can_access_order(public.orders) to authenticated;
grant execute on function public.customer_owns_row(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- app_user_profiles RLS
-- -----------------------------------------------------------------------------
alter table public.app_user_profiles enable row level security;

drop policy if exists "app_user_profiles_select_own" on public.app_user_profiles;
drop policy if exists "app_user_profiles_update_own" on public.app_user_profiles;
drop policy if exists "app_user_profiles_admin_all" on public.app_user_profiles;

create policy "app_user_profiles_select_own"
  on public.app_user_profiles
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_app_admin());

create policy "app_user_profiles_update_own"
  on public.app_user_profiles
  for update
  to authenticated
  using (user_id = auth.uid() or public.is_app_admin())
  with check (user_id = auth.uid() or public.is_app_admin());

create policy "app_user_profiles_admin_insert"
  on public.app_user_profiles
  for insert
  to authenticated
  with check (public.is_app_admin());

create policy "app_user_profiles_admin_delete"
  on public.app_user_profiles
  for delete
  to authenticated
  using (public.is_app_admin());

-- -----------------------------------------------------------------------------
-- 旧ポリシー削除（プロトタイプ: anon / authenticated 全許可）
-- -----------------------------------------------------------------------------
-- orders
drop policy if exists "orders_select_anon" on public.orders;
drop policy if exists "orders_insert_anon" on public.orders;
drop policy if exists "orders_update_anon" on public.orders;
drop policy if exists "orders_delete_anon" on public.orders;
drop policy if exists "orders_select_auth" on public.orders;
drop policy if exists "orders_insert_auth" on public.orders;
drop policy if exists "orders_update_auth" on public.orders;
drop policy if exists "orders_delete_auth" on public.orders;

-- schedules
drop policy if exists "schedules_select_anon" on public.schedules;
drop policy if exists "schedules_insert_anon" on public.schedules;
drop policy if exists "schedules_update_anon" on public.schedules;
drop policy if exists "schedules_delete_anon" on public.schedules;
drop policy if exists "schedules_select_auth" on public.schedules;
drop policy if exists "schedules_insert_auth" on public.schedules;
drop policy if exists "schedules_update_auth" on public.schedules;
drop policy if exists "schedules_delete_auth" on public.schedules;

-- projects
drop policy if exists "projects_select_anon" on public.projects;
drop policy if exists "projects_insert_anon" on public.projects;
drop policy if exists "projects_update_anon" on public.projects;
drop policy if exists "projects_delete_anon" on public.projects;
drop policy if exists "projects_select_auth" on public.projects;
drop policy if exists "projects_insert_auth" on public.projects;
drop policy if exists "projects_update_auth" on public.projects;
drop policy if exists "projects_delete_auth" on public.projects;

-- holidays
drop policy if exists "holidays_select_anon" on public.holidays;
drop policy if exists "holidays_insert_anon" on public.holidays;
drop policy if exists "holidays_update_anon" on public.holidays;
drop policy if exists "holidays_delete_anon" on public.holidays;
drop policy if exists "holidays_select_auth" on public.holidays;
drop policy if exists "holidays_insert_auth" on public.holidays;
drop policy if exists "holidays_update_auth" on public.holidays;
drop policy if exists "holidays_delete_auth" on public.holidays;

-- system_settings
drop policy if exists "system_settings_select_anon" on public.system_settings;
drop policy if exists "system_settings_insert_anon" on public.system_settings;
drop policy if exists "system_settings_update_anon" on public.system_settings;
drop policy if exists "system_settings_delete_anon" on public.system_settings;
drop policy if exists "system_settings_select_auth" on public.system_settings;
drop policy if exists "system_settings_insert_auth" on public.system_settings;
drop policy if exists "system_settings_update_auth" on public.system_settings;
drop policy if exists "system_settings_delete_auth" on public.system_settings;

-- customers
drop policy if exists "customers_select_anon" on public.customers;
drop policy if exists "customers_insert_anon" on public.customers;
drop policy if exists "customers_update_anon" on public.customers;
drop policy if exists "customers_delete_anon" on public.customers;
drop policy if exists "customers_select_auth" on public.customers;
drop policy if exists "customers_insert_auth" on public.customers;
drop policy if exists "customers_update_auth" on public.customers;
drop policy if exists "customers_delete_auth" on public.customers;

-- admin_settings
drop policy if exists "admin_settings_select_anon" on public.admin_settings;
drop policy if exists "admin_settings_insert_anon" on public.admin_settings;
drop policy if exists "admin_settings_update_anon" on public.admin_settings;
drop policy if exists "admin_settings_select_auth" on public.admin_settings;
drop policy if exists "admin_settings_insert_auth" on public.admin_settings;
drop policy if exists "admin_settings_update_auth" on public.admin_settings;

-- factories（既存の緩いポリシーがあれば削除）
drop policy if exists "factories_select_anon" on public.factories;
drop policy if exists "factories_insert_anon" on public.factories;
drop policy if exists "factories_update_anon" on public.factories;
drop policy if exists "factories_delete_anon" on public.factories;
drop policy if exists "factories_select_auth" on public.factories;
drop policy if exists "factories_insert_auth" on public.factories;
drop policy if exists "factories_update_auth" on public.factories;
drop policy if exists "factories_delete_auth" on public.factories;

-- -----------------------------------------------------------------------------
-- RLS 有効化（主要テーブル）
-- -----------------------------------------------------------------------------
alter table public.orders enable row level security;
alter table public.projects enable row level security;
alter table public.customers enable row level security;
alter table public.schedules enable row level security;
alter table public.holidays enable row level security;
alter table public.system_settings enable row level security;
alter table public.admin_settings enable row level security;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'factories'
  ) then
    execute 'alter table public.factories enable row level security';
  end if;
end $$;

-- =============================================================================
-- orders
-- =============================================================================
create policy "orders_admin_all"
  on public.orders
  for all
  to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

create policy "orders_customer_select"
  on public.orders
  for select
  to authenticated
  using (public.customer_owns_row(customer_id));

create policy "orders_customer_insert"
  on public.orders
  for insert
  to authenticated
  with check (public.customer_owns_row(customer_id));

create policy "orders_customer_update"
  on public.orders
  for update
  to authenticated
  using (public.customer_owns_row(customer_id))
  with check (public.customer_owns_row(customer_id));

create policy "orders_customer_delete"
  on public.orders
  for delete
  to authenticated
  using (public.customer_owns_row(customer_id));

create policy "orders_factory_select"
  on public.orders
  for select
  to authenticated
  using (public.factory_can_access_order(orders));

create policy "orders_factory_update"
  on public.orders
  for update
  to authenticated
  using (public.factory_can_access_order(orders))
  with check (public.factory_can_access_order(orders));

-- =============================================================================
-- projects
-- =============================================================================
create policy "projects_admin_all"
  on public.projects
  for all
  to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

create policy "projects_customer_select"
  on public.projects
  for select
  to authenticated
  using (public.customer_owns_row(customer_id));

create policy "projects_customer_insert"
  on public.projects
  for insert
  to authenticated
  with check (public.customer_owns_row(customer_id));

create policy "projects_customer_update"
  on public.projects
  for update
  to authenticated
  using (public.customer_owns_row(customer_id))
  with check (public.customer_owns_row(customer_id));

create policy "projects_customer_delete"
  on public.projects
  for delete
  to authenticated
  using (public.customer_owns_row(customer_id));

create policy "projects_factory_select"
  on public.projects
  for select
  to authenticated
  using (public.factory_can_access_project(id));

create policy "projects_factory_update"
  on public.projects
  for update
  to authenticated
  using (public.factory_can_access_project(id))
  with check (public.factory_can_access_project(id));

-- =============================================================================
-- customers（業者マスタ）
-- =============================================================================
create policy "customers_admin_all"
  on public.customers
  for all
  to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

create policy "customers_self_select"
  on public.customers
  for select
  to authenticated
  using (public.customer_owns_row(id));

create policy "customers_self_update"
  on public.customers
  for update
  to authenticated
  using (public.customer_owns_row(id))
  with check (public.customer_owns_row(id));

-- 工場: 担当物件・注文に紐づく業者のみ参照可（連絡先表示用）
create policy "customers_factory_select_linked"
  on public.customers
  for select
  to authenticated
  using (
    public.is_app_factory()
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

-- =============================================================================
-- factories（工場マスタ — テーブル存在時）
-- =============================================================================
do $$
begin
  if not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'factories'
  ) then
    return;
  end if;

  execute $pol$
    create policy "factories_admin_all"
      on public.factories
      for all
      to authenticated
      using (public.is_app_admin())
      with check (public.is_app_admin())
  $pol$;

  execute $pol$
    create policy "factories_self_select"
      on public.factories
      for select
      to authenticated
      using (public.is_app_factory() and id = public.current_factory_id())
  $pol$;

  -- 発注画面で工場名一覧が必要なため、顧客は参照のみ全件可（login_password はアプリ側で select しないこと）
  execute $pol$
    create policy "factories_customer_select"
      on public.factories
      for select
      to authenticated
      using (public.is_app_customer())
  $pol$;

  execute $pol$
    create policy "factories_factory_select_peers"
      on public.factories
      for select
      to authenticated
      using (public.is_app_factory())
  $pol$;
end $$;

-- =============================================================================
-- schedules（工場スケジュール）
-- =============================================================================
create policy "schedules_admin_all"
  on public.schedules
  for all
  to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

create policy "schedules_factory_select"
  on public.schedules
  for select
  to authenticated
  using (
    public.is_app_factory()
    and public.factory_matches_text(public.current_factory_id(), factory_site_id)
  );

create policy "schedules_factory_insert"
  on public.schedules
  for insert
  to authenticated
  with check (
    public.is_app_factory()
    and public.factory_matches_text(public.current_factory_id(), factory_site_id)
  );

create policy "schedules_factory_update"
  on public.schedules
  for update
  to authenticated
  using (
    public.is_app_factory()
    and public.factory_matches_text(public.current_factory_id(), factory_site_id)
  )
  with check (
    public.is_app_factory()
    and public.factory_matches_text(public.current_factory_id(), factory_site_id)
  );

create policy "schedules_factory_delete"
  on public.schedules
  for delete
  to authenticated
  using (
    public.is_app_factory()
    and public.factory_matches_text(public.current_factory_id(), factory_site_id)
  );

-- 顧客・工場: 稼働確認のため参照のみ（全工場分 — 必要なら工場 ID で絞る運用に変更可）
create policy "schedules_read_customer"
  on public.schedules
  for select
  to authenticated
  using (public.is_app_customer());

-- =============================================================================
-- holidays / system_settings（参照: 全ロール、更新: 管理者のみ）
-- =============================================================================
create policy "holidays_select_authenticated"
  on public.holidays
  for select
  to authenticated
  using (auth.uid() is not null);

create policy "holidays_admin_write"
  on public.holidays
  for all
  to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

create policy "system_settings_select_authenticated"
  on public.system_settings
  for select
  to authenticated
  using (auth.uid() is not null);

create policy "system_settings_admin_write"
  on public.system_settings
  for all
  to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

-- 発注画面向け: パスワードを含まない運用設定のみ（SECURITY DEFINER）
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
    s.allowed_delivery_areas,
    s.spot_threshold_volume
  from public.admin_settings s
  where s.id = 1;
$$;

revoke all on function public.get_dispatch_operational_settings() from public;
grant execute on function public.get_dispatch_operational_settings() to authenticated;

comment on function public.get_dispatch_operational_settings() is
  '顧客・工場向け運用設定（login_password を返さない）。発注アプリは rpc または列限定 select に移行すること';

-- =============================================================================
-- admin_settings（管理者のみフルアクセス。login_password 等を含む）
-- =============================================================================
create policy "admin_settings_admin_all"
  on public.admin_settings
  for all
  to authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

-- =============================================================================
-- Storage: maps バケット（本番向けに緩和ポリシーを置き換え）
-- =============================================================================
drop policy if exists "maps_public_read" on storage.objects;
drop policy if exists "maps_public_insert" on storage.objects;
drop policy if exists "maps_public_update" on storage.objects;

create policy "maps_read_authenticated"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'maps');

create policy "maps_insert_authenticated"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'maps'
    and (public.is_app_admin() or public.is_app_factory() or public.is_app_customer())
  );

create policy "maps_update_authenticated"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'maps'
    and (public.is_app_admin() or public.is_app_factory() or public.is_app_customer())
  )
  with check (
    bucket_id = 'maps'
    and (public.is_app_admin() or public.is_app_factory() or public.is_app_customer())
  );

create policy "maps_delete_admin"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'maps' and public.is_app_admin());

-- -----------------------------------------------------------------------------
-- 運用メモ（SQL コメント）
-- -----------------------------------------------------------------------------
-- 例: 管理者ユーザーの登録
--   insert into public.app_user_profiles (user_id, role)
--   values ('<auth.users.id>', 'admin');
--
-- 例: 業者ログインユーザー
--   insert into public.app_user_profiles (user_id, role, customer_id)
--   values ('<auth.users.id>', 'customer', '<customers.id>');
--
-- 例: 工場タブレットユーザー
--   insert into public.app_user_profiles (user_id, role, factory_id)
--   values ('<auth.users.id>', 'factory', '<factories.id>');
--
-- 例: メールで管理者判定
--   update public.admin_settings
--   set admin_auth_emails = array['admin@example.com']
--   where id = 1;
