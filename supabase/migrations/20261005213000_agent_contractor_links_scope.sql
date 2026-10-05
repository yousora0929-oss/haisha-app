-- 商社の取引業者リンク: 代表窓口行は「その業者の全担当者」（将来追加分を含む）
alter table public.agent_contractor_links
  add column if not exists scope text not null default 'person'
  check (scope in ('person', 'company'));

comment on column public.agent_contractor_links.scope is
  'person=リンク先の1行のみ / company=リンク先と同じorganization_idの業者全担当者（将来追加分を含む）';

-- 既存リンクのうち、代表窓口行（担当者名・電話が空）向けは company に切り替え
update public.agent_contractor_links l
set scope = 'company'
from public.customers c
where c.id = l.contractor_customer_id
  and coalesce(trim(c.manager_name), '') = ''
  and coalesce(trim(c.phone_number), '') = ''
  and c.organization_id is not null;

-- 判定用ヘルパー（権限チェックを1か所に集約）
create or replace function public.agent_link_covers_contractor(
  p_agent_customer_id uuid,
  p_contractor_customer_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.agent_contractor_links l
    join public.customers anchor on anchor.id = l.contractor_customer_id
    join public.customers target on target.id = p_contractor_customer_id
    where l.agent_customer_id = p_agent_customer_id
      and (
        l.contractor_customer_id = p_contractor_customer_id
        or (
          l.scope = 'company'
          and anchor.organization_id is not null
          and target.organization_id = anchor.organization_id
        )
      )
  );
$$;

comment on function public.agent_link_covers_contractor(uuid, uuid) is
  '商社担当者の取引業者リンクが、指定した業者行を対象にするか。scope=company は同じ organization_id の全担当者。';

grant execute on function public.agent_link_covers_contractor(uuid, uuid) to anon, authenticated;

-- 代表窓口行を削除しても company リンクを残す（同じ組織の別行へ付け替え）
create or replace function public.reanchor_company_scope_agent_links()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_next uuid;
  v_link record;
begin
  if not exists (
    select 1
    from public.agent_contractor_links l
    where l.contractor_customer_id = old.id
      and l.scope = 'company'
  ) then
    return old;
  end if;

  if old.organization_id is null then
    return old;
  end if;

  select c.id into v_next
  from public.customers c
  where c.organization_id = old.organization_id
    and c.id <> old.id
  order by
    case
      when coalesce(trim(c.manager_name), '') = ''
       and coalesce(trim(c.phone_number), '') = '' then 0
      else 1
    end,
    c.created_at,
    c.id
  limit 1;

  if v_next is null then
    return old;
  end if;

  for v_link in
    select l.id, l.agent_customer_id
    from public.agent_contractor_links l
    where l.contractor_customer_id = old.id
      and l.scope = 'company'
  loop
    begin
      update public.agent_contractor_links
      set contractor_customer_id = v_next
      where id = v_link.id;
    exception
      when unique_violation then
        delete from public.agent_contractor_links
        where agent_customer_id = v_link.agent_customer_id
          and contractor_customer_id = v_next
          and id <> v_link.id;
        update public.agent_contractor_links
        set contractor_customer_id = v_next
        where id = v_link.id;
    end;
  end loop;

  return old;
end;
$$;

drop trigger if exists trg_reanchor_company_scope_agent_links on public.customers;
create trigger trg_reanchor_company_scope_agent_links
  before delete on public.customers
  for each row
  execute function public.reanchor_company_scope_agent_links();

grant update on public.agent_contractor_links to anon, authenticated;

