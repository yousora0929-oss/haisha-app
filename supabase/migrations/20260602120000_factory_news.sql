-- 工場向けニュース配信・既読管理

create table if not exists public.factory_news (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  target_factory_ids text[] not null default '{}'::text[],
  created_at timestamptz not null default now()
);

comment on table public.factory_news is '管理者→工場向けお知らせ（target_factory_ids 空=全工場）';
comment on column public.factory_news.target_factory_ids is '配信先工場ID。空配列は全工場向け';

create table if not exists public.factory_news_reads (
  news_id uuid not null references public.factory_news (id) on delete cascade,
  factory_id text not null,
  read_at timestamptz not null default now(),
  primary key (news_id, factory_id)
);

create index if not exists factory_news_created_at_idx on public.factory_news (created_at desc);
create index if not exists factory_news_reads_news_id_idx on public.factory_news_reads (news_id);

alter table public.factory_news enable row level security;
alter table public.factory_news_reads enable row level security;

-- 配信対象判定（空=全工場）
create or replace function public.factory_news_targets_factory(
  p_target_ids text[],
  p_factory_id text
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    nullif(trim(coalesce(p_factory_id, '')), '') is not null
    and (
      p_target_ids is null
      or cardinality(p_target_ids) = 0
      or nullif(trim(coalesce(p_factory_id, '')), '') = any (p_target_ids)
    );
$$;

create or replace function public.factory_news_visible_to_actor(p_news public.factory_news)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_news is null then false
    when public.is_admin_panel_request() or public.is_app_admin() then true
    when public.is_factory_panel_request() or public.is_app_factory() then
      public.factory_news_targets_factory(
        p_news.target_factory_ids,
        public.effective_factory_actor_id()
      )
    else false
  end;
$$;

-- 既読登録（自工場のみ・p_factory_id で明示指定可）
create or replace function public.mark_factory_news_read(
  p_news_id uuid,
  p_factory_id text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fid text;
  v_panel_fid text;
begin
  if p_news_id is null then
    return;
  end if;

  v_fid := nullif(trim(coalesce(p_factory_id, '')), '');

  if public.is_factory_panel_request() then
    v_panel_fid := nullif(trim(coalesce(public.current_factory_panel_id(), '')), '');
    if v_panel_fid is null then
      raise exception '工場認証が必要です' using errcode = 'P0001';
    end if;
    if v_fid is null then
      v_fid := v_panel_fid;
    elsif v_fid is distinct from v_panel_fid then
      raise exception '工場IDが一致しません' using errcode = 'P0001';
    end if;
  else
    if v_fid is null then
      v_fid := nullif(trim(coalesce(public.effective_factory_actor_id(), '')), '');
    end if;
    if v_fid is null then
      raise exception '工場認証が必要です' using errcode = 'P0001';
    end if;
  end if;

  if not exists (
    select 1 from public.factory_news n
    where n.id = p_news_id
      and public.factory_news_targets_factory(n.target_factory_ids, v_fid)
  ) then
    raise exception '閲覧できないお知らせです' using errcode = 'P0001';
  end if;

  insert into public.factory_news_reads (news_id, factory_id)
  values (p_news_id, v_fid)
  on conflict (news_id, factory_id) do nothing;
end;
$$;

revoke all on function public.factory_news_targets_factory(text[], text) from public;
revoke all on function public.factory_news_visible_to_actor(public.factory_news) from public;
revoke all on function public.mark_factory_news_read(uuid, text) from public;
grant execute on function public.factory_news_targets_factory(text[], text) to authenticated, anon;
grant execute on function public.factory_news_visible_to_actor(public.factory_news) to authenticated, anon;
grant execute on function public.mark_factory_news_read(uuid, text) to authenticated, anon;

-- RLS: factory_news
drop policy if exists "factory_news_admin_panel" on public.factory_news;
create policy "factory_news_admin_panel"
  on public.factory_news
  for all
  to anon, authenticated
  using (public.is_admin_panel_request() or public.is_app_admin())
  with check (public.is_admin_panel_request() or public.is_app_admin());

drop policy if exists "factory_news_factory_select" on public.factory_news;
create policy "factory_news_factory_select"
  on public.factory_news
  for select
  to anon, authenticated
  using (
    (public.is_factory_panel_request() or public.is_app_factory())
    and public.factory_news_visible_to_actor(factory_news)
  );

-- RLS: factory_news_reads
drop policy if exists "factory_news_reads_admin_panel" on public.factory_news_reads;
create policy "factory_news_reads_admin_panel"
  on public.factory_news_reads
  for all
  to anon, authenticated
  using (public.is_admin_panel_request() or public.is_app_admin())
  with check (public.is_admin_panel_request() or public.is_app_admin());

drop policy if exists "factory_news_reads_factory_select" on public.factory_news_reads;
create policy "factory_news_reads_factory_select"
  on public.factory_news_reads
  for select
  to anon, authenticated
  using (
  exists (
    select 1 from public.factory_news n
    where n.id = factory_news_reads.news_id
      and public.factory_news_visible_to_actor(n)
  )
);

drop policy if exists "factory_news_reads_factory_insert" on public.factory_news_reads;
create policy "factory_news_reads_factory_insert"
  on public.factory_news_reads
  for insert
  to anon, authenticated
  with check (
    (public.is_factory_panel_request() or public.is_app_factory())
    and trim(factory_id) = coalesce(
      nullif(trim(public.effective_factory_actor_id()), ''),
      nullif(trim(public.current_factory_panel_id()), '')
    )
    and exists (
      select 1 from public.factory_news n
      where n.id = factory_news_reads.news_id
        and public.factory_news_targets_factory(n.target_factory_ids, factory_id)
    )
  );

-- Realtime
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'factory_news'
  ) then
    alter publication supabase_realtime add table public.factory_news;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'factory_news_reads'
  ) then
    alter publication supabase_realtime add table public.factory_news_reads;
  end if;
end $$;
