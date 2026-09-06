-- 配合計画書依頼: 依頼先工場の複数選択 + 既存単一列の後方互換同期

create table if not exists public.mix_design_request_factories (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.mix_design_requests(id) on delete cascade,
  factory_id text not null references public.factories(id),
  created_at timestamptz not null default now(),
  unique (request_id, factory_id)
);

comment on table public.mix_design_request_factories is
  '配合計画書依頼の依頼先工場（複数可）。正データ。mix_design_requests.requested_to_factory_id は先頭工場の互換列。';

create index if not exists idx_mix_design_request_factories_request_id
  on public.mix_design_request_factories (request_id);

create index if not exists idx_mix_design_request_factories_factory_id
  on public.mix_design_request_factories (factory_id);

alter table public.mix_design_request_factories enable row level security;

grant select, insert, update, delete on public.mix_design_request_factories to anon, authenticated;

drop policy if exists "mix_design_request_factories_logged_in_panel"
  on public.mix_design_request_factories;
create policy "mix_design_request_factories_logged_in_panel"
  on public.mix_design_request_factories
  for all
  to anon, authenticated
  using (public.is_logged_in_panel_request())
  with check (public.is_logged_in_panel_request());

-- 既存の単一工場を junction にバックフィル
insert into public.mix_design_request_factories (request_id, factory_id)
select r.id, r.requested_to_factory_id
from public.mix_design_requests r
where nullif(btrim(coalesce(r.requested_to_factory_id, '')), '') is not null
on conflict (request_id, factory_id) do nothing;

-- p_request.requested_to_factory_ids (jsonb array) または requested_to_factory_id から工場一覧を解決し、
-- junction を差し替え、先頭を requested_to_factory_id に同期する。
create or replace function public.sync_mix_design_request_factories(
  p_request_id uuid,
  p_request jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids text[] := array[]::text[];
  v_elem text;
  v_primary text;
  v_arr jsonb;
begin
  if p_request_id is null then
    raise exception 'request id required';
  end if;

  v_arr := p_request->'requested_to_factory_ids';
  if v_arr is not null and jsonb_typeof(v_arr) = 'array' and jsonb_array_length(v_arr) > 0 then
    for v_elem in
      select nullif(btrim(coalesce(x, '')), '')
      from jsonb_array_elements_text(v_arr) as t(x)
    loop
      if v_elem is not null and not (v_elem = any (v_ids)) then
        v_ids := array_append(v_ids, v_elem);
      end if;
    end loop;
  end if;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    v_elem := nullif(btrim(coalesce(p_request->>'requested_to_factory_id', '')), '');
    if v_elem is not null then
      v_ids := array[v_elem];
    end if;
  end if;

  delete from public.mix_design_request_factories where request_id = p_request_id;

  if coalesce(array_length(v_ids, 1), 0) > 0 then
    insert into public.mix_design_request_factories (request_id, factory_id)
    select p_request_id, fid
    from unnest(v_ids) as fid
    on conflict (request_id, factory_id) do nothing;
  end if;

  v_primary := case when coalesce(array_length(v_ids, 1), 0) > 0 then v_ids[1] else null end;

  update public.mix_design_requests
  set requested_to_factory_id = v_primary
  where id = p_request_id;

  return v_primary;
end;
$$;

comment on function public.sync_mix_design_request_factories(uuid, jsonb) is
  '配合依頼の依頼先工場一覧を junction に同期し、先頭を requested_to_factory_id に書く。';

revoke all on function public.sync_mix_design_request_factories(uuid, jsonb) from public;
grant execute on function public.sync_mix_design_request_factories(uuid, jsonb) to anon, authenticated;

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
  '配合計画書依頼作成。requested_to_factory_ids で複数工場を junction に保存。orders は更新しない。';

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
  '配合計画書依頼を更新し変更履歴を append。依頼先工場は junction に同期。orders は更新しない。';
