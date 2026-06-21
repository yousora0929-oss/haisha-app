-- 割当物件の特別エスカレーション（メイン→サブ順次→担当営業）

alter table public.orders
  add column if not exists sub_factory_current_index integer,
  add column if not exists sub_factory_notified_at timestamptz,
  add column if not exists admin_followup_notes jsonb not null default '[]'::jsonb,
  add column if not exists admin_followup_started_at timestamptz;

alter table public.projects
  add column if not exists sales_admin_id text,
  add column if not exists sales_admin_name text;

comment on column public.orders.sub_factory_current_index is '割当物件: 現在通知中のサブ工場インデックス（-1=メイン段階）';
comment on column public.orders.sub_factory_notified_at is '割当物件: 現サブ工場への通知時刻（10分タイムアウト判定）';
comment on column public.orders.admin_followup_notes is '管理者フォロー時の外部対応記録（JSON配列）';
comment on column public.orders.admin_followup_started_at is '管理者フォロー待ち開始時刻';
comment on column public.projects.sales_admin_id is '担当営業の OneSignal external_id（admin_ プレフィックス可）';
comment on column public.projects.sales_admin_name is '担当営業の表示名';

create or replace function public._order_association_pool_len(p_order public.orders)
returns integer
language sql
stable
set search_path = public, extensions
as $$
  select greatest(
    coalesce(jsonb_array_length(p_order.order_data->'association_assigned_factory_ids'), 0),
    coalesce(jsonb_array_length(p_order.order_data->'associationAssignedFactoryIds'), 0)
  );
$$;

create or replace function public._order_is_assigned_project(p_order public.orders)
returns boolean
language sql
stable
set search_path = public, extensions
as $$
  select
    coalesce(p_order.is_spot, false) = false
    and p_order.project_id is not null
    and public._order_association_pool_len(p_order) = 0
    and exists (
      select 1
      from public.projects p
      where p.id = p_order.project_id
        and (
          p.main_factory_id is not null
          or coalesce(jsonb_array_length(p.sub_factory_ids), 0) > 0
        )
    );
$$;

create or replace function public._assigned_project_target_factory_id(p_order public.orders)
returns text
language plpgsql
stable
set search_path = public, extensions
as $$
declare
  v_main text;
  v_subs jsonb;
  v_idx integer;
  v_rejected jsonb;
