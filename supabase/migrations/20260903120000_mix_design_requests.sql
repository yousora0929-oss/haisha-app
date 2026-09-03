-- =============================================================================
-- 配合計画書作成依頼 Phase 1: スキーマ
-- projects.commitment_level / customers.can_request_mix_design 追加
-- mix_design_requests / mix_design_request_items / correction_value_rules 新規
-- 既存カラムの変更・削除は行わない
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1-1. projects.commitment_level
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists commitment_level text not null default 'spot';

alter table public.projects
  drop constraint if exists projects_commitment_level_check;

alter table public.projects
  add constraint projects_commitment_level_check
  check (commitment_level = any (array['spot', 'mix_design_only', 'allocated']::text[]));

comment on column public.projects.commitment_level is
  '納入確度: spot=スポット注文 / mix_design_only=配合計画書依頼のみ・未確定（複数工場に同時依頼可） / allocated=会議で決定済みの割当物件（納入責任が最も強い）。allocatedへの昇格は自動判定せず、マスターが手動で切り替える。';

-- ---------------------------------------------------------------------------
-- 1-5. customers.can_request_mix_design（can_import_schedule と同じ個別許可制）
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists can_request_mix_design boolean not null default false;

comment on column public.customers.can_request_mix_design is
  'true のとき DispatchApp の新規発注画面で「配合計画書作成依頼」チェックボックスを表示・利用可能。can_import_scheduleと同じ個別許可制パターン。';

create or replace function public.current_customer_can_request_mix_design()
returns boolean
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_flag boolean;
begin
  set local row_security = off;
  select coalesce(c.can_request_mix_design, false)
    into v_flag
  from public.customers c
  where c.id = public.current_customer_panel_id()
  limit 1;
  return coalesce(v_flag, false);
exception
  when others then
    return false;
end;
$$;

comment on function public.current_customer_can_request_mix_design() is
  'ログイン中カスタマーの can_request_mix_design。';

revoke all on function public.current_customer_can_request_mix_design() from public;
grant execute on function public.current_customer_can_request_mix_design() to authenticated, anon;

