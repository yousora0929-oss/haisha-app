-- =============================================================================
-- orders: anon ロールの SELECT 系 multiple_permissive_policies 統合
--
-- 方針:
-- 1) anon 向け SELECT を 1 本に OR 統合（各 USING を無改変で連結）
-- 2) 既存 ALL ポリシーは SELECT を含むため、INSERT/UPDATE/DELETE に分割して残す
-- 3) orders_cooperative_panel_select は roles={public} のため統合対象外（ロール範囲を変えない）
-- 4) authenticated 側ポリシーは今回のスコープ外（変更しない）
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A. anon SELECT 統合ポリシー（先に作成し、旧 SELECT 寄与を後で外す）
-- ---------------------------------------------------------------------------
drop policy if exists "orders_anon_select_unified" on public.orders;
create policy "orders_anon_select_unified"
  on public.orders
  for select
  to anon
  using (
    -- orders_admin_panel (ALL → SELECT 部分)
    (is_admin_panel_request())
    -- orders_agent_panel_all (ALL → SELECT 部分)
    or (
      is_customer_panel_request()
      and (current_customer_role() = 'agent'::text)
      and (customer_id = current_customer_panel_id())
    )
    -- orders_contractor_panel_all (ALL → SELECT 部分)
    or (
      is_customer_panel_request()
      and (current_customer_role() = 'contractor'::text)
      and (
        (customer_id = current_customer_panel_id())
        or (contractor_customer_id = current_customer_panel_id())
      )
    )
    -- orders_contractor_panel_org_select
    or (
      is_customer_panel_request()
      and (current_customer_role() = 'contractor'::text)
      and (project_id is not null)
      and (
        exists (
          select 1
          from (
            projects_noauth p
            join customers_noauth c on ((c.id = p.customer_id))
          )
          where (
            (p.id = orders.project_id)
            and (c.organization_id is not null)
            and (c.organization_id = current_customer_organization_id())
          )
        )
      )
    )
    -- orders_cooperative_panel_all (ALL → SELECT 部分)
    or (
      is_customer_panel_request()
      and (current_customer_role() = 'cooperative'::text)
      and (customer_id = current_customer_panel_id())
    )
    -- orders_factory_panel_all (ALL → SELECT 部分)
    or (
      is_factory_panel_request()
      and factory_can_access_order(orders.*)
    )
    -- orders_guest_site_order_select
    or (
      is_guest_site_order_panel_request()
      and guest_can_access_order(orders.*)
    )
  );

comment on policy "orders_anon_select_unified" on public.orders is
  'anon SELECT統合。由来: orders_admin_panel | orders_agent_panel_all | orders_contractor_panel_all | orders_contractor_panel_org_select | orders_cooperative_panel_all | orders_factory_panel_all | orders_guest_site_order_select の USING を無改変OR連結。orders_cooperative_panel_select(public)は統合対象外。';

-- ---------------------------------------------------------------------------
-- B. SELECT 専用ポリシーのうち統合済みのものを削除
-- ---------------------------------------------------------------------------
drop policy if exists "orders_contractor_panel_org_select" on public.orders;
drop policy if exists "orders_guest_site_order_select" on public.orders;

-- ---------------------------------------------------------------------------
-- C. ALL → INSERT/UPDATE/DELETE 分割（SELECT は統合ポリシーへ移譲）
-- ---------------------------------------------------------------------------

-- orders_admin_panel
drop policy if exists "orders_admin_panel" on public.orders;

drop policy if exists "orders_admin_panel_insert" on public.orders;
create policy "orders_admin_panel_insert"
  on public.orders
  for insert
  to anon
  with check (is_admin_panel_request());

drop policy if exists "orders_admin_panel_update" on public.orders;
create policy "orders_admin_panel_update"
  on public.orders
  for update
  to anon
  using (is_admin_panel_request())
  with check (is_admin_panel_request());

drop policy if exists "orders_admin_panel_delete" on public.orders;
create policy "orders_admin_panel_delete"
  on public.orders
  for delete
  to anon
  using (is_admin_panel_request());

comment on policy "orders_admin_panel_insert" on public.orders is
  '旧 orders_admin_panel (ALL) の INSERT 分割。WITH CHECK 無改変。';
comment on policy "orders_admin_panel_update" on public.orders is
  '旧 orders_admin_panel (ALL) の UPDATE 分割。USING/WITH CHECK 無改変。';
comment on policy "orders_admin_panel_delete" on public.orders is
  '旧 orders_admin_panel (ALL) の DELETE 分割。USING 無改変。';

-- orders_agent_panel_all
drop policy if exists "orders_agent_panel_all" on public.orders;

drop policy if exists "orders_agent_panel_insert" on public.orders;
create policy "orders_agent_panel_insert"
  on public.orders
  for insert
  to anon
  with check (
    is_customer_panel_request()
    and (current_customer_role() = 'agent'::text)
    and (customer_id = current_customer_panel_id())
  );

drop policy if exists "orders_agent_panel_update" on public.orders;
create policy "orders_agent_panel_update"
  on public.orders
  for update
  to anon
  using (
    is_customer_panel_request()
    and (current_customer_role() = 'agent'::text)
    and (customer_id = current_customer_panel_id())
  )
  with check (
    is_customer_panel_request()
    and (current_customer_role() = 'agent'::text)
    and (customer_id = current_customer_panel_id())
  );

drop policy if exists "orders_agent_panel_delete" on public.orders;
create policy "orders_agent_panel_delete"
  on public.orders
  for delete
  to anon
  using (
    is_customer_panel_request()
    and (current_customer_role() = 'agent'::text)
    and (customer_id = current_customer_panel_id())
  );

