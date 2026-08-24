-- 確定前に顧客が注文内容を編集したことを工場へ通知するためのフラグ
alter table public.orders
  add column if not exists is_customer_modified boolean not null default false;

comment on column public.orders.is_customer_modified is
  '確定前に顧客側が注文内容を編集した場合に true。工場が受注する前に内容再確認を促すためのフラグ。工場が最新内容を確認（受注操作 or 明示的な確認操作）した時点で false に戻す。';
