-- =============================================================================
-- customers の会社単位 SELECT を追加したうえで、全開放ポリシーを削除する
--
-- 手順の意図:
--   1. 業者パネルが同一 organizations の同僚アカウントを SELECT できる正規ポリシーを足す
--      （Phase C の projects_contractor_panel_org_select と同じヘルパー）
--   2. using (true) の全開放 SELECT を削除する
-- =============================================================================

drop policy if exists "customers_contractor_panel_org_select" on public.customers;
create policy "customers_contractor_panel_org_select"
  on public.customers
  for select
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'contractor'
    and public.current_customer_organization_id() is not null
    and organization_id = public.current_customer_organization_id()
  );

comment on policy "customers_contractor_panel_org_select" on public.customers is
  'contractor: 同一会社（organizations）の担当者アカウントを SELECT 共有。書き込みは既存ポリシーのまま（本人のみ）';

drop policy if exists "anon_select_customers" on public.customers;
drop policy if exists "customers_select_auth" on public.customers;

-- anon_select_projects は削除しない。
-- 組合パネルの projects_cooperative_panel_select は「組合と同じ organization_id の
-- 業者が発注元の物件」しか許可しておらず、代理発注で他社物件を選べなくなる。

-- 工場パネル用 customers SELECT がリモートに欠けていたため、既存マイグレーション
-- 20260626000004 と同じ定義で復元する（anon_select_customers 削除後に工場が
-- 業者名を解決できなくなるのを防ぐ）。
drop policy if exists "customers_factory_select_linked" on public.customers;
create policy "customers_factory_select_linked"
  on public.customers
  for select
  using (
    public.is_app_factory()
    and (
      exists (
        select 1 from public.projects_noauth p
        where p.customer_id = customers.id
          and (
            trim(p.main_factory_id::text) = public.effective_factory_actor_id()
            or coalesce(p.sub_factory_ids, '[]'::jsonb)
               @> jsonb_build_array(public.effective_factory_actor_id())
          )
      )
      or exists (
        select 1 from public.orders o
        where o.customer_id = customers.id
          and public.factory_can_access_order(o.*)
      )
    )
  );

drop policy if exists "customers_factory_panel_select_linked" on public.customers;
create policy "customers_factory_panel_select_linked"
  on public.customers
  for select
  using (
    public.is_factory_panel_request()
    and (
      exists (
        select 1 from public.projects_noauth p
        where p.customer_id = customers.id
          and (
            trim(p.main_factory_id::text) = public.effective_factory_actor_id()
            or coalesce(p.sub_factory_ids, '[]'::jsonb)
               @> jsonb_build_array(public.effective_factory_actor_id())
          )
      )
      or exists (
        select 1 from public.orders o
        where o.customer_id = customers.id
          and public.factory_can_access_order(o.*)
      )
    )
  );

