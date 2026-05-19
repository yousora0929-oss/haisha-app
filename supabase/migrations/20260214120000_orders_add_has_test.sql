-- orders: 試験の有無（注文画面のチェックボックス。未チェック = false）
-- Supabase SQL Editor または psql で実行してください。

alter table public.orders
  add column if not exists has_test boolean not null default false;

comment on column public.orders.has_test is '試験の有無（boolean。デフォルト false＝試験なし）';
