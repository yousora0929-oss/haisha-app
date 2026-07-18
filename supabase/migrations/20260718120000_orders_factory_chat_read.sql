-- 工場側チャット既読キー（顧客側 customer_chat_read_key / customer_chat_read_at と同趣旨）
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS factory_chat_read_key text,
  ADD COLUMN IF NOT EXISTS factory_chat_read_at timestamptz;

COMMENT ON COLUMN public.orders.factory_chat_read_key IS '工場がチャットを開いた際の既読キー';
COMMENT ON COLUMN public.orders.factory_chat_read_at IS '工場がチャットを既読にした日時';
