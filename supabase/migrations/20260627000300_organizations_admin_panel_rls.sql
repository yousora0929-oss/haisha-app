-- organizations: 管理画面（is_admin_panel_request）からの CRUD を許可

drop policy if exists "organizations_admin_all" on public.organizations;
create policy "organizations_admin_all"
  on public.organizations
  for all
  to anon, authenticated
  using (public.is_admin_panel_request() or public.is_app_admin())
  with check (public.is_admin_panel_request() or public.is_app_admin());

-- migration: organizations_admin_panel_rls
