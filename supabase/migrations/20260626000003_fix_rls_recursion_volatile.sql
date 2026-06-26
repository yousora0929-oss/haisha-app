-- STABLE→VOLATILEに変更しSET LOCAL row_security=offを確実に効かせる

CREATE OR REPLACE FUNCTION public.current_customer_role()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_role text;
begin
  SET LOCAL row_security = off;
  select role into v_role
  from public.customers
  where id = public.current_customer_panel_id()
  limit 1;
  return v_role;
exception
  when others then
    return null;
end;
$$;

CREATE OR REPLACE FUNCTION public.current_customer_organization_id()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_org_id uuid;
begin
  SET LOCAL row_security = off;
  select organization_id into v_org_id
  from public.customers
  where id = public.current_customer_panel_id()
  limit 1;
  return v_org_id;
exception
  when others then
    return null;
end;
$$;

CREATE OR REPLACE FUNCTION public.current_customer_panel_id()
RETURNS uuid
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
declare
  hdr json;
  p_phone text;
  p_pass text;
  v_id uuid;
  v_panel_type text;
begin
  SET LOCAL row_security = off;
  v_panel_type := nullif(trim(coalesce(auth.jwt() ->> 'panel_type', '')), '');
  if v_panel_type = 'customer' then
    return public.safe_text_to_uuid(auth.jwt() ->> 'panel_customer_id');
  end if;
  begin
    hdr := nullif(current_setting('request.headers', true), '')::json;
  exception
    when others then
      return null;
  end;
  if hdr is null then
    return null;
  end if;
  p_phone := nullif(trim(hdr ->> 'x-customer-phone'), '');
  p_pass := nullif(trim(hdr ->> 'x-customer-password'), '');
  if p_phone is null or p_pass is null then
    return null;
  end if;
  select c.id into v_id
  from public.customers c
  where trim(coalesce(c.phone_number, '')) = p_phone
    and trim(coalesce(c.login_password, '')) = p_pass
  limit 1;
  return v_id;
exception
  when others then
    return null;
end;
$$;

CREATE OR REPLACE FUNCTION public.factory_can_access_project(p_project_id uuid)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
begin
  SET LOCAL row_security = off;
  return (
    case
      when p_project_id is null then false
      when public.is_app_admin() then true
      when not public.is_app_factory() and not public.is_factory_panel_request() then false
      else exists (
        select 1
        from public.projects p
        where p.id = p_project_id
          and (
            trim(p.main_factory_id::text) = public.effective_factory_actor_id()
            or coalesce(p.sub_factory_ids, '[]'::jsonb) @> jsonb_build_array(public.effective_factory_actor_id())
          )
      )
    end
  );
end;
$$;
