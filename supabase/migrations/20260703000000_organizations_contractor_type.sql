-- 業者（contractor）を organizations テーブルで管理し、既存業者を組織＋担当者構造へ移行

-- organizations.type に contractor を追加
alter table public.organizations
  drop constraint if exists organizations_type_check;

alter table public.organizations
  add constraint organizations_type_check
  check (type in ('agent', 'cooperative', 'contractor'));

comment on column public.organizations.type is 'agent=商社, cooperative=組合, contractor=業者';

-- 既存業者（organization_id 未設定）を 1 行につき 1 組織としてバックフィル（同名でも統合しない）
do $$
declare
  r record;
  new_org_id uuid;
  org_name text;
begin
  for r in
    select id, company_name, manager_name
    from public.customers
    where role = 'contractor'
      and organization_id is null
    order by id
  loop
    org_name := nullif(trim(coalesce(r.company_name, '')), '');
    if org_name is null then
      org_name := nullif(trim(coalesce(r.manager_name, '')), '');
    end if;
    if org_name is null then
      org_name := '名称未設定';
    end if;

    insert into public.organizations (name, type)
    values (org_name, 'contractor')
    returning id into new_org_id;

    update public.customers
    set organization_id = new_org_id
    where id = r.id;
  end loop;
end $$;
