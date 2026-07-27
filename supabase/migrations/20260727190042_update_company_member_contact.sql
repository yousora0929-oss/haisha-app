create or replace function public.update_company_member_contact(
  p_customer_id uuid,
  p_name text,
  p_phone text
)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_caller uuid;
  v_caller_company text;
  v_target_company text;
  v_target_role text;
  v_name text := trim(coalesce(p_name, ''));
  v_phone text := trim(coalesce(p_phone, ''));
begin
  if v_name = '' or v_phone = '' then
    raise exception '氏名と電話番号は必須です';
  end if;

  if public.is_admin_panel_request() or public.is_app_admin() then
    update public.customers
    set manager_name = v_name, phone_number = v_phone
    where id = p_customer_id;
    return;
  end if;

  if not public.is_customer_panel_request() then
    raise exception '権限がありません';
  end if;

  v_caller := public.current_customer_panel_id();

  select trim(coalesce(company_name, '')) into v_caller_company
  from public.customers
  where id = v_caller;

  select trim(coalesce(company_name, '')), coalesce(role, 'contractor')
    into v_target_company, v_target_role
  from public.customers
  where id = p_customer_id;

  if v_target_role <> 'contractor' then
    raise exception '編集できない対象です';
  end if;

  if v_caller_company is null or v_caller_company = ''
     or v_target_company is null or v_target_company <> v_caller_company then
    raise exception '他社の担当者は編集できません';
  end if;

  update public.customers
  set manager_name = v_name, phone_number = v_phone
  where id = p_customer_id;
end;
$$;

comment on function public.update_company_member_contact(uuid, text, text) is
  '担当者の氏名・電話番号のみ更新。login_password/role/organization_idには一切触れない。DispatchApp自己編集用（同一company_nameの相手のみ、他社は不可）。管理者は全件可。';

grant execute on function public.update_company_member_contact(uuid, text, text) to anon, authenticated;