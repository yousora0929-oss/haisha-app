-- submit_guest_orders: preferred_factory_id 未指定時は main_factory_id を第一希望に使う

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
      coalesce(
        v_elem->>'preferred_factory_id',
        v_elem->>'preferredFactoryId',
        v_elem->>'main_factory_id',
        v_elem->>'mainFactoryId',
        ''
      )
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
