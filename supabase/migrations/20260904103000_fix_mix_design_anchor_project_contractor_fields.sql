-- 配合計画書アンカー物件: p_contractor を sub_contractor_name に複製しない。
-- contractor（業者名）のみ設定し、表記用に contractor_display_name も同値を入れる。
-- 依頼者名（requested_by）は projects には書かない。

create or replace function public.insert_mix_design_anchor_project(
  p_name text,
  p_customer_id uuid,
  p_site_address text default null,
  p_main_factory_id text default null,
  p_delivery_area text default null,
  p_contractor text default null,
  p_trading_company_name text default null
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
  v_contractor text;
begin
  if not public.is_customer_panel_request() then
    raise exception 'not authorized';
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'project name required';
  end if;

  v_factory := nullif(btrim(coalesce(p_main_factory_id, '')), '');
  v_contractor := nullif(btrim(coalesce(p_contractor, '')), '');

  if p_customer_id is not null then
    select c.organization_id
      into v_org
    from public.customers c
    where c.id = p_customer_id
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
    commitment_level
  ) values (
    v_name,
    p_customer_id,
    v_org,
    nullif(btrim(coalesce(p_site_address, '')), ''),
    v_factory,
    nullif(btrim(coalesce(p_delivery_area, '')), ''),
    v_contractor,
    null,
    v_contractor,
    nullif(btrim(coalesce(p_trading_company_name, '')), ''),
    'mix_design_only'
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.insert_mix_design_anchor_project(text, uuid, text, text, text, text, text) is
  '配合計画書依頼用の物件アンカーを新規作成する。orders は更新しない。p_contractor は contractor / contractor_display_name のみに入れ、sub_contractor_name は NULL。';

revoke all on function public.insert_mix_design_anchor_project(text, uuid, text, text, text, text, text) from public;
grant execute on function public.insert_mix_design_anchor_project(text, uuid, text, text, text, text, text) to anon, authenticated;
