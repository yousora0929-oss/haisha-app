-- 通知タイプごとの最終送信時刻を記録するJSONBマップ
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS push_notified_map jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.orders.push_notified_map IS
  '通知タイプ別の最終プッシュ送信時刻 {"new_order": "ISO8601", "order_rejected": "..."}。クールダウン判定用';
