-- 工場別・多段階エスカレーション（注文から〇分後に近い順✕工場へ通知）

create table if not exists public.factory_escalation_steps (
  id uuid primary key default gen_random_uuid(),
  factory_id text not null references public.factories (id) on delete cascade,
  step_number integer not null,
  trigger_minutes integer not null default 0,
  target_factory_count integer not null default 1,
  created_at timestamptz not null default now(),
  constraint factory_escalation_steps_factory_step_unique unique (factory_id, step_number),
  constraint factory_escalation_steps_step_number_check check (step_number >= 1),
  constraint factory_escalation_steps_trigger_minutes_check check (trigger_minutes >= 0),
  constraint factory_escalation_steps_target_count_check check (target_factory_count >= 1)
);

comment on table public.factory_escalation_steps is '工場別エスカレーション段階（注文経過分→通知する近隣工場数）';
comment on column public.factory_escalation_steps.step_number is '段階番号（1始まり・工場内で一意）';
comment on column public.factory_escalation_steps.trigger_minutes is '注文からの経過分数（この時点で段階が発動）';
comment on column public.factory_escalation_steps.target_factory_count is '近い順に通知する工場数';

create index if not exists factory_escalation_steps_factory_id_idx
  on public.factory_escalation_steps (factory_id, step_number);

alter table public.factory_escalation_steps enable row level security;

drop policy if exists "factory_escalation_steps_admin_panel" on public.factory_escalation_steps;
create policy "factory_escalation_steps_admin_panel"
  on public.factory_escalation_steps
  for all
  to anon, authenticated
  using (public.is_admin_panel_request() or public.is_app_admin())
  with check (public.is_admin_panel_request() or public.is_app_admin());

drop policy if exists "factory_escalation_steps_factory_select" on public.factory_escalation_steps;
create policy "factory_escalation_steps_factory_select"
  on public.factory_escalation_steps
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
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'factory_escalation_steps'
  ) then
    alter publication supabase_realtime add table public.factory_escalation_steps;
  end if;
end $$;
