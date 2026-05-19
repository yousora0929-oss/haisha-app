-- 工場受注結果を orders テーブル列として保持（Realtime / 他工場非表示用）
alter table public.orders
  add column if not exists factory_site_id text,
  add column if not exists status text;

comment on column public.orders.factory_site_id is '受注・回答した工場ID（工場画面のログイン工場ID）';
comment on column public.orders.status is '注文ステータス（accepted / rejected / pending など）';

create index if not exists orders_factory_site_id_idx on public.orders (factory_site_id)
  where factory_site_id is not null;

create index if not exists orders_status_idx on public.orders (status)
  where status is not null;
