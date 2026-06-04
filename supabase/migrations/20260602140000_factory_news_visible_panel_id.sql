-- 工場パネル: effective_factory_actor_id が空でもヘッダー/JWT の工場IDでニュース・既読を判定

create or replace function public.factory_news_visible_to_actor(p_news public.factory_news)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_news is null then false
    when public.is_admin_panel_request() or public.is_app_admin() then true
    when public.is_factory_panel_request() or public.is_app_factory() then
      public.factory_news_targets_factory(
        p_news.target_factory_ids,
        coalesce(
          nullif(trim(public.effective_factory_actor_id()), ''),
          nullif(trim(public.current_factory_panel_id()), '')
        )
      )
    else false
  end;
$$;
