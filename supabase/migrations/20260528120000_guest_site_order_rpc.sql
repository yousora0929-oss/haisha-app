-- =============================================================================
-- 専用発注URL（ゲスト）向け RPC — anon から RLS をバイパスして安全に取得・登録
-- 本番RLSマイグレーション（20260527120000）未適用環境でも単体実行できるよう、
-- get_dispatch_operational_settings もここで定義する。
--
-- url_token 列は環境により uuid または text のため、比較は常に ::text 正規化で行う。
-- =============================================================================

-- 発注画面向け: パスワードを含まない運用設定のみ（SECURITY DEFINER）
create or replace function public.get_dispatch_operational_settings()
returns table (
  id integer,
  admin_name text,
  phone_number text,
  allowed_delivery_areas jsonb,
  spot_threshold_volume numeric
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    s.admin_name,
    s.phone_number,
    s.allowed_delivery_areas,
    s.spot_threshold_volume
  from public.admin_settings s
  where s.id = 1;
$$;

revoke all on function public.get_dispatch_operational_settings() from public;
grant execute on function public.get_dispatch_operational_settings() to anon, authenticated;

comment on function public.get_dispatch_operational_settings() is
  '顧客・工場・ゲスト発注向け運用設定（login_password を返さない）';

create or replace function public.is_valid_site_order_token(p_token text)
returns boolean
language sql
immutable
as $$
  select
    coalesce(trim(p_token), '') <> ''
    and trim(p_token) !~* '^kix'
    and (
      trim(p_token) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or trim(p_token) ~* '^[a-z0-9][a-z0-9_-]{3,127}$'
    );
$$;

/** text / json 由来の値を uuid に安全変換（失敗時 NULL） */
create or replace function public.safe_text_to_uuid(p_text text)
returns uuid
language plpgsql
immutable
as $$
declare
  v text := lower(trim(coalesce(p_text, '')));
begin
  if v = '' then
    return null;
  end if;
  return v::uuid;
exception
  when others then
    return null;
end;
$$;

/** @deprecated 互換エイリアス */
create or replace function public.site_order_token_as_uuid(p_token text)
returns uuid
language sql
immutable
as $$
  select public.safe_text_to_uuid(p_token);
$$;

/**
 * url_token 列（uuid または text）と URL トークン文字列の一致判定。
 * uuid = text / text = uuid を避けるため、双方を text に正規化して比較する。
 */
create or replace function public.site_order_url_token_equals(p_stored_token text, p_token text)
returns boolean
language sql
immutable
as $$
  select
    coalesce(trim(p_stored_token), '') <> ''
    and lower(trim(p_stored_token)) = lower(trim(coalesce(p_token, '')));
$$;

/** jsonb 配列要素（サブ工場 ID 等）を uuid に変換 */
create or replace function public.jsonb_elem_to_uuid(p_elem jsonb)
returns uuid
language plpgsql
immutable
as $$
declare
  v text;
begin
  if p_elem is null or p_elem = 'null'::jsonb then
    return null;
  end if;
  if jsonb_typeof(p_elem) = 'string' then
    v := trim(both '"' from p_elem::text);
  else
    v := trim(p_elem::text);
  end if;
  return public.safe_text_to_uuid(v);
exception
  when others then
    return null;
end;
$$;

create or replace function public.get_site_order_context_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_token text := lower(trim(coalesce(p_token, '')));
  v_project public.projects%rowtype;
  v_customer public.customers%rowtype;
  v_projects jsonb;
begin
  if not public.is_valid_site_order_token(v_token) then
    return null;
  end if;

  select * into v_project
  from public.projects p
  where p.url_token is not null
    and public.site_order_url_token_equals(p.url_token::text, v_token)
  limit 1;

  if found then
    if v_project.customer_id is not null then
      select * into v_customer
      from public.customers c
      where c.id = v_project.customer_id
      limit 1;
    end if;
    return jsonb_build_object(
      'match', 'project',
      'token', v_token,
      'project', to_jsonb(v_project),
      'customer', case when v_customer.id is not null then
        jsonb_build_object(
          'id', v_customer.id::text,
          'company_name', v_customer.company_name,
          'name', v_customer.company_name,
          'phone_number', v_customer.phone_number,
          'manager_name', v_customer.manager_name,
          'url_token', v_customer.url_token::text
        )
      else null end,
      'projects', jsonb_build_array(to_jsonb(v_project))
    );
  end if;

  select * into v_customer
  from public.customers c
  where c.url_token is not null
    and public.site_order_url_token_equals(c.url_token::text, v_token)
  limit 1;

  if found then
    select coalesce(jsonb_agg(to_jsonb(p) order by p.name), '[]'::jsonb)
    into v_projects
    from public.projects p
    where p.customer_id = v_customer.id;

    return jsonb_build_object(
      'match', 'customer',
      'token', v_token,
      'project', null,
      'customer', jsonb_build_object(
        'id', v_customer.id::text,
        'company_name', v_customer.company_name,
        'name', v_customer.company_name,
        'phone_number', v_customer.phone_number,
        'manager_name', v_customer.manager_name,
        'url_token', v_customer.url_token::text
      ),
      'projects', coalesce(v_projects, '[]'::jsonb)
    );
  end if;

  return null;
end;
$$;

create or replace function public.get_guest_factories_for_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ctx jsonb;
  v_project jsonb;
  v_ids uuid[] := array[]::uuid[];
  v_sub jsonb;
  v_elem jsonb;
  v_fid uuid;
begin
  v_ctx := public.get_site_order_context_by_token(p_token);
  if v_ctx is null then
    return '[]'::jsonb;
  end if;

  v_project := v_ctx->'project';
  if v_project is not null and coalesce(v_project->>'main_factory_id', '') <> '' then
    v_fid := public.safe_text_to_uuid(v_project->>'main_factory_id');
    if v_fid is not null then
      v_ids := array_append(v_ids, v_fid);
    end if;
    v_sub := v_project->'sub_factory_ids';
    if v_sub is not null and jsonb_typeof(v_sub) = 'array' then
      for v_elem in select value from jsonb_array_elements(v_sub) loop
        v_fid := public.jsonb_elem_to_uuid(v_elem);
        if v_fid is not null then
          v_ids := array_append(v_ids, v_fid);
        end if;
      end loop;
    end if;
  end if;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'id', f.id::text,
            'name', f.name,
            'latitude', f.latitude,
            'longitude', f.longitude
          )
          order by f.name
        )
        from public.factories f
      ),
      '[]'::jsonb
    );
  end if;

  return coalesce(
    (
      select jsonb_agg(
        jsonb_build_object(
          'id', f.id::text,
          'name', f.name,
          'latitude', f.latitude,
          'longitude', f.longitude
        )
        order by f.name
      )
      from public.factories f
      where f.id = any (v_ids)
    ),
    '[]'::jsonb
  );
