-- 讌ｭ閠・ｵ・ｹ斐＃縺ｨ縺ｮ迴ｾ蝣ｴ諡・ｽ楢・・繧ｹ繧ｿ

create table if not exists public.contractor_site_contacts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references public.organizations (id) on delete cascade,
  name             text not null,
  phone_number     text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint contractor_site_contacts_name_not_blank check (char_length(trim(name)) > 0),
  constraint contractor_site_contacts_phone_not_blank check (char_length(trim(phone_number)) > 0)
);

comment on table public.contractor_site_contacts is '讌ｭ閠・ｼ・ontractor邨・ｹ費ｼ峨＃縺ｨ縺ｮ迴ｾ蝣ｴ諡・ｽ楢・・繧ｹ繧ｿ';
comment on column public.contractor_site_contacts.organization_id is 'type=contractor 縺ｮ organizations.id';

create index if not exists contractor_site_contacts_organization_id_idx
  on public.contractor_site_contacts (organization_id);

create or replace function public.set_contractor_site_contacts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_contractor_site_contacts_updated_at on public.contractor_site_contacts;
create trigger trg_contractor_site_contacts_updated_at
  before update on public.contractor_site_contacts
  for each row
  execute function public.set_contractor_site_contacts_updated_at();

alter table public.contractor_site_contacts enable row level security;

-- 邂｡逅・判髱｢: 蜈ｨ謫堺ｽ懷庄
drop policy if exists "contractor_site_contacts_admin_all" on public.contractor_site_contacts;
create policy "contractor_site_contacts_admin_all"
  on public.contractor_site_contacts
  for all
  to anon, authenticated
  using (public.is_admin_panel_request() or public.is_app_admin())
  with check (public.is_admin_panel_request() or public.is_app_admin());

-- 讌ｭ閠・球蠖楢・ 閾ｪ邨・ｹ泌・縺ｮ縺ｿ CRUD
drop policy if exists "contractor_site_contacts_contractor_own" on public.contractor_site_contacts;
create policy "contractor_site_contacts_contractor_own"
  on public.contractor_site_contacts
  for all
  to anon, authenticated
  using (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'contractor'
    and organization_id = public.current_customer_organization_id()
  )
  with check (
    public.is_customer_panel_request()
    and public.current_customer_role() = 'contractor'
    and organization_id = public.current_customer_organization_id()
  );

-- 蝠・､ｾ繝ｻ邨・粋諡・ｽ楢・ 莉｣逅・匱豕ｨ逕ｨ縺ｫ蜈ｨ莉ｶ SELECT
drop policy if exists "contractor_site_contacts_agent_cooperative_select" on public.contractor_site_contacts;
create policy "contractor_site_contacts_agent_cooperative_select"
  on public.contractor_site_contacts
  for select
  to anon, authenticated
  using (
    public.is_customer_panel_request()
    and public.current_customer_role() in ('agent', 'cooperative')
  );

grant select, insert, update, delete on public.contractor_site_contacts to anon, authenticated;
