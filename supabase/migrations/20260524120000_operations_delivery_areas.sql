-- 組合運用: 納入エリア・スポット上限・地図待ちフラグ

alter table public.admin_settings
  add column if not exists allowed_delivery_areas jsonb not null default '["大分市","由布市","杵築市","別府市","中津市"]'::jsonb;

alter table public.admin_settings
  add column if not exists spot_threshold_volume numeric not null default 50;

comment on column public.admin_settings.allowed_delivery_areas is '受注可能な市町村・エリア名の配列（JSON）';
comment on column public.admin_settings.spot_threshold_volume is 'スポット注文の組合承認が必要となる数量上限（m³）';

alter table public.orders
  add column if not exists is_location_pending boolean not null default false;

comment on column public.orders.is_location_pending is 'true=あとから地図送付（詳細未定・枠のみ確保）';

alter table public.projects
  add column if not exists delivery_area text;

alter table public.projects
  add column if not exists site_address text;

comment on column public.projects.delivery_area is '納入エリア（組合設定の市町村など）';
comment on column public.projects.site_address is '現場住所（番地・現場名など）';

update public.admin_settings
set
  allowed_delivery_areas = coalesce(
    nullif(allowed_delivery_areas, '[]'::jsonb),
    '["大分市","由布市","杵築市","別府市","中津市"]'::jsonb
  ),
  spot_threshold_volume = coalesce(spot_threshold_volume, 50)
where id = 1;
