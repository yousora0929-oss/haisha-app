-- =============================================================================
-- Phase 1: 配車スケジュールPDF取込 ＋ 変更自動承諾フロー
-- =============================================================================
-- 注意:
--   - factories.id / orders.id は text（uuidではない）
--   - entity_aliases.entity_id も text（factory / customer / organization を同一列で扱う）
--   - 数量・時間・車両・配合は orders.order_data に格納（トップレベル quantity 列は無し）
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. テーブル
-- -----------------------------------------------------------------------------

create table if not exists public.entity_aliases (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('factory', 'organization', 'customer')),
  entity_id text not null,
  alias_text text not null,
  created_at timestamptz not null default now(),
  unique (entity_type, alias_text)
);

create index if not exists idx_entity_aliases_lookup
  on public.entity_aliases (entity_type, alias_text);

comment on table public.entity_aliases is '工場名・商社名・業者名などの表記ゆれ→正式ID対応辞書';
comment on column public.entity_aliases.entity_id is
  '対象エンティティID（factories.id / organizations.id / customers.id を text で保持）';

create table if not exists public.schedule_import_batches (
  id uuid primary key default gen_random_uuid(),
  source_file_name text,
  source_storage_path text,
  uploaded_by text,
  status text not null default 'pending_review'
    check (status in ('pending_review', 'confirmed', 'rejected', 'partially_confirmed')),
  header_raw jsonb not null default '{}'::jsonb,
  site_contacts_raw jsonb not null default '[]'::jsonb,
  extraction_notes text[] not null default '{}',
  project_id uuid references public.projects (id) on delete set null,
  contractor_customer_id uuid references public.customers (id) on delete set null,
  agent_organization_id uuid references public.organizations (id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);

comment on table public.schedule_import_batches is '配車スケジュールPDF取込バッチ（PDF1枚＝1バッチ）';

create table if not exists public.schedule_import_rows (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.schedule_import_batches (id) on delete cascade,
  row_date date not null,
  weekday_raw text,
  delivery_time text,
  factory_name_raw text not null,
  factory_id text references public.factories (id) on delete set null,
  factory_phone_raw text,
  quantity_m3 numeric,
  vehicle_type text,
  mix_design text,
  has_test boolean,
  notes text,
  row_confidence text not null default 'high'
    check (row_confidence in ('high', 'low')),
  row_confidence_reason text,
  row_status text not null default 'pending'
    check (row_status in (
      'pending',
      'new_confirmed',
      'change_proposed',
      'change_accepted',
      'change_rejected',
      'excluded',
      'needs_admin_review'
    )),
  match_type text
    check (match_type in (
      'new',
      'exact_match_no_change',
      'exact_match_changed',
      'time_shifted_match',
      'ambiguous_multi_match'
    )),
  matched_order_id text references public.orders (id) on delete set null,
  resulting_order_id text references public.orders (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_schedule_import_rows_batch
  on public.schedule_import_rows (batch_id);
create index if not exists idx_schedule_import_rows_date_factory
  on public.schedule_import_rows (row_date, factory_id);

comment on table public.schedule_import_rows is '配車スケジュール取込明細行';

create table if not exists public.order_change_proposals (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.orders (id) on delete cascade,
  schedule_import_row_id uuid references public.schedule_import_rows (id) on delete set null,
  factory_id text not null references public.factories (id) on delete cascade,
  proposed_changes jsonb not null default '[]'::jsonb,
  status text not null default 'pending_factory_response'
    check (status in ('pending_factory_response', 'accepted', 'rejected', 'expired')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  responded_by text
);

create index if not exists idx_order_change_proposals_order
  on public.order_change_proposals (order_id);
create index if not exists idx_order_change_proposals_factory_status
  on public.order_change_proposals (factory_id, status);

comment on table public.order_change_proposals is
  '既存注文への変更提案（工場が承諾すると orders.order_data へ自動反映）';
comment on column public.order_change_proposals.proposed_changes is
  '例: [{"field":"quantity_m3","old":50,"new":54.5},{"field":"delivery_time","old":"8:00","new":"8:30"}]';

-- -----------------------------------------------------------------------------
-- 2. Realtime
-- -----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'order_change_proposals'
  ) then
    alter publication supabase_realtime add table public.order_change_proposals;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. RLS
-- -----------------------------------------------------------------------------
alter table public.entity_aliases enable row level security;
alter table public.schedule_import_batches enable row level security;
alter table public.schedule_import_rows enable row level security;
alter table public.order_change_proposals enable row level security;

drop policy if exists entity_aliases_admin_all on public.entity_aliases;
create policy entity_aliases_admin_all
  on public.entity_aliases for all
  to anon, authenticated
  using (public.is_admin_panel_request() or public.is_app_admin())
  with check (public.is_admin_panel_request() or public.is_app_admin());

drop policy if exists schedule_import_batches_admin_all on public.schedule_import_batches;
create policy schedule_import_batches_admin_all
  on public.schedule_import_batches for all
  to anon, authenticated
  using (public.is_admin_panel_request() or public.is_app_admin())
  with check (public.is_admin_panel_request() or public.is_app_admin());

drop policy if exists schedule_import_rows_admin_all on public.schedule_import_rows;
create policy schedule_import_rows_admin_all
  on public.schedule_import_rows for all
  to anon, authenticated
  using (public.is_admin_panel_request() or public.is_app_admin())
  with check (public.is_admin_panel_request() or public.is_app_admin());

drop policy if exists order_change_proposals_admin_all on public.order_change_proposals;
create policy order_change_proposals_admin_all
  on public.order_change_proposals for all
  to anon, authenticated
  using (public.is_admin_panel_request() or public.is_app_admin())
  with check (public.is_admin_panel_request() or public.is_app_admin());

drop policy if exists order_change_proposals_factory_select on public.order_change_proposals;
create policy order_change_proposals_factory_select
  on public.order_change_proposals for select
  to anon, authenticated
  using (
    public.is_factory_panel_request()
    and trim(factory_id) = nullif(trim(coalesce(public.current_factory_panel_id(), '')), '')
  );

-- 工場からの UPDATE は RPC（SECURITY DEFINER）経由のみ

-- -----------------------------------------------------------------------------
-- 4. ヘルパー: HH:MM → 分
-- -----------------------------------------------------------------------------
create or replace function public.schedule_time_to_minutes(p_time text)
returns integer
language plpgsql
immutable
as $$
declare
  v text;
  v_h int;
  v_m int;
  parts text[];
begin
  v := nullif(trim(coalesce(p_time, '')), '');
  if v is null then
    return null;
  end if;
  -- "8:00" / "08:00" / "8：00"
  v := replace(v, '：', ':');
  parts := string_to_array(v, ':');
  if array_length(parts, 1) < 2 then
    return null;
  end if;
  begin
    v_h := trim(parts[1])::int;
    v_m := trim(parts[2])::int;
  exception when others then
    return null;
  end;
  if v_h < 0 or v_h > 23 or v_m < 0 or v_m > 59 then
    return null;
  end if;
  return v_h * 60 + v_m;
end;
$$;

create or replace function public.schedule_minutes_to_label(p_minutes integer)
returns text
language sql
immutable
as $$
  select case
    when p_minutes is null then null
    else (p_minutes / 60)::text || ':' || lpad((p_minutes % 60)::text, 2, '0')
  end;
$$;

-- -----------------------------------------------------------------------------
-- 5. apply_order_change_proposal
-- -----------------------------------------------------------------------------
create or replace function public.apply_order_change_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.order_change_proposals%rowtype;
  v_caller_factory_id text;
  v_order public.orders%rowtype;
  v_od jsonb;
  v_change jsonb;
  v_field text;
  v_new text;
  v_new_num numeric;
  v_new_bool boolean;
  v_minutes integer;
  v_label text;
  v_vehicle text;
  v_chat_parts text[] := '{}';
  v_chat_body text;
  v_now timestamptz := now();
begin
  v_caller_factory_id := nullif(trim(coalesce(public.current_factory_panel_id(), '')), '');
  if v_caller_factory_id is null and not (public.is_admin_panel_request() or public.is_app_admin()) then
    raise exception '工場認証が必要です' using errcode = 'P0001';
  end if;

  select * into v_proposal
  from public.order_change_proposals
  where id = p_proposal_id
  for update;

  if not found then
    raise exception 'proposal not found' using errcode = 'P0002';
  end if;

  if v_proposal.status is distinct from 'pending_factory_response' then
    raise exception 'proposal already resolved' using errcode = 'P0001';
  end if;

  if v_caller_factory_id is not null
     and trim(v_proposal.factory_id) is distinct from v_caller_factory_id then
    raise exception '工場IDが一致しません' using errcode = 'P0001';
  end if;

  select * into v_order
  from public.orders
  where id = v_proposal.order_id
  for update;

  if not found then
    raise exception 'order not found' using errcode = 'P0002';
  end if;

  v_od := coalesce(v_order.order_data, '{}'::jsonb);
  if jsonb_typeof(v_od) is distinct from 'object' then
    v_od := '{}'::jsonb;
  end if;

  for v_change in
    select value
    from jsonb_array_elements(coalesce(v_proposal.proposed_changes, '[]'::jsonb))
  loop
    v_field := lower(trim(coalesce(v_change->>'field', '')));
    v_new := v_change->>'new';

    if v_field = 'quantity_m3' then
      begin
        v_new_num := nullif(trim(coalesce(v_new, '')), '')::numeric;
      exception when others then
        v_new_num := null;
      end;
      if v_new_num is not null then
        v_od := v_od
          || jsonb_build_object('quantityM3', v_new_num, 'confirmedQuantityM3', v_new_num);
        v_chat_parts := array_append(v_chat_parts, format('数量 %s→%sm³', coalesce(v_change->>'old', '?'), v_new_num::text));
      end if;

    elsif v_field = 'delivery_time' then
      v_minutes := public.schedule_time_to_minutes(v_new);
      v_label := public.schedule_minutes_to_label(v_minutes);
      if v_minutes is not null then
        v_od := v_od || jsonb_build_object(
          'timeSlot', v_minutes::text,
          'timeSlotMinutes', v_minutes,
          'scheduleMatchMinutes', v_minutes,
          'timeSlotLabel', coalesce(v_label, v_new),
          'timePointLabel', coalesce(v_label, v_new)
        );
        v_chat_parts := array_append(
          v_chat_parts,
          format('時間 %s→%s', coalesce(v_change->>'old', '?'), coalesce(v_label, v_new))
        );
      end if;

    elsif v_field = 'vehicle_type' then
      v_vehicle := lower(trim(coalesce(v_new, '')));
      if v_vehicle in ('small', '小型', '小型車') then
        v_od := v_od || jsonb_build_object('vehicleType', 'small', 'vehicleLabel', '小型');
        v_chat_parts := array_append(v_chat_parts, format('車両 %s→小型', coalesce(v_change->>'old', '?')));
      elsif v_vehicle in ('large', '大型', '大型車') then
        v_od := v_od || jsonb_build_object('vehicleType', 'large', 'vehicleLabel', '大型');
        v_chat_parts := array_append(v_chat_parts, format('車両 %s→大型', coalesce(v_change->>'old', '?')));
      end if;

    elsif v_field = 'mix_design' then
      v_od := v_od || jsonb_build_object(
        'mixText', coalesce(v_new, ''),
        'confirmedMixText', coalesce(v_new, '')
      );
      v_chat_parts := array_append(
        v_chat_parts,
        format('配合 %s→%s', coalesce(v_change->>'old', '?'), coalesce(v_new, ''))
      );

    elsif v_field = 'has_test' then
      begin
        v_new_bool := case
          when lower(trim(coalesce(v_new, ''))) in ('true', 't', '1', '有', 'yes') then true
          when lower(trim(coalesce(v_new, ''))) in ('false', 'f', '0', '無', 'no') then false
          when jsonb_typeof(v_change->'new') = 'boolean' then (v_change->>'new')::boolean
          else null
        end;
      exception when others then
        v_new_bool := null;
      end;
      if v_new_bool is not null then
        v_od := v_od || jsonb_build_object('has_test', v_new_bool, 'hasTest', v_new_bool);
        v_order.has_test := v_new_bool;
        v_chat_parts := array_append(
          v_chat_parts,
          format('試験 %s→%s', coalesce(v_change->>'old', '?'), case when v_new_bool then '有' else '無' end)
        );
      end if;

    elsif v_field = 'notes' then
      v_od := v_od || jsonb_build_object('scheduleImportNotes', coalesce(v_new, ''));
      if nullif(trim(coalesce(v_new, '')), '') is not null then
        v_chat_parts := array_append(v_chat_parts, format('備考→%s', v_new));
      end if;
    end if;
  end loop;

  -- ordered_by / orderedBy には触れない（normalizeOrderRow 前提維持）
  v_od := v_od || jsonb_build_object(
    'is_factory_modified', true,
    'isFactoryModified', true
  );

  update public.orders
  set
    order_data = v_od,
    has_test = v_order.has_test,
    is_factory_modified = true,
    updated_at = v_now,
    chat_messages = coalesce(chat_messages, '[]'::jsonb) || jsonb_build_array(
      jsonb_build_object(
        'id',
        'msg_' || floor(extract(epoch from clock_timestamp()) * 1000)::bigint::text || '_'
          || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4),
        'from', 'system',
        'body',
          case
            when coalesce(array_length(v_chat_parts, 1), 0) > 0 then
              '【予定変更・承諾】' || array_to_string(v_chat_parts, ' / ')
            else
              '【予定変更・承諾】スケジュール取込の変更を反映しました'
          end,
        'createdAt', to_char(timezone('utc', v_now), 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
      )
    )
  where id = v_proposal.order_id;

  update public.order_change_proposals
  set
    status = 'accepted',
    responded_at = v_now,
    responded_by = coalesce(v_caller_factory_id, 'admin')
  where id = p_proposal_id;

  if v_proposal.schedule_import_row_id is not null then
    update public.schedule_import_rows
    set row_status = 'change_accepted'
    where id = v_proposal.schedule_import_row_id;
  end if;

  return jsonb_build_object('ok', true, 'order_id', v_proposal.order_id);
end;
$$;

revoke all on function public.apply_order_change_proposal(uuid) from public;
grant execute on function public.apply_order_change_proposal(uuid) to anon, authenticated;

comment on function public.apply_order_change_proposal(uuid) is
  '工場が変更提案を承諾し、orders.order_data（数量・時間・車両・配合・試験）へ反映する。ordered_by/orderedByは変更しない。';

-- -----------------------------------------------------------------------------
-- 6. reject_order_change_proposal
-- -----------------------------------------------------------------------------
create or replace function public.reject_order_change_proposal(p_proposal_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_proposal public.order_change_proposals%rowtype;
  v_caller_factory_id text;
  v_now timestamptz := now();
begin
  v_caller_factory_id := nullif(trim(coalesce(public.current_factory_panel_id(), '')), '');
  if v_caller_factory_id is null and not (public.is_admin_panel_request() or public.is_app_admin()) then
    raise exception '工場認証が必要です' using errcode = 'P0001';
  end if;

  select * into v_proposal
  from public.order_change_proposals
  where id = p_proposal_id
  for update;

  if not found then
    raise exception 'proposal not found' using errcode = 'P0002';
  end if;

  if v_proposal.status is distinct from 'pending_factory_response' then
    raise exception 'proposal already resolved' using errcode = 'P0001';
  end if;

  if v_caller_factory_id is not null
     and trim(v_proposal.factory_id) is distinct from v_caller_factory_id then
    raise exception '工場IDが一致しません' using errcode = 'P0001';
  end if;

  update public.order_change_proposals
  set
    status = 'rejected',
    responded_at = v_now,
    responded_by = coalesce(v_caller_factory_id, 'admin')
  where id = p_proposal_id;

  if v_proposal.schedule_import_row_id is not null then
    update public.schedule_import_rows
    set row_status = 'change_rejected'
    where id = v_proposal.schedule_import_row_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.reject_order_change_proposal(uuid) from public;
grant execute on function public.reject_order_change_proposal(uuid) to anon, authenticated;

comment on function public.reject_order_change_proposal(uuid) is
  '工場が変更提案を拒否し、管理者確認待ち（change_rejected）にする';
