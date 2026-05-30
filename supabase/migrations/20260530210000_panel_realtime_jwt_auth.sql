-- =============================================================================
-- Realtime（WebSocket）向けパネル JWT 認証
--
-- REST は custom fetch ヘッダー、Realtime は JWT のみ届くため、
-- ログイン検証後に panel クレーム付き JWT を発行し auth.jwt() でも RLS を評価する。
--
-- 初回セットアップ（Supabase SQL Editor で1回）:
--   select vault.create_secret(
--     '<Dashboard > Project Settings > API > JWT Secret>',
--     'panel_realtime_jwt_secret'
--   );
-- =============================================================================

create extension if not exists pgjwt with schema extensions;

create or replace function public.panel_realtime_jwt_secret()
returns text
language plpgsql
stable
security definer
set search_path = public, vault
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'panel_realtime_jwt_secret'
  limit 1;
  if v_secret is not null and v_secret <> '' then
    return v_secret;
  end if;
  v_secret := nullif(current_setting('app.settings.jwt_secret', true), '');
  return v_secret;
exception
  when others then
    return nullif(current_setting('app.settings.jwt_secret', true), '');
end;
$$;

revoke all on function public.panel_realtime_jwt_secret() from public;

create or replace function public.sign_panel_realtime_jwt(p_claims jsonb)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_secret text;
  v_payload json;
  v_now bigint;
begin
  v_secret := public.panel_realtime_jwt_secret();
  if v_secret is null or v_secret = '' then
    raise exception 'Panel Realtime JWT secret not configured'
      using hint = 'Run: select vault.create_secret(''<JWT Secret>'', ''panel_realtime_jwt_secret'');';
  end if;
  v_now := floor(extract(epoch from now()));
  v_payload := (
    jsonb_build_object(
      'role', 'anon',
      'iss', 'supabase',
      'iat', v_now,
      'exp', v_now + 86400
    ) || coalesce(p_claims, '{}'::jsonb)
  )::json;
  return extensions.sign(v_payload, v_secret, 'HS256');
end;
$$;

revoke all on function public.sign_panel_realtime_jwt(jsonb) from public;

