-- =============================================================================
-- 地図スタンプ配置用 Storage バケット「maps」（パブリック）
-- Supabase Dashboard の Storage でも同名バケットを作成できます。
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'maps',
  'maps',
  true,
  10485760,
  array['image/png', 'image/jpeg', 'image/webp']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- 匿名・認証ユーザー: 読み取り
drop policy if exists "maps_public_read" on storage.objects;
create policy "maps_public_read"
  on storage.objects for select
  to anon, authenticated
  using (bucket_id = 'maps');

-- 匿名・認証ユーザー: アップロード（プロトタイプ。本番は認可を見直してください）
drop policy if exists "maps_public_insert" on storage.objects;
create policy "maps_public_insert"
  on storage.objects for insert
  to anon, authenticated
  with check (bucket_id = 'maps');

drop policy if exists "maps_public_update" on storage.objects;
create policy "maps_public_update"
  on storage.objects for update
  to anon, authenticated
  using (bucket_id = 'maps')
  with check (bucket_id = 'maps');
