-- 配合計画書依頼: 帳票用スナップショット項目を mix_design_requests に追加。
-- RPC シグネチャ（uuid, jsonb, jsonb, jsonb）は変更しない。p_request の追加キーのみ読む。
-- 既存 projects は更新しない（工期カラムも projects には無い）。

alter table public.mix_design_requests
  add column if not exists prime_contractor_name text,
  add column if not exists trading_company_name text,
  add column if not exists site_manager_name text,
  add column if not exists site_manager_contact text,
  add column if not exists period_start date,
  add column if not exists period_end date;

comment on column public.mix_design_requests.prime_contractor_name is
  '配合計画書宛名の元請名。projects.contractor_display_name に相当する依頼時点のスナップショット。既存物件は更新しない。';
comment on column public.mix_design_requests.trading_company_name is
  '商社名の依頼時点スナップショット。';
comment on column public.mix_design_requests.site_manager_name is
  '現場担当者名。';
comment on column public.mix_design_requests.site_manager_contact is
  '現場担当者連絡先。';
comment on column public.mix_design_requests.period_start is
  '工期開始日。projects に工期カラムが無いため依頼側で保持する。';
comment on column public.mix_design_requests.period_end is
  '工期終了日。';

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
      nullif(btrim(coalesce(p_anchor->>'tradingCompanyName', '')), '')
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
    period_end
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
      when p_request->>'quote_requested' is null or p_request->>'quote_requested' = '' then null
      else (p_request->>'quote_requested')::boolean
    end,
    nullif(btrim(coalesce(p_request->>'memo', '')), ''),
    nullif(btrim(coalesce(p_request->>'prime_contractor_name', '')), ''),
    nullif(btrim(coalesce(p_request->>'trading_company_name', '')), ''),
    nullif(btrim(coalesce(p_request->>'site_manager_name', '')), ''),
    nullif(btrim(coalesce(p_request->>'site_manager_contact', '')), ''),
    nullif(btrim(coalesce(p_request->>'period_start', '')), '')::date,
    nullif(btrim(coalesce(p_request->>'period_end', '')), '')::date
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
