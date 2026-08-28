-- =============================================================================
-- 同一会社なのに複数レコードに分かれている業者組織（type='contractor'）を1件に統合
--
-- 会社名の名寄せは public.normalize_company_name（= src/utils/csvImport.js の
-- normalizeCompanyName と同一規則）で判定する。
--
-- 残す組織（keeper）の選び方:
--   1. 参照されている（担当者・物件などが紐づく）組織を優先
--   2. 次に created_at が古いもの、最後に id 昇順
-- 参照0件の空組織が古い場合まで「古い方」を残すと、実データを持つ組織側の行を
-- 無意味に書き換えることになるため、参照有無を最優先している。
-- =============================================================================

do $$
declare
  rec record;
  n_customers int;
  n_projects int;
  n_trading int;
  n_orders int;
  n_batches int;
  n_children int;
begin
  for rec in
    with dup as (
      select o.id,
             o.name,
             o.created_at,
             public.normalize_company_name(o.name) as norm,
             (select count(*) from public.customers c where c.organization_id = o.id)
             + (select count(*) from public.projects p where p.organization_id = o.id)
             + (select count(*) from public.projects p where p.trading_company_organization_id = o.id)
             + (select count(*) from public.orders ord where ord.agent_organization_id = o.id)
             + (select count(*) from public.schedule_import_batches b where b.agent_organization_id = o.id)
             + (select count(*) from public.organizations x where x.cooperative_id = o.id) as refs
      from public.organizations o
      where o.type = 'contractor'
    ),
    ranked as (
      select d.*,
             row_number() over (partition by d.norm order by (d.refs > 0) desc, d.created_at, d.id) as rn
      from dup d
      where d.norm in (select norm from dup group by norm having count(*) > 1)
    )
    select r.id as loser_id, r.name as loser_name, k.id as keeper_id
    from ranked r
    join ranked k on k.norm = r.norm and k.rn = 1
    where r.rn > 1
  loop
    update public.customers set organization_id = rec.keeper_id where organization_id = rec.loser_id;
    get diagnostics n_customers = row_count;

    update public.projects set organization_id = rec.keeper_id where organization_id = rec.loser_id;
    get diagnostics n_projects = row_count;

    -- 以下は業者組織が商社枠で参照されている異常データ向けの保険（通常は0件）
    update public.projects set trading_company_organization_id = rec.keeper_id
     where trading_company_organization_id = rec.loser_id;
    get diagnostics n_trading = row_count;

    update public.orders set agent_organization_id = rec.keeper_id where agent_organization_id = rec.loser_id;
    get diagnostics n_orders = row_count;

    update public.schedule_import_batches set agent_organization_id = rec.keeper_id
     where agent_organization_id = rec.loser_id;
    get diagnostics n_batches = row_count;

    update public.organizations set cooperative_id = rec.keeper_id where cooperative_id = rec.loser_id;
    get diagnostics n_children = row_count;

    -- keeper 側にフリガナが無い場合だけ、消す側の値を引き継ぐ
    update public.organizations k
    set furigana = l.furigana
    from public.organizations l
    where k.id = rec.keeper_id
      and l.id = rec.loser_id
      and btrim(coalesce(k.furigana, '')) = ''
      and btrim(coalesce(l.furigana, '')) <> '';

    delete from public.organizations where id = rec.loser_id;

    raise notice 'merged organization % (%) into %: customers=% projects=% trading=% orders=% batches=% children=%',
      rec.loser_id, rec.loser_name, rec.keeper_id,
      n_customers, n_projects, n_trading, n_orders, n_batches, n_children;
  end loop;
end $$;
