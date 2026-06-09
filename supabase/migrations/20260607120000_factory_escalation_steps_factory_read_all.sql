-- 工場タブレット: 注文の公開範囲計算に他工場のエスカレーション段階も参照する（SELECT のみ全件可）

drop policy if exists "factory_escalation_steps_factory_select" on public.factory_escalation_steps;
create policy "factory_escalation_steps_factory_select"
  on public.factory_escalation_steps
  for select
  to anon, authenticated
  using (
    public.is_admin_panel_request()
    or public.is_app_admin()
    or public.is_factory_panel_request()
    or public.is_app_factory()
  );
