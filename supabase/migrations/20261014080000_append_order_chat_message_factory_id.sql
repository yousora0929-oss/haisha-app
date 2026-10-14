-- 工場発言だけに、呼び出した工場の ID をサーバー側で付ける。
-- GRANT / REVOKE は変更しない（create or replace で既存の実行権限を引き継ぐ）。

create or replace function public.append_order_chat_message(p_order_id text, p_from text, p_body text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.orders;
  v_list jsonb;
  v_msg jsonb;
  v_next jsonb;
  v_from text;
  v_body text;
  v_factory_id text;
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
  -- NULL / 非配列は空配列にフォールバック
  v_list := coalesce(v_order.chat_messages, '[]'::jsonb);
  if jsonb_typeof(v_list) is distinct from 'array' then
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
  -- 工場発言のみ、呼び出した工場のIDをサーバー側で付与する（クライアント指定は信用しない）
  -- 呼び出し元が工場として特定できない場合（管理者がfactory名義で送る等）は付与せず、そのまま保存する
  if v_from = 'factory' then
    v_factory_id := nullif(trim(coalesce(public.effective_factory_actor_id(), '')), '');
    if v_factory_id is not null then
      v_msg := v_msg || jsonb_build_object('factoryId', v_factory_id);
    end if;
  end if;
  -- JSONB 配列に安全に追記
  v_next := v_list || jsonb_build_array(v_msg);
  -- 最大100件（古いものから削除）
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
$function$;
