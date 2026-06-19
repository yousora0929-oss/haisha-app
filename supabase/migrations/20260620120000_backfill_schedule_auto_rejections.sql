-- 満車自動拒否済みなのに rejected_factory_ids に未登録の注文を一括修復する。
-- chat_messages・status は変更しない（rejected_factory_ids への追加のみ）。

ALTER TABLE public.orders DISABLE TRIGGER trg_orders_onesignal_push;

DO $$
DECLARE
  rec RECORD;
  fid text;
BEGIN
  FOR rec IN
    SELECT
      id,
      factory_site_id,
      preferred_factory_id,
      rejected_factory_ids,
      chat_messages,
      order_data
    FROM public.orders
    WHERE (
        chat_messages::text LIKE '%満車のため拒否 — システム自動応答%'
        OR chat_messages::text LIKE '%今回はご対応が難しい状況です%'
        OR COALESCE(order_data->>'factoryRejectSource', order_data->>'factory_reject_source', '') = 'schedule_auto'
      )
      AND chat_messages IS NOT NULL
  LOOP
    fid := COALESCE(
      NULLIF(TRIM(rec.factory_site_id::text), ''),
      NULLIF(TRIM(rec.preferred_factory_id::text), ''),
      NULLIF(TRIM(rec.order_data->>'factory_site_id'), ''),
      NULLIF(TRIM(rec.order_data->>'factorySiteId'), ''),
      NULLIF(TRIM(rec.order_data->>'preferred_factory_id'), ''),
      NULLIF(TRIM(rec.order_data->>'preferredFactoryId'), ''),
      NULLIF(TRIM(rec.order_data->>'main_factory_id'), ''),
      NULLIF(TRIM(rec.order_data->>'mainFactoryId'), '')
    );

    IF fid IS NULL OR fid = '' THEN
      CONTINUE;
    END IF;

    IF COALESCE(rec.rejected_factory_ids, '[]'::jsonb) @> jsonb_build_array(fid) THEN
      CONTINUE;
    END IF;

    UPDATE public.orders
    SET rejected_factory_ids =
      COALESCE(rejected_factory_ids, '[]'::jsonb) || jsonb_build_array(fid)
    WHERE id = rec.id;
  END LOOP;
END $$;

ALTER TABLE public.orders ENABLE TRIGGER trg_orders_onesignal_push;
