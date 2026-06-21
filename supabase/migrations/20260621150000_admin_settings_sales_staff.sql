-- 担当営業マスタ（物件の担当営業プルダウン用・将来SMS通知向け）

alter table public.admin_settings
  add column if not exists sales_staff jsonb not null default '[]'::jsonb;

alter table public.admin_settings
  drop constraint if exists admin_settings_sales_staff_is_array;

alter table public.admin_settings
  add constraint admin_settings_sales_staff_is_array
  check (jsonb_typeof(sales_staff) = 'array');

comment on column public.admin_settings.sales_staff is
  '担当営業マスタ JSON 配列 [{ id, name, phone }]（物件担当営業の選択肢・将来SMS用）';

comment on column public.projects.sales_admin_id is '担当営業マスタの id（sales_staff[].id）';
comment on column public.projects.sales_admin_name is '担当営業の表示名（sales_staff[].name と同期）';