create or replace function public.get_spot_site_name_suggestions(
  p_contractor_ref_customer_id uuid,
  p_limit int default 8
)
returns table (
  site_name text,
  use_count bigint,
  last_used_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_caller uuid;
  v_role text;
  v_allowed boolean := false;
begin
  if p_contractor_ref_customer_id is null then
    return;
  end if;

  v_caller := public.current_customer_panel_id();
  if v_caller is null then
    -- 管理画面からの確認用（任意）。顧客以外は空を返す。
    if public.is_admin_panel_request() or public.is_app_admin() then
      v_allowed := true;
    else
      return;
    end if;
  else
    v_role := public.current_customer_role();

    if p_contractor_ref_customer_id = v_caller then
      v_allowed := true;
    elsif v_role = 'agent' then
      v_allowed := public.agent_link_covers_contractor(v_caller, p_contractor_ref_customer_id);
    elsif v_role = 'cooperative' then
      -- DispatchApp と同様: 組合は role=contractor の業者を代理発注対象にできる
      v_allowed := exists (
        select 1
        from public.customers c
        where c.id = p_contractor_ref_customer_id
          and coalesce(c.role, 'contractor') = 'contractor'
      );
    else
      -- contractor 等: 自分以外は不可
      v_allowed := false;
    end if;
  end if;

  if not v_allowed then
    return;
  end if;

  return query
  select
    trim(coalesce(o.order_data->>'siteName', o.order_data->>'site_name')) as site_name,
    count(*)::bigint as use_count,
    max(o.created_at) as last_used_at
  from public.orders o
  where o.project_id is null
    and o.site_history_contractor_id = p_contractor_ref_customer_id
    and trim(coalesce(o.order_data->>'siteName', o.order_data->>'site_name', '')) <> ''
  group by 1
  order by max(o.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 8), 20));
end;
$$;

comment on function public.get_spot_site_name_suggestions(uuid, int) is
  'スポット注文の現場名オートコンプリート候補。site_history_contractor_id単位で集計。current_customer_panel_id で権限検証。商社は agent_link_covers_contractor。';

revoke all on function public.get_spot_site_name_suggestions(uuid, int) from public;
grant execute on function public.get_spot_site_name_suggestions(uuid, int) to anon, authenticated;

create or replace function public.get_company_members(
  p_contractor_ref_customer_id uuid
)
returns table (
  id uuid,
  name text,
  phone_number text
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_caller uuid;
  v_role text;
  v_allowed boolean := false;
  v_target_company text;
  v_target_org uuid;
begin
  if p_contractor_ref_customer_id is null then
    return;
  end if;

  select trim(coalesce(c0.company_name, '')), c0.organization_id
    into v_target_company, v_target_org
  from public.customers c0
  where c0.id = p_contractor_ref_customer_id;

  if v_target_org is null and (v_target_company is null or v_target_company = '') then
    return;
  end if;

  if public.is_admin_panel_request() or public.is_app_admin() then
    v_allowed := true;
  elsif public.is_customer_panel_request() then
    v_caller := public.current_customer_panel_id();
    v_role := public.current_customer_role();

    if p_contractor_ref_customer_id = v_caller then
      v_allowed := true;
    elsif v_role = 'agent' then
      v_allowed := public.agent_link_covers_contractor(v_caller, p_contractor_ref_customer_id);
    elsif v_role = 'cooperative' then
      v_allowed := exists (
        select 1 from public.customers c1
        where c1.id = p_contractor_ref_customer_id
          and coalesce(c1.role, 'contractor') = 'contractor'
      );
    end if;
  end if;

  if not v_allowed then
    return;
  end if;

  return query
  select c.id, c.manager_name as name, c.phone_number
  from public.customers c
  where coalesce(c.role, 'contractor') = 'contractor'
    and (
      (v_target_org is not null and c.organization_id = v_target_org)
      or (
        v_target_org is null
        and trim(coalesce(c.company_name, '')) = v_target_company
      )
    )
    and coalesce(trim(c.manager_name), '') <> ''
    and coalesce(trim(c.phone_number), '') <> ''
  order by c.manager_name;
end;
$$;

comment on function public.get_company_members(uuid) is
  '会社単位の担当者一覧。organization_id があれば組織単位、なければ company_name 一致。商社は agent_link_covers_contractor で権限判定。';

grant execute on function public.get_company_members(uuid) to anon, authenticated;
