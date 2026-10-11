-- 本番で直接 revoke 済み。anon / authenticated / public からは呼べないようにする。
-- get_company_members / get_spot_site_name_suggestions は security definer なので、所有者経由の内部呼び出しは残る。
revoke execute on function public.agent_link_covers_contractor(uuid, uuid) from public, anon, authenticated;
