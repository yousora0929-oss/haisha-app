-- 全ロール向け: 工場別当月出荷量（customer / guest からも参照可能）

create or replace function public.get_factory_monthly_volume()
returns table (factory_id text, monthly_volume_m3 numeric)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (s.factory_id)
    s.factory_id,
    s.monthly_volume_m3
  from public.factory_escalation_steps s
  order by s.factory_id, s.step_number asc;
$$;

comment on function public.get_factory_monthly_volume() is
  '全ロール向け: 工場別当月出荷量（factory_escalation_steps を集計・factory_id ごとに step_number 最小行を採用）。get_factory_small_vehicle_info と同じ公開方針';

revoke all on function public.get_factory_monthly_volume() from public;
grant execute on function public.get_factory_monthly_volume() to anon, authenticated;
