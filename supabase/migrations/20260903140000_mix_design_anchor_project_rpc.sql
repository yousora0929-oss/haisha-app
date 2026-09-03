-- 配合計画書依頼: スポット注文から物件アンカーを作る／commitment_level を昇格する。
-- orders は参照のみ。既存の projects カラムは変更しない。
-- agent / cooperative は projects への一般 INSERT/UPDATE が無いため SECURITY DEFINER にする。

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
begin
  if not public.is_customer_panel_request() then
    raise exception 'not authorized';
  end if;

  v_name := nullif(btrim(coalesce(p_name, '')), '');
  if v_name is null then
    raise exception 'project name required';
  end if;

  v_factory := nullif(btrim(coalesce(p_main_factory_id, '')), '');

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
    trading_company_name,
    commitment_level
  ) values (
    v_name,
    p_customer_id,
    v_org,
    nullif(btrim(coalesce(p_site_address, '')), ''),
    v_factory,
    nullif(btrim(coalesce(p_delivery_area, '')), ''),
    nullif(btrim(coalesce(p_contractor, '')), ''),
    nullif(btrim(coalesce(p_contractor, '')), ''),
    nullif(btrim(coalesce(p_trading_company_name, '')), ''),
    'mix_design_only'
  )
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.insert_mix_design_anchor_project(text, uuid, text, text, text, text, text) is
  '配合計画書依頼用の物件アンカーを新規作成する。orders は更新しない。commitment_level は mix_design_only。';

revoke all on function public.insert_mix_design_anchor_project(text, uuid, text, text, text, text, text) from public;
grant execute on function public.insert_mix_design_anchor_project(text, uuid, text, text, text, text, text) to anon, authenticated;

create or replace function public.upgrade_project_commitment_to_mix_design_only(p_project_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_customer_panel_request() then
    raise exception 'not authorized';
  end if;
  if p_project_id is null then
    return;
  end if;

  update public.projects
     set commitment_level = 'mix_design_only'
   where id = p_project_id
     and commitment_level is distinct from 'allocated'
     and commitment_level is distinct from 'mix_design_only';
end;
$$;

comment on function public.upgrade_project_commitment_to_mix_design_only(uuid) is
  'spot から mix_design_only への昇格のみ。allocated は変更しない。orders は更新しない。';

revoke all on function public.upgrade_project_commitment_to_mix_design_only(uuid) from public;
grant execute on function public.upgrade_project_commitment_to_mix_design_only(uuid) to anon, authenticated;
