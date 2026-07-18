-- レガシー: orders INSERT 時に OneSignal REST API へ直接 POST していたトリガーを撤去
-- （正規ルートは trg_orders_onesignal_push → trigger_onesignal_order_push の new_order）
--
-- 撤去前定義（APIキーは [REDACTED]）:
-- CREATE TRIGGER send_order_push_notification
--   AFTER INSERT ON public.orders
--   FOR EACH ROW
--   EXECUTE FUNCTION supabase_functions.http_request(
--     'https://onesignal.com/api/v1/notifications',
--     'POST',
--     '{"Content-type":"application/json"}',
--     '{"Authorization: Basic":"[REDACTED]"}',
--     '5000'
--   );
--
-- 注: 専用関数 send_order_push_notification() は存在しない。
--     実行先は共有の supabase_functions.http_request() のため DROP FUNCTION しない。

drop trigger if exists send_order_push_notification on public.orders;
