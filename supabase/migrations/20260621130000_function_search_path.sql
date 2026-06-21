-- =============================================================================
-- SECURITY: 13 関数に固定の search_path を設定（Supabase Advisor 0011 対応）
-- =============================================================================
-- 問題:
--   13 個の関数（SECURITY DEFINER を含む）で search_path が未設定。
--   攻撃者が別スキーマに同名の関数を作成して検索パスに紛れ込ませた場合、
--   SECURITY DEFINER 関数が偽物を呼んでしまう古典的な権限昇格攻撃に脆弱。
--
-- 方針:
--   関数ボディは一切変更せず、ALTER FUNCTION SET で search_path のみ固定する。
--   これにより、関数の動作は変わらず、設定の硬化だけが実現できる。
--   public, extensions の順で固定（pg_net などの拡張も安全に解決される）。
-- =============================================================================

alter function public.set_schedules_updated_at()
  set search_path = public, extensions;

alter function public.is_valid_site_order_token(p_token text)
  set search_path = public, extensions;

alter function public.factory_matches_text(p_factory_id text, p_site_text text)
  set search_path = public, extensions;

alter function public.site_order_token_as_uuid(p_token text)
  set search_path = public, extensions;

alter function public.safe_text_to_uuid(p_text text)
  set search_path = public, extensions;

alter function public.site_order_url_token_equals(p_stored_token text, p_token text)
  set search_path = public, extensions;

alter function public.jsonb_elem_to_uuid(p_elem jsonb)
  set search_path = public, extensions;

alter function public.sync_project_sub_contractor_names()
  set search_path = public, extensions;

alter function public.resolve_site_order_parties(p_project public.projects, p_customer public.customers)
  set search_path = public, extensions;

alter function public.factory_news_targets_factory(p_target_ids text[], p_factory_id text)
  set search_path = public, extensions;

alter function public.handle_chat_update_onesignal_push()
  set search_path = public, extensions;

alter function public.set_projects_updated_at()
  set search_path = public, extensions;

alter function public._onesignal_effective_order_status(p_status text, p_order_data jsonb)
  set search_path = public, extensions;
