-- スポット注文の現場名サジェスト用。プッシュ通知には使用しない（contractor_customer_id とは独立）。

alter table public.orders
  add column if not exists site_history_contractor_id uuid references public.customers (id) on delete set null;

comment on column public.orders.site_history_contractor_id is
  '現場名オートコンプリート集計専用の実質業者ID。直接発注はcustomer_id、代理発注は選択した発注先業者。プッシュ通知対象の判定には使用しないこと。';

create index if not exists orders_site_history_contractor_id_idx
  on public.orders (site_history_contractor_id)
  where site_history_contractor_id is not null;

-- バックフィル：既存注文に対して実質業者IDを埋める
update public.orders
set site_history_contractor_id = coalesce(contractor_customer_id, customer_id)
where site_history_contractor_id is null
  and coalesce(contractor_customer_id, customer_id) is not null;
