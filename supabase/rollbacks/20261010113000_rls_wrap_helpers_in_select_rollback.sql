-- ROLLBACK: 20261010113000_rls_wrap_helpers_in_select.sql を元に戻す（括りを外す）
-- supabase/migrations には置かない（置くと通常のマイグレーションとして適用されてしまう）。
-- 適用前の本番 pg_policies から計算した定義と md5 一致を確認済み（62f4a13bc8810a3527c1e5ab3ff2e982）。
-- 使うとき: 不一致・権限エラー・動作異常が出たときに、この内容を1トランザクションで実行する。
-- ---- BEGIN GENERATED (31 policies) ----
alter policy customers_admin_all on public.customers
  using (is_app_admin())
  with check (is_app_admin());

alter policy customers_admin_panel on public.customers
  using (is_admin_panel_request())
  with check (is_admin_panel_request());

alter policy customers_agent_panel_contractors_select on public.customers
  using ((is_customer_panel_request() AND (role = 'contractor'::text) AND (EXISTS ( SELECT 1
   FROM customers_noauth me
  WHERE ((me.id = current_customer_panel_id()) AND (me.role = ANY (ARRAY['agent'::text, 'cooperative'::text])))))));

alter policy customers_contractor_panel_org_select on public.customers
  using ((is_customer_panel_request() AND (current_customer_role() = 'contractor'::text) AND (current_customer_organization_id() IS NOT NULL) AND (organization_id = current_customer_organization_id())));

alter policy customers_contractor_panel_trading_agent_select on public.customers
  using ((is_customer_panel_request() AND (current_customer_role() = 'contractor'::text) AND (role = 'agent'::text) AND (EXISTS ( SELECT 1
   FROM orders o
  WHERE (o.trading_agent_customer_id = customers.id)))));

alter policy customers_cooperative_panel_agents_select on public.customers
  using ((is_customer_panel_request() AND (current_customer_role() = 'cooperative'::text) AND (role = 'agent'::text)));

alter policy customers_customer_panel_select on public.customers
  using ((is_customer_panel_request() AND (id = current_customer_panel_id())));

alter policy customers_factory_panel_select_linked on public.customers
  using ((is_factory_panel_request() AND ((EXISTS ( SELECT 1
   FROM projects_noauth p
  WHERE ((p.customer_id = customers.id) AND ((TRIM(BOTH FROM p.main_factory_id) = effective_factory_actor_id()) OR (COALESCE(p.sub_factory_ids, '[]'::jsonb) @> jsonb_build_array(effective_factory_actor_id())))))) OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.customer_id = customers.id) AND factory_can_access_order(o.*)))) OR (EXISTS ( SELECT 1
   FROM (orders o
     JOIN projects_noauth p2 ON ((p2.id = o.project_id)))
  WHERE ((p2.customer_id = customers.id) AND factory_can_access_order(o.*)))))));

alter policy customers_factory_select_linked on public.customers
  using ((is_app_factory() AND ((EXISTS ( SELECT 1
   FROM projects_noauth p
  WHERE ((p.customer_id = customers.id) AND ((TRIM(BOTH FROM p.main_factory_id) = effective_factory_actor_id()) OR (COALESCE(p.sub_factory_ids, '[]'::jsonb) @> jsonb_build_array(effective_factory_actor_id())))))) OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.customer_id = customers.id) AND factory_can_access_order(o.*)))) OR (EXISTS ( SELECT 1
   FROM (orders o
     JOIN projects_noauth p2 ON ((p2.id = o.project_id)))
  WHERE ((p2.customer_id = customers.id) AND factory_can_access_order(o.*)))))));

alter policy customers_guest_site_order_select on public.customers
  using ((is_guest_site_order_panel_request() AND (id = guest_site_order_customer_id())));

alter policy customers_representative_org_agents_select on public.customers
  using ((is_customer_panel_request() AND (current_customer_role() = 'agent'::text) AND (role = 'agent'::text) AND (EXISTS ( SELECT 1
   FROM customers_noauth me
  WHERE ((me.id = current_customer_panel_id()) AND (me.is_representative = true) AND (me.organization_id IS NOT NULL) AND (me.organization_id = customers.organization_id))))));

alter policy orders_admin_all on public.orders
  using (is_app_admin())
  with check (is_app_admin());

alter policy orders_admin_panel_delete on public.orders
  using (is_admin_panel_request());

alter policy orders_admin_panel_insert on public.orders
  with check (is_admin_panel_request());

alter policy orders_admin_panel_update on public.orders
  using (is_admin_panel_request())
  with check (is_admin_panel_request());

alter policy orders_agent_panel_delete on public.orders
  using ((is_customer_panel_request() AND (current_customer_role() = 'agent'::text) AND (customer_id = current_customer_panel_id())));

alter policy orders_agent_panel_insert on public.orders
  with check ((is_customer_panel_request() AND (current_customer_role() = 'agent'::text) AND (customer_id = current_customer_panel_id())));

