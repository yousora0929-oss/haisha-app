-- =============================================================================
-- 組合承認: 複数工場割当の RLS 対応
--
-- SQL Editor で単体実行する場合も、本ファイル1本で完結します。
-- 先頭で RLS ヘルパー（is_app_admin 等）を idempotent に定義してから
-- factory_can_access_order を更新します。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 前提スキーマ（未適用環境向け・idempotent）
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

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

alter table public.admin_settings
  add column if not exists admin_auth_emails text[] not null default '{}'::text[];

-- -----------------------------------------------------------------------------
-- RLS ヘルパー関数（依存順: app_role → is_app_admin → 他）
-- ポリシーや factory_can_access_order より必ず先に定義すること
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

-- -----------------------------------------------------------------------------
-- 組合指定工場 ID 一覧（order_data）
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 工場が注文を閲覧・更新できるか（組合指定工場・pending_association 除外）
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 権限（authenticated のみ execute）
-- -----------------------------------------------------------------------------
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