create or replace function public.issue_panel_realtime_jwt(
  p_panel_type text,
  p_credential_a text default null,
  p_credential_b text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text;
  v_id integer;
  v_customer_id uuid;
  v_factory_id text;
  v_token text;
begin
  v_type := lower(nullif(trim(coalesce(p_panel_type, '')), ''));
  if v_type is null then
    raise exception 'panel_type is required' using errcode = 'P0001';
  end if;

  if v_type = 'admin' then
    select s.id into v_id
    from public.admin_settings s
    where s.id = 1
      and trim(coalesce(s.phone_number, '')) = trim(coalesce(p_credential_a, ''))
      and trim(coalesce(s.login_password, '')) = trim(coalesce(p_credential_b, ''));
    if v_id is null then
      raise exception '管理者の電話番号またはパスワードが間違っています' using errcode = 'P0001';
    end if;
    return public.sign_panel_realtime_jwt(jsonb_build_object(
      'panel_type', 'admin',
      'panel_admin_id', v_id
    ));
  end if;

  if v_type = 'customer' then
    select c.id into v_customer_id
    from public.customers c
    where trim(coalesce(c.phone_number, '')) = trim(coalesce(p_credential_a, ''))
      and trim(coalesce(c.login_password, '')) = trim(coalesce(p_credential_b, ''))
    limit 1;
    if v_customer_id is null then
      raise exception '電話番号またはパスワードが間違っています' using errcode = 'P0001';
    end if;
    return public.sign_panel_realtime_jwt(jsonb_build_object(
      'panel_type', 'customer',
      'panel_customer_id', v_customer_id::text
    ));
  end if;

  if v_type = 'factory' then
    v_factory_id := null;
    select f.id::text into v_factory_id
    from public.factories f
    where trim(f.id::text) = trim(coalesce(p_credential_a, ''))
      and trim(coalesce(f.login_password, '')) = trim(coalesce(p_credential_b, ''))
    limit 1;
    if v_factory_id is null then
      raise exception '工場 ID またはパスワードが間違っています' using errcode = 'P0001';
    end if;
    return public.sign_panel_realtime_jwt(jsonb_build_object(
      'panel_type', 'factory',
      'panel_factory_id', v_factory_id
    ));
  end if;

  if v_type = 'guest' then
    v_token := nullif(trim(coalesce(p_credential_a, '')), '');
    if v_token is null or not public.is_valid_site_order_token(v_token) then
      raise exception '無効な専用発注 URL トークンです' using errcode = 'P0001';
    end if;
    return public.sign_panel_realtime_jwt(jsonb_build_object(
      'panel_type', 'guest',
      'panel_site_order_token', v_token
    ));
  end if;

  raise exception 'Unknown panel_type: %', v_type using errcode = 'P0001';
end;
$$;

comment on function public.issue_panel_realtime_jwt(text, text, text) is
  'パネル資格情報を検証し Realtime 用 JWT（24h）を発行する';

revoke all on function public.issue_panel_realtime_jwt(text, text, text) from public;
grant execute on function public.issue_panel_realtime_jwt(text, text, text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- RLS ヘルパー: REST ヘッダー + Realtime JWT の両方を評価
-- ---------------------------------------------------------------------------

create or replace function public.is_admin_panel_request()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  hdr json;
  p_phone text;
  p_pass text;
  v_panel_type text;
  v_admin_id integer;
begin
  v_panel_type := nullif(trim(coalesce(auth.jwt() ->> 'panel_type', '')), '');
  if v_panel_type = 'admin' then
    v_admin_id := coalesce(nullif(trim(coalesce(auth.jwt() ->> 'panel_admin_id', '')), '')::integer, 0);
    return v_admin_id = 1 and exists (select 1 from public.admin_settings s where s.id = 1);
  end if;

  begin
    hdr := nullif(current_setting('request.headers', true), '')::json;
  exception
    when others then
      return false;
  end;
  if hdr is null then
    return false;
  end if;
  p_phone := nullif(trim(hdr ->> 'x-admin-phone'), '');
  p_pass := nullif(trim(hdr ->> 'x-admin-password'), '');
  if p_phone is null or p_pass is null then
    return false;
  end if;
  return exists (
    select 1
    from public.admin_settings s
    where s.id = 1
      and trim(coalesce(s.phone_number, '')) = p_phone
      and trim(coalesce(s.login_password, '')) = p_pass
  );
exception
  when others then
    return false;
end;
$$;

create or replace function public.current_customer_panel_id()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  hdr json;
  p_phone text;
  p_pass text;
  v_id uuid;
  v_panel_type text;
begin
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

create or replace function public.current_factory_panel_id()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  hdr json;
  p_id text;
  p_pass text;
  v_id text;
  v_panel_type text;
  v_jwt_factory_id text;
begin
  v_panel_type := nullif(trim(coalesce(auth.jwt() ->> 'panel_type', '')), '');
  if v_panel_type = 'factory' then
    v_jwt_factory_id := nullif(trim(coalesce(auth.jwt() ->> 'panel_factory_id', '')), '');
    if v_jwt_factory_id is null then
      return null;
    end if;
    if exists (
      select 1
      from public.factories f
      where trim(f.id::text) = v_jwt_factory_id
    ) then
      return v_jwt_factory_id;
    end if;
    return null;
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
  p_id := nullif(trim(hdr ->> 'x-factory-id'), '');
  p_pass := nullif(trim(hdr ->> 'x-factory-password'), '');
  if p_id is null or p_pass is null then
    return null;
  end if;
  select f.id::text into v_id
  from public.factories f
  where trim(f.id::text) = p_id
    and trim(coalesce(f.login_password, '')) = p_pass
  limit 1;
  return v_id;
exception
  when others then
    return null;
end;
$$;

create or replace function public.current_site_order_panel_token()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  hdr json;
  p_token text;
  v_panel_type text;
begin
  v_panel_type := nullif(trim(coalesce(auth.jwt() ->> 'panel_type', '')), '');
  if v_panel_type = 'guest' then
    p_token := nullif(trim(coalesce(auth.jwt() ->> 'panel_site_order_token', '')), '');
    if p_token is null or not public.is_valid_site_order_token(p_token) then
      return null;
    end if;
    return p_token;
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
  p_token := nullif(trim(hdr ->> 'x-site-order-token'), '');
  if p_token is null or not public.is_valid_site_order_token(p_token) then
    return null;
  end if;
  return p_token;
exception
  when others then
    return null;
end;
$$;

-- login RPC: Realtime トークンを同梱（失敗時は null・ログイン自体は成功）
create or replace function public.login_admin(p_phone text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id integer;
  v_admin_name text;
  v_phone_number text;
  v_areas jsonb;
  v_spot numeric;
  v_realtime_token text;
begin
  select
    s.id,
    s.admin_name,
    s.phone_number,
    coalesce(s.allowed_delivery_areas, '[]'::jsonb),
    s.spot_threshold_volume
  into v_id, v_admin_name, v_phone_number, v_areas, v_spot
  from public.admin_settings s
  where s.id = 1
    and trim(coalesce(s.phone_number, '')) = trim(coalesce(p_phone, ''))
    and trim(coalesce(s.login_password, '')) = trim(coalesce(p_password, ''));
  if not found then
    raise exception '管理者の電話番号またはパスワードが間違っています'
      using errcode = 'P0001';
  end if;
  begin
    v_realtime_token := public.sign_panel_realtime_jwt(jsonb_build_object(
      'panel_type', 'admin',
      'panel_admin_id', v_id
    ));
  exception
    when others then
      v_realtime_token := null;
  end;
  return jsonb_build_object(
    'id', v_id,
    'admin_name', v_admin_name,
    'phone_number', v_phone_number,
    'allowed_delivery_areas', v_areas,
    'spot_threshold_volume', v_spot,
    'realtime_token', v_realtime_token
  );
end;
$$;

create or replace function public.login_customer(p_phone text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_company_name text;
  v_phone_number text;
  v_manager_name text;
  v_url_token text;
  v_realtime_token text;
begin
  select
    c.id,
    c.company_name,
    c.phone_number,
    c.manager_name,
    c.url_token::text
  into v_id, v_company_name, v_phone_number, v_manager_name, v_url_token
  from public.customers c
  where trim(coalesce(c.phone_number, '')) = trim(coalesce(p_phone, ''))
    and trim(coalesce(c.login_password, '')) = trim(coalesce(p_password, ''))
  limit 1;
  if v_id is null then
    return null;
  end if;
  begin
    v_realtime_token := public.sign_panel_realtime_jwt(jsonb_build_object(
      'panel_type', 'customer',
      'panel_customer_id', v_id::text
    ));
  exception
    when others then
      v_realtime_token := null;
  end;
  return jsonb_build_object(
    'id', v_id::text,
    'company_name', v_company_name,
    'name', coalesce(v_company_name, ''),
    'phone_number', v_phone_number,
    'manager_name', v_manager_name,
    'url_token', v_url_token,
    'realtime_token', v_realtime_token
  );
end;
$$;

grant execute on function public.login_admin(text, text) to authenticated, anon;
grant execute on function public.login_customer(text, text) to authenticated, anon;
