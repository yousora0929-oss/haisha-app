-- 配合計画書依頼: 業者/商社の暫定確保・会社連絡先登録・変更履歴
-- orders には触れない。既存の物件登録 UI は変更しない。

-- ---------------------------------------------------------------------------
-- 1. アンカー物件: 商社 org id を受け取り、customer_id は選択業者（呼び出し側）
-- ---------------------------------------------------------------------------
drop function if exists public.insert_mix_design_anchor_project(text, uuid, text, text, text, text, text);

create or replace function public.insert_mix_design_anchor_project(
  p_name text,
  p_customer_id uuid,
  p_site_address text default null,
  p_main_factory_id text default null,
  p_delivery_area text default null,
  p_contractor text default null,
  p_trading_company_name text default null,
  p_trading_company_organization_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_org uuid;
  v_name text;
  v_factory text;
  v_contractor_label text;
  v_trading_org uuid;
begin
  if not public.is_customer_panel_request() then
    raise exception 'not authorized';
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'project name required';
  end if;

  v_factory := nullif(btrim(coalesce(p_main_factory_id, '')), '');
  v_contractor_label := nullif(btrim(coalesce(p_contractor, '')), '');
  v_trading_org := p_trading_company_organization_id;

  if p_customer_id is not null then
    select c.organization_id
      into v_org
    from public.customers c
    where c.id = p_customer_id
    limit 1;
  end if;

  if v_trading_org is null and nullif(btrim(coalesce(p_trading_company_name, '')), '') is not null then
    select o.id
      into v_trading_org
    from public.organizations o
    where o.type = 'agent'
      and btrim(coalesce(o.name, '')) = btrim(p_trading_company_name)
    limit 1;
  end if;

  insert into public.projects (
    name,
    customer_id,
    organization_id,
    site_address,
    main_factory_id,
    delivery_area,
    contractor,
    sub_contractor_name,
    contractor_display_name,
    trading_company_name,
    trading_company,
    trading_company_organization_id,
    commitment_level
  ) values (
    v_name,
    p_customer_id,
    v_org,
    nullif(btrim(coalesce(p_site_address, '')), ''),
    v_factory,
    nullif(btrim(coalesce(p_delivery_area, '')), ''),
    null,
    null,
    v_contractor_label,
    nullif(btrim(coalesce(p_trading_company_name, '')), ''),
    nullif(btrim(coalesce(p_trading_company_name, '')), ''),
    v_trading_org,
    'mix_design_only'
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.insert_mix_design_anchor_project(text, uuid, text, text, text, text, text, uuid) is
  '配合計画書依頼用の物件アンカー。p_customer_id=選択業者。p_contractor→contractor_display_name。下請系は NULL。';

revoke all on function public.insert_mix_design_anchor_project(text, uuid, text, text, text, text, text, uuid) from public;
grant execute on function public.insert_mix_design_anchor_project(text, uuid, text, text, text, text, text, uuid) to anon, authenticated;

-- submit RPC を新シグネチャに合わせて更新
create or replace function public.submit_mix_design_request_from_history(
  p_existing_project_id uuid,
  p_anchor jsonb,
  p_request jsonb,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_request_id uuid;
  v_items jsonb;
begin
  if not public.is_customer_panel_request() then
    raise exception 'not authorized';
  end if;
  if not coalesce(public.current_customer_can_request_mix_design(), false) then
    raise exception 'not authorized';
  end if;

  v_project_id := p_existing_project_id;
  if v_project_id is null then
    v_project_id := public.insert_mix_design_anchor_project(
      nullif(btrim(coalesce(p_anchor->>'name', '')), ''),
      nullif(btrim(coalesce(p_anchor->>'customerId', '')), '')::uuid,
      nullif(btrim(coalesce(p_anchor->>'siteAddress', '')), ''),
      nullif(btrim(coalesce(p_anchor->>'mainFactoryId', '')), ''),
      nullif(btrim(coalesce(p_anchor->>'deliveryArea', '')), ''),
      nullif(btrim(coalesce(p_anchor->>'contractor', '')), ''),
      nullif(btrim(coalesce(p_anchor->>'tradingCompanyName', '')), ''),
      nullif(btrim(coalesce(p_anchor->>'tradingCompanyOrganizationId', '')), '')::uuid
    );
  end if;
  if v_project_id is null then
    raise exception 'project id required';
  end if;

  insert into public.mix_design_requests (
    project_id,
    requested_to_factory_id,
    requested_by,
    status,
    submission_method,
    submission_email,
    creation_date_specified,
    creation_date,
    copies_count,
    vehicle_types,
    total_volume_m3,
    test_salt,
    test_split_pour,
    test_specimen_count,
    test_third_party,
    quote_requested,
    memo,
    prime_contractor_name,
    trading_company_name,
    site_manager_name,
    site_manager_contact,
    period_start,
    period_end,
    project_name,
    contractor_name,
    site_address
  ) values (
    v_project_id,
    nullif(btrim(coalesce(p_request->>'requested_to_factory_id', '')), ''),
    nullif(btrim(coalesce(p_request->>'requested_by', '')), ''),
    'requested',
    case
      when p_request->>'submission_method' in ('original', 'electronic')
        then p_request->>'submission_method'
      else null
    end,
    nullif(btrim(coalesce(p_request->>'submission_email', '')), ''),
    coalesce((p_request->>'creation_date_specified')::boolean, false),
    nullif(btrim(coalesce(p_request->>'creation_date', '')), '')::date,
    nullif(btrim(coalesce(p_request->>'copies_count', '')), '')::integer,
    coalesce(p_request->'vehicle_types', '[]'::jsonb),
    nullif(btrim(coalesce(p_request->>'total_volume_m3', '')), '')::numeric,
    coalesce((p_request->>'test_salt')::boolean, false),
    coalesce((p_request->>'test_split_pour')::boolean, false),
    nullif(btrim(coalesce(p_request->>'test_specimen_count', '')), '')::integer,
    coalesce((p_request->>'test_third_party')::boolean, false),
    case
      when p_request->>'quote_requested' is null or btrim(p_request->>'quote_requested') = '' then null
      else (p_request->>'quote_requested')::boolean
    end,
    nullif(btrim(coalesce(p_request->>'memo', '')), ''),
    nullif(btrim(coalesce(p_request->>'prime_contractor_name', '')), ''),
    nullif(btrim(coalesce(p_request->>'trading_company_name', '')), ''),
    nullif(btrim(coalesce(p_request->>'site_manager_name', '')), ''),
    nullif(btrim(coalesce(p_request->>'site_manager_contact', '')), ''),
    nullif(btrim(coalesce(p_request->>'period_start', '')), '')::date,
    nullif(btrim(coalesce(p_request->>'period_end', '')), '')::date,
    nullif(btrim(coalesce(p_request->>'project_name', '')), ''),
    nullif(btrim(coalesce(p_request->>'contractor_name', '')), ''),
    nullif(btrim(coalesce(p_request->>'site_address', '')), '')
  )
  returning id into v_request_id;

  v_items := coalesce(p_items, '[]'::jsonb);
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'mix design items required';
  end if;

  insert into public.mix_design_request_items (
    request_id,
    sort_order,
    base_strength,
    correction_value,
    correction_is_auto,
    nominal_strength,
    slump,
    aggregate_size,
    cement_type,
    ae_admixture,
    quantity_m3,
    pour_date,
    construction_location,
    water_cement_ratio,
    unit_water_content
  )
  select
    v_request_id,
    coalesce(nullif(btrim(coalesce(elem->>'sort_order', '')), '')::integer, ordinality::integer - 1),
    (elem->>'base_strength')::integer,
    nullif(btrim(coalesce(elem->>'correction_value', '')), '')::integer,
    coalesce((elem->>'correction_is_auto')::boolean, true),
    nullif(btrim(coalesce(elem->>'nominal_strength', '')), '')::integer,
    (elem->>'slump')::integer,
    (elem->>'aggregate_size')::integer,
    case when elem->>'cement_type' = 'BB' then 'BB' else 'N' end,
    coalesce((elem->>'ae_admixture')::boolean, false),
    nullif(btrim(coalesce(elem->>'quantity_m3', '')), '')::numeric,
    nullif(btrim(coalesce(elem->>'pour_date', '')), '')::date,
    nullif(btrim(coalesce(elem->>'construction_location', '')), ''),
    nullif(btrim(coalesce(elem->>'water_cement_ratio', '')), '')::numeric,
    nullif(btrim(coalesce(elem->>'unit_water_content', '')), '')::numeric
  from jsonb_array_elements(v_items) with ordinality as t(elem, ordinality);

  perform public.upgrade_project_commitment_to_mix_design_only(v_project_id);

  return v_request_id;
end;
$$;

comment on function public.submit_mix_design_request_from_history(uuid, jsonb, jsonb, jsonb) is
  '発注履歴から配合計画書依頼を1トランザクションで作成。orders は更新しない。spot 注文では新規 project を作るだけ。';

-- ---------------------------------------------------------------------------
-- 2. 業者・商社の暫定確保（顧客パネルから security definer）
-- ---------------------------------------------------------------------------
create or replace function public.ensure_mix_design_contractor_customer(p_company_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_org_id uuid;
  v_customer_id uuid;
begin
  if not public.is_customer_panel_request() then
    raise exception 'not authorized';
  end if;
  if not coalesce(public.current_customer_can_request_mix_design(), false) then
    raise exception 'not authorized';
  end if;

  v_name := nullif(btrim(coalesce(p_company_name, '')), '');
  if v_name is null then
    raise exception 'company name required';
  end if;

  select c.id
    into v_customer_id
  from public.customers c
  where c.role = 'contractor'
    and btrim(coalesce(c.company_name, '')) = v_name
  order by c.created_at asc nulls last, c.id asc
  limit 1;
  if v_customer_id is not null then
    return v_customer_id;
  end if;

  select o.id
    into v_org_id
  from public.organizations o
  where o.type = 'contractor'
    and btrim(coalesce(o.name, '')) = v_name
  limit 1;

  if v_org_id is null then
    insert into public.organizations (name, type)
    values (v_name, 'contractor')
    returning id into v_org_id;
  end if;

  insert into public.customers (
    organization_id,
    role,
    company_name,
    manager_name,
    phone_number,
    login_password
  ) values (
    v_org_id,
    'contractor',
    v_name,
    null,
    null,
    null
  )
  returning id into v_customer_id;

  return v_customer_id;
end;
$$;

comment on function public.ensure_mix_design_contractor_customer(text) is
  '配合計画書依頼用: 業者名から既存 customers を探すか、organizations+customers を暫定作成する。';

revoke all on function public.ensure_mix_design_contractor_customer(text) from public;
grant execute on function public.ensure_mix_design_contractor_customer(text) to anon, authenticated;

create or replace function public.ensure_mix_design_agent_organization(p_company_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_org_id uuid;
begin
  if not public.is_customer_panel_request() then
    raise exception 'not authorized';
  end if;
  if not coalesce(public.current_customer_can_request_mix_design(), false) then
    raise exception 'not authorized';
  end if;

  v_name := nullif(btrim(coalesce(p_company_name, '')), '');
  if v_name is null then
    raise exception 'company name required';
  end if;

  select o.id
    into v_org_id
  from public.organizations o
  where o.type = 'agent'
    and btrim(coalesce(o.name, '')) = v_name
  limit 1;
  if v_org_id is not null then
    return v_org_id;
  end if;

  insert into public.organizations (name, type)
  values (v_name, 'agent')
  returning id into v_org_id;

  return v_org_id;
end;
$$;

comment on function public.ensure_mix_design_agent_organization(text) is
  '配合計画書依頼用: 商社名から organizations(agent) を探すか暫定作成する。';

revoke all on function public.ensure_mix_design_agent_organization(text) from public;
grant execute on function public.ensure_mix_design_agent_organization(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. 現場担当者を業者の会社連絡先として登録（重複回避）
-- ---------------------------------------------------------------------------
create or replace function public.register_mix_design_company_contact(
  p_contractor_customer_id uuid,
  p_manager_name text,
  p_phone text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
  v_phone text;
  v_phone_digits text;
  v_org_id uuid;
  v_company text;
  v_existing uuid;
  v_id uuid;
begin
  if not public.is_customer_panel_request() then
    raise exception 'not authorized';
  end if;
  if not coalesce(public.current_customer_can_request_mix_design(), false) then
    raise exception 'not authorized';
  end if;

  if p_contractor_customer_id is null then
    raise exception 'contractor customer id required';
  end if;

  v_name := nullif(btrim(coalesce(p_manager_name, '')), '');
  if v_name is null then
    raise exception 'manager name required';
  end if;
  v_phone := nullif(btrim(coalesce(p_phone, '')), '');
  v_phone_digits := regexp_replace(coalesce(v_phone, ''), '\D', '', 'g');

  select c.organization_id, btrim(coalesce(c.company_name, ''))
    into v_org_id, v_company
  from public.customers c
  where c.id = p_contractor_customer_id
  limit 1;

  if v_org_id is null then
    raise exception 'contractor organization not found';
  end if;
  if v_company = '' then
    select btrim(coalesce(o.name, ''))
      into v_company
    from public.organizations o
    where o.id = v_org_id
    limit 1;
  end if;

  select c.id
    into v_existing
  from public.customers c
  where c.organization_id = v_org_id
    and (
      btrim(coalesce(c.manager_name, '')) = v_name
      or (
        v_phone_digits <> ''
        and regexp_replace(coalesce(c.phone_number, ''), '\D', '', 'g') = v_phone_digits
      )
    )
  limit 1;

  if v_existing is not null then
    return v_existing;
  end if;

  insert into public.customers (
    organization_id,
    role,
    company_name,
    manager_name,
    phone_number,
    login_password
  ) values (
    v_org_id,
    'contractor',
    nullif(v_company, ''),
    v_name,
    v_phone,
    null
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.register_mix_design_company_contact(uuid, text, text) is
  '配合計画書依頼: 現場担当者を業者組織の customers 連絡先として登録（同名・同電話は既存を返す）。';

revoke all on function public.register_mix_design_company_contact(uuid, text, text) from public;
grant execute on function public.register_mix_design_company_contact(uuid, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. 変更履歴テーブル + 更新 RPC
-- ---------------------------------------------------------------------------
create table if not exists public.mix_design_request_change_logs (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.mix_design_requests(id) on delete cascade,
  changed_at timestamptz not null default now(),
  changed_by text,
  changes jsonb not null default '[]'::jsonb,
  before_snapshot jsonb,
  after_snapshot jsonb
);

comment on table public.mix_design_request_change_logs is
  '配合計画書依頼の変更履歴（append-only）。現行行は mix_design_requests を更新し、差分・スナップショットをここに残す。';

create index if not exists idx_mix_design_request_change_logs_request_id
  on public.mix_design_request_change_logs (request_id, changed_at desc);

alter table public.mix_design_request_change_logs enable row level security;

grant select, insert on public.mix_design_request_change_logs to anon, authenticated;

drop policy if exists "mix_design_request_change_logs_logged_in_panel"
  on public.mix_design_request_change_logs;
create policy "mix_design_request_change_logs_logged_in_panel"
  on public.mix_design_request_change_logs
  for all
  to anon, authenticated
  using (public.is_logged_in_panel_request())
  with check (public.is_logged_in_panel_request());

create or replace function public.update_mix_design_request_with_log(
  p_request_id uuid,
  p_request jsonb,
  p_items jsonb,
  p_changes jsonb default '[]'::jsonb,
  p_before_snapshot jsonb default null,
  p_after_snapshot jsonb default null,
  p_changed_by text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb;
begin
  if not public.is_customer_panel_request() then
    raise exception 'not authorized';
  end if;
  if not coalesce(public.current_customer_can_request_mix_design(), false) then
    raise exception 'not authorized';
  end if;
  if p_request_id is null then
    raise exception 'request id required';
  end if;
  if not exists (select 1 from public.mix_design_requests r where r.id = p_request_id) then
    raise exception 'request not found';
  end if;

  update public.mix_design_requests set
    requested_to_factory_id = nullif(btrim(coalesce(p_request->>'requested_to_factory_id', '')), ''),
    requested_by = coalesce(
      nullif(btrim(coalesce(p_request->>'requested_by', '')), ''),
      requested_by
    ),
    submission_method = case
      when p_request->>'submission_method' in ('original', 'electronic')
        then p_request->>'submission_method'
      else null
    end,
    submission_email = nullif(btrim(coalesce(p_request->>'submission_email', '')), ''),
    creation_date_specified = coalesce((p_request->>'creation_date_specified')::boolean, false),
    creation_date = nullif(btrim(coalesce(p_request->>'creation_date', '')), '')::date,
    copies_count = nullif(btrim(coalesce(p_request->>'copies_count', '')), '')::integer,
    vehicle_types = coalesce(p_request->'vehicle_types', '[]'::jsonb),
    total_volume_m3 = nullif(btrim(coalesce(p_request->>'total_volume_m3', '')), '')::numeric,
    test_salt = coalesce((p_request->>'test_salt')::boolean, false),
    test_split_pour = coalesce((p_request->>'test_split_pour')::boolean, false),
    test_specimen_count = nullif(btrim(coalesce(p_request->>'test_specimen_count', '')), '')::integer,
    test_third_party = coalesce((p_request->>'test_third_party')::boolean, false),
    quote_requested = case
      when p_request->>'quote_requested' is null or btrim(p_request->>'quote_requested') = '' then null
      else (p_request->>'quote_requested')::boolean
    end,
    memo = nullif(btrim(coalesce(p_request->>'memo', '')), ''),
    prime_contractor_name = nullif(btrim(coalesce(p_request->>'prime_contractor_name', '')), ''),
    trading_company_name = nullif(btrim(coalesce(p_request->>'trading_company_name', '')), ''),
    site_manager_name = nullif(btrim(coalesce(p_request->>'site_manager_name', '')), ''),
    site_manager_contact = nullif(btrim(coalesce(p_request->>'site_manager_contact', '')), ''),
    period_start = nullif(btrim(coalesce(p_request->>'period_start', '')), '')::date,
    period_end = nullif(btrim(coalesce(p_request->>'period_end', '')), '')::date,
    project_name = nullif(btrim(coalesce(p_request->>'project_name', '')), ''),
    contractor_name = nullif(btrim(coalesce(p_request->>'contractor_name', '')), ''),
    site_address = nullif(btrim(coalesce(p_request->>'site_address', '')), ''),
    updated_at = now()
  where id = p_request_id;

  delete from public.mix_design_request_items where request_id = p_request_id;

  v_items := coalesce(p_items, '[]'::jsonb);
  if jsonb_typeof(v_items) = 'array' and jsonb_array_length(v_items) > 0 then
    insert into public.mix_design_request_items (
      request_id,
      sort_order,
      base_strength,
      correction_value,
      correction_is_auto,
      nominal_strength,
      slump,
      aggregate_size,
      cement_type,
      ae_admixture,
      quantity_m3,
      pour_date,
      construction_location,
      water_cement_ratio,
      unit_water_content
    )
    select
      p_request_id,
      coalesce((elem->>'sort_order')::integer, ord::integer - 1),
      (elem->>'base_strength')::integer,
      nullif(btrim(coalesce(elem->>'correction_value', '')), '')::integer,
      coalesce((elem->>'correction_is_auto')::boolean, true),
      nullif(btrim(coalesce(elem->>'nominal_strength', '')), '')::integer,
      (elem->>'slump')::integer,
      (elem->>'aggregate_size')::integer,
      case when upper(elem->>'cement_type') = 'BB' then 'BB' else 'N' end,
      coalesce((elem->>'ae_admixture')::boolean, false),
      nullif(btrim(coalesce(elem->>'quantity_m3', '')), '')::numeric,
      nullif(btrim(coalesce(elem->>'pour_date', '')), '')::date,
      nullif(btrim(coalesce(elem->>'construction_location', '')), ''),
      nullif(btrim(coalesce(elem->>'water_cement_ratio', '')), '')::numeric,
      nullif(btrim(coalesce(elem->>'unit_water_content', '')), '')::numeric
    from jsonb_array_elements(v_items) with ordinality as t(elem, ord);
  end if;

  insert into public.mix_design_request_change_logs (
    request_id,
    changed_by,
    changes,
    before_snapshot,
    after_snapshot
  ) values (
    p_request_id,
    nullif(btrim(coalesce(p_changed_by, '')), ''),
    coalesce(p_changes, '[]'::jsonb),
    p_before_snapshot,
    p_after_snapshot
  );

  return p_request_id;
end;
$$;

comment on function public.update_mix_design_request_with_log(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) is
  '配合計画書依頼を更新し、変更履歴を append。orders は更新しない。';

revoke all on function public.update_mix_design_request_with_log(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) from public;
grant execute on function public.update_mix_design_request_with_log(uuid, jsonb, jsonb, jsonb, jsonb, jsonb, text) to anon, authenticated;
