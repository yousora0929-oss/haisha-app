-- 1) is_representative カラム（未適用環境向け）
alter table public.customers
  add column if not exists is_representative boolean not null default false;

comment on column public.customers.is_representative is
  '商社(agent)の代表窓口フラグ。role=agentの時のみ意味を持つ。組織に属する全担当者の物件・取引業者を統合して閲覧できる専用アカウントであることを示す。';

create unique index if not exists customers_one_representative_per_org
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

-- 2) customers_noauth に is_representative を末尾追加（既存列順は維持。依存ポリシーを壊さない）
create or replace view public.customers_noauth
with (security_invoker = false)
as
select
  id,
  company_name,
  company_name_katakana,
  furigana,
  manager_name,
  phone_number,
  url_token,
  role,
  organization_id,
  created_at,
  is_representative
from public.customers;

alter view public.customers_noauth owner to postgres;

-- 3) 代表窓口が同一組織の他担当者(role=agent)を閲覧できる最小ポリシー
drop policy if exists customers_representative_org_agents_select on public.customers;
create policy customers_representative_org_agents_select
on public.customers
for select
using (
  is_customer_panel_request()
  and current_customer_role() = 'agent'
  and role = 'agent'
  and exists (
    select 1 from customers_noauth me
    where me.id = current_customer_panel_id()
      and me.is_representative = true
      and me.organization_id is not null
      and me.organization_id = customers.organization_id
  )
);
