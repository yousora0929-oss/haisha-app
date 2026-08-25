-- current_customer_panel_id() のログイン照合 WHERE と完全一致する式インデックス
-- trim(coalesce(...)) の書き方は関数定義と1文字も変えないこと
create index if not exists customers_login_lookup_idx
  on public.customers (trim(coalesce(phone_number, '')), trim(coalesce(login_password, '')));
