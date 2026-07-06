-- チャーター車両募集 Phase 3: 応答・通知・閲覧RLS

-- =============================================================================
-- 1. charter_responses
-- =============================================================================
create table if not exists public.charter_responses (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.charter_requests (id) on delete cascade,
  responder_type text not null check (responder_type in ('factory', 'charter_operator')),
  responder_id text not null,
  offered_count integer not null check (offered_count > 0),
  message text,
  status text not null default 'offered' check (status in ('offered', 'accepted', 'rejected', 'withdrawn')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (request_id, responder_type, responder_id)
);

create index if not exists idx_charter_responses_request on public.charter_responses (request_id);

comment on table public.charter_responses is 'チャーター募集への応答（工場が手動選択して確定。Phase4）';

-- =============================================================================
-- 2. charter_requests.matched_response_id
-- =============================================================================
alter table public.charter_requests
  add column if not exists matched_response_id uuid references public.charter_responses (id);

-- =============================================================================
-- 3. charter_requests: 通知対象からの閲覧
-- =============================================================================
drop policy if exists "charter_requests_target_factory_select" on public.charter_requests;
create policy "charter_requests_target_factory_select"
  on public.charter_requests
  for select
  to anon
  using (
    public.is_factory_panel_request()
    and exists (
      select 1 from public.charter_notification_preferences p
      where p.factory_id = charter_requests.requesting_factory_id
        and p.target_type = 'factory'
        and p.target_id = public.current_factory_panel_id()
    )
  );

drop policy if exists "charter_requests_target_charter_select" on public.charter_requests;
create policy "charter_requests_target_charter_select"
  on public.charter_requests
  for select
  to anon
  using (
    public.is_charter_panel_request()
    and exists (
      select 1 from public.charter_notification_preferences p
      where p.factory_id = charter_requests.requesting_factory_id
        and p.target_type = 'charter_operator'
        and p.target_id = public.current_charter_panel_id()
    )
  );

-- =============================================================================
-- 4. charter_responses RLS
-- =============================================================================
alter table public.charter_responses enable row level security;

grant select, insert, update, delete on public.charter_responses to anon, authenticated;

drop policy if exists "charter_responses_admin_panel" on public.charter_responses;
create policy "charter_responses_admin_panel"
  on public.charter_responses
  for all
  to anon
  using (public.is_admin_panel_request())
  with check (public.is_admin_panel_request());

drop policy if exists "charter_responses_factory_own" on public.charter_responses;
create policy "charter_responses_factory_own"
  on public.charter_responses
  for all
  to anon
  using (
    public.is_factory_panel_request()
    and responder_type = 'factory'
    and responder_id = public.current_factory_panel_id()
  )
  with check (
    public.is_factory_panel_request()
    and responder_type = 'factory'
    and responder_id = public.current_factory_panel_id()
  );

drop policy if exists "charter_responses_charter_own" on public.charter_responses;
create policy "charter_responses_charter_own"
  on public.charter_responses
  for all
  to anon
  using (
    public.is_charter_panel_request()
    and responder_type = 'charter_operator'
    and responder_id = public.current_charter_panel_id()
  )
  with check (
    public.is_charter_panel_request()
    and responder_type = 'charter_operator'
    and responder_id = public.current_charter_panel_id()
  );

drop policy if exists "charter_responses_request_owner_select" on public.charter_responses;
create policy "charter_responses_request_owner_select"
  on public.charter_responses
  for select
  to anon
  using (
    public.is_factory_panel_request()
    and exists (
      select 1 from public.charter_requests r
      where r.id = charter_responses.request_id
        and r.requesting_factory_id = public.current_factory_panel_id()
    )
  );

-- =============================================================================
-- 5. OneSignal プッシュトリガー（charter_requests INSERT）
-- =============================================================================
create extension if not exists pg_net with schema extensions;

create or replace function public.trigger_onesignal_charter_request_push()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  webhook_url text;
  service_key text;
begin
  if tg_op = 'INSERT' and new.status = 'open' then
    select ds.decrypted_secret into webhook_url
    from vault.decrypted_secrets ds
    where ds.name = 'onesignal_push_webhook_url'
    limit 1;

    if coalesce(webhook_url, '') = '' then
      return new;
    end if;

    select ds.decrypted_secret into service_key
    from vault.decrypted_secrets ds
    where ds.name = 'service_role_key'
    limit 1;

    perform net.http_post(
      url := webhook_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || coalesce(service_key, '')
      ),
      body := jsonb_build_object(
        'event', 'charter_request_created',
        'record', to_jsonb(new)
      ),
      timeout_milliseconds := 8000
    );
  end if;
  return new;
exception
  when others then
    raise warning 'trigger_onesignal_charter_request_push failed: %', sqlerrm;
    return new;
end;
$$;

drop trigger if exists trg_charter_requests_onesignal_push on public.charter_requests;
create trigger trg_charter_requests_onesignal_push
  after insert on public.charter_requests
  for each row
  execute function public.trigger_onesignal_charter_request_push();
