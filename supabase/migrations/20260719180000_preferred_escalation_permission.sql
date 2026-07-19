-- 第一希望指定注文の許可制エスカレーション用カラム

-- 工場ごとの第一希望無応答タイムアウト（分）
ALTER TABLE public.factories
  ADD COLUMN IF NOT EXISTS preferred_no_response_timeout_minutes integer NOT NULL DEFAULT 15;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'factories_pref_timeout_range'
      AND conrelid = 'public.factories'::regclass
  ) THEN
    ALTER TABLE public.factories
      ADD CONSTRAINT factories_pref_timeout_range CHECK (
        preferred_no_response_timeout_minutes BETWEEN 5 AND 60
        AND preferred_no_response_timeout_minutes % 5 = 0
      );
  END IF;
END $$;

COMMENT ON COLUMN public.factories.preferred_no_response_timeout_minutes IS
  '第一希望指定注文で、この工場が無応答のとき顧客へ許可確認を出すまでの分数（5〜60、5分刻み）';

-- 顧客がエスカレーション開放を許可した時刻
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS escalation_approved_at timestamptz;

COMMENT ON COLUMN public.orders.escalation_approved_at IS
  '第一希望指定注文で顧客が「他工場に広げる」を許可した時刻。NULL=未許可（第一希望のみ公開）';

-- 工場パネル: 自工場のタイムアウト設定のみ更新可
DROP POLICY IF EXISTS "factories_factory_panel_update_timeout" ON public.factories;
CREATE POLICY "factories_factory_panel_update_timeout"
  ON public.factories
  FOR UPDATE
  TO anon
  USING (
    public.is_factory_panel_request()
    AND id::text = nullif(trim(public.current_factory_panel_id()::text), '')
  )
  WITH CHECK (
    public.is_factory_panel_request()
    AND id::text = nullif(trim(public.current_factory_panel_id()::text), '')
  );

-- authenticated 工場ロールでも自工場のタイムアウトを更新可
DROP POLICY IF EXISTS "factories_factory_self_update_timeout" ON public.factories;
CREATE POLICY "factories_factory_self_update_timeout"
  ON public.factories
  FOR UPDATE
  TO authenticated
  USING (
    public.is_app_factory()
    AND id::text = nullif(trim(public.current_factory_id()::text), '')
  )
  WITH CHECK (
    public.is_app_factory()
    AND id::text = nullif(trim(public.current_factory_id()::text), '')
  );

-- 顧客が「他工場に広げる」を許可する RPC（カラムのみ更新）
CREATE OR REPLACE FUNCTION public.approve_order_escalation(p_order_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_now timestamptz := now();
BEGIN
  IF NOT (
    public.is_app_customer()
    OR public.is_customer_panel_request()
    OR public.is_app_admin()
    OR public.is_admin_panel_request()
  ) THEN
    RAISE EXCEPTION 'access_denied';
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = trim(p_order_id)
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found';
  END IF;

  IF v_order.status IS DISTINCT FROM 'pending' THEN
    RAISE EXCEPTION 'invalid_status';
  END IF;

  IF v_order.escalation_approved_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'escalation_approved_at', v_order.escalation_approved_at,
      'already', true
    );
  END IF;

  UPDATE public.orders
  SET escalation_approved_at = v_now
  WHERE id = trim(p_order_id);

  RETURN jsonb_build_object('escalation_approved_at', v_now, 'already', false);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_order_escalation(text) FROM public;
GRANT EXECUTE ON FUNCTION public.approve_order_escalation(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_order_escalation(text) TO anon;

-- preferred-timeout-scan を5分間隔で起動
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'preferred-timeout-scan') THEN
    PERFORM cron.unschedule('preferred-timeout-scan');
  END IF;
END $$;

SELECT cron.schedule(
  'preferred-timeout-scan',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://vwgsbhseoijbkdzwijnw.supabase.co/functions/v1/preferred-timeout-scan',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        ''
      ),
      'apikey', coalesce(
        (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1),
        ''
      )
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
  $$
);
