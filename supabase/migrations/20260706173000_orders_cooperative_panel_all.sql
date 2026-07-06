-- 組合（cooperative）が自分を customer_id とする注文を INSERT/UPDATE/DELETE できるようにする。
-- orders_cooperative_panel_select（他組織注文の閲覧）は変更しない。

drop policy if exists "orders_cooperative_panel_all" on public.orders;
create policy "orders_cooperative_panel_all"
  on public.orders
  for all
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'cooperative'
    and customer_id = public.current_customer_panel_id()
  )
  with check (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'cooperative'
    and customer_id = public.current_customer_panel_id()
  );
