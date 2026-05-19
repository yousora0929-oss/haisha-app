-- 管理画面から注文内容を変更したことを各画面に通知するためのフラグ
alter table public.orders
  add column if not exists is_admin_modified boolean not null default false;

comment on column public.orders.is_admin_modified is '管理者によって注文内容が変更された場合に true';
