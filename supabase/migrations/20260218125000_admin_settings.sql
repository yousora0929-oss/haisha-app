-- 管理者名・電話番号の管理設定（id=1 固定）
create table if not exists public.admin_settings (
  id integer primary key default 1,
  admin_name text,
  phone_number text,
  login_password text,
  updated_at timestamptz not null default now(),
  constraint admin_settings_singleton check (id = 1)
);

alter table public.admin_settings enable row level security;

drop policy if exists "admin_settings_select_anon" on public.admin_settings;
drop policy if exists "admin_settings_insert_anon" on public.admin_settings;
drop policy if exists "admin_settings_update_anon" on public.admin_settings;
drop policy if exists "admin_settings_select_auth" on public.admin_settings;
drop policy if exists "admin_settings_insert_auth" on public.admin_settings;
drop policy if exists "admin_settings_update_auth" on public.admin_settings;

create policy "admin_settings_select_anon" on public.admin_settings for select to anon using (true);
create policy "admin_settings_insert_anon" on public.admin_settings for insert to anon with check (true);
create policy "admin_settings_update_anon" on public.admin_settings for update to anon using (true) with check (true);
create policy "admin_settings_select_auth" on public.admin_settings for select to authenticated using (true);
create policy "admin_settings_insert_auth" on public.admin_settings for insert to authenticated with check (true);
create policy "admin_settings_update_auth" on public.admin_settings for update to authenticated using (true) with check (true);

alter table public.admin_settings
  add column if not exists login_password text;

insert into public.admin_settings (id, admin_name, phone_number, login_password)
values (1, '管理者', null, null)
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'admin_settings'
  ) then
    alter publication supabase_realtime add table public.admin_settings;
  end if;
end $$;

comment on table public.admin_settings is '現場注文アプリに表示する管理者情報（id=1 固定）';
comment on column public.admin_settings.admin_name is '管理者名';
comment on column public.admin_settings.phone_number is '管理者の電話番号';
comment on column public.admin_settings.login_password is '管理者画面ログイン用パスワード（簡易認証）';
