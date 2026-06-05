-- チャット送信: orders.chat_messages のみを安全に追記（フル行 PATCH による 400 / RLS 事故を回避）

create or replace function public.can_panel_append_order_chat(p_order public.orders)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_order is null then false
    when public.is_app_admin() then true
    when public.is_customer_panel_request()
      and p_order.customer_id is not null
      and p_order.customer_id = public.current_customer_panel_id() then true
    when public.is_factory_panel_request()
      and public.factory_can_access_order(p_order) then true
    when public.is_guest_site_order_panel_request()
      and public.guest_can_access_order(p_order) then true
    when public.is_app_customer()
      and public.customer_owns_row(p_order.customer_id) then true
    when public.is_app_factory()
      and public.factory_can_access_order(p_order) then true
    else false
  end;
$$;

create or replace function public.append_order_chat_message(
  p_order_id text,
  p_from text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_list jsonb;
  v_msg jsonb;
  v_next jsonb;
  v_from text;
  v_body text;
begin
  v_body := trim(coalesce(p_body, ''));
  if coalesce(trim(p_order_id), '') = '' or v_body = '' then
    raise exception 'invalid_chat_input' using errcode = 'P0001';
  end if;

  v_from := lower(trim(coalesce(p_from, '')));
  if v_from not in ('factory', 'system', 'admin', 'customer', 'master') then
    v_from := 'master';
  end if;

  select * into v_order
  from public.orders
  where id = trim(p_order_id)
  for update;

  if not found then
    raise exception 'order_not_found' using errcode = 'P0002';
  end if;

  if not public.can_panel_append_order_chat(v_order) then
    raise exception 'chat_append_access_denied' using errcode = '42501';
  end if;

  v_list := coalesce(v_order.chat_messages, '[]'::jsonb);
  if jsonb_typeof(v_list) <> 'array' then
    v_list := '[]'::jsonb;
  end if;

  v_msg := jsonb_build_object(
    'id',
    'msg_' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text || '_'
      || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4),
    'from', v_from,
    'body', v_body,
    'createdAt', to_char(timezone('utc', clock_timestamp()), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
  );

  v_next := v_list || jsonb_build_array(v_msg);

  if jsonb_array_length(v_next) > 100 then
    v_next := (
      select coalesce(jsonb_agg(value order by ord), '[]'::jsonb)
      from (
        select value, ord
        from jsonb_array_elements(v_next) with ordinality as t(value, ord)
        where ord > jsonb_array_length(v_next) - 100
      ) sliced
    );
  end if;

  update public.orders
  set chat_messages = v_next
  where id = v_order.id;

  return v_next;
end;
$$;

comment on function public.append_order_chat_message(text, text, text) is
  'orders.chat_messages に1件追記（パネル認証済みのみ・chat_messages 列のみ更新）';

revoke all on function public.can_panel_append_order_chat(public.orders) from public;
revoke all on function public.append_order_chat_message(text, text, text) from public;
grant execute on function public.can_panel_append_order_chat(public.orders) to authenticated, anon;
grant execute on function public.append_order_chat_message(text, text, text) to authenticated, anon;
