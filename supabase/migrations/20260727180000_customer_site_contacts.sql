-- 業者ごとの現場担当者マスタ（複数人）。customers.manager_name/phone_number（代表1名）とは別物。

create table if not exists public.customer_site_contacts (
  id           uuid primary key default gen_random_uuid(),
  customer_id  uuid not null references public.customers (id) on delete cascade,
  name         text not null,
  phone_number text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint customer_site_contacts_name_not_blank check (char_length(trim(name)) > 0),
  constraint customer_site_contacts_phone_not_blank check (char_length(trim(phone_number)) > 0)
);

comment on table public.customer_site_contacts is
  '業者ごとの現場担当者マスタ（複数人登録可）。DispatchAppの発注フォームの現場担当者サジェストに使用。customers.manager_name/phone_number（代表担当者1名）とは別物。';

create index if not exists customer_site_contacts_customer_id_idx
  on public.customer_site_contacts (customer_id);

create or replace function public.set_customer_site_contacts_updated_at()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_customer_site_contacts_updated_at on public.customer_site_contacts;
create trigger trg_customer_site_contacts_updated_at
  before update on public.customer_site_contacts
  for each row
  execute function public.set_customer_site_contacts_updated_at();

alter table public.customer_site_contacts enable row level security;

grant select, insert, update, delete on public.customer_site_contacts to anon, authenticated;

-- 既存の customers / agent_contractor_links / contractor_site_contacts と同様に
-- is_customer_panel_request() / is_admin_panel_request() / is_app_admin() を組み合わせる。

drop policy if exists "customer_site_contacts_select" on public.customer_site_contacts;
create policy "customer_site_contacts_select"
  on public.customer_site_contacts
  for select
  to anon, authenticated
  using (
    public.is_admin_panel_request()
    or public.is_app_admin()
    or (
      public.is_customer_panel_request()
      and customer_id = public.current_customer_panel_id()
    )
    or (
      public.is_customer_panel_request()
      and public.current_customer_role() = 'agent'
      and exists (
        select 1
        from public.agent_contractor_links l
        where l.agent_customer_id = public.current_customer_panel_id()
          and l.contractor_customer_id = customer_site_contacts.customer_id
      )
    )
    or (
      public.is_customer_panel_request()
      and public.current_customer_role() = 'cooperative'
      and exists (
        select 1
        from public.customers c
        where c.id = customer_site_contacts.customer_id
          and coalesce(c.role, 'contractor') = 'contractor'
      )
    )
  );

drop policy if exists "customer_site_contacts_insert" on public.customer_site_contacts;
create policy "customer_site_contacts_insert"
  on public.customer_site_contacts
  for insert
  to anon, authenticated
  with check (
    public.is_admin_panel_request()
    or public.is_app_admin()
    or (
      public.is_customer_panel_request()
      and customer_id = public.current_customer_panel_id()
    )
  );

drop policy if exists "customer_site_contacts_update" on public.customer_site_contacts;
create policy "customer_site_contacts_update"
  on public.customer_site_contacts
  for update
  to anon, authenticated
  using (
    public.is_admin_panel_request()
    or public.is_app_admin()
    or (
      public.is_customer_panel_request()
      and customer_id = public.current_customer_panel_id()
    )
  )
  with check (
    public.is_admin_panel_request()
    or public.is_app_admin()
    or (
      public.is_customer_panel_request()
      and customer_id = public.current_customer_panel_id()
    )
  );

drop policy if exists "customer_site_contacts_delete" on public.customer_site_contacts;
create policy "customer_site_contacts_delete"
  on public.customer_site_contacts
  for delete
  to anon, authenticated
  using (
    public.is_admin_panel_request()
    or public.is_app_admin()
    or (
      public.is_customer_panel_request()
      and customer_id = public.current_customer_panel_id()
    )
  );
