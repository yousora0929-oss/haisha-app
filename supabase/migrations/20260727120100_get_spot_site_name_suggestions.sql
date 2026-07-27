-- スポット注文の現場名オートコンプリート候補
-- 呼び出し元は customer panel ヘッダー認証必須。任意UUIDの横断参照を拒否する。

create or replace function public.get_spot_site_name_suggestions(
  p_contractor_ref_customer_id uuid,
  p_limit int default 8
)
returns table (
  site_name text,
  use_count bigint,
  last_used_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_caller uuid;
  v_role text;
  v_allowed boolean := false;
begin
  if p_contractor_ref_customer_id is null then
    return;
  end if;

  v_caller := public.current_customer_panel_id();
  if v_caller is null then
    -- 管理画面からの確認用（任意）。顧客以外は空を返す。
    if public.is_admin_panel_request() or public.is_app_admin() then
      v_allowed := true;
    else
      return;
    end if;
  else
    v_role := public.current_customer_role();

    if p_contractor_ref_customer_id = v_caller then
      v_allowed := true;
    elsif v_role = 'agent' then
      v_allowed := exists (
        select 1
        from public.agent_contractor_links l
        where l.agent_customer_id = v_caller
          and l.contractor_customer_id = p_contractor_ref_customer_id
      );
    elsif v_role = 'cooperative' then
      -- DispatchApp と同様: 組合は role=contractor の業者を代理発注対象にできる
      v_allowed := exists (
        select 1
        from public.customers c
        where c.id = p_contractor_ref_customer_id
          and coalesce(c.role, 'contractor') = 'contractor'
      );
    else
      -- contractor 等: 自分以外は不可
      v_allowed := false;
    end if;
  end if;

  if not v_allowed then
    return;
  end if;

  return query
  select
    trim(coalesce(o.order_data->>'siteName', o.order_data->>'site_name')) as site_name,
    count(*)::bigint as use_count,
    max(o.created_at) as last_used_at
  from public.orders o
  where o.project_id is null
    and o.site_history_contractor_id = p_contractor_ref_customer_id
    and trim(coalesce(o.order_data->>'siteName', o.order_data->>'site_name', '')) <> ''
  group by 1
  order by max(o.created_at) desc
  limit greatest(1, least(coalesce(p_limit, 8), 20));
end;
$$;

comment on function public.get_spot_site_name_suggestions(uuid, int) is
  'スポット注文の現場名オートコンプリート候補。site_history_contractor_id単位で集計。current_customer_panel_id で権限検証。';

revoke all on function public.get_spot_site_name_suggestions(uuid, int) from public;
grant execute on function public.get_spot_site_name_suggestions(uuid, int) to anon, authenticated;
