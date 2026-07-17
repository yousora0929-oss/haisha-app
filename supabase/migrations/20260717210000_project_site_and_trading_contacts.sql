-- 物件: 現場担当者（複数）と商社担当者（スナップショット）
alter table public.projects
  add column if not exists site_contacts jsonb not null default '[]'::jsonb,
  add column if not exists trading_contact_name text,
  add column if not exists trading_contact_phone text;

comment on column public.projects.site_contacts is
  '現場担当者リスト [{"name":"...","phone":"..."}]（任意・複数可）';
comment on column public.projects.trading_contact_name is '商社担当者名（任意）';
comment on column public.projects.trading_contact_phone is '商社担当者連絡先（任意）';

-- 商社マスタ: 担当者リスト（物件フォームの自動入力候補）
alter table public.trading_companies
  add column if not exists contacts jsonb not null default '[]'::jsonb;

comment on column public.trading_companies.contacts is
  '商社担当者リスト [{"name":"...","phone":"..."}]';
