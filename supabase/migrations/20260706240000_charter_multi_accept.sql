-- チャーター募集: 複数応答の積み上げ確定モデル

-- =============================================================================
-- 1. 確定済み合計台数ヘルパー
-- =============================================================================
create or replace function public.charter_request_accepted_count(p_request_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(offered_count), 0)::integer
  from public.charter_responses
  where request_id = p_request_id
    and status = 'accepted';
$$;

revoke all on function public.charter_request_accepted_count(uuid) from public;
grant execute on function public.charter_request_accepted_count(uuid) to authenticated, anon;

-- =============================================================================
-- 2. confirm_charter_response（積み上げモデル）
-- =============================================================================
create or replace function public.confirm_charter_response(p_response_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_request_id uuid;
  v_request_status text;
  v_requesting_factory_id text;
  v_caller_factory_id text;
  v_response_status text;
  v_desired_count integer;
  v_this_offered_count integer;
  v_accepted_total integer;
  v_now_matched boolean := false;
begin
  v_caller_factory_id := public.current_factory_panel_id();
  if v_caller_factory_id is null then
    raise exception '工場認証が必要です' using errcode = 'P0001';
  end if;

  select r.id, r.status, r.requesting_factory_id, r.desired_count,
         resp.status, resp.offered_count
  into v_request_id, v_request_status, v_requesting_factory_id, v_desired_count,
       v_response_status, v_this_offered_count
  from public.charter_responses resp
  join public.charter_requests r on r.id = resp.request_id
  where resp.id = p_response_id;

  if v_request_id is null then
    raise exception '対象の応答が見つかりません' using errcode = 'P0001';
  end if;

  if v_requesting_factory_id is distinct from v_caller_factory_id then
    raise exception 'この募集を確定する権限がありません' using errcode = 'P0001';
  end if;

  if v_request_status <> 'open' then
    raise exception 'この募集は既に確定済み・終了しています' using errcode = 'P0001';
  end if;

  if v_response_status <> 'offered' then
    raise exception 'この応答は確定できない状態です（取り下げ済み等）' using errcode = 'P0001';
  end if;

  update public.charter_responses
  set status = 'accepted', updated_at = now()
  where id = p_response_id;

  v_accepted_total := public.charter_request_accepted_count(v_request_id);

  if v_accepted_total >= v_desired_count then
    v_now_matched := true;

    update public.charter_responses
    set status = 'rejected', updated_at = now()
    where request_id = v_request_id
      and status = 'offered';

    update public.charter_requests
    set status = 'matched', matched_response_id = p_response_id, updated_at = now()
    where id = v_request_id;
  end if;

  return jsonb_build_object(
    'request_id', v_request_id,
    'accepted_response_id', p_response_id,
    'accepted_total', v_accepted_total,
    'desired_count', v_desired_count,
    'fully_matched', v_now_matched
  );
end;
$$;

revoke all on function public.confirm_charter_response(uuid) from public;
grant execute on function public.confirm_charter_response(uuid) to authenticated, anon;
