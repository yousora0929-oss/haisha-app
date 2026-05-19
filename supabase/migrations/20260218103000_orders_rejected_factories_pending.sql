-- 工場ごとの見送り履歴と、未受注の初期ステータス
alter table public.orders
  add column if not exists rejected_factory_ids jsonb not null default '[]'::jsonb;

alter table public.orders
  alter column status set default 'pending';

update public.orders
set status = 'pending'
where status is null;

comment on column public.orders.rejected_factory_ids is '見送り済み工場IDの配列';
