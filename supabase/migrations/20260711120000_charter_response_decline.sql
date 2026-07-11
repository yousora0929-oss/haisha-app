-- charter_responses: 「見送る」(declined) を許可し、offered_count 制約を緩和

alter table public.charter_responses
  drop constraint if exists charter_responses_status_check;

alter table public.charter_responses
  add constraint charter_responses_status_check
  check (status in ('offered', 'accepted', 'rejected', 'withdrawn', 'declined'));

alter table public.charter_responses
  drop constraint if exists charter_responses_offered_count_check;

alter table public.charter_responses
  add constraint charter_responses_offered_count_check
  check (status = 'declined' or offered_count > 0);

alter table public.charter_responses
  alter column offered_count set default 0;
