-- =============================================================================
-- 物件マスタ・稼働時間・休日管理・orders 拡張
-- 前提: public.factories が存在し、id が uuid 型であること
-- Supabase SQL Editor または supabase db push で実行してください。
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- projects（物件マスタ）
-- -----------------------------------------------------------------------------
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  main_factory_id uuid not null references public.factories (id) on delete restrict,
  sub_factory_ids jsonb not null default '[]'::jsonb,
  lat double precision,
  lng double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_sub_factory_ids_is_array
    check (jsonb_typeof(sub_factory_ids) = 'array')
);

comment on table public.projects is '物件マスタ（メイン工場・サブ工場・位置情報）';
comment on column public.projects.main_factory_id is 'メイン工場（factories.id）';
comment on column public.projects.sub_factory_ids is 'サブ工場 UUID の JSON 配列（例: ["uuid-1","uuid-2"]）';
comment on column public.projects.lat is '緯度（FLOAT8 / double precision）';
comment on column public.projects.lng is '経度（FLOAT8 / double precision）';

create index if not exists projects_main_factory_id_idx on public.projects (main_factory_id);
create index if not exists projects_name_idx on public.projects (name);

create or replace function public.set_projects_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_projects_updated_at on public.projects;
create trigger trg_projects_updated_at
before update on public.projects
for each row
execute function public.set_projects_updated_at();

-- -----------------------------------------------------------------------------
-- holidays（休日）
-- -----------------------------------------------------------------------------
create table if not exists public.holidays (
  id uuid primary key default gen_random_uuid(),
  holiday_date date not null,
  description text,
  created_at timestamptz not null default now(),
  constraint holidays_holiday_date_unique unique (holiday_date)
);

comment on table public.holidays is '休日カレンダー（稼働時間・休日管理）';
comment on column public.holidays.holiday_date is '休日の日付';
comment on column public.holidays.description is '休日の説明（例: 年末年始）';

create index if not exists holidays_holiday_date_idx on public.holidays (holiday_date);

-- -----------------------------------------------------------------------------
-- system_settings（稼働時間・システム設定・シングルトン想定 id=1）
-- -----------------------------------------------------------------------------
create table if not exists public.system_settings (
  id integer primary key,
  start_time time not null default '08:00:00',
  end_time time not null default '16:00:00',
  updated_at timestamptz not null default now()
);

comment on table public.system_settings is 'システム稼働時間（通常は id=1 の1行のみ）';
comment on column public.system_settings.start_time is '稼働開始時刻';
comment on column public.system_settings.end_time is '稼働終了時刻';

insert into public.system_settings (id, start_time, end_time)
values (1, '08:00:00'::time, '16:00:00'::time)
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- orders（物件・スポット注文）
-- -----------------------------------------------------------------------------
alter table public.orders
  add column if not exists project_id uuid references public.projects (id) on delete set null;

alter table public.orders
  add column if not exists is_spot boolean not null default false;

comment on column public.orders.project_id is '物件マスタ参照（NULL可・スポット注文など）';
comment on column public.orders.is_spot is 'スポット注文フラグ（true=スポット）';

create index if not exists orders_project_id_idx on public.orders (project_id)
  where project_id is not null;

create index if not exists orders_is_spot_idx on public.orders (is_spot)
  where is_spot = true;

-- -----------------------------------------------------------------------------
-- Row Level Security（プロトタイプ: anon / authenticated で読み書き可）
-- -----------------------------------------------------------------------------
alter table public.projects enable row level security;
alter table public.holidays enable row level security;
alter table public.system_settings enable row level security;

-- projects
drop policy if exists "projects_select_anon" on public.projects;
drop policy if exists "projects_insert_anon" on public.projects;
drop policy if exists "projects_update_anon" on public.projects;
drop policy if exists "projects_delete_anon" on public.projects;

create policy "projects_select_anon" on public.projects for select to anon using (true);
create policy "projects_insert_anon" on public.projects for insert to anon with check (true);
create policy "projects_update_anon" on public.projects for update to anon using (true) with check (true);
create policy "projects_delete_anon" on public.projects for delete to anon using (true);

drop policy if exists "projects_select_auth" on public.projects;
drop policy if exists "projects_insert_auth" on public.projects;
drop policy if exists "projects_update_auth" on public.projects;
drop policy if exists "projects_delete_auth" on public.projects;

create policy "projects_select_auth" on public.projects for select to authenticated using (true);
create policy "projects_insert_auth" on public.projects for insert to authenticated with check (true);
create policy "projects_update_auth" on public.projects for update to authenticated using (true) with check (true);
create policy "projects_delete_auth" on public.projects for delete to authenticated using (true);

-- holidays
drop policy if exists "holidays_select_anon" on public.holidays;
drop policy if exists "holidays_insert_anon" on public.holidays;
drop policy if exists "holidays_update_anon" on public.holidays;
drop policy if exists "holidays_delete_anon" on public.holidays;

create policy "holidays_select_anon" on public.holidays for select to anon using (true);
create policy "holidays_insert_anon" on public.holidays for insert to anon with check (true);
create policy "holidays_update_anon" on public.holidays for update to anon using (true) with check (true);
create policy "holidays_delete_anon" on public.holidays for delete to anon using (true);

drop policy if exists "holidays_select_auth" on public.holidays;
drop policy if exists "holidays_insert_auth" on public.holidays;
drop policy if exists "holidays_update_auth" on public.holidays;
drop policy if exists "holidays_delete_auth" on public.holidays;

create policy "holidays_select_auth" on public.holidays for select to authenticated using (true);
create policy "holidays_insert_auth" on public.holidays for insert to authenticated with check (true);
create policy "holidays_update_auth" on public.holidays for update to authenticated using (true) with check (true);
create policy "holidays_delete_auth" on public.holidays for delete to authenticated using (true);

-- system_settings
drop policy if exists "system_settings_select_anon" on public.system_settings;
drop policy if exists "system_settings_insert_anon" on public.system_settings;
drop policy if exists "system_settings_update_anon" on public.system_settings;
drop policy if exists "system_settings_delete_anon" on public.system_settings;

create policy "system_settings_select_anon" on public.system_settings for select to anon using (true);
create policy "system_settings_insert_anon" on public.system_settings for insert to anon with check (true);
create policy "system_settings_update_anon" on public.system_settings for update to anon using (true) with check (true);
create policy "system_settings_delete_anon" on public.system_settings for delete to anon using (true);

drop policy if exists "system_settings_select_auth" on public.system_settings;
drop policy if exists "system_settings_insert_auth" on public.system_settings;
drop policy if exists "system_settings_update_auth" on public.system_settings;
drop policy if exists "system_settings_delete_auth" on public.system_settings;

create policy "system_settings_select_auth" on public.system_settings for select to authenticated using (true);
create policy "system_settings_insert_auth" on public.system_settings for insert to authenticated with check (true);
create policy "system_settings_update_auth" on public.system_settings for update to authenticated using (true) with check (true);
create policy "system_settings_delete_auth" on public.system_settings for delete to authenticated using (true);

-- -----------------------------------------------------------------------------
-- Realtime（任意・再実行安全）
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'projects'
  ) then
    alter publication supabase_realtime add table public.projects;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'holidays'
  ) then
    alter publication supabase_realtime add table public.holidays;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'system_settings'
  ) then
    alter publication supabase_realtime add table public.system_settings;
  end if;
end $$;
