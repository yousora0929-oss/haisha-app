-- 商社担当者と業者の取引関係（多対多）
create table if not exists public.agent_contractor_links (
  id uuid primary key default gen_random_uuid(),
  agent_customer_id uuid not null
    references public.customers (id) on delete cascade,
  contractor_customer_id uuid not null
    references public.customers (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (agent_customer_id, contractor_customer_id)
);

comment on table public.agent_contractor_links is
  '商社担当者（role=agent）と業者（role=contractor）の取引関係。DispatchApp代理発注の業者絞り込みとAdminApp管理に使用';

create index if not exists agent_contractor_links_agent_idx
  on public.agent_contractor_links (agent_customer_id);

create index if not exists agent_contractor_links_contractor_idx
  on public.agent_contractor_links (contractor_customer_id);

alter table public.agent_contractor_links enable row level security;

grant select, insert, delete on public.agent_contractor_links to anon, authenticated;

-- =============================================================
-- RLS (a): 顧客パネル（組合・商社）からの SELECT
-- Phase 1 customers_cooperative_panel_agents_select と同系ヘルパー
-- =============================================================
create policy "agent_contractor_links_panel_select"
  on public.agent_contractor_links
  for select
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_role() in ('cooperative', 'agent')
  );

-- =============================================================
-- RLS (b): AdminApp CRUD（SELECT / INSERT / DELETE）
-- 参照: organizations_admin_all
--   (supabase/migrations/20260627000300_organizations_admin_panel_rls.sql)
-- ヘルパー: is_admin_panel_request() / is_app_admin()
-- UPDATE は運用上不要だが、既存の for all パターンに合わせる
-- =============================================================
create policy "agent_contractor_links_admin_all"
  on public.agent_contractor_links
  for all
  to anon, authenticated
  using (public.is_admin_panel_request() or public.is_app_admin())
  with check (public.is_admin_panel_request() or public.is_app_admin());
