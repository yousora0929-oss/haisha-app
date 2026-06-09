-- =============================================================================
-- orders INSERT/UPDATE トリガーで NEW.quantity を参照している古い関数を削除
-- =============================================================================
-- 数量は orders.quantity 列ではなく order_data->>'quantityM3' に格納。
-- スポット上限による pending_association はアプリ側 resolveInitialOrderStatus が担当。
-- 本番に手動作成されたトリガーが 42703 を起こす場合に備え、動的に検出して DROP する。

do $$
declare
  r record;
  other_triggers int;
begin
  for r in
    select
      t.tgname as trigger_name,
      p.oid as func_oid,
      n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as func_sig
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace cn on cn.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace n on n.oid = p.pronamespace
    where cn.nspname = 'public'
      and c.relname = 'orders'
      and not t.tgisinternal
      and (
        p.prosrc ilike '%new.quantity%'
        or p.prosrc ilike '%new."quantity"%'
        or p.prosrc ilike '%NEW.quantity%'
      )
  loop
    execute format('drop trigger if exists %I on public.orders', r.trigger_name);
    raise notice 'Dropped trigger % on public.orders', r.trigger_name;

    select count(*) into other_triggers
    from pg_trigger t2
    where t2.tgfoid = r.func_oid
      and not t2.tgisinternal;

    if other_triggers = 0 then
      execute format('drop function if exists %s', r.func_sig);
      raise notice 'Dropped function %', r.func_sig;
    end if;
  end loop;
end $$;

-- よくある命名のフォールバック（prosrc 検索に引っかからない場合）
drop trigger if exists trg_orders_spot_threshold on public.orders;
drop trigger if exists trg_enforce_spot_order_status on public.orders;
drop trigger if exists trg_orders_set_pending_association on public.orders;
drop trigger if exists trg_orders_spot_pending_association on public.orders;

drop function if exists public.enforce_spot_order_status();
drop function if exists public.set_spot_pending_association();
drop function if exists public.check_spot_order_quantity();
