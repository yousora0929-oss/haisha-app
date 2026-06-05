-- 旧エスカレーション設定テーブル（単一 scope 型）の完全廃止
-- 後継: factory_escalation_steps（20260602160000）

do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'factory_escalation_settings'
  ) then
    alter publication supabase_realtime drop table public.factory_escalation_settings;
  end if;
end $$;

drop trigger if exists trg_factory_escalation_settings_updated_at on public.factory_escalation_settings;
drop function if exists public.set_factory_escalation_settings_updated_at();

drop policy if exists "factory_escalation_settings_admin_panel" on public.factory_escalation_settings;
drop policy if exists "factory_escalation_settings_factory_select" on public.factory_escalation_settings;

drop table if exists public.factory_escalation_settings cascade;
