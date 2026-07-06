-- 車両は1行1台のため count 列を廃止（台数は行数で集計）

alter table public.charter_vehicles
  drop column if exists count;
