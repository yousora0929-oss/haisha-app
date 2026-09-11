-- 配合パターンごとの備考（mix_design_request_items.memo）
-- 依頼全体の備考（mix_design_requests.memo）とは別項目。orders は更新しない。

alter table public.mix_design_request_items
  add column if not exists memo text;

comment on column public.mix_design_request_items.memo is
  '配合パターンごとの備考（自由記述）。依頼全体の備考（mix_design_requests.memo）とは別項目。';

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
  v_primary_factory text;
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

  -- 先頭工場を仮置き（sync で最終確定）
  v_primary_factory := nullif(btrim(coalesce(p_request->>'requested_to_factory_id', '')), '');
  if v_primary_factory is null
     and p_request->'requested_to_factory_ids' is not null
     and jsonb_typeof(p_request->'requested_to_factory_ids') = 'array'
     and jsonb_array_length(p_request->'requested_to_factory_ids') > 0 then
    v_primary_factory := nullif(btrim(coalesce(p_request->'requested_to_factory_ids'->>0, '')), '');
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
    v_primary_factory,
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

  perform public.sync_mix_design_request_factories(v_request_id, p_request);

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
    unit_water_content,
    memo
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
    nullif(btrim(coalesce(elem->>'unit_water_content', '')), '')::numeric,
    nullif(btrim(coalesce(elem->>'memo', '')), '')
  from jsonb_array_elements(v_items) with ordinality as t(elem, ordinality);

  perform public.upgrade_project_commitment_to_mix_design_only(v_project_id);

  return v_request_id;
end;
$$;

comment on function public.submit_mix_design_request_from_history(uuid, jsonb, jsonb, jsonb) is
  '配合計画書依頼作成。requested_to_factory_ids で複数工場を junction に保存。p_items.memo は配合パターン備考。orders は更新しない。';

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

  perform public.sync_mix_design_request_factories(p_request_id, p_request);

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
      unit_water_content,
      memo
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
      nullif(btrim(coalesce(elem->>'unit_water_content', '')), '')::numeric,
      nullif(btrim(coalesce(elem->>'memo', '')), '')
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
  '配合計画書依頼を更新し変更履歴を append。p_items.memo は配合パターン備考。依頼先工場は junction に同期。orders は更新しない。';
