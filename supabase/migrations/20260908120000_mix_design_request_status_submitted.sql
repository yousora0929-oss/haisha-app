-- 配合計画書依頼: status に submitted（提出済み）を追加して5段階にする。
-- 既存値 not_started / requested / in_progress / completed は維持。orders は変更しない。

do $$
declare
  rec record;
begin
  for rec in
    select conname
    from pg_constraint
    where conrelid = 'public.mix_design_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ~* 'not_started'
      and pg_get_constraintdef(oid) ~* 'requested'
  loop
    execute format('alter table public.mix_design_requests drop constraint if exists %I', rec.conname);
  end loop;
end $$;

alter table public.mix_design_requests
  drop constraint if exists mix_design_requests_status_check;

alter table public.mix_design_requests
  add constraint mix_design_requests_status_check
  check (
    status = any (
      array['not_started', 'requested', 'in_progress', 'completed', 'submitted']::text[]
    )
  );

comment on column public.mix_design_requests.status is
  '保留中(not_started) / 依頼中(requested) / 作成中(in_progress) / 完成(completed) / 提出済み(submitted)。作成時は requested、工場受注URLは requested→in_progress。完成・提出済みは手動変更可。';

comment on table public.mix_design_requests is
  '配合計画書作成依頼。ステータスは 保留中→依頼中(送信で自動)→作成中(工場が受注URLで自動)→完成→提出済み。orders は更新しない。';

create or replace function public.update_mix_design_request_status(
  p_request_id uuid,
  p_status text,
  p_changed_by text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old text;
begin
  if not public.is_customer_panel_request() then
    raise exception 'not authorized';
  end if;
  if not coalesce(public.current_customer_can_request_mix_design(), false) then
    raise exception 'not authorized';
  end if;
  if p_request_id is null then
    raise exception 'request id required';
  end if;
  if p_status is null
     or p_status not in ('not_started', 'requested', 'in_progress', 'completed', 'submitted') then
    raise exception 'invalid status';
  end if;

  select r.status into v_old
  from public.mix_design_requests r
  where r.id = p_request_id
  for update;

  if not found then
    raise exception 'request not found';
  end if;

  if v_old = p_status then
    return v_old;
  end if;

  update public.mix_design_requests
  set
    status = p_status,
    updated_at = now()
  where id = p_request_id;

  insert into public.mix_design_request_change_logs (
    request_id,
    changed_by,
    changes,
    before_snapshot,
    after_snapshot
  ) values (
    p_request_id,
    nullif(btrim(coalesce(p_changed_by, '')), ''),
    jsonb_build_array(
      jsonb_build_object(
        'field', 'status',
        'label', 'ステータス',
        'old', v_old,
        'new', p_status
      )
    ),
    jsonb_build_object('status', v_old),
    jsonb_build_object('status', p_status)
  );

  return v_old;
end;
$$;

comment on function public.update_mix_design_request_status(uuid, text, text) is
  '配合計画書依頼のステータスを手動更新し、変更履歴に記録する。orders は更新しない。';

revoke all on function public.update_mix_design_request_status(uuid, text, text) from public;
grant execute on function public.update_mix_design_request_status(uuid, text, text) to anon, authenticated;
