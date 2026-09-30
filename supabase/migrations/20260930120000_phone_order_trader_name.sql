-- register_phone_order_by_factory に任意の商社名 p_trader_name を末尾追加
-- （既存呼び出しは default null で後方互換。引数リストが変わるため旧シグネチャを drop）

drop function if exists public.register_phone_order_by_factory(
  text, text, uuid, uuid, numeric, text, date, text, text, text, text, text, text, text, text, text, text, text
);

create or replace function public.register_phone_order_by_factory(
  p_factory_id text,
  p_factory_name text,
  p_customer_id uuid,
  p_project_id uuid,
  p_quantity_m3 numeric,
  p_mix_text text,
  p_preferred_date date,
  p_time_slot text,
  p_time_slot_label text,
  p_site_name text,
  p_site_address text,
  p_delivery_area text,
  p_site_address_detail text,
  p_ordered_by_name text,
  p_site_phone text,
  p_vehicle_type text default 'large',
  p_unload_duration text default '30',
  p_registered_by_name text default null,
  p_trader_name text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller_factory_id text;
  v_factory_id text;
  v_order_id text;
  v_now timestamptz := now();
  v_order_data jsonb;
  v_row public.orders;
  v_customer public.customers;
  v_project public.projects;
  v_site_name text;
  v_site_address text;
  v_delivery_area text;
  v_ordered_by text;
  v_site_contact text;
  v_vehicle_type text;
  v_unload text;
  v_qty numeric;
  v_time_minutes int;
  v_chat_body text;
  v_pref_uuid uuid;
  v_name_norm text;
  v_project_sub_norm text;
  v_trader_name text;
begin
  v_caller_factory_id := nullif(trim(coalesce(public.current_factory_panel_id(), '')), '');
  if v_caller_factory_id is null then
    raise exception '工場認証が必要です' using errcode = 'P0001';
  end if;

  v_factory_id := nullif(trim(coalesce(p_factory_id, '')), '');
  if v_factory_id is null then
    raise exception '工場IDが必要です' using errcode = 'P0001';
  end if;
  if v_factory_id is distinct from v_caller_factory_id then
    raise exception '工場IDが一致しません' using errcode = 'P0001';
  end if;

  if p_customer_id is null then
    raise exception '顧客IDが必要です（既存登録顧客のみ対象）' using errcode = 'P0001';
  end if;

  v_qty := p_quantity_m3;
  if v_qty is null or v_qty <= 0 then
    raise exception '数量（m³）が不正です' using errcode = 'P0001';
  end if;

  select * into v_customer from public.customers where id = p_customer_id;
  if not found then
    raise exception '指定された顧客が見つかりません' using errcode = 'P0001';
  end if;

  if p_project_id is not null then
    select * into v_project from public.projects where id = p_project_id;
    if not found then
      raise exception '指定された物件が見つかりません' using errcode = 'P0001';
    end if;
    v_name_norm := lower(regexp_replace(coalesce(v_customer.company_name, ''), '\s+', '', 'g'));
    v_project_sub_norm := lower(regexp_replace(coalesce(v_project.sub_contractor_name, v_project.contractor, ''), '\s+', '', 'g'));
    if v_project.customer_id is distinct from p_customer_id
       and (v_name_norm = '' or v_project_sub_norm is distinct from v_name_norm) then
      raise exception '指定された物件はこの顧客に紐づいていません' using errcode = 'P0001';
    end if;
  end if;

  v_order_id := 'ord_' || gen_random_uuid()::text;
  v_site_name := nullif(trim(coalesce(p_site_name, '')), '');
  if v_site_name is null and p_project_id is not null then
    v_site_name := nullif(trim(coalesce(v_project.name, '')), '');
  end if;
  v_site_address := nullif(trim(coalesce(p_site_address, '')), '');
  if v_site_address is null and p_project_id is not null then
    v_site_address := nullif(trim(coalesce(v_project.site_address, '')), '');
  end if;
  v_delivery_area := coalesce(nullif(trim(coalesce(p_delivery_area, '')), ''), '');
  if v_delivery_area = '' and p_project_id is not null then
    v_delivery_area := coalesce(nullif(trim(coalesce(v_project.delivery_area, '')), ''), '');
  end if;

  v_ordered_by := coalesce(nullif(trim(coalesce(v_customer.manager_name, '')), ''), '');
  v_site_contact := coalesce(nullif(trim(coalesce(p_ordered_by_name, '')), ''), '');
  v_vehicle_type := case when lower(trim(coalesce(p_vehicle_type, 'large'))) = 'small' then 'small' else 'large' end;
  v_unload := coalesce(nullif(trim(coalesce(p_unload_duration, '')), ''), '30');
  -- 商社名：空欄はそのまま空欄（フォールバック文字列は入れない）
  v_trader_name := nullif(trim(coalesce(p_trader_name, '')), '');

  begin
    v_time_minutes := nullif(trim(coalesce(p_time_slot, '')), '')::int;
  exception when others then
    v_time_minutes := null;
  end;

  -- preferred_factory_id は uuid 型の環境があるため、uuid として解釈できる場合のみセット
  begin
    v_pref_uuid := v_factory_id::uuid;
  exception when others then
    v_pref_uuid := null;
  end;

  v_order_data := jsonb_build_object(
    'id', v_order_id,
    'customer_id', p_customer_id,
    'customerId', p_customer_id,
    'customerName', coalesce(v_customer.company_name, ''),
    'project_id', p_project_id,
    'projectId', p_project_id,
    'is_spot', p_project_id is null,
    'quantityM3', v_qty,
    'confirmedQuantityM3', v_qty,
    'mixText', coalesce(nullif(trim(coalesce(p_mix_text, '')), ''), ''),
    'confirmedMixText', coalesce(nullif(trim(coalesce(p_mix_text, '')), ''), ''),
    'preferredDate', p_preferred_date,
    'scheduleMatchDate', p_preferred_date,
    'timeSlot', coalesce(nullif(trim(coalesce(p_time_slot, '')), ''), ''),
    'timeSlotLabel', coalesce(nullif(trim(coalesce(p_time_slot_label, '')), ''), ''),
    'timePointLabel', coalesce(nullif(trim(coalesce(p_time_slot_label, '')), ''), ''),
    'timeSlotMinutes', v_time_minutes,
    'scheduleMatchMinutes', v_time_minutes,
    'siteName', coalesce(v_site_name, ''),
    'siteAddress', coalesce(v_site_address, ''),
    'deliveryArea', v_delivery_area,
    'delivery_area', v_delivery_area,
    'siteAddressDetail', coalesce(nullif(trim(coalesce(p_site_address_detail, '')), ''), ''),
    'ordered_by', v_ordered_by,
    'order_placer_name', v_ordered_by,
    'orderPlacerName', v_ordered_by,
    'orderedBy', v_site_contact,
    'site_contact_name', v_site_contact,
    'siteContactName', v_site_contact,
    'sitePhone', coalesce(nullif(trim(coalesce(p_site_phone, '')), ''), ''),
    'vehicleType', v_vehicle_type,
    'vehicleLabel', case when v_vehicle_type = 'small' then '小型' else '大型' end,
    'unloadDuration', v_unload,
    'unloadDurationMinutes', v_unload,
    'factorySiteId', v_factory_id,
    'factory_site_id', v_factory_id,
    'factorySiteName', coalesce(nullif(trim(coalesce(p_factory_name, '')), ''), v_factory_id),
    'preferred_factory_id', v_factory_id,
    'preferredFactoryId', v_factory_id,
    'acceptedFactoryLabel', '受注工場：' || coalesce(nullif(trim(coalesce(p_factory_name, '')), ''), v_factory_id),
    'status', 'accepted',
    'factoryResponseStatus', 'accepted',
    'factoryResponseLocked', true,
    'traderName', coalesce(v_trader_name, ''),
    'is_phone_order', true,
    'phone_order_factory_id', v_factory_id,
    'phone_order_registered_by', nullif(trim(coalesce(p_registered_by_name, '')), ''),
    'phone_order_registered_at', v_now,
    'accepted_at', v_now,
    'acceptedAt', v_now
  );

  v_chat_body := format(
    '【電話注文】%sが電話注文を登録しました（担当：%s）',
    coalesce(nullif(trim(coalesce(p_factory_name, '')), ''), v_factory_id),
    coalesce(nullif(trim(coalesce(p_registered_by_name, '')), ''), '不明')
  );

  insert into public.orders (
    id,
    order_data,
    chat_messages,
    customer_id,
    ordered_by,
    is_spot,
    project_id,
    status,
    factory_site_id,
    preferred_factory_id,
    rejected_factory_ids,
    has_test,
    is_location_pending,
    is_phone_order,
    phone_order_factory_id,
    phone_order_registered_by,
    phone_order_registered_at,
    accepted_at,
    created_at
  ) values (
    v_order_id,
    v_order_data,
    jsonb_build_array(
      jsonb_build_object(
        'id', 'msg_' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text || '_'
          || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4),
        'from', 'system',
        'body', v_chat_body,
        'createdAt', to_char(timezone('utc', v_now), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      )
    ),
    p_customer_id,
    nullif(v_ordered_by, ''),
    p_project_id is null,
    p_project_id,
    'accepted',
    v_factory_id,
    v_pref_uuid,
    '[]'::jsonb,
    false,
    false,
    true,
    v_factory_id,
    nullif(trim(coalesce(p_registered_by_name, '')), ''),
    v_now,
    v_now,
    v_now
  )
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.register_phone_order_by_factory(
  text, text, uuid, uuid, numeric, text, date, text, text, text, text, text, text, text, text, text, text, text, text
) from public;
grant execute on function public.register_phone_order_by_factory(
  text, text, uuid, uuid, numeric, text, date, text, text, text, text, text, text, text, text, text, text, text, text
) to anon, authenticated;

comment on function public.register_phone_order_by_factory(
  text, text, uuid, uuid, numeric, text, date, text, text, text, text, text, text, text, text, text, text, text, text
) is
  '工場が電話で受けた注文を、既存登録顧客に紐づけて即受注確定状態で登録するRPC（任意の商社名可）';
