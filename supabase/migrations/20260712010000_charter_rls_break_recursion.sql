-- charter_requests / charter_responses の RLS 循環参照を解消
-- EXISTS 直参照を SECURITY DEFINER ヘルパー経由に置き換える

-- =============================================================================
-- 1. ヘルパー関数（RLS を迂回して判定）
-- =============================================================================
create or replace function public.charter_request_owned_by_factory(p_request_id uuid, p_factory_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.charter_requests r
    where r.id = p_request_id
      and r.requesting_factory_id = p_factory_id
  );
$$;

create or replace function public.charter_operator_has_response(p_request_id uuid, p_operator_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.charter_responses resp
    where resp.request_id = p_request_id
      and resp.responder_type = 'charter_operator'
      and resp.responder_id = p_operator_id
  );
$$;

revoke all on function public.charter_request_owned_by_factory(uuid, text) from public;
revoke all on function public.charter_operator_has_response(uuid, text) from public;
grant execute on function public.charter_request_owned_by_factory(uuid, text) to authenticated, anon;
grant execute on function public.charter_operator_has_response(uuid, text) to authenticated, anon;

-- =============================================================================
-- 2. charter_responses 側のポリシーを関数経由に差し替え
-- =============================================================================
drop policy if exists "charter_responses_request_owner_select" on public.charter_responses;
create policy "charter_responses_request_owner_select"
  on public.charter_responses
  for select
  to anon
  using (
    public.is_factory_panel_request()
    and public.charter_request_owned_by_factory(request_id, public.current_factory_panel_id())
  );

-- =============================================================================
-- 3. charter_requests 側のポリシーを関数経由に差し替え
-- =============================================================================
drop policy if exists "charter_requests_charter_responder_select" on public.charter_requests;
create policy "charter_requests_charter_responder_select"
  on public.charter_requests
  for select
  to anon
  using (
    public.is_charter_panel_request()
    and public.charter_operator_has_response(id, public.current_charter_panel_id())
  );
