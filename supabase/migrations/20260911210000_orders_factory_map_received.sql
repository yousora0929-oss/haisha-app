alter table public.orders
  add column if not exists factory_map_received_at timestamptz,
  add column if not exists factory_map_received_by text;
comment on column public.orders.factory_map_received_at is
  '工場がアプリ外（写真・LINE・紙等）で地図を直接受領した日時。地図エディタ経由の提出とは別概念。';
comment on column public.orders.factory_map_received_by is
  '受領を記録した工場名（表示用）';
