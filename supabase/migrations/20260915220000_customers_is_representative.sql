-- 商社(agent)の代表窓口アカウント
alter table public.customers
  add column is_representative boolean not null default false;

comment on column public.customers.is_representative is
  '商社(agent)の代表窓口フラグ。role=agentの時のみ意味を持つ。組織に属する全担当者の物件・取引業者を統合して閲覧できる専用アカウントであることを示す。';

create unique index customers_one_representative_per_org
  on public.customers (organization_id)
  where is_representative = true and role = 'agent';

insert into public.customers (company_name, manager_name, role, organization_id, is_representative)
select o.name, '代表窓口', 'agent', o.id, true
from public.organizations o
where o.type = 'agent'
  and not exists (
    select 1 from public.customers c
    where c.organization_id = o.id and c.is_representative = true
  );
