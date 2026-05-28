-- 業者（元請）と業者（下請）の役割をスキーマ・RPC・コメントで明確化
-- 既存マッピング:
--   projects.customer_id     → customers.id（業者・元請＝会社マスタ）
--   projects.contractor      → 旧: 現場の業者名（下請の自由入力）
--   projects.sub_contractor_name → 新: 業者（下請）の正規カラム（contractor と同期）

-- ---------------------------------------------------------------------------
-- customers: 元請名称（company_name）の補完
-- ---------------------------------------------------------------------------
alter table public.customers
  add column if not exists company_name text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'customers'
      and column_name = 'name'
  ) then
    update public.customers
    set company_name = coalesce(nullif(trim(company_name), ''), nullif(trim(name), ''))
    where company_name is null or trim(company_name) = '';
  end if;
end $$;

comment on column public.customers.company_name is '業者（元請）の会社名。物件の customer_id から参照される。';

-- ---------------------------------------------------------------------------
-- projects: 下請名称カラム
-- ---------------------------------------------------------------------------
alter table public.projects
  add column if not exists sub_contractor_name text;

update public.projects
set sub_contractor_name = coalesce(
  nullif(trim(sub_contractor_name), ''),
  nullif(trim(contractor), '')
)
where sub_contractor_name is null or trim(sub_contractor_name) = '';

comment on column public.projects.customer_id is '業者（元請）: customers.id への参照';
comment on column public.projects.sub_contractor_name is '業者（下請）: 現場・物件単位の下請業者名（自由入力）';
comment on column public.projects.contractor is '業者（下請）の旧カラム。sub_contractor_name と同期（互換用）';
comment on column public.projects.trading_company_name is '商社名（任意）';

-- contractor ⇔ sub_contractor_name 双方向同期
create or replace function public.sync_project_sub_contractor_names()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.sub_contractor_name is not null and trim(new.sub_contractor_name) <> '' then
    new.contractor := trim(new.sub_contractor_name);
  elsif new.contractor is not null and trim(new.contractor) <> '' then
    new.sub_contractor_name := trim(new.contractor);
  else
    new.contractor := null;
    new.sub_contractor_name := null;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_project_sub_contractor_names on public.projects;
create trigger trg_sync_project_sub_contractor_names
  before insert or update of contractor, sub_contractor_name
  on public.projects
  for each row
  execute function public.sync_project_sub_contractor_names();

-- ---------------------------------------------------------------------------
-- ゲスト発注・UI 用: 元請 / 下請 / 商社 / 住所を JSON で返す
-- ---------------------------------------------------------------------------
create or replace function public.resolve_site_order_parties(
  p_project public.projects,
  p_customer public.customers
)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'prime_contractor_name',
      nullif(trim(coalesce(p_customer.company_name, '')), ''),
    'sub_contractor_name',
      nullif(
        trim(coalesce(p_project.sub_contractor_name, p_project.contractor, '')),
        ''
      ),
    'trading_company_name',
      nullif(
        trim(coalesce(p_project.trading_company_name, p_project.trading_company, '')),
        ''
      ),
    'project_address',
      nullif(
        trim(
          concat_ws(
            ' ',
            nullif(trim(coalesce(p_project.delivery_area, '')), ''),
            nullif(trim(coalesce(p_project.site_address, '')), '')
          )
        ),
        ''
      ),
    'project_name',
      nullif(trim(coalesce(p_project.name, '')), '')
  );
$$;

-- get_site_order_context_by_token: parties ブロックを追加
create or replace function public.get_site_order_context_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_token text := lower(trim(coalesce(p_token, '')));
  v_project public.projects%rowtype;
  v_customer public.customers%rowtype;
  v_projects jsonb;
  v_parties jsonb;
begin
  if not public.is_valid_site_order_token(v_token) then
    return null;
  end if;

  select * into v_project
  from public.projects p
  where p.url_token is not null
    and public.site_order_url_token_equals(p.url_token::text, v_token)
  limit 1;

  if found then
    if v_project.customer_id is not null then
      select * into v_customer
      from public.customers c
      where c.id = v_project.customer_id
      limit 1;
    end if;

    v_parties := public.resolve_site_order_parties(v_project, v_customer);

    return jsonb_build_object(
      'match', 'project',
      'token', v_token,
      'project', to_jsonb(v_project),
      'customer', case
        when v_customer.id is not null then
          jsonb_build_object(
            'id', v_customer.id::text,
            'company_name', v_customer.company_name,
            'name', v_customer.company_name,
            'phone_number', v_customer.phone_number,
            'manager_name', v_customer.manager_name,
            'url_token', v_customer.url_token::text
          )
        else null
      end,
      'projects', jsonb_build_array(to_jsonb(v_project)),
      'parties', v_parties
    );
  end if;

  select * into v_customer
  from public.customers c
  where c.url_token is not null
    and public.site_order_url_token_equals(c.url_token::text, v_token)
  limit 1;

  if found then
    select coalesce(jsonb_agg(to_jsonb(p) order by p.name), '[]'::jsonb)
    into v_projects
    from public.projects p
    where p.customer_id = v_customer.id;

    v_parties := jsonb_build_object(
      'prime_contractor_name', nullif(trim(coalesce(v_customer.company_name, '')), ''),
      'sub_contractor_name', null,
      'trading_company_name', null,
      'project_address', null,
      'project_name', null
    );

    return jsonb_build_object(
      'match', 'customer',
      'token', v_token,
      'project', null,
      'customer', jsonb_build_object(
        'id', v_customer.id::text,
        'company_name', v_customer.company_name,
        'name', v_customer.company_name,
        'phone_number', v_customer.phone_number,
        'manager_name', v_customer.manager_name,
        'url_token', v_customer.url_token::text
      ),
      'projects', coalesce(v_projects, '[]'::jsonb),
      'parties', v_parties
    );
  end if;

  return null;
end;
$$;

comment on function public.resolve_site_order_parties(public.projects, public.customers) is
  '物件・顧客から業者（元請）・業者（下請）・商社・住所を解決';
comment on function public.get_site_order_context_by_token(text) is
  '専用発注URLトークンから物件・業者を解決（parties に元請/下請/商社/住所を含む）';

grant execute on function public.resolve_site_order_parties(public.projects, public.customers) to anon, authenticated;
