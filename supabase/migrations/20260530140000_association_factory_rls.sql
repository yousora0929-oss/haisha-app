-- 組合承認で複数指定された工場が RLS 上でも注文を閲覧できるようにする

create or replace function public.order_association_factory_ids(p_order public.orders)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select array_agg(distinct trim(x))
      from (
        select jsonb_array_elements_text(
          coalesce(p_order.order_data->'association_assigned_factory_ids', '[]'::jsonb)
        ) as x
        union all
        select jsonb_array_elements_text(
          coalesce(p_order.order_data->'associationAssignedFactoryIds', '[]'::jsonb)
        ) as x
      ) s
      where nullif(trim(x), '') is not null
    ),
    array[]::text[]
  );
$$;

revoke all on function public.order_association_factory_ids(public.orders) from public;
grant execute on function public.order_association_factory_ids(public.orders) to authenticated;

create or replace function public.factory_can_access_order(p_order public.orders)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_order is null then false
    when public.is_app_admin() then true
    when not public.is_app_factory() then false
    when p_order.status = 'pending_association' then false
    else (
      public.factory_matches_text(public.current_factory_id(), p_order.factory_site_id)
      or p_order.preferred_factory_id = public.current_factory_id()
      or (
        public.current_factory_id() is not null
        and public.current_factory_id()::text = any (public.order_association_factory_ids(p_order))
      )
      or (
        p_order.project_id is not null
        and public.factory_can_access_project(p_order.project_id)
      )
      or coalesce(p_order.rejected_factory_ids, '[]'::jsonb) @> jsonb_build_array(public.current_factory_id()::text)
    )
  end;
$$;
