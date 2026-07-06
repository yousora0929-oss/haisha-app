-- チャーター車両募集 Phase 4: マッチング確定 RPC + 応答結果通知トリガー

-- =============================================================================
-- 1. confirm_charter_response RPC
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
begin
  v_caller_factory_id := public.current_factory_panel_id();
  if v_caller_factory_id is null then
    raise exception '工場認証が必要です' using errcode = 'P0001';
  end if;

  select r.id, r.status, r.requesting_factory_id, resp.status
  into v_request_id, v_request_status, v_requesting_factory_id, v_response_status
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
    raise exception 'この募集は既に確定または終了しています' using errcode = 'P0001';
  end if;

  if v_response_status <> 'offered' then
    raise exception 'この応答は確定できない状態です（取り下げ済み等）' using errcode = 'P0001';
  end if;

  update public.charter_responses
  set status = 'accepted', updated_at = now()
  where id = p_response_id;

  update public.charter_responses
  set status = 'rejected', updated_at = now()
  where request_id = v_request_id
    and id <> p_response_id
    and status = 'offered';

  update public.charter_requests
  set status = 'matched', matched_response_id = p_response_id, updated_at = now()
  where id = v_request_id;

  return jsonb_build_object(
    'request_id', v_request_id,
    'matched_response_id', p_response_id
  );
end;
$$;

revoke all on function public.confirm_charter_response(uuid) from public;
grant execute on function public.confirm_charter_response(uuid) to authenticated, anon;

-- =============================================================================
-- 2. 応答確定・見送り通知トリガー
-- =============================================================================
create extension if not exists pg_net with schema extensions;

create or replace function public.trigger_onesignal_charter_response_push()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  webhook_url text;
  service_key text;
  push_event text;
begin
  if tg_op = 'UPDATE' and old.status is distinct from new.status then
    if new.status = 'accepted' then
      push_event := 'charter_response_accepted';
    elsif new.status = 'rejected' then
      push_event := 'charter_response_rejected';
    else
      return new;
    end if;

    select ds.decrypted_secret into webhook_url
    from vault.decrypted_secrets ds
    where ds.name = 'onesignal_push_webhook_url'
    limit 1;

    if coalesce(webhook_url, '') = '' then
      return new;
    end if;

    select ds.decrypted_secret into service_key
    from vault.decrypted_secrets ds
    where ds.name = 'service_role_key'
    limit 1;

    perform net.http_post(
      url := webhook_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(service_key, '')
      ),
      body := jsonb_build_object(
        'event', push_event,
        'record', to_jsonb(new)
      ),
      timeout_milliseconds := 8000
    );
  end if;
  return new;
exception
  when others then
    raise warning 'trigger_onesignal_charter_response_push failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_charter_responses_onesignal_push on public.charter_responses;
create trigger trg_charter_responses_onesignal_push
  after update on public.charter_responses
  for each row
  execute function public.trigger_onesignal_charter_response_push();
