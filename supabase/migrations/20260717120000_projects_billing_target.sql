-- 物件の請求先（元請 / 下請）
alter table public.projects
  add column if not exists billing_target text not null default 'main';

alter table public.projects
  drop constraint if exists projects_billing_target_check;

alter table public.projects
  add constraint projects_billing_target_check
  check (billing_target in ('main', 'sub'));

comment on column public.projects.billing_target is
  '請求先: main=元請 / sub=下請';
