-- 商社マスタ + 物件の業者表記用フィールド

create table if not exists public.trading_companies (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.trading_companies is '商社マスタ（管理画面）';
comment on column public.trading_companies.name is '商社名（一意）';

alter table public.projects
  add column if not exists contractor_display_name text;

comment on column public.projects.contractor_display_name is '印刷物・専用URL等の業者表記（自由入力・任意）';

-- 既存 trading_company_name から初期データ移行
insert into public.trading_companies (name)
select distinct trim(trading_company_name)
from public.projects
where trading_company_name is not null
  and trim(trading_company_name) <> ''
on conflict (name) do nothing;

alter table public.trading_companies enable row level security;

create policy "trading_companies_admin_panel"
  on public.trading_companies
  for all
  to anon
  using (public.is_admin_panel_request())
  with check (public.is_admin_panel_request());

grant select, insert, update, delete on public.trading_companies to anon;
