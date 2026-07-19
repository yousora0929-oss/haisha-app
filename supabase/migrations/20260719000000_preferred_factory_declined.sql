-- 第一希望工場が割当物件注文を拒否した後のカスタマー選択を保存する列 + RPC

-- 1. 列追加
alter table public.orders
  add column if not exists preferred_factory_declined_at timestamptz,
  add column if not exists preferred_factory_choice text;

comment on column public.orders.preferred_factory_declined_at is
  '第一希望工場が割当物件注文を拒否した時刻。nullなら未拒否。';
comment on column public.orders.preferred_factory_choice is
  'preferred_factory_declined_at 後のカスタマー選択:
   reschedule（別日指定）/ use_assigned（担当工場に確認）/ cancel（キャンセル）';

-- 2. normalizeOrderRow で読めるよう、既存の snake→camel 変換パターンに倣い
--    フロントは preferred_factory_declined_at / preferredFactoryDeclinedAt、
--    preferred_factory_choice / preferredFactoryChoice で参照する
--    （normalizeOrderRow 側の変更は②で行うため、ここではコメントのみ）

-- 3. RPC: カスタマーが選択を送信する
--    注: orders.id は text 型のため p_order_id::uuid ではなく trim(p_order_id) で照合する
create or replace function public.set_preferred_factory_choice(
  p_order_id text,
  p_choice   text   -- 'reschedule' | 'use_assigned' | 'cancel'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
  v_patch  jsonb;
begin
  -- 認可: カスタマー本人またはマスター（パネルJWT含む）
  -- 注: is_app_master() は未定義のため、既存の customer/admin パネル認可で代替
  if not (
    public.is_app_customer()
    or public.is_customer_panel_request()
    or public.is_app_admin()
    or public.is_admin_panel_request()
  ) then
    raise exception 'access_denied';
  end if;

  -- バリデーション
  if p_choice not in ('reschedule', 'use_assigned', 'cancel') then
    raise exception 'invalid_choice: %', p_choice;
  end if;

  select * into v_order
  from public.orders
  where id = trim(p_order_id)
  limit 1;

  if not found then
    raise exception 'order_not_found';
  end if;

  -- 選択済みは上書き不可
  if v_order.preferred_factory_choice is not null then
    raise exception 'already_chosen';
  end if;

  -- preferred_factory_declined_at がないのに選択は不正
  if v_order.preferred_factory_declined_at is null then
    raise exception 'not_declined_yet';
  end if;

  v_patch := jsonb_build_object('preferred_factory_choice', p_choice);

  -- cancel の場合は status も customer_cancelled に
  if p_choice = 'cancel' then
    v_patch := v_patch || jsonb_build_object('status', 'customer_cancelled');
  end if;

  -- use_assigned の場合は sub_factory_current_index を 0 にリセット
  -- （割当フローをメイン工場から再開）
  if p_choice = 'use_assigned' then
    v_patch := v_patch || jsonb_build_object('sub_factory_current_index', 0);
  end if;

  update public.orders
  set
    preferred_factory_choice  = p_choice,
    status = case when p_choice = 'cancel' then 'customer_cancelled' else status end,
    sub_factory_current_index = case when p_choice = 'use_assigned' then 0
                                     else sub_factory_current_index end
  where id = trim(p_order_id);

  return v_patch;
end;
$$;

revoke all on function public.set_preferred_factory_choice(text, text) from public;
grant execute on function public.set_preferred_factory_choice(text, text) to authenticated;
grant execute on function public.set_preferred_factory_choice(text, text) to anon;
