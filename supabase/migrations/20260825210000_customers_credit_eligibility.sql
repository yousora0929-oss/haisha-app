-- 組合取引先名簿に基づく掛売可フラグ（商社経由の注文には適用されない）
alter table public.customers
  add column if not exists is_credit_eligible boolean not null default false,
  add column if not exists credit_source text;

comment on column public.customers.is_credit_eligible is
  '組合の取引先名簿に基づく掛売可フラグ（商社経由の注文には適用されない）';
comment on column public.customers.credit_source is
  '掛売可の根拠（例: "大分中央生コンクリート協同組合 取引先業者名簿 2026/4/1"）';
