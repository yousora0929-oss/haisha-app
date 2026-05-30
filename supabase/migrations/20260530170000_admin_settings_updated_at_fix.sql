-- login_admin の updated_at 参照エラー修正（本番で admin_settings.updated_at が無い環境向け）

alter table public.admin_settings
  add column if not exists updated_at timestamptz not null default now();

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

grant execute on function public.login_admin(text, text) to authenticated, anon;
