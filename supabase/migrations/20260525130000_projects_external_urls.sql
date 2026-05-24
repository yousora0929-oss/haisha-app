-- 物件の外部リンク（Google Drive フォルダ / スプレッドシート等）

alter table public.projects
  add column if not exists folder_url text;

alter table public.projects
  add column if not exists sheet_url text;

comment on column public.projects.folder_url is 'Google Drive フォルダ等の共有URL';
comment on column public.projects.sheet_url is 'Google スプレッドシート等の共有URL';
