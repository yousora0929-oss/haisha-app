-- Fix: RETURNS TABLE(id uuid, ...) makes bare `id` ambiguous inside the function body
-- (output column vs customers.id). Qualify all customers references with aliases.
create or replace function public.get_company_members(
  p_contractor_ref_customer_id uuid
)
returns table (
  id uuid,
  name text,
  phone_number text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_caller uuid;
  v_role text;
  v_allowed boolean := false;
  v_target_company text;
begin
  if p_contractor_ref_customer_id is null then
    return;
  end if;

  select trim(coalesce(c0.company_name, '')) into v_target_company
  from public.customers c0
  where c0.id = p_contractor_ref_customer_id;

  if v_target_company is null or v_target_company = '' then
    return;
  end if;

  if public.is_admin_panel_request() or public.is_app_admin() then
    v_allowed := true;
  elsif public.is_customer_panel_request() then
    v_caller := public.current_customer_panel_id();
    v_role := public.current_customer_role();

    if p_contractor_ref_customer_id = v_caller then
      v_allowed := true;
    elsif v_role = 'agent' then
      v_allowed := exists (
        select 1 from public.agent_contractor_links l
        where l.agent_customer_id = v_caller
          and l.contractor_customer_id = p_contractor_ref_customer_id
      );
    elsif v_role = 'cooperative' then
      v_allowed := exists (
        select 1 from public.customers c1
        where c1.id = p_contractor_ref_customer_id
          and coalesce(c1.role, 'contractor') = 'contractor'
      );
    end if;
  end if;

  if not v_allowed then
    return;
  end if;

  return query
  select c.id, c.manager_name as name, c.phone_number
  from public.customers c
  where coalesce(c.role, 'contractor') = 'contractor'
    and trim(coalesce(c.company_name, '')) = v_target_company
    and coalesce(trim(c.manager_name), '') <> ''
    and coalesce(trim(c.phone_number), '') <> ''
  order by c.manager_name;
end;
$$;

comment on function public.get_company_members(uuid) is
  '会社単位（company_name一致・role=contractor）の担当者一覧。現場担当者サジェスト＆DispatchApp自己編集リスト用。';

grant execute on function public.get_company_members(uuid) to anon, authenticated;
