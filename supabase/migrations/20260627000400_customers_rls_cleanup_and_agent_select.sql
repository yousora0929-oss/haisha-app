-- ============================================================
-- 1. 危険な旧ポリシー削除
-- ============================================================
drop policy if exists "customers_select_anon"  on public.customers;
drop policy if exists "customers_update_anon"  on public.customers;
drop policy if exists "customers_delete_anon"  on public.customers;
drop policy if exists "customers_update_auth"  on public.customers;
drop policy if exists "customers_delete_auth"  on public.customers;
drop policy if exists "customers_insert_anon"  on public.customers;
drop policy if exists "customers_insert_auth"  on public.customers;

-- ============================================================
-- 2. agent/cooperative が contractor 一覧を取得できるポリシー
-- ============================================================
-- agent/cooperative は role='contractor' の customers を全件SELECT可
-- （代理発注先業者の選択肢として使用）
create policy "customers_agent_panel_contractors_select"
  on public.customers
  for select
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_role() in ('agent', 'cooperative')
    and role = 'contractor'
  );

-- ============================================================
-- 3. 既存の customers_customer_panel_select を拡張
--    （自分自身のレコードも引き続き取得できるよう維持）
-- ============================================================
-- 既存ポリシーはそのまま（自分のレコード取得用として維持）
