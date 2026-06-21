-- =============================================================================
-- maps バケット: 不要な公開ポリシーの削除（Security Advisor 対応）
-- =============================================================================
-- 問題1: "Allow all operations for maps" (FOR ALL, roles: public,
--        USING/CHECK: bucket_id='maps') が残存しており、認証なしで
--        誰でも全ファイルの読み取り・上書き・削除が可能になっていた。
--        maps_delete_admin（管理者限定）等のポリシーを実質無効化していた。
-- 問題2: maps_read_anon / maps_read_authenticated_v2 が SELECT を許可し、
--        list() で全ファイル名を一覧取得できた
--        （Supabase Advisor: public_bucket_allows_listing）。
--        アプリは getPublicUrl() のみで画像表示しており list() は不使用。
--        public バケットのため、SELECTポリシーがなくても公開URL経由の
--        ダウンロードには影響しない。
-- =============================================================================

drop policy if exists "Allow all operations for maps" on storage.objects;
drop policy if exists "maps_read_anon" on storage.objects;
drop policy if exists "maps_read_authenticated_v2" on storage.objects;
