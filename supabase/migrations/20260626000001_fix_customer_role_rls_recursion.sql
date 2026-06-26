-- current_customer_role: customers SELECT時にRLSをバイパス
CREATE OR REPLACE FUNCTION public.current_customer_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_role text;
begin
  -- RLS再帰を防ぐためバイパス
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

-- current_customer_organization_id: 同様にRLSをバイパス
CREATE OR REPLACE FUNCTION public.current_customer_organization_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
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
