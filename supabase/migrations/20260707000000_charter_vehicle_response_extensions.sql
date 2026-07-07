-- チャーター車両: ナンバー種別・応答車両スナップショット・取り下げ期限

-- =============================================================================
-- 1. charter_vehicles.plate_category
-- =============================================================================
alter table public.charter_vehicles
  add column if not exists plate_category text not null default 'business'
    check (plate_category in ('business', 'private'));

comment on column public.charter_vehicles.plate_category is
  'ナンバー種別: business=事業用（緑ナンバー） / private=自家用（白ナンバー）';

-- =============================================================================
-- 2. charter_responses.assigned_vehicles
-- =============================================================================
alter table public.charter_responses
  add column if not exists assigned_vehicles jsonb not null default '[]'::jsonb;

comment on column public.charter_responses.assigned_vehicles is
  '応答時に割り当てた車両のスナップショット配列。例: [{"vehicle_id":"...","vehicle_type":"large","plate_category":"business","vehicle_number":"...","door_number":"..."}]。台帳(charter_vehicles)の現在値とは非同期（メモ用途）。';

-- =============================================================================
-- 3. 募集日3日前以降の取り下げブロック
-- =============================================================================
create or replace function public.enforce_charter_response_withdrawal_deadline()
returns trigger
language plpgsql
as $$
declare
  v_request_date date;
begin
  if new.status = 'withdrawn' and old.status is distinct from 'withdrawn' then
    select r.request_date into v_request_date
    from public.charter_requests r
    where r.id = old.request_id;

    if v_request_date is not null and v_request_date - current_date < 3 then
      raise exception '募集日の3日前を過ぎているため、この応答は取り下げできません'
        using errcode = 'P0001';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_charter_responses_withdrawal_deadline on public.charter_responses;
create trigger trg_charter_responses_withdrawal_deadline
  before update on public.charter_responses
  for each row
  execute function public.enforce_charter_response_withdrawal_deadline();
