-- current_customer_role / organization_id の重複解決を削減
-- シグネチャ・外部意味は不変。リクエスト（トランザクション）内で結果をキャッシュする。
-- VOLATILE + SET LOCAL row_security=off は維持（再帰回避）。

create or replace function public.current_customer_panel_id()
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  hdr json;
  p_phone text;
  p_pass text;
  v_id uuid;
  v_panel_type text;
  v_ready text;
  v_cached text;
begin
  v_ready := current_setting('haisha.ccp_id_ready', true);
  if v_ready = '1' then
    v_cached := current_setting('haisha.ccp_id', true);
    if v_cached is null or v_cached = '' then
      return null;
    end if;
    return v_cached::uuid;
  end if;

  set local row_security = off;
  v_panel_type := nullif(trim(coalesce(auth.jwt() ->> 'panel_type', '')), '');
  if v_panel_type = 'customer' then
    v_id := public.safe_text_to_uuid(auth.jwt() ->> 'panel_customer_id');
    perform set_config('haisha.ccp_id_ready', '1', true);
    perform set_config('haisha.ccp_id', coalesce(v_id::text, ''), true);
    return v_id;
  end if;

  begin
    hdr := nullif(current_setting('request.headers', true), '')::json;
  exception
    when others then
      perform set_config('haisha.ccp_id_ready', '1', true);
      perform set_config('haisha.ccp_id', '', true);
      return null;
  end;
  if hdr is null then
    perform set_config('haisha.ccp_id_ready', '1', true);
    perform set_config('haisha.ccp_id', '', true);
    return null;
  end if;
  p_phone := nullif(trim(hdr ->> 'x-customer-phone'), '');
  p_pass := nullif(trim(hdr ->> 'x-customer-password'), '');
  if p_phone is null or p_pass is null then
    perform set_config('haisha.ccp_id_ready', '1', true);
    perform set_config('haisha.ccp_id', '', true);
    return null;
  end if;

  select c.id into v_id
  from public.customers c
  where trim(coalesce(c.phone_number, '')) = p_phone
    and trim(coalesce(c.login_password, '')) = p_pass
  limit 1;

  perform set_config('haisha.ccp_id_ready', '1', true);
  perform set_config('haisha.ccp_id', coalesce(v_id::text, ''), true);
  return v_id;
exception
  when others then
    perform set_config('haisha.ccp_id_ready', '1', true);
    perform set_config('haisha.ccp_id', '', true);
    return null;
end;
$$;

-- role と organization_id を1回の SELECT で解決しキャッシュする内部ヘルパー
create or replace function public.current_customer_panel_attrs()
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_role text;
  v_org uuid;
begin
  if current_setting('haisha.ccp_attrs_ready', true) = '1' then
    return;
  end if;

  set local row_security = off;
  v_id := public.current_customer_panel_id();
  if v_id is null then
    perform set_config('haisha.ccp_attrs_ready', '1', true);
    perform set_config('haisha.ccp_role', '', true);
    perform set_config('haisha.ccp_org', '', true);
    return;
  end if;

  select c.role, c.organization_id
    into v_role, v_org
  from public.customers c
  where c.id = v_id
  limit 1;

  perform set_config('haisha.ccp_attrs_ready', '1', true);
  perform set_config('haisha.ccp_role', coalesce(v_role, ''), true);
  perform set_config('haisha.ccp_org', coalesce(v_org::text, ''), true);
exception
  when others then
    perform set_config('haisha.ccp_attrs_ready', '1', true);
    perform set_config('haisha.ccp_role', '', true);
    perform set_config('haisha.ccp_org', '', true);
end;
$$;

revoke all on function public.current_customer_panel_attrs() from public;
grant execute on function public.current_customer_panel_attrs() to anon, authenticated;

create or replace function public.current_customer_role()
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_role text;
begin
  perform public.current_customer_panel_attrs();
  v_role := nullif(current_setting('haisha.ccp_role', true), '');
  return v_role;
exception
  when others then
    return null;
end;
$$;

create or replace function public.current_customer_organization_id()
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_org text;
begin
  perform public.current_customer_panel_attrs();
  v_org := nullif(current_setting('haisha.ccp_org', true), '');
  if v_org is null or v_org = '' then
    return null;
  end if;
  return v_org::uuid;
exception
  when others then
    return null;
end;
$$;

comment on function public.current_customer_panel_attrs() is
  '内部用: current_customer_role / organization_id が共有する role+org 解決（リクエスト内キャッシュ）';
comment on function public.current_customer_panel_id() is
  'カスタマーパネルの顧客ID。JWTまたはヘッダー照合。リクエスト内キャッシュ付き。';
