-- レガシー: chat_message 形式で onesignal-push を直接叩くトリガーを撤去
-- （正規ルートは trg_orders_onesignal_push → trigger_onesignal_order_push の slim 形式）
--
-- このトリガーは orders のあらゆる UPDATE で発火し、固定文言の chat_message を
-- 1〜数秒間隔で大量送信していた（フロントエンド由来ではなかった）。

drop trigger if exists on_chat_updated_push on public.orders;
drop function if exists public.handle_chat_update_onesignal_push();
