-- 配合計画書依頼: 工場ごとの受注確認トークン（ログイン不要の公開URL）
-- 既存行にも DEFAULT でトークンを発行する。
-- 編集時にトークン / 受注日時を消さないよう sync は差分同期にする。
-- orders テーブルは変更しない。

alter table public.mix_design_request_factories
  add column if not exists accept_token uuid not null default gen_random_uuid(),
  add column if not exists accepted_at timestamp with time zone,
  add column if not exists accepted_ip text;

comment on column public.mix_design_request_factories.accept_token is
  '工場が受注を確定する際に使う、ログイン不要の公開URL用トークン。推測困難なUUIDを使用。';

comment on column public.mix_design_request_factories.accepted_at is
  '受注ボタンが押された日時。NULLのままなら未受注。一度セットされたら上書きしない（多重送信・多重クリック対策）。';

comment on column public.mix_design_request_factories.accepted_ip is
  '受注操作時のアクセス元IP。取得できない場合は NULL。';

create unique index if not exists idx_mix_design_request_factories_accept_token
  on public.mix_design_request_factories (accept_token);

-- 既存工場の差し替え時にトークンと受注状態を保持する
create or replace function public.sync_mix_design_request_factories(
  p_request_id uuid,
  p_request jsonb
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids text[] := array[]::text[];
  v_elem text;
  v_primary text;
  v_arr jsonb;
begin
  if p_request_id is null then
    raise exception 'request id required';
  end if;

  v_arr := p_request->'requested_to_factory_ids';
  if v_arr is not null and jsonb_typeof(v_arr) = 'array' and jsonb_array_length(v_arr) > 0 then
    for v_elem in
      select nullif(btrim(coalesce(x, '')), '')
      from jsonb_array_elements_text(v_arr) as t(x)
    loop
      if v_elem is not null and not (v_elem = any (v_ids)) then
        v_ids := array_append(v_ids, v_elem);
      end if;
    end loop;
  end if;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    v_elem := nullif(btrim(coalesce(p_request->>'requested_to_factory_id', '')), '');
    if v_elem is not null then
      v_ids := array[v_elem];
    end if;
  end if;

  delete from public.mix_design_request_factories
  where request_id = p_request_id
    and (
      coalesce(array_length(v_ids, 1), 0) = 0
      or not (factory_id = any (v_ids))
    );

  if coalesce(array_length(v_ids, 1), 0) > 0 then
    insert into public.mix_design_request_factories (request_id, factory_id)
    select p_request_id, fid
    from unnest(v_ids) as fid
    on conflict (request_id, factory_id) do nothing;
  end if;

  v_primary := case when coalesce(array_length(v_ids, 1), 0) > 0 then v_ids[1] else null end;

  update public.mix_design_requests
  set requested_to_factory_id = v_primary
  where id = p_request_id;

  return v_primary;
end;
$$;

comment on function public.sync_mix_design_request_factories(uuid, jsonb) is
  '配合依頼の依頼先工場一覧を junction に差分同期する。既存行の accept_token / accepted_at は保持し、先頭工場を requested_to_factory_id に書く。';

-- 公開ページ用: トークンに紐づく最低限の概要のみ返す（他依頼・他工場・連絡先は出さない）
create or replace function public.get_mix_design_accept_by_token(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_row public.mix_design_request_factories%rowtype;
  v_req public.mix_design_requests%rowtype;
  v_factory_name text;
  v_item_count integer := 0;
  v_mix_labels jsonb := '[]'::jsonb;
begin
  if p_token is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into v_row
  from public.mix_design_request_factories
  where accept_token = p_token
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into v_req
  from public.mix_design_requests
  where id = v_row.request_id
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select nullif(btrim(coalesce(f.name, '')), '')
  into v_factory_name
  from public.factories f
  where f.id = v_row.factory_id
  limit 1;

  select count(*)::integer
  into v_item_count
  from public.mix_design_request_items i
  where i.request_id = v_req.id;

  select coalesce(
    jsonb_agg(
      to_jsonb(
        concat_ws(
          ' ',
          nullif(
            concat_ws(
              '-',
              nullif(i.base_strength::text, ''),
              nullif(i.slump::text, ''),
              nullif(i.aggregate_size::text, '')
            ),
            ''
          ),
          case when i.cement_type in ('N', 'BB') then i.cement_type else null end
        )
      )
      order by i.sort_order, i.created_at
    ),
    '[]'::jsonb
  )
  into v_mix_labels
  from public.mix_design_request_items i
  where i.request_id = v_req.id;

  return jsonb_build_object(
    'ok', true,
    'already_accepted', v_row.accepted_at is not null,
    'accepted_at', v_row.accepted_at,
    'factory_name', coalesce(v_factory_name, v_row.factory_id),
    'project_name', coalesce(v_req.project_name, ''),
    'contractor_name', coalesce(v_req.contractor_name, ''),
    'item_count', coalesce(v_item_count, 0),
    'mix_labels', coalesce(v_mix_labels, '[]'::jsonb)
  );
end;
$$;

comment on function public.get_mix_design_accept_by_token(uuid) is
  '受注確認公開ページ用。accept_token に一致する1件の概要のみ返す。他の依頼・工場・個人連絡先は返さない。';

revoke all on function public.get_mix_design_accept_by_token(uuid) from public;
grant execute on function public.get_mix_design_accept_by_token(uuid) to anon, authenticated;

create or replace function public.accept_mix_design_request_factory(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.mix_design_request_factories%rowtype;
  v_headers jsonb;
  v_ip text;
  v_now timestamptz := now();
  v_updated integer := 0;
begin
  if p_token is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select * into v_row
  from public.mix_design_request_factories
  where accept_token = p_token
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  if v_row.accepted_at is not null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'already_accepted',
      'accepted_at', v_row.accepted_at
    );
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception
    when others then
      v_headers := null;
  end;

  if v_headers is not null then
    v_ip := nullif(btrim(split_part(coalesce(v_headers->>'x-forwarded-for', ''), ',', 1)), '');
    if v_ip is null then
      v_ip := nullif(btrim(coalesce(v_headers->>'cf-connecting-ip', '')), '');
    end if;
    if v_ip is null then
      v_ip := nullif(btrim(coalesce(v_headers->>'x-real-ip', '')), '');
    end if;
  end if;
  v_ip := nullif(left(coalesce(v_ip, ''), 100), '');

  update public.mix_design_request_factories
  set
    accepted_at = v_now,
    accepted_ip = v_ip
  where id = v_row.id
    and accepted_at is null;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    select accepted_at into v_row.accepted_at
    from public.mix_design_request_factories
    where id = v_row.id;

    return jsonb_build_object(
      'ok', false,
      'reason', 'already_accepted',
      'accepted_at', v_row.accepted_at
    );
  end if;

  update public.mix_design_requests
  set status = 'in_progress'
  where id = v_row.request_id
    and status = 'requested';

  return jsonb_build_object(
    'ok', true,
    'accepted_at', v_now
  );
end;
$$;

comment on function public.accept_mix_design_request_factory(uuid) is
  '受注確認公開ページ用。accepted_at が空のときだけセットし、依頼 status は requested のときだけ in_progress にする。orders は更新しない。';

revoke all on function public.accept_mix_design_request_factory(uuid) from public;
grant execute on function public.accept_mix_design_request_factory(uuid) to anon, authenticated;
