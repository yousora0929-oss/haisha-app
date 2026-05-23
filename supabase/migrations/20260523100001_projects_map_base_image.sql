-- 物件マスタ: 現場図面（地図エディタの背景画像URL）
alter table public.projects
  add column if not exists map_base_image_url text;

comment on column public.projects.map_base_image_url is '現場図面の公開URL（地図エディタの背景）';
