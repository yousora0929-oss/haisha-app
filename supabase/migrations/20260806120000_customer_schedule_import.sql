-- =============================================================================
-- スケジュール取込: カスタマー権限フラグ + RLS + login_customer 返却拡張
-- =============================================================================

alter table public.customers
  add column if not exists can_import_schedule boolean not null default false;

comment on column public.customers.can_import_schedule is
  'true のとき DispatchApp でスケジュールPDF取込（確認・確定含む）を利用可能';

-- 権限チェック（SECURITY DEFINER + row_security off で再帰回避）
-- customers_noauth は SELECT * 展開済みのため新列を含まず、直接 customers を参照する
create or replace function public.current_customer_can_import_schedule()
returns boolean
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_flag boolean;
begin
  set local row_security = off;
  select coalesce(c.can_import_schedule, false)
    into v_flag
  from public.customers c
  where c.id = public.current_customer_panel_id()
  limit 1;
  return coalesce(v_flag, false);
exception
  when others then
    return false;
end;
$$;

comment on function public.current_customer_can_import_schedule() is
  'ログイン中カスタマーの can_import_schedule。customers_noauth 経由。';

revoke all on function public.current_customer_can_import_schedule() from public;
grant execute on function public.current_customer_can_import_schedule() to authenticated, anon;

-- バッチ所有判定（rows ポリシーから batches を直接見ると RLS が絡むため definer で判定）
create or replace function public.customer_owns_schedule_import_batch(p_batch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select exists (
    select 1
    from public.schedule_import_batches b
    where b.id = p_batch_id
      and b.uploaded_by = public.current_customer_panel_id()::text
  );
$$;

revoke all on function public.customer_owns_schedule_import_batch(uuid) from public;
grant execute on function public.customer_owns_schedule_import_batch(uuid) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- schedule_import_batches: 自分がアップロードしたバッチのみ
-- ---------------------------------------------------------------------------
drop policy if exists "schedule_import_batches_customer_panel_select"
  on public.schedule_import_batches;
create policy "schedule_import_batches_customer_panel_select"
  on public.schedule_import_batches
  for select
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_can_import_schedule()
    and uploaded_by = public.current_customer_panel_id()::text
  );

drop policy if exists "schedule_import_batches_customer_panel_update"
  on public.schedule_import_batches;
create policy "schedule_import_batches_customer_panel_update"
  on public.schedule_import_batches
  for update
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_can_import_schedule()
    and uploaded_by = public.current_customer_panel_id()::text
  )
  with check (
    public.is_customer_panel_request()
    and public.current_customer_can_import_schedule()
    and uploaded_by = public.current_customer_panel_id()::text
  );

-- ---------------------------------------------------------------------------
-- schedule_import_rows: 自分のバッチの行のみ
-- ---------------------------------------------------------------------------
drop policy if exists "schedule_import_rows_customer_panel_select"
  on public.schedule_import_rows;
create policy "schedule_import_rows_customer_panel_select"
  on public.schedule_import_rows
  for select
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_can_import_schedule()
    and public.customer_owns_schedule_import_batch(batch_id)
  );

drop policy if exists "schedule_import_rows_customer_panel_update"
  on public.schedule_import_rows;
create policy "schedule_import_rows_customer_panel_update"
  on public.schedule_import_rows
  for update
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_can_import_schedule()
    and public.customer_owns_schedule_import_batch(batch_id)
  )
  with check (
    public.is_customer_panel_request()
    and public.current_customer_can_import_schedule()
    and public.customer_owns_schedule_import_batch(batch_id)
  );

-- ---------------------------------------------------------------------------
-- entity_aliases: factory のみ INSERT、権限者は SELECT 可
-- ---------------------------------------------------------------------------
drop policy if exists "entity_aliases_customer_panel_insert_factory_only"
  on public.entity_aliases;
create policy "entity_aliases_customer_panel_insert_factory_only"
  on public.entity_aliases
  for insert
  to anon
  with check (
    public.is_customer_panel_request()
    and public.current_customer_can_import_schedule()
    and entity_type = 'factory'
  );

drop policy if exists "entity_aliases_customer_panel_select"
  on public.entity_aliases;
create policy "entity_aliases_customer_panel_select"
  on public.entity_aliases
  for select
  to anon
  using (
    public.is_customer_panel_request()
    and public.current_customer_can_import_schedule()
  );

-- ---------------------------------------------------------------------------
-- login_customer: can_import_schedule / role / organization_id を返す
-- ---------------------------------------------------------------------------
create or replace function public.login_customer(p_phone text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_company_name text;
  v_phone_number text;
  v_manager_name text;
  v_url_token text;
  v_role text;
  v_organization_id uuid;
  v_can_import_schedule boolean;
  v_realtime_token text;
begin
  select
    c.id,
    c.company_name,
    c.phone_number,
    c.manager_name,
    c.url_token::text,
    c.role,
    c.organization_id,
    coalesce(c.can_import_schedule, false)
  into
    v_id,
    v_company_name,
    v_phone_number,
    v_manager_name,
    v_url_token,
    v_role,
    v_organization_id,
    v_can_import_schedule
  from public.customers c
  where trim(coalesce(c.phone_number, '')) = trim(coalesce(p_phone, ''))
    and trim(coalesce(c.login_password, '')) = trim(coalesce(p_password, ''))
  limit 1;

  if v_id is null then
    return null;
  end if;

  begin
    v_realtime_token := public.sign_panel_realtime_jwt(jsonb_build_object(
      'panel_type', 'customer',
      'panel_customer_id', v_id::text
    ));
  exception
    when others then
      v_realtime_token := null;
  end;

  return jsonb_build_object(
    'id', v_id::text,
    'company_name', v_company_name,
    'name', coalesce(v_company_name, ''),
    'phone_number', v_phone_number,
    'manager_name', v_manager_name,
    'url_token', v_url_token,
    'role', coalesce(v_role, 'contractor'),
    'organization_id', case when v_organization_id is null then null else v_organization_id::text end,
    'can_import_schedule', v_can_import_schedule,
    'realtime_token', v_realtime_token
  );
end;
$$;

grant execute on function public.login_customer(text, text) to authenticated, anon;