begin
  if not public._order_is_assigned_project(p_order) then
    return '';
  end if;

  select p.main_factory_id::text, coalesce(p.sub_factory_ids, '[]'::jsonb)
  into v_main, v_subs
  from public.projects p
  where p.id = p_order.project_id;

  v_rejected := coalesce(p_order.rejected_factory_ids, '[]'::jsonb);
  v_idx := coalesce(p_order.sub_factory_current_index, -1);

  if coalesce(v_main, '') <> ''
     and not v_rejected @> jsonb_build_array(v_main) then
    return v_main;
  end if;

  if (v_idx >= 0
     and v_idx < coalesce(jsonb_array_length(v_subs), 0) then
    return coalesce(v_subs->>v_idx, '');
  end if;

  return '';
end;
$$;

create or replace function public._assigned_project_sales_admin_id(p_order public.orders)
returns text
language sql
stable
set search_path = public, extensions
as $$
  select coalesce(p.sales_admin_id, '')
  from public.projects p
  where p.id = p_order.project_id
  limit 1;
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
  old_status text := 'pending';
  new_status text := 'pending';
  old_len int;
  new_len int;
  latest_chat jsonb;
  chat_from text := '';
  chat_message_id text := '';
  old_map_fp text;
  new_map_fp text;
  target_factory_id text := '';
begin
  if tg_op = 'INSERT' then
    new_status := public._onesignal_effective_order_status(new.status, coalesce(new.order_data, '{}'::jsonb));
    if new_status <> 'pending_association'
       and coalesce(nullif(new_status, ''), 'pending') in ('pending', '') then
      if public._order_is_assigned_project(new) then
        push_event := 'order_assigned_main';
        target_factory_id := public._assigned_project_target_factory_id(new);
      else
        push_event := 'new_order';
      end if;
    end if;
  elsif tg_op = 'UPDATE' then
    old_status := public._onesignal_effective_order_status(old.status, coalesce(old.order_data, '{}'::jsonb));
    new_status := public._onesignal_effective_order_status(new.status, coalesce(new.order_data, '{}'::jsonb));

    if coalesce(old.factory_consult_status, '') is distinct from coalesce(new.factory_consult_status, '')
       and coalesce(new.factory_consult_status, '') = 'consulting' then
      push_event := 'consult_start';
    elsif coalesce(old_status, 'pending') = 'pending_association'
          and coalesce(new_status, 'pending') = 'pending' then
      push_event := 'association_approved';
    elsif coalesce(old_status, '') = 'awaiting_admin_followup'
          and coalesce(new_status, 'pending') = 'pending'
          and new.factory_site_id is not null then
      push_event := 'new_order';
    elsif coalesce(new_status, '') = 'awaiting_admin_followup'
          and coalesce(old_status, '') is distinct from 'awaiting_admin_followup' then
      push_event := 'order_awaiting_admin';
    elsif public._order_is_assigned_project(new)
          and coalesce(old.sub_factory_current_index, -1) is distinct from coalesce(new.sub_factory_current_index, -1)
          and coalesce(new.sub_factory_current_index, -1) >= 0
          and coalesce(new_status, 'pending') = 'pending' then
      push_event := 'order_assigned_sub_next';
      target_factory_id := public._assigned_project_target_factory_id(new);
    elsif coalesce(old_status, 'pending') in ('pending', 'pending_association', '')
       and new_status in ('accepted', 'confirmed') then
      push_event := 'order_accepted';
    elsif coalesce(old_status, 'pending') in ('pending', 'pending_association', '')
       and new_status in ('rejected', 'cancelled', 'customer_cancelled') then
      push_event := 'order_rejected';
    elsif coalesce(jsonb_array_length(old.rejected_factory_ids), 0)
          < coalesce(jsonb_array_length(new.rejected_factory_ids), 0)
          and not public._order_is_assigned_project(new) then
      push_event := 'escalation_expanded';
    else
      old_len := coalesce(jsonb_array_length(old.chat_messages), 0);
      new_len := coalesce(jsonb_array_length(new.chat_messages), 0);
      if new_len > old_len and new_len > 0 then
        latest_chat := new.chat_messages->(new_len - 1);
        chat_from := lower(trim(coalesce(latest_chat->>'from', '')));
        chat_message_id := trim(coalesce(latest_chat->>'id', ''));
        if chat_from in ('factory', 'admin') then
          push_event := 'customer_chat';
        elsif chat_from in ('master', 'customer') then
          push_event := 'factory_chat';
        end if;
      end if;

      if push_event is null and to_regprocedure('public._onesignal_order_map_fingerprint(text,jsonb,double precision,double precision,jsonb)') is not null then
        old_map_fp := public._onesignal_order_map_fingerprint(
          old.override_map_image_url,
          old.map_annotations,
          old.delivery_lat,
          old.delivery_lng,
          coalesce(old.order_data, '{}'::jsonb)
        );
        new_map_fp := public._onesignal_order_map_fingerprint(
          new.override_map_image_url,
          new.map_annotations,
          new.delivery_lat,
          new.delivery_lng,
          coalesce(new.order_data, '{}'::jsonb)
        );
        if coalesce(new_map_fp, '') <> ''
           and coalesce(new_map_fp, '') is distinct from coalesce(old_map_fp, '') then
          push_event := 'customer_map_shared';
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

  if target_factory_id = '' and push_event in ('order_assigned_main', 'order_assigned_sub_next') then
    target_factory_id := public._assigned_project_target_factory_id(new);
  end if;

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
    'target_factory_id', coalesce(target_factory_id, ''),
    'sales_admin_id', coalesce(public._assigned_project_sales_admin_id(new), ''),
    'phone', coalesce(
      new.order_data->>'phone_number',
      new.order_data->>'customerPhone',
      new.order_data->>'sitePhone',
      new.order_data->>'phone',
      ''
    ),
    'factory_name', coalesce(
      new.order_data->>'factoryConsultByName',
      new.order_data->>'acceptedFactoryLabel',
      new.order_data->>'factorySiteName',
      new.order_data->>'factory_name',
      new.order_data->>'factoryName',
      '工場'
    ),
    'contractor_name', coalesce(
      new.order_data->>'siteName',
      new.order_data->>'site_name',
      new.order_data->>'customerName',
      new.order_data->>'customer_name',
      new.order_data->>'contractorName',
      '新規注文'
    ),
    'sender_name', coalesce(
      new.order_data->>'customerName',
      new.order_data->>'customer_name',
      new.order_data->>'contractorName',
      new.order_data->>'contractor_name',
      new.order_data->>'ordered_by',
      new.order_data->>'orderedBy',
      'カスタマー'
    ),
    'chat_from', chat_from,
    'chat_message_id', chat_message_id,
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

drop trigger if exists trg_orders_onesignal_push on public.orders;
create trigger trg_orders_onesignal_push
  after insert or update of
    status,
    preferred_factory_id,
    chat_messages,
    rejected_factory_ids,
    factory_consult_status,
    sub_factory_current_index,
    sub_factory_notified_at,
    admin_followup_started_at,
    override_map_image_url,
    map_annotations,
    delivery_lat,
    delivery_lng,
    order_data
  on public.orders
  for each row
  execute function public.trigger_onesignal_order_push();

comment on function public.trigger_onesignal_order_push() is
  'orders 変更時に onesignal-push へ通知（割当物件: order_assigned_main/sub_next/awaiting_admin 含む）';
