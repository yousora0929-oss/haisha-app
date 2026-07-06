-- チャーター車両募集 Phase 2: 募集・優先通知リスト

-- =============================================================================
-- 1. charter_requests（工場が出す募集）
-- =============================================================================
create table if not exists public.charter_requests (
  id uuid primary key default gen_random_uuid(),
  requesting_factory_id text not null references public.factories (id),
  request_date date not null,
  vehicle_type text not null check (vehicle_type in ('large', 'small')),
  desired_count integer not null check (desired_count > 0),
  note text,
  status text not null default 'open' check (status in ('open', 'matched', 'closed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_charter_requests_factory on public.charter_requests (requesting_factory_id, request_date);

comment on table public.charter_requests is '工場が出す出荷過多日のチャーター車両募集';

-- =============================================================================
-- 2. charter_notification_preferences（優先通知リスト）
-- =============================================================================
create table if not exists public.charter_notification_preferences (
  id uuid primary key default gen_random_uuid(),
  factory_id text not null references public.factories (id),
  target_type text not null check (target_type in ('factory', 'charter_operator')),
  target_id text not null,
  priority_order integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (factory_id, target_type, target_id)
);

create index if not exists idx_charter_notif_pref_factory on public.charter_notification_preferences (factory_id, priority_order);

comment on table public.charter_notification_preferences is
  '工場ごとの通知優先順位（ドラッグ並べ替えで設定。priority_orderが小さいほど先に通知）';

-- =============================================================================
-- 3. RLS
-- =============================================================================
alter table public.charter_requests enable row level security;
alter table public.charter_notification_preferences enable row level security;

grant select, insert, update, delete on public.charter_requests to anon, authenticated;
grant select, insert, update, delete on public.charter_notification_preferences to anon, authenticated;

drop policy if exists "charter_requests_admin_panel" on public.charter_requests;
create policy "charter_requests_admin_panel"
  on public.charter_requests
  for all
  to anon
  using (public.is_admin_panel_request())
  with check (public.is_admin_panel_request());

drop policy if exists "charter_requests_factory_own" on public.charter_requests;
create policy "charter_requests_factory_own"
  on public.charter_requests
  for all
  to anon
  using (
    public.is_factory_panel_request()
    and requesting_factory_id = public.current_factory_panel_id()
  )
  with check (
    public.is_factory_panel_request()
    and requesting_factory_id = public.current_factory_panel_id()
  );

drop policy if exists "charter_notif_pref_admin_panel" on public.charter_notification_preferences;
create policy "charter_notif_pref_admin_panel"
  on public.charter_notification_preferences
  for all
  to anon
  using (public.is_admin_panel_request())
  with check (public.is_admin_panel_request());

drop policy if exists "charter_notif_pref_factory_own" on public.charter_notification_preferences;
create policy "charter_notif_pref_factory_own"
  on public.charter_notification_preferences
  for all
  to anon
  using (
    public.is_factory_panel_request()
    and factory_id = public.current_factory_panel_id()
  )
  with check (
    public.is_factory_panel_request()
    and factory_id = public.current_factory_panel_id()
  );

-- 工場: 通知優先リスト設定用に active なチャーター業者名を参照可
drop policy if exists "charter_operators_factory_select_active" on public.charter_operators;
create policy "charter_operators_factory_select_active"
  on public.charter_operators
  for select
  to anon
  using (
    public.is_factory_panel_request()
    and status = 'active'
  );
