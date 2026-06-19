-- スポット注文のエスカレーション: preferred_factory_id 自動設定に依存せず
-- 配達エリアが一致する工場が RLS で閲覧できるようにする

create or replace function public.order_is_spot(p_order public.orders)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_order.is_spot,
    (p_order.order_data->>'is_spot')::boolean,
    (p_order.order_data->>'isSpot')::boolean,
    false
  );
$$;

create or replace function public.order_delivery_area_text(p_order public.orders)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(trim(
    coalesce(
      nullif(trim(p_order.order_data->>'delivery_area'), ''),
      nullif(trim(p_order.order_data->>'deliveryArea'), ''),
      nullif(trim(p_order.order_data->>'city'), ''),
      nullif(trim(p_order.order_data->>'municipality'), '')
    )
  ), '');
$$;

create or replace function public.factory_spot_order_area_match(
  p_factory_id text,
  p_order public.orders
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when nullif(trim(p_factory_id), '') is null then false
    when public.order_delivery_area_text(p_order) is null then true
    else exists (
      select 1
      from public.factories f
      where trim(f.id::text) = trim(p_factory_id)
        and (
          coalesce(f.allowed_delivery_areas, '[]'::jsonb) = '[]'::jsonb
          or exists (
            select 1
            from jsonb_array_elements_text(coalesce(f.allowed_delivery_areas, '[]'::jsonb)) area
            where public.order_delivery_area_text(p_order) like '%' || trim(area) || '%'
               or trim(area) like '%' || public.order_delivery_area_text(p_order) || '%'
          )
        )
    )
  end;
$$;

create or replace function public.factory_can_access_spot_order(
  p_order public.orders,
  p_factory_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.order_is_spot(p_order)
    and p_order.project_id is null
    and coalesce(p_order.status, 'pending') not in ('pending_association', 'deleted')
    and public.factory_spot_order_area_match(p_factory_id, p_order);
$$;

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
    when not public.is_app_factory() and not public.is_factory_panel_request() then false
    when p_order.status = 'pending_association' then false
    else (
      public.factory_matches_text(public.effective_factory_actor_id(), p_order.factory_site_id)
      or trim(p_order.preferred_factory_id::text) = public.effective_factory_actor_id()
      or (
        public.effective_factory_actor_id() is not null
        and public.effective_factory_actor_id() = any (public.order_association_factory_ids(p_order))
      )
      or (
        p_order.project_id is not null
        and public.factory_can_access_project(p_order.project_id)
      )
      or coalesce(p_order.rejected_factory_ids, '[]'::jsonb) @> jsonb_build_array(public.effective_factory_actor_id())
      or public.factory_can_access_spot_order(p_order, public.effective_factory_actor_id())
    )
  end;
$$;

comment on function public.factory_can_access_spot_order(public.orders, text) is
  'スポット注文: 配達エリアが一致する工場はエスカレーション公開のため閲覧可';

revoke all on function public.order_is_spot(public.orders) from public;
revoke all on function public.order_delivery_area_text(public.orders) from public;
revoke all on function public.factory_spot_order_area_match(text, public.orders) from public;
revoke all on function public.factory_can_access_spot_order(public.orders, text) from public;

grant execute on function public.order_is_spot(public.orders) to authenticated, anon;
grant execute on function public.order_delivery_area_text(public.orders) to authenticated, anon;
grant execute on function public.factory_spot_order_area_match(text, public.orders) to authenticated, anon;
grant execute on function public.factory_can_access_spot_order(public.orders, text) to authenticated, anon;

-- 過去に RLS 用に自動設定された第一希望を解除（ユーザー明示指定は残す）
update public.orders
set preferred_factory_id = null
where is_spot = true
  and project_id is null
  and status = 'pending'
  and preferred_factory_id is not null
  and not coalesce((order_data->>'preferred_factory_user_specified')::boolean, false)
  and not coalesce((order_data->>'preferredFactoryUserSpecified')::boolean, false);
