-- エスカレーション容量スコアリング: 工場別月間出荷量・距離/容量ウェイト設定

-- 1. factory_escalation_steps に当月出荷m³カラムを追加
alter table public.factory_escalation_steps
  add column if not exists monthly_volume_m3 numeric default null;

comment on column public.factory_escalation_steps.monthly_volume_m3 is
  '管理者が手動入力する当月出荷m³';

-- 2. 距離/容量ウェイト設定（シングルトン）
create table if not exists public.factory_escalation_weight_config (
  id integer primary key default 1,
  distance_weight numeric not null default 0.7,
  updated_at timestamptz not null default now(),
  constraint factory_escalation_weight_config_singleton check (id = 1),
  constraint factory_escalation_weight_config_distance_weight_range check (
    distance_weight >= 0.0 and distance_weight <= 1.0
  )
);

comment on table public.factory_escalation_weight_config is
  'エスカレーション距離/容量スコアリングのウェイト設定（id=1 固定）';
comment on column public.factory_escalation_weight_config.distance_weight is
  '距離スコアの重み（0.0〜1.0。残りは容量スコア）';

insert into public.factory_escalation_weight_config (id, distance_weight, updated_at)
values (1, 0.7, now())
on conflict (id) do nothing;

-- 3. RLS
alter table public.factory_escalation_weight_config enable row level security;

drop policy if exists "factory_escalation_weight_config_admin" on public.factory_escalation_weight_config;
create policy "factory_escalation_weight_config_admin"
  on public.factory_escalation_weight_config
  for all
  to anon, authenticated
  using (public.is_admin_panel_request() or public.is_app_admin())
  with check (public.is_admin_panel_request() or public.is_app_admin());

drop policy if exists "factory_escalation_weight_config_factory_select" on public.factory_escalation_weight_config;
create policy "factory_escalation_weight_config_factory_select"
  on public.factory_escalation_weight_config
  for select
  to anon, authenticated
  using (public.is_app_factory());

drop policy if exists "factory_escalation_weight_config_customer_select" on public.factory_escalation_weight_config;
create policy "factory_escalation_weight_config_customer_select"
  on public.factory_escalation_weight_config
  for select
  to anon, authenticated
  using (public.is_app_customer());

-- 4. factory_escalation_steps.monthly_volume_m3 は既存 RLS（admin all / factory select）を継承するため変更不要

-- migration: escalation_capacity_scoring
