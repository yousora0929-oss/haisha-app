-- 配車待ち（pending）注文: 工場は DB 取得可、表示範囲はフロントの isOrderVisibleToFactory で制御
-- エスカレーション段階で公開される距離順候補工場が RLS で弾かれないようにする

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
    when p_order.status = 'deleted' then false
    else (
      case
        when coalesce(p_order.status, 'pending') = 'accepted' then (
          public.factory_matches_text(public.effective_factory_actor_id(), p_order.factory_site_id)
          or trim(p_order.preferred_factory_id::text) = public.effective_factory_actor_id()
          or (
            p_order.project_id is not null
            and public.factory_can_access_project(p_order.project_id)
          )
        )
        when coalesce(p_order.status, 'pending') = 'pending' then true
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
        )
      end
    )
  end;
$$;

comment on function public.factory_can_access_order(public.orders) is
  '工場の注文閲覧可否。pending は全工場取得可（表示はフロントのエスカレーション判定）。accepted は関係工場のみ。';
