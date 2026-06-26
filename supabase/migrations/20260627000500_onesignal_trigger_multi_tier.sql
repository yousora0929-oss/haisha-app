-- ============================================================
-- onesignal-push トリガーにマルチティア発注フィールドを追加
-- ============================================================
-- DBトリガーがEdge Functionに送るpayloadに
-- contractor_customer_id / agent_organization_id を追加する

create or replace function public.trigger_onesignal_order_push()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  webhook_url text;
  service_key text;
  push_event text := null;
  params jsonb;
  old_status text;
  new_status text;
  old_len int;
  new_len int;
  latest_chat jsonb;
  chat_from text;
begin
  chat_from := '';

  if tg_op = 'INSERT' then
    new_status := public._onesignal_effective_order_status(
      new.status,
      coalesce(new.order_data, '{}'::jsonb)
    );
    if new_status <> 'pending_association'
       and coalesce(nullif(new_status, ''), 'pending') in ('pending', '') then
      push_event := 'new_order';
    end if;
  elsif tg_op = 'UPDATE' then
    old_status := public._onesignal_effective_order_status(
      old.status,
      coalesce(old.order_data, '{}'::jsonb)
    );
    new_status := public._onesignal_effective_order_status(
      new.status,
      coalesce(new.order_data, '{}'::jsonb)
    );

    if coalesce(old_status, 'pending') in ('pending', 'pending_association', '')
       and new_status in ('accepted', 'confirmed') then
      push_event := 'customer_accepted';
    elsif coalesce(old_status, 'pending') in ('pending', 'pending_association', '')
       and new_status in ('rejected', 'cancelled', 'customer_cancelled') then
      push_event := 'customer_rejected';
    else
      old_len := coalesce(jsonb_array_length(old.chat_messages), 0);
      new_len := coalesce(jsonb_array_length(new.chat_messages), 0);
      if new_len > old_len and new_len > 0 then
        latest_chat := new.chat_messages->(new_len - 1);
        chat_from := lower(trim(coalesce(latest_chat->>'from', '')));
        if chat_from in ('factory', 'admin') then
          push_event := 'customer_chat';
        elsif chat_from in ('master', 'customer') then
          push_event := 'factory_chat';
        end if;
      end if;
    end if;
  end if;

  if push_event is null then
    return new;
  end if;

  select ds.decrypted_secret into webhook_url
  from vault.decrypted_secrets ds
  where ds.name = 'onesignal_push_webhook_url'
  limit 1;

  if coalesce(webhook_url, '') = '' then
    return new;
  end if;

  select ds.decrypted_secret into service_key
  from vault.decrypted_secrets ds
  where ds.name = 'service_role_key'
  limit 1;

  params := jsonb_build_object(
    'event',                push_event,
    'order_id',             new.id::text,
    'customer_id',          coalesce(new.customer_id::text, ''),
    'contractor_customer_id', coalesce(new.contractor_customer_id::text, ''),
    'agent_organization_id',  coalesce(new.agent_organization_id::text, ''),
    'factory_site_id',      coalesce(
                              new.factory_site_id::text,
                              new.order_data->>'factory_site_id',
                              new.order_data->>'factorySiteId',
                              ''
                            ),
    'preferred_factory_id', coalesce(
                              new.preferred_factory_id::text,
                              new.order_data->>'preferred_factory_id',
                              new.order_data->>'preferredFactoryId',
                              ''
                            ),
    'status',               coalesce(new.status, ''),
    'chat_from',            chat_from
  );

  perform net.http_post(
    url     := webhook_url,
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || coalesce(service_key, '')
    ),
    body    := params,
    timeout_milliseconds := 8000
  );

  return new;
exception
  when others then
    raise warning 'trigger_onesignal_order_push failed: %', sqlerrm;
    return new;
end;
$$;

-- EXECUTE権限を維持（既存設定どおり）
revoke execute on function public.trigger_onesignal_order_push() from anon, authenticated;
