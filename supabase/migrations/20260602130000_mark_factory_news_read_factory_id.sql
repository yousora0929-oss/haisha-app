-- 既読RPC: フロントから工場IDを明示受け取る（effective_factory_actor_id 未解決時の救済）

drop function if exists public.mark_factory_news_read(uuid);

create or replace function public.mark_factory_news_read(
  p_news_id uuid,
  p_factory_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fid text;
  v_panel_fid text;
begin
  if p_news_id is null then
    return;
  end if;

  v_fid := nullif(trim(coalesce(p_factory_id, '')), '');

  if public.is_factory_panel_request() then
    v_panel_fid := nullif(trim(coalesce(public.current_factory_panel_id(), '')), '');
    if v_panel_fid is null then
      raise exception '工場認証が必要です' using errcode = 'P0001';
    end if;
    if v_fid is null then
      v_fid := v_panel_fid;
    elsif v_fid is distinct from v_panel_fid then
      raise exception '工場IDが一致しません' using errcode = 'P0001';
    end if;
  else
    if v_fid is null then
      v_fid := nullif(trim(coalesce(public.effective_factory_actor_id(), '')), '');
      if v_fid is null and public.is_factory_panel_request() then
        v_fid := nullif(trim(coalesce(public.current_factory_panel_id(), '')), '');
      end if;
    end if;
    if v_fid is null then
      raise exception '工場認証が必要です' using errcode = 'P0001';
    end if;
  end if;

  if not exists (
    select 1 from public.factory_news n
    where n.id = p_news_id
      and public.factory_news_targets_factory(n.target_factory_ids, v_fid)
  ) then
    raise exception '閲覧できないお知らせです' using errcode = 'P0001';
  end if;

  insert into public.factory_news_reads (news_id, factory_id)
  values (p_news_id, v_fid)
  on conflict (news_id, factory_id) do nothing;
end;
$$;

revoke all on function public.mark_factory_news_read(uuid, text) from public;
grant execute on function public.mark_factory_news_read(uuid, text) to authenticated, anon;
