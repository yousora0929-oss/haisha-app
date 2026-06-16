-- 同一注文へのプッシュ連打防止用タイムスタンプ
alter table public.orders
  add column if not exists push_notified_at timestamptz;

comment on column public.orders.push_notified_at is
  'OneSignal プッシュ最終送信時刻（Edge Function で60秒クールダウンに使用）';
