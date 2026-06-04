-- 工場別・未読通知の自動エスカレーション設定（管理者画面のみ編集）

create table if not exists public.factory_escalation_settings (
  factory_id text primary key references public.factories (id) on delete cascade,
  enabled boolean not null default false,
  unread_idle_minutes integer not null default 15,
  escalation_scope text not null default 'admin',
  updated_at timestamptz not null default now(),
  constraint factory_escalation_settings_minutes_check
    check (unread_idle_minutes >= 1),
  constraint factory_escalation_settings_scope_check
    check (escalation_scope in ('admin', 'area', 'all'))
);

comment on table public.factory_escalation_settings is '工場別・未読放置時の通知エスカレーション設定';
comment on column public.factory_escalation_settings.enabled is '自動エスカレーション有効';
comment on column public.factory_escalation_settings.unread_idle_minutes is '未読とみなす放置時間（分）';
comment on column public.factory_escalation_settings.escalation_scope is 'admin=本部のみ, area=近隣工場, all=全工場';

create or replace function public.set_factory_escalation_settings_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_factory_escalation_settings_updated_at on public.factory_escalation_settings;
create trigger trg_factory_escalation_settings_updated_at
before update on public.factory_escalation_settings
for each row
execute function public.set_factory_escalation_settings_updated_at();

alter table public.factory_escalation_settings enable row level security;

drop policy if exists "factory_escalation_settings_admin_panel" on public.factory_escalation_settings;
create policy "factory_escalation_settings_admin_panel"
  on public.factory_escalation_settings
  for all
  to anon, authenticated
  using (public.is_admin_panel_request() or public.is_app_admin())
  with check (public.is_admin_panel_request() or public.is_app_admin());

drop policy if exists "factory_escalation_settings_factory_select" on public.factory_escalation_settings;
create policy "factory_escalation_settings_factory_select"
  on public.factory_escalation_settings
  for select
  to anon, authenticated
  using (
    (public.is_factory_panel_request() or public.is_app_factory())
    and trim(factory_id) = coalesce(
      nullif(trim(public.effective_factory_actor_id()), ''),
      nullif(trim(public.current_factory_panel_id()), '')
    )
  );

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'factory_escalation_settings'
  ) then
    alter publication supabase_realtime add table public.factory_escalation_settings;
  end if;
end $$;
