-- =============================================================================
-- 専用発注URL（ゲスト）向け RPC — anon から RLS をバイパスして安全に取得・登録
-- 本番RLSマイグレーション（20260527120000）未適用環境でも単体実行できるよう、
-- get_dispatch_operational_settings もここで定義する。
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

create or replace function public.get_site_order_context_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_token text := trim(coalesce(p_token, ''));
  v_project public.projects%rowtype;
  v_customer public.customers%rowtype;
  v_projects jsonb;
begin
  if not public.is_valid_site_order_token(v_token) then
    return null;
  end if;

  select * into v_project from public.projects where url_token = v_token limit 1;
  if found then
    if v_project.customer_id is not null then
      select * into v_customer from public.customers where id = v_project.customer_id limit 1;
    end if;
    return jsonb_build_object(
      'match', 'project',
      'token', v_token,
      'project', to_jsonb(v_project),
      'customer', case when v_customer.id is not null then
        jsonb_build_object(
          'id', v_customer.id,
          'company_name', v_customer.company_name,
          'name', coalesce(v_customer.company_name, v_customer.name),
          'phone_number', v_customer.phone_number,
          'manager_name', v_customer.manager_name,
          'url_token', v_customer.url_token
        )
      else null end,
      'projects', jsonb_build_array(to_jsonb(v_project))
    );
  end if;

  select * into v_customer from public.customers where url_token = v_token limit 1;
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
        'id', v_customer.id,
        'company_name', v_customer.company_name,
        'name', coalesce(v_customer.company_name, v_customer.name),
        'phone_number', v_customer.phone_number,
        'manager_name', v_customer.manager_name,
        'url_token', v_customer.url_token
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
begin
  v_ctx := public.get_site_order_context_by_token(p_token);
  if v_ctx is null then
    return '[]'::jsonb;
  end if;

  v_project := v_ctx->'project';
  if v_project is not null and v_project->>'main_factory_id' is not null then
    v_ids := array_append(v_ids, (v_project->>'main_factory_id')::uuid);
    v_sub := v_project->'sub_factory_ids';
    if v_sub is not null and jsonb_typeof(v_sub) = 'array' then
      for v_elem in select value from jsonb_array_elements(v_sub) loop
        begin
          v_ids := array_append(v_ids, trim(both '"' from v_elem::text)::uuid);
        exception when others then
          null;
        end;
      end loop;
    end if;
  end if;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    return coalesce(
      (
        select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'phone_number', f.phone_number, 'latitude', f.latitude, 'longitude', f.longitude) order by f.name)
        from public.factories f
      ),
      '[]'::jsonb
    );
  end if;

  return coalesce(
    (
      select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'phone_number', f.phone_number, 'latitude', f.latitude, 'longitude', f.longitude) order by f.name)
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
  v_inserted jsonb := '[]'::jsonb;
begin
  v_ctx := public.get_site_order_context_by_token(p_token);
  if v_ctx is null then
    raise exception 'invalid_site_order_token' using errcode = 'P0001';
  end if;

  v_match := v_ctx->>'match';
  v_customer_id := (v_ctx->'customer'->>'id')::uuid;
  if v_customer_id is null then
    raise exception 'customer_not_found_for_token' using errcode = 'P0001';
  end if;

  if v_match = 'project' and v_ctx->'project' is not null then
    v_project_id := (v_ctx->'project'->>'id')::uuid;
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

    if v_match = 'customer' and coalesce(nullif(trim(coalesce(v_elem->>'project_id', v_elem->>'projectId', '')), ''), '') <> '' then
      if not exists (
        select 1
        from public.projects p
        where p.id = nullif(trim(coalesce(v_elem->>'project_id', v_elem->>'projectId', '')), '')::uuid
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
        else nullif(trim(coalesce(v_elem->>'project_id', v_elem->>'projectId', '')), '')::uuid
      end,
      nullif(v_elem->>'delivery_lat', '')::double precision,
      nullif(v_elem->>'delivery_lng', '')::double precision,
      nullif(trim(coalesce(v_elem->>'preferred_factory_id', v_elem->>'preferredFactoryId', '')), '')::uuid,
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
revoke all on function public.get_site_order_context_by_token(text) from public;
revoke all on function public.get_guest_factories_for_token(text) from public;
revoke all on function public.submit_guest_orders(text, jsonb) from public;

grant execute on function public.is_valid_site_order_token(text) to anon, authenticated;
grant execute on function public.get_site_order_context_by_token(text) to anon, authenticated;
grant execute on function public.get_guest_factories_for_token(text) to anon, authenticated;
grant execute on function public.submit_guest_orders(text, jsonb) to anon, authenticated;

comment on function public.get_site_order_context_by_token(text) is
  '専用発注URLトークンから物件・業者を解決（login_password 等は返さない）';
comment on function public.submit_guest_orders(text, jsonb) is
  '専用発注URL経由のゲスト発注（トークンに紐づく業者・物件のみ許可）';
