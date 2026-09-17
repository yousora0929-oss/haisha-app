-- =============================================================================
-- 割決会議資料取込向け projects 拡張カラム
-- =============================================================================

alter table public.projects
  add column if not exists period_start_date date,
  add column if not exists period_end_date date,
  add column if not exists planned_quantity_m3 numeric,
  add column if not exists planned_delivery_note text,
  add column if not exists notes text,
  add column if not exists is_new_project boolean;

-- フェーズ分割などで工場未設定のまま物件だけ登録できるようにする
alter table public.projects
  alter column main_factory_id drop not null;

comment on column public.projects.period_start_date is '工期（自）。割決会議資料からの取込を想定';
comment on column public.projects.period_end_date is '工期（至）';
comment on column public.projects.planned_quantity_m3 is '会議時点の予定数量（m³）。実際の受注数量とは別管理';
comment on column public.projects.planned_delivery_note is '納期予定（自由記述、例: "10月中旬"）';
comment on column public.projects.notes is '備考（会議資料の備考欄など）';
comment on column public.projects.is_new_project is '新規/既存の区分。会議資料の「新・旧」列に対応';
comment on column public.projects.main_factory_id is 'メイン工場（factories.id）。割決会議のフェーズ分割行などでは null 可';
