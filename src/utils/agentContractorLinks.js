/** 担当者名・電話がどちらも空の customers 行は代表窓口（業者全体リンクの対象）。 */
export function isCompanyScopeContractorRow(customer) {
  if (!customer || typeof customer !== 'object') return false;
  return (
    String(customer.manager_name ?? '').trim() === '' &&
    String(customer.phone_number ?? '').trim() === ''
  );
}

/** @returns {'company' | 'person'} */
export function agentContractorLinkScopeForRow(customer) {
  return isCompanyScopeContractorRow(customer) ? 'company' : 'person';
}

function contractorOrgId(customer) {
  return String(customer?.organization_id ?? '').trim();
}

/**
 * 保存する取引業者ID。
 * 同じ組織の代表窓口（company）が選ばれていれば、その組織の個別担当者はリンクにしない。
 */
export function contractorIdsForAgentLinks(selectedIds, contractors) {
  const list = Array.isArray(contractors) ? contractors : [];
  const byId = new Map(list.filter((row) => row?.id).map((row) => [String(row.id), row]));
  const ids = [
    ...new Set((selectedIds || []).map((id) => String(id || '').trim()).filter(Boolean)),
  ];
  const companyOrgIds = new Set();
  for (const id of ids) {
    const row = byId.get(id);
    if (!row || agentContractorLinkScopeForRow(row) !== 'company') continue;
    const orgId = contractorOrgId(row);
    if (orgId) companyOrgIds.add(orgId);
  }
  return ids.filter((id) => {
    const row = byId.get(id);
    if (!row) return true;
    const orgId = contractorOrgId(row);
    if (!orgId || !companyOrgIds.has(orgId)) return true;
    return agentContractorLinkScopeForRow(row) === 'company';
  });
}

function contractorRows(customers) {
  return (Array.isArray(customers) ? customers : []).filter(
    (row) => row?.id && (row.role ?? 'contractor') === 'contractor',
  );
}

/**
 * scope=company のリンクを、同じ organization_id の業者行へ展開する。
 * 個別リンク（person）はその1行だけ。
 * @returns {string[]}
 */
export function expandContractorIdsForAgentLinks(links, customers) {
  const contractors = contractorRows(customers);
  const byId = new Map(contractors.map((row) => [String(row.id), row]));
  const ids = new Set();
  for (const link of links || []) {
    const anchorId = String(link?.contractor_customer_id || '').trim();
    if (!anchorId) continue;
    ids.add(anchorId);
    if (String(link?.scope || '') !== 'company') continue;
    const anchor = byId.get(anchorId);
    const orgId = contractorOrgId(anchor) || String(link?.contractor_organization_id || '').trim();
    if (!orgId) continue;
    for (const row of contractors) {
      if (contractorOrgId(row) !== orgId) continue;
      ids.add(String(row.id));
    }
  }
  return [...ids];
}

/**
 * 一覧表示用。company リンクは組織の全担当者を memberIds に含める。
 * 同じ組織の個別リンクは included=true（全担当者に含まれる）。
 * @returns {Array<{ contractor: object, memberIds: string[], scope: 'company'|'person', included: boolean }>}
 */
export function describeAgentContractorLinks(links, customers) {
  const contractors = contractorRows(customers);
  const byId = new Map(contractors.map((row) => [String(row.id), row]));
  const companyOrgIds = new Set();
  for (const link of links || []) {
    if (String(link?.scope || '') !== 'company') continue;
    const anchor = byId.get(String(link?.contractor_customer_id || '').trim());
    const orgId =
      contractorOrgId(anchor) || String(link?.contractor_organization_id || '').trim();
    if (orgId) companyOrgIds.add(orgId);
  }

  const rows = [];
  const seenOrg = new Set();
  const seenId = new Set();
  for (const link of links || []) {
    const anchorId = String(link?.contractor_customer_id || '').trim();
    const anchor = byId.get(anchorId);
    if (!anchor) continue;
    const orgId = contractorOrgId(anchor);
    const company = String(link?.scope || '') === 'company' && Boolean(orgId);
    if (company) {
      if (seenOrg.has(orgId)) continue;
      seenOrg.add(orgId);
      const memberIds = contractors
        .filter((row) => contractorOrgId(row) === orgId)
        .map((row) => String(row.id));
      rows.push({
        contractor: anchor,
        memberIds: memberIds.length ? memberIds : [anchorId],
        scope: 'company',
        included: false,
      });
      continue;
    }
    if (seenId.has(anchorId)) continue;
    seenId.add(anchorId);
    const included = Boolean(orgId && companyOrgIds.has(orgId));
    rows.push({
      contractor: anchor,
      memberIds: [anchorId],
      scope: String(link?.scope || '') === 'company' ? 'company' : 'person',
      included,
    });
  }
  return rows;
}
