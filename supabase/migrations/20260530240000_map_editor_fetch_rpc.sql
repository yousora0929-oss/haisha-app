-- =============================================================================
-- 地図エディタ: orders / projects 取得 RPC（パネル認証 + RLS ヘルパーでアクセス判定）
-- =============================================================================

create or replace function public.map_editor_can_access_order(p_order public.orders)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_order is null then false
    when public.is_admin_panel_request() then true
    when public.is_customer_panel_request()
      and p_order.customer_id = public.current_customer_panel_id() then true
    when public.is_factory_panel_request()
      and public.factory_can_access_order(p_order) then true
    when public.is_guest_site_order_panel_request()
      and public.guest_can_access_order(p_order) then true
    else false
  end;
$$;

create or replace function public.map_editor_can_access_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_project_id is null then false
    when public.is_admin_panel_request() then true
    when public.is_customer_panel_request() then exists (
      select 1
      from public.projects p
      where p.id = p_project_id
        and p.customer_id = public.current_customer_panel_id()
    )
    when public.is_factory_panel_request() then public.factory_can_access_project(p_project_id)
    when public.is_guest_site_order_panel_request() then public.guest_can_access_project(p_project_id)
    else false
  end;
$$;

create or replace function public.fetch_order_for_map_editor(p_order_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_project public.projects;
begin
  select *
  into v_order
  from public.orders o
  where o.id = trim(coalesce(p_order_id, ''))
  limit 1;

  if not found then
    return null;
  end if;

  if v_order.status = 'deleted' then
    return null;
  end if;

  if not public.map_editor_can_access_order(v_order) then
    return null;
  end if;

  v_project := null;
  if v_order.project_id is not null and public.map_editor_can_access_project(v_order.project_id) then
    select *
    into v_project
    from public.projects p
    where p.id = v_order.project_id
    limit 1;
  end if;

  return jsonb_build_object(
    'order', to_jsonb(v_order),
    'project', case when v_project.id is not null then to_jsonb(v_project) else null end
  );
end;
$$;

revoke all on function public.map_editor_can_access_order(public.orders) from public;
revoke all on function public.map_editor_can_access_project(uuid) from public;
revoke all on function public.fetch_order_for_map_editor(text) from public;

grant execute on function public.map_editor_can_access_order(public.orders) to authenticated, anon;
grant execute on function public.map_editor_can_access_project(uuid) to authenticated, anon;
grant execute on function public.fetch_order_for_map_editor(text) to authenticated, anon;

comment on function public.fetch_order_for_map_editor(text) is
  '地図エディタ用: パネルヘッダー/JWT 認証下で orders + projects を返す（SECURITY DEFINER + 明示的アクセス判定）';
