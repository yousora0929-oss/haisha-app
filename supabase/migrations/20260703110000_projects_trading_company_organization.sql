-- 物件の商社欄を organizations（type=agent）と紐付け

alter table public.projects
  add column if not exists trading_company_organization_id uuid
    references public.organizations (id) on delete set null;

comment on column public.projects.trading_company_organization_id is
  '商社マスタ（organizations.type=agent）への参照。未登録商社名の場合はNULL';

create index if not exists projects_trading_company_organization_id_idx
  on public.projects (trading_company_organization_id)
  where trading_company_organization_id is not null;

-- trading_company_name と organizations.name が完全一致するものだけバックフィル
update public.projects p
set trading_company_organization_id = o.id
from public.organizations o
where o.type = 'agent'
  and p.trading_company_organization_id is null
  and trim(coalesce(p.trading_company_name, p.trading_company, '')) <> ''
  and trim(o.name) = trim(coalesce(p.trading_company_name, p.trading_company, ''));
