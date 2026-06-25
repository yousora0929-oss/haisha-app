-- factory_escalation_steps に updated_at カラムを追加
ALTER TABLE factory_escalation_steps
  ADD COLUMN IF NOT EXISTS volume_updated_at timestamptz DEFAULT NULL;

-- monthly_volume_m3 を更新した時に volume_updated_at を自動更新するトリガー
CREATE OR REPLACE FUNCTION update_volume_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.monthly_volume_m3 IS DISTINCT FROM OLD.monthly_volume_m3 THEN
    NEW.volume_updated_at = now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_volume_updated_at ON factory_escalation_steps;
CREATE TRIGGER trg_volume_updated_at
  BEFORE UPDATE ON factory_escalation_steps
  FOR EACH ROW EXECUTE FUNCTION update_volume_updated_at();
