-- チャーター応答: 車両単位の部分確定（partially_accepted）

-- =============================================================================
-- 1. status に partially_accepted を追加
-- =============================================================================
alter table public.charter_responses
  drop constraint if exists charter_responses_status_check;

alter table public.charter_responses
  add constraint charter_responses_status_check
  check (status in ('offered', 'accepted', 'rejected', 'withdrawn', 'declined', 'partially_accepted'));

-- =============================================================================
-- 2. 集計: 車両単位（assigned_vehicles）／応答単位の混在に対応
-- =============================================================================
create or replace function public.charter_request_accepted_count(p_request_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
    case
      when jsonb_array_length(coalesce(resp.assigned_vehicles, '[]'::jsonb)) > 0 then (
        select count(*)::integer
        from jsonb_array_elements(resp.assigned_vehicles) v
        where coalesce(
          v->>'status',
          case when resp.status = 'accepted' then 'accepted' else 'offered' end
        ) = 'accepted'
      )
      when resp.status = 'accepted' then resp.offered_count
      else 0
    end
  ), 0)::integer
  from public.charter_responses resp
  where resp.request_id = p_request_id
    and resp.status in ('accepted', 'partially_accepted');
$$;

-- =============================================================================
-- 3. confirm_charter_response を車両単位対応に拡張
-- =============================================================================
drop function if exists public.confirm_charter_response(uuid);
drop function if exists public.confirm_charter_response(uuid, text[]);

create or replace function public.confirm_charter_response(
  p_response_id uuid,
  p_vehicle_ids text[] default null
)
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
  v_assigned_vehicles jsonb;
  v_updated_vehicles jsonb;
  v_all_accepted boolean;
  v_confirm_count integer;
  v_accepted_total integer;
  v_now_matched boolean := false;
begin
  v_caller_factory_id := public.current_factory_panel_id();
  if v_caller_factory_id is null then
    raise exception '工場認証が必要です' using errcode = 'P0001';
  end if;

  select r.id, r.status, r.requesting_factory_id, r.desired_count,
         resp.status, coalesce(resp.assigned_vehicles, '[]'::jsonb)
  into v_request_id, v_request_status, v_requesting_factory_id, v_desired_count,
       v_response_status, v_assigned_vehicles
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
  if v_response_status not in ('offered', 'partially_accepted') then
    raise exception 'この応答は確定できない状態です' using errcode = 'P0001';
  end if;

  if p_vehicle_ids is not null
     and coalesce(array_length(p_vehicle_ids, 1), 0) > 0
     and jsonb_array_length(v_assigned_vehicles) > 0 then
    select count(*)::integer
    into v_confirm_count
    from jsonb_array_elements(v_assigned_vehicles) v
    where (v->>'vehicle_id') = any(p_vehicle_ids)
      and coalesce(v->>'status', 'offered') = 'offered';

    if coalesce(v_confirm_count, 0) = 0 then
      raise exception '確定対象の車両がありません' using errcode = 'P0001';
    end if;

    select jsonb_agg(
      case
        when (v->>'vehicle_id') = any(p_vehicle_ids)
          and coalesce(v->>'status', 'offered') = 'offered'
          then v || jsonb_build_object('status', 'accepted')
        when v ? 'status' then v
        else v || jsonb_build_object('status', 'offered')
      end
      order by ordinality
    )
    into v_updated_vehicles
    from jsonb_array_elements(v_assigned_vehicles) with ordinality as t(v, ordinality);

    select bool_and(coalesce(v->>'status', 'offered') = 'accepted')
    into v_all_accepted
    from jsonb_array_elements(v_updated_vehicles) v;

    update public.charter_responses
    set assigned_vehicles = v_updated_vehicles,
        status = case when v_all_accepted then 'accepted' else 'partially_accepted' end,
        updated_at = now()
    where id = p_response_id;
  else
    -- 応答まるごと確定（車両割当がある場合は各車両も accepted にする）
    if jsonb_array_length(v_assigned_vehicles) > 0 then
      select jsonb_agg(
        case
          when coalesce(v->>'status', 'offered') in ('offered', 'accepted')
            then v || jsonb_build_object('status', 'accepted')
          else v
        end
        order by ordinality
      )
      into v_updated_vehicles
      from jsonb_array_elements(v_assigned_vehicles) with ordinality as t(v, ordinality);

      update public.charter_responses
      set assigned_vehicles = v_updated_vehicles,
          status = 'accepted',
          updated_at = now()
      where id = p_response_id;
    else
      update public.charter_responses
      set status = 'accepted', updated_at = now()
      where id = p_response_id;
    end if;
  end if;

  v_accepted_total := public.charter_request_accepted_count(v_request_id);

  if v_accepted_total >= v_desired_count then
    v_now_matched := true;

    update public.charter_responses
    set status = 'rejected', updated_at = now()
    where request_id = v_request_id
      and status = 'offered';

    update public.charter_responses resp
    set assigned_vehicles = (
      select jsonb_agg(
        case
          when coalesce(v->>'status', 'offered') = 'offered'
            then v || jsonb_build_object('status', 'rejected')
          when v ? 'status' then v
          else v || jsonb_build_object('status', 'offered')
        end
        order by ordinality
      )
      from jsonb_array_elements(resp.assigned_vehicles) with ordinality as t(v, ordinality)
    ),
    status = 'accepted',
    updated_at = now()
    where resp.request_id = v_request_id
      and resp.status = 'partially_accepted';

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

revoke all on function public.confirm_charter_response(uuid, text[]) from public;
grant execute on function public.confirm_charter_response(uuid, text[]) to authenticated, anon;
