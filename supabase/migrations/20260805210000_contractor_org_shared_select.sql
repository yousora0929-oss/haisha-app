-- =============================================================================
-- contractor: 同一 organization_id の担当者同士で物件・注文を SELECT 共有
--
-- 既存の orders_contractor_panel_all / projects_contractor_panel_all
-- （本人 customer_id 一致の ALL）は削除・変更せず、SELECT 専用ポリシーを追加する。
-- INSERT/UPDATE/DELETE は既存どおり本人記録のみ。
--
-- スポット注文（orders.project_id IS NULL）は新ポリシー対象外。
-- サブクエリは RLS 再帰回避のため customers_noauth / projects_noauth 経由。
-- =============================================================================

-- 物件: 同一組織の contractor 担当者同士で閲覧共有
drop policy if exists "projects_contractor_panel_org_select" on public.projects;
create policy "projects_contractor_panel_org_select"
  on public.projects
  for select
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'contractor'
    and exists (
      select 1
      from public.customers_noauth c
      where c.id = projects.customer_id
        and c.organization_id is not null
        and c.organization_id = public.current_customer_organization_id()
    )
  );

-- 注文: 同一組織 かつ 同一現場（project 経由）の contractor 注文を閲覧共有
drop policy if exists "orders_contractor_panel_org_select" on public.orders;
create policy "orders_contractor_panel_org_select"
  on public.orders
  for select
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'contractor'
    and orders.project_id is not null
    and exists (
      select 1
      from public.projects_noauth p
      join public.customers_noauth c on c.id = p.customer_id
      where p.id = orders.project_id
        and c.organization_id is not null
        and c.organization_id = public.current_customer_organization_id()
    )
  );

comment on policy "projects_contractor_panel_org_select" on public.projects is
  'contractor: 同一 organization_id の担当者同士で物件を SELECT 共有';

comment on policy "orders_contractor_panel_org_select" on public.orders is
  'contractor: 同一 organization_id かつ同一 project の注文を SELECT 共有（スポット除外）';
