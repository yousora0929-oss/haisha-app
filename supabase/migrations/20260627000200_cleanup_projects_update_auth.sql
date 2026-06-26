-- projects: authenticated 全員 UPDATE 可能な旧ポリシーを削除
-- （projects_customer_update / projects_factory_update が適切な条件で担当）

drop policy if exists "projects_update_auth" on public.projects;

-- migration: cleanup_projects_update_auth
