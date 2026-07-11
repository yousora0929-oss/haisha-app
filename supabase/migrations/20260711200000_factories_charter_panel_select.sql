-- チャーター業者パネルから工場名を参照できるよう factories SELECT を許可
drop policy if exists "factories_charter_panel_select" on public.factories;
create policy "factories_charter_panel_select"
  on public.factories
  for select
  to anon
  using (public.is_charter_panel_request());

-- 自分が応答した募集（確定後の matched 含む）をカレンダー表示できるよう許可
drop policy if exists "charter_requests_charter_responder_select" on public.charter_requests;
create policy "charter_requests_charter_responder_select"
  on public.charter_requests
  for select
  to anon
  using (
    public.is_charter_panel_request()
    and exists (
      select 1
      from public.charter_responses resp
      where resp.request_id = charter_requests.id
        and resp.responder_type = 'charter_operator'
        and resp.responder_id = public.current_charter_panel_id()
    )
  );