end;
$$;

create or replace function public.submit_guest_orders(p_token text, p_orders jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ctx jsonb;
  v_customer_id uuid;
  v_project_id uuid;
  v_match text;
  v_elem jsonb;
  v_order_id text;
  v_is_spot boolean;
  v_status text;
  v_elem_project_id uuid;
  v_elem_pref_factory_id uuid;
  v_inserted jsonb := '[]'::jsonb;
begin
  v_ctx := public.get_site_order_context_by_token(p_token);
  if v_ctx is null then
    raise exception 'invalid_site_order_token' using errcode = 'P0001';
  end if;

  v_match := v_ctx->>'match';
  v_customer_id := public.safe_text_to_uuid(v_ctx->'customer'->>'id');
  if v_customer_id is null then
    raise exception 'customer_not_found_for_token' using errcode = 'P0001';
  end if;

  if v_match = 'project' and v_ctx->'project' is not null then
    v_project_id := public.safe_text_to_uuid(v_ctx->'project'->>'id');
  end if;

  if p_orders is null or jsonb_typeof(p_orders) <> 'array' or jsonb_array_length(p_orders) = 0 then
    raise exception 'orders_required' using errcode = 'P0001';
  end if;

  for v_elem in select value from jsonb_array_elements(p_orders) loop
    v_order_id := coalesce(nullif(trim(v_elem->>'id'), ''), 'ord_' || gen_random_uuid()::text);
    v_is_spot := coalesce((v_elem->>'is_spot')::boolean, (v_elem->>'isSpot')::boolean, false);
    v_status := coalesce(nullif(trim(v_elem->>'status'), ''), 'pending');

    if v_match = 'project' and v_project_id is not null then
      v_is_spot := false;
    end if;

    v_elem_project_id := public.safe_text_to_uuid(
      coalesce(v_elem->>'project_id', v_elem->>'projectId', '')
    );
    v_elem_pref_factory_id := public.safe_text_to_uuid(
      coalesce(v_elem->>'preferred_factory_id', v_elem->>'preferredFactoryId', '')
    );

    if v_match = 'customer' and v_elem_project_id is not null then
      if not exists (
        select 1
        from public.projects p
        where p.id = v_elem_project_id
          and p.customer_id = v_customer_id
      ) then
        raise exception 'project_not_allowed_for_token' using errcode = 'P0001';
      end if;
    end if;

    insert into public.orders (
      id,
      order_data,
      chat_messages,
      has_test,
      customer_id,
      ordered_by,
      is_spot,
      project_id,
      delivery_lat,
      delivery_lng,
      preferred_factory_id,
      factory_site_id,
      status,
      is_location_pending,
      rejected_factory_ids
    ) values (
      v_order_id,
      v_elem,
      '[]'::jsonb,
      coalesce((v_elem->>'has_test')::boolean, (v_elem->>'hasTest')::boolean, false),
      v_customer_id,
      nullif(trim(coalesce(v_elem->>'ordered_by', v_elem->>'orderedBy', '')), ''),
      v_is_spot,
      case
        when v_match = 'project' then v_project_id
        else v_elem_project_id
      end,
      nullif(v_elem->>'delivery_lat', '')::double precision,
      nullif(v_elem->>'delivery_lng', '')::double precision,
      v_elem_pref_factory_id,
      null,
      v_status,
      coalesce((v_elem->>'is_location_pending')::boolean, (v_elem->>'isLocationPending')::boolean, false),
      '[]'::jsonb
    );

    v_inserted := v_inserted || jsonb_build_array(jsonb_build_object('id', v_order_id));
  end loop;

  return v_inserted;
end;
$$;

revoke all on function public.is_valid_site_order_token(text) from public;
revoke all on function public.safe_text_to_uuid(text) from public;
revoke all on function public.site_order_token_as_uuid(text) from public;
revoke all on function public.site_order_url_token_equals(text, text) from public;
revoke all on function public.jsonb_elem_to_uuid(jsonb) from public;
revoke all on function public.get_site_order_context_by_token(text) from public;
revoke all on function public.get_guest_factories_for_token(text) from public;
revoke all on function public.submit_guest_orders(text, jsonb) from public;

grant execute on function public.is_valid_site_order_token(text) to anon, authenticated;
grant execute on function public.safe_text_to_uuid(text) to anon, authenticated;
grant execute on function public.site_order_token_as_uuid(text) to anon, authenticated;
grant execute on function public.site_order_url_token_equals(text, text) to anon, authenticated;
grant execute on function public.jsonb_elem_to_uuid(jsonb) to anon, authenticated;
grant execute on function public.get_site_order_context_by_token(text) to anon, authenticated;
grant execute on function public.get_guest_factories_for_token(text) to anon, authenticated;
grant execute on function public.submit_guest_orders(text, jsonb) to anon, authenticated;

comment on function public.get_site_order_context_by_token(text) is
  '専用発注URLトークンから物件・業者を解決（login_password 等は返さない）';
comment on function public.submit_guest_orders(text, jsonb) is
  '専用発注URL経由のゲスト発注（トークンに紐づく業者・物件のみ許可）';
