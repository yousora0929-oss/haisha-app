-- エスカレーション完了後も未受注の注文を検出するための準備
--   1. orders.push_timeout_notified_at: タイムアウト拒否通知の二重送信防止
--   2. pg_cron: dispatch-timeout-check Edge Function を5分おきに呼び出す

alter table public.orders
  add column if not exists push_timeout_notified_at timestamptz;

comment on column public.orders.push_timeout_notified_at is
  'エスカレーション完了後タイムアウト拒否通知の送信時刻（dispatch-timeout-check で二重送信防止）';

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

-- 既存スケジュールがあれば解除（再実行安全）
do $$
begin
  if exists (select 1 from cron.job where jobname = 'dispatch-timeout-check') then
    perform cron.unschedule('dispatch-timeout-check');
  end if;
end $$;

-- service_role_key は Vault から取得（current_setting に依存しない）
select cron.schedule(
  'dispatch-timeout-check',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://vwgsbhseoijbkdzwijnw.supabase.co/functions/v1/dispatch-timeout-check',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1),
        ''
      ),
      'apikey', coalesce(
        (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key' limit 1),
        ''
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  );
  $$
);
