-- 顧客変更依頼の構造化パッチ（承諾時に自動反映するため）
alter table public.orders
  add column if not exists pending_change_request_patch jsonb;

comment on column public.orders.pending_change_request_patch is
  '顧客からの変更依頼の内容（フィールド名→新しい値のマップ）。has_pending_change_request が true の間のみ意味を持つ。承諾・却下時にnullへ戻す。';
