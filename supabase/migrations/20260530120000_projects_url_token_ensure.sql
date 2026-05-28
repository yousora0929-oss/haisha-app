-- 物件 url_token の自動生成を DB 側でも保証（クライアント insert と二重化）
alter table public.projects
  add column if not exists url_token uuid;

-- デフォルト UUID（未設定 INSERT 時に Supabase/Postgres が付与）
alter table public.projects
  alter column url_token set default gen_random_uuid();

-- 既存の null 行を埋める
update public.projects
set url_token = gen_random_uuid()
where url_token is null;

-- 一意制約（既存環境で無い場合のみ）
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'projects_url_token_key'
      and conrelid = 'public.projects'::regclass
  ) then
    alter table public.projects
      add constraint projects_url_token_key unique (url_token);
  end if;
exception
  when duplicate_object then null;
end $$;

comment on column public.projects.url_token is '物件専用発注URL（/order/{url_token}）。新規登録時に自動生成。';
