-- =============================================================================
-- 地図ハイブリッド: プロジェクト基本マップ + オーダー上書きマップ
-- =============================================================================

alter table public.projects
  add column if not exists default_map_image_url text;

comment on column public.projects.default_map_image_url is 'プロジェクトの基本現場図（地図エディタのデフォルト背景）';

alter table public.orders
  add column if not exists override_map_image_url text;

comment on column public.orders.override_map_image_url is '打設日・注文専用の上書き現場図（基本マップより優先）';

-- 旧カラム map_base_image_url → default_map_image_url へコピー（存在する場合）
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projects' and column_name = 'map_base_image_url'
  ) then
    update public.projects
    set default_map_image_url = map_base_image_url
    where default_map_image_url is null and map_base_image_url is not null and trim(map_base_image_url) <> '';
  end if;
end $$;
