-- projects: プロトタイプ時代の全許可ポリシーを削除（RLS OR 評価で新制限が無効化されるのを防ぐ）

drop policy if exists "projects_select_anon" on public.projects;
drop policy if exists "projects_insert_anon" on public.projects;
drop policy if exists "projects_update_anon" on public.projects;
drop policy if exists "projects_delete_anon" on public.projects;
drop policy if exists "projects_select_auth" on public.projects;
drop policy if exists "projects_insert_auth" on public.projects;
drop policy if exists "projects_delete_auth" on public.projects;
drop policy if exists "誰でもアクセス可能" on public.projects;

-- migration: cleanup_projects_legacy_policies
