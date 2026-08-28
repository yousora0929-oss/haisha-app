-- 業者パネルが、自社の注文に紐づく経由商社（role=agent）の連絡先を SELECT できるようにする。
-- 書き込みは既存ポリシーのまま。orders 側の RLS が既に業者の閲覧範囲を制限するため、
-- その結果に含まれる trading_agent_customer_id だけを customers から読む。

drop policy if exists "customers_contractor_panel_trading_agent_select" on public.customers;
create policy "customers_contractor_panel_trading_agent_select"
  on public.customers
  for select
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'contractor'
    and customers.role = 'agent'
    and exists (
      select 1
      from public.orders o
      where o.trading_agent_customer_id = customers.id
    )
  );

comment on policy "customers_contractor_panel_trading_agent_select" on public.customers is
  'contractor: 閲覧可能な注文の経由商社（trading_agent_customer_id）の連絡先を SELECT。書き込みは本人のみのまま';
