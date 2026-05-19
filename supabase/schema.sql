-- =============================================================================
-- 配車アプリ Supabase 初期スキーマ（SQL Editor で一括実行可）
-- orders: 注文本体 + チャット履歴（JSONB）
-- schedules: 工場ごと・日付ごとの 4 枠 × 大型/小型 の○×
-- =============================================================================

-- 拡張（gen_random_uuid 用）
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- orders
-- -----------------------------------------------------------------------------
create table if not exists public.orders (
  id text primary key,
  order_data jsonb not null default '{}'::jsonb,
  chat_messages jsonb not null default '[]'::jsonb,
  has_test boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists orders_created_at_idx on public.orders (created_at desc);

create or replace function public.set_orders_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_orders_updated_at on public.orders;
create trigger trg_orders_updated_at
before update on public.orders
for each row
execute function public.set_orders_updated_at();

-- -----------------------------------------------------------------------------
-- schedules（工場 × 日付 で一意、blocks に am1/am2/pm1/pm2 の large/small）
-- -----------------------------------------------------------------------------
create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  factory_site_id text not null,
  date date not null,
  blocks jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (factory_site_id, date)
);

create index if not exists schedules_factory_date_idx on public.schedules (factory_site_id, date);

create or replace function public.set_schedules_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_schedules_updated_at on public.schedules;
create trigger trg_schedules_updated_at
before update on public.schedules
for each row
execute function public.set_schedules_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security（プロトタイプ: anon で読み書き可 ※本番は必ず見直し）
-- -----------------------------------------------------------------------------
alter table public.orders enable row level security;
alter table public.schedules enable row level security;

drop policy if exists "orders_select_anon" on public.orders;
drop policy if exists "orders_insert_anon" on public.orders;
drop policy if exists "orders_update_anon" on public.orders;
drop policy if exists "orders_delete_anon" on public.orders;

create policy "orders_select_anon" on public.orders
  for select to anon using (true);

create policy "orders_insert_anon" on public.orders
  for insert to anon with check (true);

create policy "orders_update_anon" on public.orders
  for update to anon using (true) with check (true);

create policy "orders_delete_anon" on public.orders
  for delete to anon using (true);

drop policy if exists "schedules_select_anon" on public.schedules;
drop policy if exists "schedules_insert_anon" on public.schedules;
drop policy if exists "schedules_update_anon" on public.schedules;
drop policy if exists "schedules_delete_anon" on public.schedules;

create policy "schedules_select_anon" on public.schedules
  for select to anon using (true);

create policy "schedules_insert_anon" on public.schedules
  for insert to anon with check (true);

create policy "schedules_update_anon" on public.schedules
  for update to anon using (true) with check (true);

create policy "schedules_delete_anon" on public.schedules
  for delete to anon using (true);

-- authenticated ロールにも同様（将来ログイン用）
drop policy if exists "orders_select_auth" on public.orders;
drop policy if exists "orders_insert_auth" on public.orders;
drop policy if exists "orders_update_auth" on public.orders;
drop policy if exists "orders_delete_auth" on public.orders;

create policy "orders_select_auth" on public.orders
  for select to authenticated using (true);

create policy "orders_insert_auth" on public.orders
  for insert to authenticated with check (true);

create policy "orders_update_auth" on public.orders
  for update to authenticated using (true) with check (true);

create policy "orders_delete_auth" on public.orders
  for delete to authenticated using (true);

drop policy if exists "schedules_select_auth" on public.schedules;
drop policy if exists "schedules_insert_auth" on public.schedules;
drop policy if exists "schedules_update_auth" on public.schedules;
drop policy if exists "schedules_delete_auth" on public.schedules;

create policy "schedules_select_auth" on public.schedules
  for select to authenticated using (true);

create policy "schedules_insert_auth" on public.schedules
  for insert to authenticated with check (true);

create policy "schedules_update_auth" on public.schedules
  for update to authenticated using (true) with check (true);

create policy "schedules_delete_auth" on public.schedules
  for delete to authenticated using (true);

-- -----------------------------------------------------------------------------
-- Realtime（Publication にテーブルを追加・再実行安全）
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'orders'
  ) then
    alter publication supabase_realtime add table public.orders;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'schedules'
  ) then
    alter publication supabase_realtime add table public.schedules;
  end if;
end $$;
