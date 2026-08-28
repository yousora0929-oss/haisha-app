-- =============================================================================
-- 業者の会社単位所有 Phase C: 閲覧範囲を「担当者個人」から「所属会社」へ広げる
--
-- 方針:
--   * SELECT だけを広げる。INSERT/UPDATE/DELETE のポリシー（with_check 含む）は
--     一切変更しないため、同僚の物件・注文を書き換えることはできない。
--   * 既存条件は削らず OR で追加するだけ。個人アクセスは従来どおり。
--   * 会社の判定は既存ヘルパー public.current_customer_organization_id() を再利用。
--     （セッション変数にキャッシュされるため 1 クエリ内で再計算されない）
--
-- 触っていないもの:
--   projects_contractor_panel_all（ALL ポリシー。書き込み権限があるため拡張しない）
--   orders_contractor_panel_update / _delete / _insert（書き込み系）
--   orders_anon_select_unified（式が大きいため差し替えず、別ポリシーで OR 追加）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- projects: 既存の会社単位 SELECT に projects.organization_id 基準の条件を追加
--   従来は「物件の発注元 customers.organization_id」経由の判定のみだった。
--   Phase A/B で projects.organization_id が埋まったため、列を直接比較する
--   軽い条件を OR で先に置く（同じ可視範囲。customers への相関サブクエリを回避）。
-- -----------------------------------------------------------------------------
drop policy if exists "projects_contractor_panel_org_select" on public.projects;
create policy "projects_contractor_panel_org_select"
  on public.projects
  for select
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'contractor'
    and public.current_customer_organization_id() is not null
    and (
      projects.organization_id = public.current_customer_organization_id()
      or exists (
        select 1
        from public.customers_noauth c
        where c.id = projects.customer_id
          and c.organization_id is not null
          and c.organization_id = public.current_customer_organization_id()
      )
    )
  );

comment on policy "projects_contractor_panel_org_select" on public.projects is
  'contractor: 同一会社（organizations）の物件を SELECT 共有。projects.organization_id または発注元 customers.organization_id で判定。書き込みは projects_contractor_panel_all（本人のみ）のまま';

-- -----------------------------------------------------------------------------
-- orders: 同一会社の注文を SELECT 共有（追加ポリシー）
--   既存 orders_anon_select_unified は「物件の所有会社」経由でのみ共有しており、
--   スポット注文（project_id is null）と業者本人発注の一部が対象外だった。
--   ここでは注文に紐づく業者アカウント（contractor_customer_id / customer_id）の
--   所属会社で判定する。permissive ポリシーなので既存条件と OR される。
-- -----------------------------------------------------------------------------
drop policy if exists "orders_contractor_panel_org_select" on public.orders;
create policy "orders_contractor_panel_org_select"
  on public.orders
  for select
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'contractor'
    and public.current_customer_organization_id() is not null
    and (
      exists (
        select 1
        from public.customers_noauth t
        where t.id = orders.contractor_customer_id
          and t.organization_id = public.current_customer_organization_id()
      )
      or exists (
        select 1
        from public.customers_noauth t
        where t.id = orders.customer_id
          and t.role = 'contractor'
          and t.organization_id = public.current_customer_organization_id()
      )
    )
  );

comment on policy "orders_contractor_panel_org_select" on public.orders is
  'contractor: 同一会社（organizations）の注文を SELECT 共有（スポット注文も対象）。書き込みは orders_contractor_panel_update/_delete（本人のみ）のまま';
