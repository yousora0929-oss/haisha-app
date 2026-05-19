-- 現場（物件）ごとの専用発注URLトークン
alter table public.projects
  add column if not exists url_token uuid unique default gen_random_uuid();

comment on column public.projects.url_token is '現場専用発注URL（/order/{url_token}）';

-- 既存行にトークンが無い場合は付与
update public.projects
set url_token = gen_random_uuid()
where url_token is null;
