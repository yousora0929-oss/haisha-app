-- マルチティア発注モデル: 業者直接発注・商社代理発注・組合代理発注

-- =============================================================================
-- 1. organizations（商社・組合マスタ）
-- =============================================================================
create table if not exists public.organizations (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  type             text not null check (type in ('agent', 'cooperative')),
  cooperative_id   uuid references public.organizations (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

comment on table public.organizations is '商社（agent）・組合（cooperative）の組織マスタ';
comment on column public.organizations.type is 'agent=商社, cooperative=組合';
comment on column public.organizations.cooperative_id is '商社が所属する組合のid（組合の場合はNULL）';

create index if not exists organizations_type_idx on public.organizations (type);
create index if not exists organizations_cooperative_id_idx on public.organizations (cooperative_id)
  where cooperative_id is not null;

create or replace function public.set_organizations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_organizations_updated_at on public.organizations;
create trigger trg_organizations_updated_at
  before update on public.organizations
  for each row
  execute function public.set_organizations_updated_at();

alter table public.organizations enable row level security;

drop policy if exists "organizations_admin_all" on public.organizations;
create policy "organizations_admin_all"
  on public.organizations
  for all
  to anon, authenticated
  using (public.is_app_admin())
  with check (public.is_app_admin());

drop policy if exists "organizations_customer_panel_select" on public.organizations;
create policy "organizations_customer_panel_select"
  on public.organizations
  for select
  to anon, authenticated
  using (public.is_customer_panel_request());

drop policy if exists "organizations_factory_panel_select" on public.organizations;
create policy "organizations_factory_panel_select"
  on public.organizations
  for select
  to anon, authenticated
  using (public.is_factory_panel_request());

grant select, insert, update, delete on public.organizations to anon, authenticated;

-- =============================================================================
-- 2. customers へのカラム追加
-- =============================================================================
alter table public.customers
  add column if not exists role text default 'contractor',
  add column if not exists organization_id uuid references public.organizations (id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'customers_role_check'
      and conrelid = 'public.customers'::regclass
  ) then
    alter table public.customers
      add constraint customers_role_check
      check (role in ('contractor', 'agent', 'cooperative'));
  end if;
end $$;

comment on column public.customers.role is
  'contractor=業者（直接発注）, agent=商社担当者, cooperative=組合担当者';
comment on column public.customers.organization_id is
  'agentまたはcooperativeの場合、所属するorganizations.id';

create index if not exists customers_organization_id_idx on public.customers (organization_id)
  where organization_id is not null;
create index if not exists customers_role_idx on public.customers (role);

-- =============================================================================
-- 3. orders へのカラム追加
-- =============================================================================
alter table public.orders
  add column if not exists contractor_customer_id uuid references public.customers (id) on delete set null,
  add column if not exists agent_organization_id uuid references public.organizations (id) on delete set null;

comment on column public.orders.contractor_customer_id is
  '代理発注時の納品責任業者（contractor）。直接発注時はNULL（customer_idが業者本人）';
comment on column public.orders.agent_organization_id is
  '代理発注した商社または組合のorganizations.id。直接発注時はNULL';

create index if not exists orders_contractor_customer_id_idx on public.orders (contractor_customer_id)
  where contractor_customer_id is not null;
create index if not exists orders_agent_organization_id_idx on public.orders (agent_organization_id)
  where agent_organization_id is not null;

-- =============================================================================
-- 4. RLS ヘルパー関数
-- =============================================================================
create or replace function public.current_customer_role()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  select role into v_role
  from public.customers
  where id = public.current_customer_panel_id()
  limit 1;
  return v_role;
exception
  when others then
    return null;
end;
$$;

create or replace function public.current_customer_organization_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org_id uuid;
begin
  select organization_id into v_org_id
  from public.customers
  where id = public.current_customer_panel_id()
  limit 1;
  return v_org_id;
exception
  when others then
    return null;
end;
$$;

comment on function public.current_customer_role() is 'ログイン中カスタマーパネルの customers.role';
comment on function public.current_customer_organization_id() is 'ログイン中カスタマーパネルの customers.organization_id';

revoke all on function public.current_customer_role() from public;
revoke all on function public.current_customer_organization_id() from public;
grant execute on function public.current_customer_role() to authenticated, anon;
grant execute on function public.current_customer_organization_id() to authenticated, anon;

-- =============================================================================
-- 5. orders の RLS ポリシー更新
-- =============================================================================
drop policy if exists "orders_customer_panel_all" on public.orders;

drop policy if exists "orders_contractor_panel_all" on public.orders;
create policy "orders_contractor_panel_all"
  on public.orders
  for all
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'contractor'
    and (
      customer_id = public.current_customer_panel_id()
      or contractor_customer_id = public.current_customer_panel_id()
    )
  )
  with check (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'contractor'
    and customer_id = public.current_customer_panel_id()
  );

drop policy if exists "orders_agent_panel_all" on public.orders;
create policy "orders_agent_panel_all"
  on public.orders
  for all
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'agent'
    and customer_id = public.current_customer_panel_id()
  )
  with check (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'agent'
    and customer_id = public.current_customer_panel_id()
  );

drop policy if exists "orders_cooperative_panel_select" on public.orders;
create policy "orders_cooperative_panel_select"
  on public.orders
  for select
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'cooperative'
    and (
      exists (
        select 1
        from public.customers c
        where c.id = orders.contractor_customer_id
          and c.organization_id = public.current_customer_organization_id()
      )
      or exists (
        select 1
        from public.customers c
        where c.id = orders.customer_id
          and c.role = 'contractor'
          and c.organization_id = public.current_customer_organization_id()
      )
      or exists (
        select 1
        from public.customers c
        where c.id = orders.customer_id
          and c.role = 'agent'
          and c.organization_id = public.current_customer_organization_id()
      )
    )
  );

-- =============================================================================
-- 6. projects の RLS ポリシー更新
-- =============================================================================
drop policy if exists "projects_customer_panel_all" on public.projects;

drop policy if exists "projects_contractor_panel_all" on public.projects;
create policy "projects_contractor_panel_all"
  on public.projects
  for all
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'contractor'
    and customer_id = public.current_customer_panel_id()
  )
  with check (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'contractor'
    and customer_id = public.current_customer_panel_id()
  );

drop policy if exists "projects_agent_panel_select" on public.projects;
create policy "projects_agent_panel_select"
  on public.projects
  for select
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'agent'
  );

drop policy if exists "projects_cooperative_panel_select" on public.projects;
create policy "projects_cooperative_panel_select"
  on public.projects
  for select
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'cooperative'
    and exists (
      select 1
      from public.customers c
      where c.id = projects.customer_id
        and c.organization_id = public.current_customer_organization_id()
    )
  );

-- search_path 固定（Supabase Advisor 対応）
alter function public.set_organizations_updated_at()
  set search_path = public, extensions;

-- migration: multi_tier_ordering_schema
