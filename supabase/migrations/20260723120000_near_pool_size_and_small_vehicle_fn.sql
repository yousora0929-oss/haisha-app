-- 近い候補プールN社数（全注文共通）＋小型車保有工場情報関数

-- 1-1. 近い候補プールN社数
alter table public.factory_escalation_weight_config
  add column if not exists near_pool_size integer not null default 5;

comment on column public.factory_escalation_weight_config.near_pool_size is
  '工場選定: 距離順で「近い」とみなす上位N社。この中で当月出荷量の少ない工場を優先する（全注文共通）';

alter table public.factory_escalation_weight_config
  drop constraint if exists factory_escalation_weight_config_near_pool_size_range;

alter table public.factory_escalation_weight_config
  add constraint factory_escalation_weight_config_near_pool_size_range
  check (near_pool_size >= 1 and near_pool_size <= 50);

comment on column public.factory_escalation_weight_config.distance_weight is
  '【廃止・互換残置】旧・加重平均方式の距離重み。二段階方式移行後は未使用';

-- 1-2. 小型車保有工場ID取得関数
-- 判定ルール: 車両を1台以上登録済みかつ小型ゼロの工場のみ「小型なし」。未登録工場は行が返らない＝判定不能扱い。
create or replace function public.get_factory_small_vehicle_info()
returns table (factory_id text, has_any_vehicle boolean, has_small_vehicle boolean)
language sql
stable
security definer
set search_path = public
as $$
  select
    v.owner_id as factory_id,
    true as has_any_vehicle,
    bool_or(v.vehicle_type = 'small') as has_small_vehicle
  from public.charter_vehicles v
  where v.owner_type = 'factory'
  group by v.owner_id;
$$;

comment on function public.get_factory_small_vehicle_info() is
  '工場の車両登録状況（charter_vehicles owner_type=factory を集計）。未登録工場は行が返らない＝判定不能扱い';

grant execute on function public.get_factory_small_vehicle_info() to anon, authenticated;
