-- admin_settings: 古い環境では updated_at が無い場合がある
alter table public.admin_settings
  add column if not exists updated_at timestamptz not null default now();

-- =============================================================================
-- 管理者画面（電話番号 + パスワード・anon キー）向け RLS 補完
--
-- 本番 RLS 適用後、管理画面は Supabase Auth 未ログインのため orders / customers 等が
-- 読めなくなる。リクエストヘッダー x-admin-phone / x-admin-password で
-- admin_settings と照合し、従来どおり管理画面から操作できるようにする。
-- =============================================================================

create or replace function public.is_admin_panel_request()
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  hdr json;
  p_phone text;
  p_pass text;
begin
  begin
    hdr := nullif(current_setting('request.headers', true), '')::json;
  exception
    when others then
      return false;
  end;
  if hdr is null then
    return false;
  end if;
  p_phone := nullif(trim(hdr ->> 'x-admin-phone'), '');
  p_pass := nullif(trim(hdr ->> 'x-admin-password'), '');
  if p_phone is null or p_pass is null then
    return false;
  end if;
  return exists (
    select 1
    from public.admin_settings s
    where s.id = 1
      and trim(coalesce(s.phone_number, '')) = p_phone
      and trim(coalesce(s.login_password, '')) = p_pass
  );
exception
  when others then
    return false;
end;
$$;

comment on function public.is_admin_panel_request() is
  '管理画面リクエスト（x-admin-phone / x-admin-password ヘッダーが admin_settings と一致）';

-- ログイン用 RPC（RLS 下でも anon から認証可能）
create or replace function public.login_admin(p_phone text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id integer;
  v_admin_name text;
  v_phone_number text;
  v_areas jsonb;
  v_spot numeric;
begin
  select
    s.id,
    s.admin_name,
    s.phone_number,
    coalesce(s.allowed_delivery_areas, '[]'::jsonb),
    s.spot_threshold_volume
  into v_id, v_admin_name, v_phone_number, v_areas, v_spot
  from public.admin_settings s
  where s.id = 1
    and trim(coalesce(s.phone_number, '')) = trim(coalesce(p_phone, ''))
    and trim(coalesce(s.login_password, '')) = trim(coalesce(p_password, ''));
  if not found then
    raise exception '管理者の電話番号またはパスワードが間違っています'
      using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'id', v_id,
    'admin_name', v_admin_name,
    'phone_number', v_phone_number,
    'allowed_delivery_areas', v_areas,
    'spot_threshold_volume', v_spot
  );
end;
$$;

revoke all on function public.is_admin_panel_request() from public;
revoke all on function public.login_admin(text, text) from public;
grant execute on function public.is_admin_panel_request() to authenticated, anon;
grant execute on function public.login_admin(text, text) to authenticated, anon;

-- 管理画面: anon からのフルアクセス（ヘッダー認証時のみ）
create policy "orders_admin_panel"
  on public.orders
  for all
  to anon
  using (public.is_admin_panel_request())
  with check (public.is_admin_panel_request());

create policy "customers_admin_panel"
  on public.customers
  for all
  to anon
  using (public.is_admin_panel_request())
  with check (public.is_admin_panel_request());

create policy "projects_admin_panel"
  on public.projects
  for all
  to anon
  using (public.is_admin_panel_request())
  with check (public.is_admin_panel_request());

create policy "schedules_admin_panel"
  on public.schedules
  for all
  to anon
  using (public.is_admin_panel_request())
  with check (public.is_admin_panel_request());

create policy "holidays_admin_panel"
  on public.holidays
  for all
  to anon
  using (public.is_admin_panel_request())
  with check (public.is_admin_panel_request());

create policy "system_settings_admin_panel"
  on public.system_settings
  for all
  to anon
  using (public.is_admin_panel_request())
  with check (public.is_admin_panel_request());

create policy "admin_settings_admin_panel"
  on public.admin_settings
  for all
  to anon
  using (public.is_admin_panel_request())
  with check (public.is_admin_panel_request());

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'factories'
  ) then
    execute $pol$
      create policy "factories_admin_panel"
        on public.factories
        for all
        to anon
        using (public.is_admin_panel_request())
        with check (public.is_admin_panel_request())
    $pol$;
  end if;
end $$;
