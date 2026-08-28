-- =============================================================================
-- 業者の会社単位所有 Phase A: 器の新設＋データ移行（追加のみ）
--
-- - organizations.type に 'contractor' を許可（20260703000000 で既に許可済。冪等に再定義）
-- - customers / projects に organization_id を追加（projects 側が新規）
-- - 業者アカウントを会社（type='contractor'）へ紐付け、物件に所有会社を書き込む
--
-- 参照系（RLS・アプリのクエリ・表示ロジック）は従来どおり customer_id ベースのまま。
-- projects.organization_id を読むコードはまだ存在しない（Phase B で切り替える）。
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 作業1: organizations.type に contractor を許可
-- -----------------------------------------------------------------------------
alter table public.organizations
  drop constraint if exists organizations_type_check;

alter table public.organizations
  add constraint organizations_type_check
  check (type in ('agent', 'cooperative', 'contractor'));

-- -----------------------------------------------------------------------------
-- 作業2: customers / projects に organization_id を追加
-- -----------------------------------------------------------------------------
alter table public.customers
  add column if not exists organization_id uuid references public.organizations (id) on delete set null;

alter table public.projects
  add column if not exists organization_id uuid references public.organizations (id) on delete set null;

create index if not exists customers_organization_id_idx on public.customers (organization_id);
create index if not exists projects_organization_id_idx on public.projects (organization_id);

comment on column public.customers.organization_id is
  '所属会社（organizations）。contractor の場合は所属する業者会社。将来的に物件アクセスを会社単位にするための列で、customer_idベースの既存ロジックには影響しない。';
comment on column public.projects.organization_id is
  '物件を所有する会社（organizations, type=contractor）。将来的にRLSをこちら基準に切り替える予定。現時点では未使用（参照系ロジックはcustomer_idのまま）。';

-- -----------------------------------------------------------------------------
-- 作業3: 業者アカウントの会社紐付けと、物件の所有会社の書き込み
-- -----------------------------------------------------------------------------

-- 会社名の名寄せキー。src/utils/csvImport.js の normalizeCompanyName と同一規則
-- （空白統一 → 全角括弧を半角へ → 法人格を種類別トークンへ置換）。
-- 前株/後株の違い・法人格の種類違い・支店名の違いは別会社として扱う。
create or replace function public.normalize_company_name(raw text)
returns text
language sql
immutable
as $$
  select btrim(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              regexp_replace(
                regexp_replace(
                  translate(btrim(coalesce(raw, '')), chr(12288) || '（）', ' ()'),
                  '\s+', ' ', 'g'),
                '株式会社|㈱|\(株\)', '[KK]', 'g'),
              '有限会社|㈲|\(有\)', '[YK]', 'g'),
            '合同会社|㈾|\(同\)', '[GD]', 'g'),
          '合資会社|\(資\)', '[GS]', 'g'),
        '合名会社|\(名\)', '[GM]', 'g'),
      '\s+', ' ', 'g')
  )
$$;

comment on function public.normalize_company_name(text) is
  '会社名の名寄せキー。src/utils/csvImport.js の normalizeCompanyName と同一規則';

-- 3-1. 会社が未設定の業者アカウント向けに、正規化名ごとに1件だけ組織を作成
--      （同じ正規化名の contractor 組織が既にあれば作らず既存を使う）
insert into public.organizations (name, type)
select distinct on (public.normalize_company_name(c.company_name))
       btrim(c.company_name),
       'contractor'
from public.customers c
where coalesce(c.role, 'contractor') = 'contractor'
  and c.organization_id is null
  and btrim(coalesce(c.company_name, '')) <> ''
  and not exists (
    select 1
    from public.organizations o
    where o.type = 'contractor'
      and public.normalize_company_name(o.name) = public.normalize_company_name(c.company_name)
  )
order by public.normalize_company_name(c.company_name), btrim(c.company_name), c.id;

-- 3-2. 業者アカウントを、正規化名が一致する組織へ紐付ける
update public.customers c
set organization_id = m.organization_id
from (
  select c2.id as customer_id,
         (select o.id
            from public.organizations o
           where o.type = 'contractor'
             and public.normalize_company_name(o.name) = public.normalize_company_name(c2.company_name)
           order by o.created_at, o.id
           limit 1) as organization_id
  from public.customers c2
  where coalesce(c2.role, 'contractor') = 'contractor'
    and c2.organization_id is null
    and btrim(coalesce(c2.company_name, '')) <> ''
) m
where c.id = m.customer_id
  and m.organization_id is not null;

-- 3-3. 物件の所有会社を、発注元業者アカウントの所属会社で埋める
--      （customer_id が業者以外を指す物件は対象外。NULL のまま残す）
update public.projects p
set organization_id = c.organization_id
from public.customers c
where c.id = p.customer_id
  and coalesce(c.role, 'contractor') = 'contractor'
  and c.organization_id is not null
  and p.organization_id is null;
