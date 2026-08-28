import { normalizeCompanyName } from './csvImport.js';

export { normalizeCompanyName };

/**
 * 物件が業者に紐づくか（元請=ID一致 or 下請=名前一致）
 * @returns {'main' | 'sub' | null}
 */
export function projectMatchRole(project, customer) {
  if (!project || !customer) return null;

  const projectCustomerId = String(project.customer_id || '').trim();
  const customerId = String(customer.id || '').trim();
  if (projectCustomerId && customerId && projectCustomerId === customerId) {
    return 'main';
  }

  const subName = normalizeCompanyName(
    project.sub_contractor_name || project.contractor,
  );
  const customerName = normalizeCompanyName(
    customer.company_name || customer.name,
  );
  return subName && customerName && subName === customerName ? 'sub' : null;
}

/**
 * 同じ会社に属する業者アカウント一覧。
 * 判定は organization_id 一致（RLS の会社単位判定と同じ基準）と
 * company_name の正規化一致の和集合。組織未設定の古いデータでも会社単位で探せる。
 * @param {object[]|null|undefined} customers
 * @param {object|null|undefined} customer 基準となる業者アカウント
 * @returns {object[]}
 */
export function contractorAccountsInSameCompany(customers, customer) {
  if (!customer) return [];
  const orgId = String(customer.organization_id || '').trim();
  const key = normalizeCompanyName(customer.company_name || customer.name);
  if (!orgId && !key) return [customer];
  const list = (Array.isArray(customers) ? customers : []).filter(
    (c) =>
      c &&
      (c.role ?? 'contractor') === 'contractor' &&
      ((orgId && String(c.organization_id || '').trim() === orgId) ||
        (key && normalizeCompanyName(c.company_name || c.name) === key)),
  );
  if (!list.some((c) => String(c.id) === String(customer.id))) list.push(customer);
  return list;
}

/**
 * 複数アカウントに対する物件マッチ。元請（main）を優先し、
 * どのアカウントに紐づく物件かも返す（一覧で担当者を添えるため）。
 * @returns {{ role: 'main'|'sub', customer: object } | null}
 */
export function projectMatchForCustomers(project, customers) {
  let subMatch = null;
  for (const customer of customers || []) {
    const role = projectMatchRole(project, customer);
    if (role === 'main') return { role, customer };
    if (role === 'sub' && !subMatch) subMatch = { role, customer };
  }
  return subMatch;
}

/** 物件の登録アカウント表示（担当者名。空欄は会社の代表窓口） */
export function formatProjectAccountLabel(customer) {
  if (!customer) return '';
  const manager = String(customer.manager_name || '').trim();
  return `担当: ${manager || '代表'}`;
}
