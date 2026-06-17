-- 受注日時（他工場受注の履歴切り替え判定に使用）
alter table public.orders
  add column if not exists accepted_at timestamptz;

comment on column public.orders.accepted_at is
  '工場受注確定時刻（他工場受注は受注日の翌日0時で履歴へ移動）';

update public.orders
set accepted_at = coalesce(updated_at, created_at)
where status = 'accepted'
  and accepted_at is null;
