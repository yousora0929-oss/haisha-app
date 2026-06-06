-- pg_net → Edge Function: POST body が届かない環境があるため URL params で渡す。
-- Dashboard → SQL Editor でこのファイル全文を実行してください。

create or replace function public._onesignal_effective_order_status(p_status text, p_order_data jsonb)
returns text
language sql
immutable
as $$
  select coalesce(
    nullif(trim(coalesce(p_order_data->>'factoryResponseStatus', p_order_data->>'factory_response_status')), ''),
    nullif(trim(p_status), ''),
    nullif(trim(p_order_data->>'status'), ''),
    'pending'
  );
$$;

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
  if tg_op = 'INSERT' then
    new_status := public._onesignal_effective_order_status(new.status, coalesce(new.order_data, '{}'::jsonb));
    if new_status <> 'pending_association'
       and coalesce(nullif(new_status, ''), 'pending') in ('pending', '') then
      push_event := 'new_order';
    end if;
  elsif tg_op = 'UPDATE' then
    old_status := public._onesignal_effective_order_status(old.status, coalesce(old.order_data, '{}'::jsonb));
    new_status := public._onesignal_effective_order_status(new.status, coalesce(new.order_data, '{}'::jsonb));

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
        chat_from := coalesce(latest_chat->>'from', '');
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

  select ds.decrypted_secret
  into webhook_url
  from vault.decrypted_secrets ds
  where ds.name = 'onesignal_push_webhook_url'
  limit 1;

  if coalesce(webhook_url, '') = '' then
    return new;
  end if;

  select ds.decrypted_secret
  into service_key
  from vault.decrypted_secrets ds
  where ds.name = 'service_role_key'
  limit 1;

  params := jsonb_build_object(
    'event', push_event,
    'order_id', new.id::text,
    'customer_id', coalesce(new.customer_id::text, ''),
    'factory_site_id', coalesce(new.factory_site_id::text, new.order_data->>'factory_site_id', new.order_data->>'factorySiteId', ''),
    'preferred_factory_id', coalesce(
      new.preferred_factory_id::text,
      new.order_data->>'preferred_factory_id',
      new.order_data->>'preferredFactoryId',
      ''
    ),
    'phone', coalesce(
      new.order_data->>'phone_number',
      new.order_data->>'customerPhone',
      new.order_data->>'sitePhone',
      new.order_data->>'phone',
      ''
    ),
    'factory_name', coalesce(
      new.order_data->>'acceptedFactoryLabel',
      new.order_data->>'factorySiteName',
      new.order_data->>'factory_name',
      new.order_data->>'factoryName',
      '工場'
    ),
    'contractor_name', coalesce(
      new.order_data->>'customerName',
      new.order_data->>'customer_name',
      new.order_data->>'contractorName',
      '新規注文'
    ),
    'sender_name', coalesce(
      new.order_data->>'manager_name',
      new.order_data->>'contact_person',
      new.order_data->>'ordered_by',
      new.order_data->>'orderedBy',
      '担当者'
    ),
    'status', coalesce(new_status, '')
  );

  perform net.http_post(
    url := webhook_url,
    params := params,
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || coalesce(service_key, ''),
      'apikey', coalesce(service_key, '')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 8000
  );

  return new;
exception
  when others then
    raise warning 'trigger_onesignal_order_push failed: %', sqlerrm;
    return new;
end;
$$;

comment on function public.trigger_onesignal_order_push() is
  'orders 変更時に onesignal-push へ URL params で通知（pg_net body 欠損回避）';
