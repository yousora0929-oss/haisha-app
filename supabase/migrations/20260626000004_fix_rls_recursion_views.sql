-- ============================================================
-- RLS再帰を断ち切るSECURITY DEFINERビューを作成
-- ポリシー内サブクエリはこのビュー経由でアクセスする
-- ============================================================

-- customers をRLSバイパスで参照するビュー
CREATE OR REPLACE VIEW customers_noauth
WITH (security_invoker = false)
AS SELECT * FROM public.customers;

ALTER VIEW customers_noauth OWNER TO postgres;

-- projects をRLSバイパスで参照するビュー  
CREATE OR REPLACE VIEW projects_noauth
WITH (security_invoker = false)
AS SELECT * FROM public.projects;

ALTER VIEW projects_noauth OWNER TO postgres;

-- ============================================================
-- 循環Aの解消:
-- customers_agent_panel_contractors_select ポリシーを作り直す
-- current_customer_role() を使わず customers_noauth で直接参照
-- ============================================================
DROP POLICY IF EXISTS customers_agent_panel_contractors_select ON customers;
CREATE POLICY customers_agent_panel_contractors_select ON customers
FOR SELECT
USING (
  is_customer_panel_request()
  AND role = 'contractor'
  AND EXISTS (
    SELECT 1 FROM customers_noauth me
    WHERE me.id = current_customer_panel_id()
      AND me.role IN ('agent', 'cooperative')
  )
);

-- ============================================================
-- 循環Bの解消:
-- customers_factory_select_linked / customers_factory_panel_select_linked
-- factory_can_access_project を projects_noauth 経由の直接チェックに置き換え
-- ============================================================
DROP POLICY IF EXISTS customers_factory_select_linked ON customers;
CREATE POLICY customers_factory_select_linked ON customers
FOR SELECT
USING (
  is_app_factory()
  AND (
    EXISTS (
      SELECT 1 FROM projects_noauth p
      WHERE p.customer_id = customers.id
        AND (
          trim(p.main_factory_id::text) = effective_factory_actor_id()
          OR coalesce(p.sub_factory_ids, '[]'::jsonb)
             @> jsonb_build_array(effective_factory_actor_id())
        )
    )
    OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o.customer_id = customers.id
        AND factory_can_access_order(o.*)
    )
  )
);

DROP POLICY IF EXISTS customers_factory_panel_select_linked ON customers;
CREATE POLICY customers_factory_panel_select_linked ON customers
FOR SELECT
USING (
  is_factory_panel_request()
  AND (
    EXISTS (
      SELECT 1 FROM projects_noauth p
      WHERE p.customer_id = customers.id
        AND (
          trim(p.main_factory_id::text) = effective_factory_actor_id()
          OR coalesce(p.sub_factory_ids, '[]'::jsonb)
             @> jsonb_build_array(effective_factory_actor_id())
        )
    )
    OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o.customer_id = customers.id
        AND factory_can_access_order(o.*)
    )
  )
);

-- ============================================================
-- 循環Cの解消:
-- projects_cooperative_panel_select のサブクエリを customers_noauth 経由に
-- ============================================================
DROP POLICY IF EXISTS projects_cooperative_panel_select ON projects;
CREATE POLICY projects_cooperative_panel_select ON projects
FOR SELECT
USING (
  is_customer_panel_request()
  AND current_customer_role() = 'cooperative'
  AND EXISTS (
    SELECT 1 FROM customers_noauth c
    WHERE c.id = projects.customer_id
      AND c.organization_id = current_customer_organization_id()
  )
);

-- ============================================================
-- orders_cooperative_panel_select も同様に customers_noauth 経由に
-- ============================================================
DROP POLICY IF EXISTS orders_cooperative_panel_select ON orders;
CREATE POLICY orders_cooperative_panel_select ON orders
FOR SELECT
USING (
  is_customer_panel_request()
  AND current_customer_role() = 'cooperative'
  AND (
    EXISTS (
      SELECT 1 FROM customers_noauth c
      WHERE c.id = orders.contractor_customer_id
        AND c.organization_id = current_customer_organization_id()
    )
    OR EXISTS (
      SELECT 1 FROM customers_noauth c
      WHERE c.id = orders.customer_id
        AND c.role = 'contractor'
        AND c.organization_id = current_customer_organization_id()
    )
    OR EXISTS (
      SELECT 1 FROM customers_noauth c
      WHERE c.id = orders.customer_id
        AND c.role = 'agent'
        AND c.organization_id = current_customer_organization_id()
    )
  )
);