comment on policy "orders_agent_panel_insert" on public.orders is
  '旧 orders_agent_panel_all (ALL) の INSERT 分割。WITH CHECK 無改変。';
comment on policy "orders_agent_panel_update" on public.orders is
  '旧 orders_agent_panel_all (ALL) の UPDATE 分割。USING/WITH CHECK 無改変。';
comment on policy "orders_agent_panel_delete" on public.orders is
  '旧 orders_agent_panel_all (ALL) の DELETE 分割。USING 無改変。';

-- orders_contractor_panel_all
-- NOTE: USING と WITH CHECK が異なる（既存どおり）。無改変で分割する。
drop policy if exists "orders_contractor_panel_all" on public.orders;

drop policy if exists "orders_contractor_panel_insert" on public.orders;
create policy "orders_contractor_panel_insert"
  on public.orders
  for insert
  to anon
  with check (
    is_customer_panel_request()
    and (current_customer_role() = 'contractor'::text)
    and (customer_id = current_customer_panel_id())
  );

drop policy if exists "orders_contractor_panel_update" on public.orders;
create policy "orders_contractor_panel_update"
  on public.orders
  for update
  to anon
  using (
    is_customer_panel_request()
    and (current_customer_role() = 'contractor'::text)
    and (
      (customer_id = current_customer_panel_id())
      or (contractor_customer_id = current_customer_panel_id())
    )
  )
  with check (
    is_customer_panel_request()
    and (current_customer_role() = 'contractor'::text)
    and (customer_id = current_customer_panel_id())
  );

drop policy if exists "orders_contractor_panel_delete" on public.orders;
create policy "orders_contractor_panel_delete"
  on public.orders
  for delete
  to anon
  using (
    is_customer_panel_request()
    and (current_customer_role() = 'contractor'::text)
    and (
      (customer_id = current_customer_panel_id())
      or (contractor_customer_id = current_customer_panel_id())
    )
  );

comment on policy "orders_contractor_panel_insert" on public.orders is
  '旧 orders_contractor_panel_all (ALL) の INSERT 分割。WITH CHECK 無改変。';
comment on policy "orders_contractor_panel_update" on public.orders is
  '旧 orders_contractor_panel_all (ALL) の UPDATE 分割。USING/WITH CHECK 無改変（差異あり）。';
comment on policy "orders_contractor_panel_delete" on public.orders is
  '旧 orders_contractor_panel_all (ALL) の DELETE 分割。USING 無改変。';

-- orders_cooperative_panel_all
drop policy if exists "orders_cooperative_panel_all" on public.orders;

drop policy if exists "orders_cooperative_panel_insert" on public.orders;
create policy "orders_cooperative_panel_insert"
  on public.orders
  for insert
  to anon
  with check (
    is_customer_panel_request()
    and (current_customer_role() = 'cooperative'::text)
    and (customer_id = current_customer_panel_id())
  );

drop policy if exists "orders_cooperative_panel_update" on public.orders;
create policy "orders_cooperative_panel_update"
  on public.orders
  for update
  to anon
  using (
    is_customer_panel_request()
    and (current_customer_role() = 'cooperative'::text)
    and (customer_id = current_customer_panel_id())
  )
  with check (
    is_customer_panel_request()
    and (current_customer_role() = 'cooperative'::text)
    and (customer_id = current_customer_panel_id())
  );

drop policy if exists "orders_cooperative_panel_delete" on public.orders;
create policy "orders_cooperative_panel_delete"
  on public.orders
  for delete
  to anon
  using (
    is_customer_panel_request()
    and (current_customer_role() = 'cooperative'::text)
    and (customer_id = current_customer_panel_id())
  );

comment on policy "orders_cooperative_panel_insert" on public.orders is
  '旧 orders_cooperative_panel_all (ALL) の INSERT 分割。WITH CHECK 無改変。';
comment on policy "orders_cooperative_panel_update" on public.orders is
  '旧 orders_cooperative_panel_all (ALL) の UPDATE 分割。USING/WITH CHECK 無改変。';
comment on policy "orders_cooperative_panel_delete" on public.orders is
  '旧 orders_cooperative_panel_all (ALL) の DELETE 分割。USING 無改変。';

-- orders_factory_panel_all
drop policy if exists "orders_factory_panel_all" on public.orders;

drop policy if exists "orders_factory_panel_insert" on public.orders;
create policy "orders_factory_panel_insert"
  on public.orders
  for insert
  to anon
  with check (
    is_factory_panel_request()
    and factory_can_access_order(orders.*)
  );

drop policy if exists "orders_factory_panel_update" on public.orders;
create policy "orders_factory_panel_update"
  on public.orders
  for update
  to anon
  using (
    is_factory_panel_request()
    and factory_can_access_order(orders.*)
  )
  with check (
    is_factory_panel_request()
    and factory_can_access_order(orders.*)
  );

drop policy if exists "orders_factory_panel_delete" on public.orders;
create policy "orders_factory_panel_delete"
  on public.orders
  for delete
  to anon
  using (
    is_factory_panel_request()
    and factory_can_access_order(orders.*)
  );

comment on policy "orders_factory_panel_insert" on public.orders is
  '旧 orders_factory_panel_all (ALL) の INSERT 分割。WITH CHECK 無改変。';
comment on policy "orders_factory_panel_update" on public.orders is
  '旧 orders_factory_panel_all (ALL) の UPDATE 分割。USING/WITH CHECK 無改変。';
comment on policy "orders_factory_panel_delete" on public.orders is
  '旧 orders_factory_panel_all (ALL) の DELETE 分割。USING 無改変。';

-- orders_cooperative_panel_select (roles=public) はロール範囲維持のため変更しない
-- orders_guest_site_order_update は UPDATE のみのため変更しない
-- authenticated 側ポリシーは変更しない
