-- 業者単位の顧客特定と、発注担当者名
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  created_at timestamptz not null default now()
);

alter table public.customers
  add column if not exists company_name text;

alter table public.customers enable row level security;

drop policy if exists "customers_select_anon" on public.customers;
drop policy if exists "customers_insert_anon" on public.customers;
drop policy if exists "customers_update_anon" on public.customers;
drop policy if exists "customers_delete_anon" on public.customers;
drop policy if exists "customers_select_auth" on public.customers;
drop policy if exists "customers_insert_auth" on public.customers;
drop policy if exists "customers_update_auth" on public.customers;
drop policy if exists "customers_delete_auth" on public.customers;

create policy "customers_select_anon" on public.customers for select to anon using (true);
create policy "customers_insert_anon" on public.customers for insert to anon with check (true);
create policy "customers_update_anon" on public.customers for update to anon using (true) with check (true);
create policy "customers_delete_anon" on public.customers for delete to anon using (true);
create policy "customers_select_auth" on public.customers for select to authenticated using (true);
create policy "customers_insert_auth" on public.customers for insert to authenticated with check (true);
create policy "customers_update_auth" on public.customers for update to authenticated using (true) with check (true);
create policy "customers_delete_auth" on public.customers for delete to authenticated using (true);

insert into public.customers (id, company_name)
values
  ('11111111-1111-1111-1111-111111111111', 'テスト業者A'),
  ('22222222-2222-2222-2222-222222222222', 'テスト業者B')
on conflict (id) do nothing;

alter table public.projects
  add column if not exists customer_id uuid references public.customers (id) on delete set null;

alter table public.orders
  add column if not exists customer_id uuid references public.customers (id) on delete set null,
  add column if not exists ordered_by text;

create index if not exists projects_customer_id_idx on public.projects (customer_id)
  where customer_id is not null;

create index if not exists orders_customer_id_idx on public.orders (customer_id)
  where customer_id is not null;

comment on column public.projects.customer_id is 'この物件を利用する業者ID';
comment on column public.orders.customer_id is '発注元の業者ID';
comment on column public.orders.ordered_by is '当日の発注担当者名（自由入力）';

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'customers'
  ) then
    alter publication supabase_realtime add table public.customers;
  end if;
end $$;
