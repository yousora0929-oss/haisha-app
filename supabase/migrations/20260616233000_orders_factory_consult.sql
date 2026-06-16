-- 工場「相談」ステータス（時間制限なしの交渉中ステート）
alter table public.orders
  add column if not exists factory_consult_status text;
alter table public.orders
  add column if not exists factory_consult_started_at timestamptz;
alter table public.orders
  add column if not exists factory_consult_by_factory_id text;

comment on column public.orders.factory_consult_status is
  '工場相談ステータス（consulting = 相談中・時間制限なし）';
comment on column public.orders.factory_consult_started_at is
  '相談開始時刻';
comment on column public.orders.factory_consult_by_factory_id is
  '相談中の工場ID（このIDの工場のみ操作可能）';

create index if not exists orders_factory_consult_status_idx
  on public.orders (factory_consult_status)
  where factory_consult_status is not null;