-- ---------------------------------------------------------------------------
-- login_customer: can_request_mix_design を返す（can_import_schedule と同じ拡張）
-- ---------------------------------------------------------------------------
create or replace function public.login_customer(p_phone text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_company_name text;
  v_phone_number text;
  v_manager_name text;
  v_url_token text;
  v_role text;
  v_organization_id uuid;
  v_can_import_schedule boolean;
  v_can_request_mix_design boolean;
  v_realtime_token text;
begin
  select
    c.id,
    c.company_name,
    c.phone_number,
    c.manager_name,
    c.url_token::text,
    c.role,
    c.organization_id,
    coalesce(c.can_import_schedule, false),
    coalesce(c.can_request_mix_design, false)
  into
    v_id,
    v_company_name,
    v_phone_number,
    v_manager_name,
    v_url_token,
    v_role,
    v_organization_id,
    v_can_import_schedule,
    v_can_request_mix_design
  from public.customers c
  where trim(coalesce(c.phone_number, '')) = trim(coalesce(p_phone, ''))
    and trim(coalesce(c.login_password, '')) = trim(coalesce(p_password, ''))
  limit 1;

  if v_id is null then
    return null;
  end if;

  begin
    v_realtime_token := public.sign_panel_realtime_jwt(jsonb_build_object(
      'panel_type', 'customer',
      'panel_customer_id', v_id::text
    ));
  exception
    when others then
      v_realtime_token := null;
  end;

  return jsonb_build_object(
    'id', v_id::text,
    'company_name', v_company_name,
    'name', coalesce(v_company_name, ''),
    'phone_number', v_phone_number,
    'manager_name', v_manager_name,
    'url_token', v_url_token,
    'role', coalesce(v_role, 'contractor'),
    'organization_id', case when v_organization_id is null then null else v_organization_id::text end,
    'can_import_schedule', v_can_import_schedule,
    'can_request_mix_design', v_can_request_mix_design,
    'realtime_token', v_realtime_token
  );
end;
$$;

grant execute on function public.login_customer(text, text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 1-2. mix_design_requests
-- project_id = uuid (projects.id) / requested_to_factory_id = text (factories.id)
-- ---------------------------------------------------------------------------
create table if not exists public.mix_design_requests (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id),
  requested_to_factory_id text references public.factories(id),
  requested_by text,
  status text not null default 'not_started'
    check (status = any (array['not_started', 'requested', 'in_progress', 'completed']::text[])),
  submission_method text
    check (submission_method is null or submission_method = any (array['original', 'electronic']::text[])),
  submission_email text,
  creation_date_specified boolean not null default false,
  creation_date date,
  copies_count integer,
  vehicle_types jsonb not null default '[]'::jsonb,
  total_volume_m3 numeric,
  test_salt boolean not null default false,
  test_split_pour boolean not null default false,
  test_specimen_count integer,
  test_third_party boolean not null default false,
  quote_requested boolean,
  memo text,
  pdf_url text,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

comment on table public.mix_design_requests is
  '配合計画書作成依頼のログ。1物件(project)に対して複数工場へ複数回依頼できる。ステータスは 未着手→依頼中(送信で自動)→作成中(工場が受注ボタンで手動遷移・Phase2)→完了(PDFアップロードで自動遷移・Phase2)。Phase1では not_started/requested までを扱う。';

comment on column public.mix_design_requests.requested_by is
  '依頼を作成した人の表示名（自由入力 or ログインユーザー名）。orders.ordered_byやorder_data.orderedByとは別概念。';

create index if not exists idx_mix_design_requests_project_id
  on public.mix_design_requests (project_id);

create index if not exists idx_mix_design_requests_factory_id
  on public.mix_design_requests (requested_to_factory_id);

create index if not exists idx_mix_design_requests_status
  on public.mix_design_requests (status);

-- ---------------------------------------------------------------------------
-- 1-3. mix_design_request_items
-- ---------------------------------------------------------------------------
create table if not exists public.mix_design_request_items (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.mix_design_requests(id) on delete cascade,
  sort_order integer not null default 0,
  base_strength integer not null,
  correction_value integer,
  correction_is_auto boolean not null default true,
  nominal_strength integer,
  slump integer not null,
  aggregate_size integer not null,
  cement_type text not null check (cement_type = any (array['N', 'BB']::text[])),
  ae_admixture boolean not null default false,
  quantity_m3 numeric,
  pour_date date,
  construction_location text,
  water_cement_ratio numeric,
  unit_water_content numeric,
  created_at timestamp with time zone not null default now(),
  updated_at timestamp with time zone not null default now()
);

comment on table public.mix_design_request_items is
  '配合パターン明細。1依頼(mix_design_requests)に対して複数行、自由に追加・削除可能な可変リスト。呼び強度は「設計基準強度+補正値」を呼び強度規格値リストに切り上げた値（39は存在せず36の次は40）。配合コード表示は nominal_strength（base_strength+correction_value+cement_type）-slump-aggregate_size+cement_type・高性能 の形式でフロント側が組み立てる。';

create index if not exists idx_mix_design_request_items_request_id
  on public.mix_design_request_items (request_id, sort_order);

-- ---------------------------------------------------------------------------
-- 1-4. correction_value_rules + 2026年度データ
-- ---------------------------------------------------------------------------
create table if not exists public.correction_value_rules (
  id uuid primary key default gen_random_uuid(),
  fiscal_year integer not null,
  region text not null,
  cement_type text not null check (cement_type = any (array['N', 'BB']::text[])),
  category_label text not null,
  date_start_month integer not null check (date_start_month between 1 and 12),
  date_start_day integer not null check (date_start_day between 1 and 31),
  date_end_month integer not null check (date_end_month between 1 and 12),
  date_end_day integer not null check (date_end_day between 1 and 31),
  correction_value integer not null,
  created_at timestamp with time zone not null default now()
);

comment on table public.correction_value_rules is
  '組合が年次発行する構造体強度の補正値表。地域×セメント種別×日付レンジ(月日のみ、年またぎ考慮)で補正値を規定。年度更新は該当年度の新規行を追加する形で対応(過去年度の行は保持)。日付レンジ判定は month*100+day の数値比較で行い、開始>終了の場合は年またぎとして扱う。';

create index if not exists idx_correction_value_rules_lookup
  on public.correction_value_rules (fiscal_year, region, cement_type);

insert into public.correction_value_rules
  (fiscal_year, region, cement_type, category_label, date_start_month, date_start_day, date_end_month, date_end_day, correction_value)
values
  (2026, '大分市・挟間町', 'N', '8℃以上',        2, 8,  6, 28, 3),
  (2026, '大分市・挟間町', 'N', '8℃以上',        9, 17, 12, 5, 3),
  (2026, '大分市・挟間町', 'N', '暑中期間',       6, 29, 9, 16, 6),
  (2026, '大分市・挟間町', 'N', '0℃以上8℃未満',  12, 6,  2, 7, 6),
  (2026, '大分市・挟間町', 'BB', '13℃以上',        3, 16, 6, 28, 3),
  (2026, '大分市・挟間町', 'BB', '13℃以上',        9, 17, 11, 5, 3),
  (2026, '大分市・挟間町', 'BB', '暑中期間',        6, 29, 9, 16, 6),
  (2026, '大分市・挟間町', 'BB', '0℃以上13℃未満',  11, 6,  3, 15, 6),
  (2026, '湯布院・庄内', 'N', '8℃以上',        3, 4,  7, 23, 3),
  (2026, '湯布院・庄内', 'N', '暑中期間',       7, 24, 8, 18, 6),
  (2026, '湯布院・庄内', 'N', '0℃以上8℃未満',  11, 11, 3, 3, 6),
  (2026, '湯布院・庄内', 'BB', '13℃以上',        4, 5,  7, 23, 3),
  (2026, '湯布院・庄内', 'BB', '暑中期間',        7, 24, 8, 18, 6),
  (2026, '湯布院・庄内', 'BB', '0℃以上13℃未満',  10, 15, 4, 4, 6);

-- ---------------------------------------------------------------------------
-- 1-6. RLS
-- Phase 1: ログイン済みパネル（業者・工場・管理者）は読み書き可。未認証には非公開。
-- 厳密な階層 RLS は Phase 2。
-- correction_value_rules は参照のみ（書き込みは管理者）。
-- ---------------------------------------------------------------------------
create or replace function public.is_logged_in_panel_request()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.is_customer_panel_request()
    or public.is_factory_panel_request()
    or public.is_admin_panel_request()
    or public.is_app_admin();
$$;

comment on function public.is_logged_in_panel_request() is
  '業者・工場・管理者いずれかのパネル認証が通っているか。配合計画書 Phase 1 の緩い RLS 用。';

revoke all on function public.is_logged_in_panel_request() from public;
grant execute on function public.is_logged_in_panel_request() to authenticated, anon;

alter table public.mix_design_requests enable row level security;
alter table public.mix_design_request_items enable row level security;
alter table public.correction_value_rules enable row level security;

grant select, insert, update, delete on public.mix_design_requests to anon, authenticated;
grant select, insert, update, delete on public.mix_design_request_items to anon, authenticated;
grant select, insert, update, delete on public.correction_value_rules to anon, authenticated;

drop policy if exists "mix_design_requests_logged_in_panel_all"
  on public.mix_design_requests;
create policy "mix_design_requests_logged_in_panel_all"
  on public.mix_design_requests
  for all
  to anon, authenticated
  using (public.is_logged_in_panel_request())
  with check (public.is_logged_in_panel_request());

drop policy if exists "mix_design_request_items_logged_in_panel_all"
  on public.mix_design_request_items;
create policy "mix_design_request_items_logged_in_panel_all"
  on public.mix_design_request_items
  for all
  to anon, authenticated
  using (public.is_logged_in_panel_request())
  with check (public.is_logged_in_panel_request());

drop policy if exists "correction_value_rules_logged_in_panel_select"
  on public.correction_value_rules;
create policy "correction_value_rules_logged_in_panel_select"
  on public.correction_value_rules
  for select
  to anon, authenticated
  using (public.is_logged_in_panel_request());

drop policy if exists "correction_value_rules_admin_write"
  on public.correction_value_rules;
create policy "correction_value_rules_admin_write"
  on public.correction_value_rules
  for all
  to anon, authenticated
  using (public.is_admin_panel_request() or public.is_app_admin())
  with check (public.is_admin_panel_request() or public.is_app_admin());
