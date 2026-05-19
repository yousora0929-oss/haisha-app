-- 業者マスタに代表担当者名・電話番号を追加
alter table public.customers
  add column if not exists manager_name text,
  add column if not exists phone_number text;

comment on column public.customers.manager_name is '代表担当者名（任意）';
comment on column public.customers.phone_number is '電話番号（任意）';
