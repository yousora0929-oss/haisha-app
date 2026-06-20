-- projects.default_map_image_url（未適用環境向け）

alter table public.projects
  add column if not exists default_map_image_url text;

comment on column public.projects.default_map_image_url is
  'プロジェクトの基本現場図（地図エディタのデフォルト背景）';

alter table public.projects
  add column if not exists map_annotations jsonb;

comment on column public.projects.map_annotations is
  '物件基本マップ用の注釈データ';

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'map_base_image_url'
  ) then
    update public.projects
    set default_map_image_url = map_base_image_url
    where default_map_image_url is null
      and map_base_image_url is not null
      and trim(map_base_image_url) <> '';
  end if;
end $$;
