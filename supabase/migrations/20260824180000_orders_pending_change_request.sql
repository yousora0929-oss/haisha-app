-- 確定後に顧客が変更依頼を送ったことを工場・管理者へ通知するためのフラグ
alter table public.orders
  add column if not exists has_pending_change_request boolean not null default false;

comment on column public.orders.has_pending_change_request is
  '確定後に顧客が変更依頼を送った際 true。工場またはAdminAppが対応済みにすると false に戻る。';
