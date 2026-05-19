-- 物件に紐づく商社名を明示カラム化
alter table public.projects
  add column if not exists trading_company text,
  add column if not exists contractor text,
  add column if not exists trading_company_name text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'projects'
      and column_name = 'trading_company'
  ) then
    update public.projects
    set trading_company_name = coalesce(trading_company_name, trading_company)
    where trading_company_name is null;
  end if;
end $$;

comment on column public.projects.trading_company_name is '商社名（任意）。設定時は注文表示で「[商社 経由] 業者 - 物件」と表示';
comment on column public.projects.trading_company is '旧互換用の商社名';
comment on column public.projects.contractor is '現場の業者名';
