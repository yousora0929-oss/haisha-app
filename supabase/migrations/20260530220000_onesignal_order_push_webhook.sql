-- =============================================================================
-- OneSignal プッシュ: orders INSERT/UPDATE → Edge Function (service_role)
-- =============================================================================
-- 前提:
--   1. Edge Function `onesignal-push` をデプロイ
--   2. Vault に以下を登録（Dashboard → Project Settings → Vault）:
--        - onesignal_push_webhook_url  … https://<project>.supabase.co/functions/v1/onesignal-push
--        - service_role_key            … プロジェクトの service_role キー
--   3. Edge Function シークレット:
--        ONESIGNAL_APP_ID, ONESIGNAL_REST_API_KEY
--        （SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY は自動注入）
--
-- 注: 本リポジトリには従来 OneSignal 用 DB Webhook は存在しませんでした。
--     trg_orders_updated_at のみが orders トリガーです（削除されていません）。

create extension if not exists pg_net with schema extensions;

create or replace function public.trigger_onesignal_order_push()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  webhook_url text;
  service_key text;
  should_notify boolean := false;
begin
  if tg_op = 'INSERT' then
    should_notify := true;
  elsif tg_op = 'UPDATE' then
    should_notify := (
      old.status is distinct from new.status
      or old.order_data is distinct from new.order_data
      or old.chat_messages is distinct from new.chat_messages
      or old.factory_site_id is distinct from new.factory_site_id
      or old.preferred_factory_id is distinct from new.preferred_factory_id
    );
  end if;

  if not should_notify then
    return new;
  end if;

  select ds.decrypted_secret
  into webhook_url
  from vault.decrypted_secrets ds
  where ds.name = 'onesignal_push_webhook_url'
  limit 1;

  if coalesce(webhook_url, '') = '' then
    return new;
  end if;

  select ds.decrypted_secret
  into service_key
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
      'type', tg_op,
      'record', to_jsonb(new),
      'old_record', case when tg_op = 'UPDATE' then to_jsonb(old) else null end
    ),
    timeout_milliseconds := 8000
  );

  return new;
exception
  when others then
    raise warning 'trigger_onesignal_order_push failed: %', sqlerrm;
    return new;
end;
$$;

comment on function public.trigger_onesignal_order_push() is
  'orders 変更時に onesignal-push Edge Function を pg_net で呼び出す（Vault 未設定時は no-op）';

drop trigger if exists trg_orders_onesignal_push on public.orders;
create trigger trg_orders_onesignal_push
  after insert or update on public.orders
  for each row
  execute function public.trigger_onesignal_order_push();

-- Realtime UPDATE の old 行参照用（JWT RLS 修正と併用）
alter table public.orders replica identity full;
