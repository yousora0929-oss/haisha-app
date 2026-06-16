-- 業者マスタにフリガナ列を追加
alter table public.customers
  add column if not exists furigana text;

comment on column public.customers.furigana is '業者名フリガナ（任意）';
