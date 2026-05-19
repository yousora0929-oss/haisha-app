-- スポット注文の配達先座標（エスカレーション距離計算用）
alter table public.orders
  add column if not exists delivery_lat double precision,
  add column if not exists delivery_lng double precision;

comment on column public.orders.delivery_lat is '配達先緯度（スポット注文で地図指定）';
comment on column public.orders.delivery_lng is '配達先経度（スポット注文で地図指定）';
