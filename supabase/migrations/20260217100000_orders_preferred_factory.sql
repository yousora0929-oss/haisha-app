-- 第一希望工場（エスカレーション初期表示用・任意）
alter table public.orders
  add column if not exists preferred_factory_id uuid references public.factories (id) on delete set null;

comment on column public.orders.preferred_factory_id is '第一希望工場（factories.id・任意）';

create index if not exists orders_preferred_factory_id_idx on public.orders (preferred_factory_id)
  where preferred_factory_id is not null;
