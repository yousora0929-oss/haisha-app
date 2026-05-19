-- 現場注文アプリ用の簡易ログインパスワード
alter table public.customers
  add column if not exists login_password text;

comment on column public.customers.login_password is '現場注文アプリ用ログインパスワード（簡易認証）';
