-- 現場地図エディタ: スタンプ・荷下ろし地点・コメント等の構造化データ

alter table public.orders
  add column if not exists map_annotations jsonb;

alter table public.projects
  add column if not exists map_annotations jsonb;

comment on column public.orders.map_annotations is '地図エディタの注釈（スタンプ・荷下ろし赤〇・コメント等）';
comment on column public.projects.map_annotations is '物件基本マップ用の注釈データ';
