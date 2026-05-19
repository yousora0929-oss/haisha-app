-- customers の業者名カラムを company_name に統一する互換マイグレーション
alter table public.customers
  add column if not exists company_name text;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'customers'
      and column_name = 'name'
  ) then
    update public.customers
    set company_name = coalesce(company_name, name)
    where company_name is null;
  end if;
end $$;
