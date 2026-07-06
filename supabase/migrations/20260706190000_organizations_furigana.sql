-- 組織マスタ（商社・組合・業者）のフリガナ（任意）

alter table public.organizations
  add column if not exists furigana text;

comment on column public.organizations.furigana is '組織名フリガナ（任意・サジェスト検索用）';