alter policy orders_agent_panel_update on public.orders
  using ((is_customer_panel_request() AND (current_customer_role() = 'agent'::text) AND (customer_id = current_customer_panel_id())))
  with check ((is_customer_panel_request() AND (current_customer_role() = 'agent'::text) AND (customer_id = current_customer_panel_id())));

alter policy orders_anon_select_unified on public.orders
  using ((is_admin_panel_request() OR (is_customer_panel_request() AND (current_customer_role() = 'agent'::text) AND ((customer_id = current_customer_panel_id()) OR ((project_id IS NOT NULL) AND agent_is_project_contact(project_id)))) OR (is_customer_panel_request() AND (current_customer_role() = 'contractor'::text) AND ((customer_id = current_customer_panel_id()) OR (contractor_customer_id = current_customer_panel_id()))) OR (is_customer_panel_request() AND (current_customer_role() = 'contractor'::text) AND (project_id IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM (projects_noauth p
     JOIN customers_noauth c ON ((c.id = p.customer_id)))
  WHERE ((p.id = orders.project_id) AND (c.organization_id IS NOT NULL) AND (c.organization_id = current_customer_organization_id()))))) OR (is_customer_panel_request() AND (current_customer_role() = 'cooperative'::text) AND (customer_id = current_customer_panel_id())) OR (is_factory_panel_request() AND factory_can_access_order(orders.*)) OR (is_guest_site_order_panel_request() AND guest_can_access_order(orders.*))));

alter policy orders_contractor_panel_delete on public.orders
  using ((is_customer_panel_request() AND (current_customer_role() = 'contractor'::text) AND ((customer_id = current_customer_panel_id()) OR (contractor_customer_id = current_customer_panel_id()))));

alter policy orders_contractor_panel_insert on public.orders
  with check ((is_customer_panel_request() AND (current_customer_role() = 'contractor'::text) AND (customer_id = current_customer_panel_id())));

alter policy orders_contractor_panel_org_select on public.orders
  using ((is_customer_panel_request() AND (current_customer_role() = 'contractor'::text) AND (current_customer_organization_id() IS NOT NULL) AND ((EXISTS ( SELECT 1
   FROM customers_noauth t
  WHERE ((t.id = orders.contractor_customer_id) AND (t.organization_id = current_customer_organization_id())))) OR (EXISTS ( SELECT 1
   FROM customers_noauth t
  WHERE ((t.id = orders.customer_id) AND (t.role = 'contractor'::text) AND (t.organization_id = current_customer_organization_id())))))));

alter policy orders_contractor_panel_update on public.orders
  using ((is_customer_panel_request() AND (current_customer_role() = 'contractor'::text) AND ((customer_id = current_customer_panel_id()) OR (contractor_customer_id = current_customer_panel_id()))))
  with check ((is_customer_panel_request() AND (current_customer_role() = 'contractor'::text) AND (customer_id = current_customer_panel_id())));

alter policy orders_cooperative_panel_delete on public.orders
  using ((is_customer_panel_request() AND (current_customer_role() = 'cooperative'::text) AND (customer_id = current_customer_panel_id())));

alter policy orders_cooperative_panel_insert on public.orders
  with check ((is_customer_panel_request() AND (current_customer_role() = 'cooperative'::text) AND (customer_id = current_customer_panel_id())));

alter policy orders_cooperative_panel_select on public.orders
  using ((is_customer_panel_request() AND (current_customer_role() = 'cooperative'::text) AND ((EXISTS ( SELECT 1
   FROM customers_noauth c
  WHERE ((c.id = orders.contractor_customer_id) AND (c.organization_id = current_customer_organization_id())))) OR (EXISTS ( SELECT 1
   FROM customers_noauth c
  WHERE ((c.id = orders.customer_id) AND (c.role = 'contractor'::text) AND (c.organization_id = current_customer_organization_id())))) OR (EXISTS ( SELECT 1
   FROM customers_noauth c
  WHERE ((c.id = orders.customer_id) AND (c.role = 'agent'::text) AND (c.organization_id = current_customer_organization_id())))))));

alter policy orders_cooperative_panel_update on public.orders
  using ((is_customer_panel_request() AND (current_customer_role() = 'cooperative'::text) AND (customer_id = current_customer_panel_id())))
  with check ((is_customer_panel_request() AND (current_customer_role() = 'cooperative'::text) AND (customer_id = current_customer_panel_id())));

alter policy orders_factory_panel_delete on public.orders
  using ((is_factory_panel_request() AND factory_can_access_order(orders.*)));

alter policy orders_factory_panel_insert on public.orders
  with check ((is_factory_panel_request() AND factory_can_access_order(orders.*)));

alter policy orders_factory_panel_update on public.orders
  using ((is_factory_panel_request() AND factory_can_access_order(orders.*)))
  with check ((is_factory_panel_request() AND factory_can_access_order(orders.*)));

alter policy orders_guest_site_order_update on public.orders
  using ((is_guest_site_order_panel_request() AND guest_can_access_order(orders.*)))
  with check ((is_guest_site_order_panel_request() AND guest_can_access_order(orders.*)));
