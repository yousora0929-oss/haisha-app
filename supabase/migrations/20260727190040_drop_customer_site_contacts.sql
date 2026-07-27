drop policy if exists customer_site_contacts_select on public.customer_site_contacts;
drop policy if exists customer_site_contacts_insert on public.customer_site_contacts;
drop policy if exists customer_site_contacts_update on public.customer_site_contacts;
drop policy if exists customer_site_contacts_delete on public.customer_site_contacts;
drop trigger if exists trg_customer_site_contacts_updated_at on public.customer_site_contacts;
drop function if exists public.set_customer_site_contacts_updated_at();
drop table if exists public.customer_site_contacts;