-- 未使用の現場担当者マスタ（customers で代用する方針に変更済み）

drop table if exists public.contractor_site_contacts;

drop function if exists public.set_contractor_site_contacts_updated_at();
