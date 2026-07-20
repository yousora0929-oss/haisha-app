-- 三層代理発注: 組合 → 商社（担当者個人） → 業者
-- orders に経由商社担当者の参照列を追加
alter table public.orders
  add column if not exists trading_agent_customer_id uuid
    references public.customers (id) on delete set null;
comment on column public.orders.trading_agent_customer_id is
  '組合が商社経由で代理発注した際の経由商社担当者（customers.id, role=agent）。それ以外の発注パターンではNULL。受注確定通知の宛先に含まれる';
create index if not exists orders_trading_agent_customer_id_idx
  on public.orders (trading_agent_customer_id)
  where trading_agent_customer_id is not null;

-- =============================================================
-- RLS: 組合（cooperative）が商社担当者（role='agent'）の customers を
-- 選択肢として取得できるようにする
-- 既存の customers_agent_panel_contractors_select（contractor限定）は変更しない
-- =============================================================
create policy "customers_cooperative_panel_agents_select"
  on public.customers
  for select
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'cooperative'
    and role = 'agent'
  );
