-- 工場が注文内容を変更したことを各画面に通知するためのフラグ
alter table public.orders
  add column if not exists is_factory_modified boolean not null default false;

comment on column public.orders.is_factory_modified is '工場によって注文内容が変更された場合に true';
