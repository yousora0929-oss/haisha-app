-- 管理者画面ログイン用パスワードを追加
alter table public.admin_settings
  add column if not exists login_password text;

comment on column public.admin_settings.login_password is '管理者画面ログイン用パスワード（簡易認証）';
