-- アプリ配信バージョン管理（強制更新）

create table if not exists public.app_release_control (
  id integer primary key default 1,
  min_version text not null default '0',
  force_reload_at timestamptz default null,
  message text default null,
  updated_at timestamptz not null default now(),
  constraint app_release_control_singleton check (id = 1)
);

comment on table public.app_release_control is
  'アプリ配信バージョン管理（id=1固定）。min_versionより古いクライアントはforce_reload_atに自動リロード';

comment on column public.app_release_control.min_version is
  '要求最小バージョン（ビルド時刻epoch ms文字列）';

comment on column public.app_release_control.force_reload_at is
  '強制リロード時刻。nullなら任意更新のみ（バナー表示はoutdated時のみ・強制なし）';

comment on column public.app_release_control.message is
  'バナーに表示する任意メッセージ';

insert into public.app_release_control (id) values (1)
on conflict (id) do nothing;

alter table public.app_release_control enable row level security;

drop policy if exists "app_release_control_select_all" on public.app_release_control;
create policy "app_release_control_select_all"
  on public.app_release_control for select
  to anon, authenticated
  using (true);

drop policy if exists "app_release_control_admin_write" on public.app_release_control;
create policy "app_release_control_admin_write"
  on public.app_release_control for update
  to anon, authenticated
  using (public.is_admin_panel_request() or public.is_app_admin())
  with check (public.is_admin_panel_request() or public.is_app_admin());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'app_release_control'
  ) then
    alter publication supabase_realtime add table public.app_release_control;
  end if;
end $$;
