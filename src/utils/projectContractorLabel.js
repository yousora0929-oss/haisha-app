/** 物件の下請業者名（sub_contractor_name → contractor フォールバック） */
export function resolveProjectSubContractorName(project) {
  if (!project || typeof project !== 'object') return '';
  return String(project.sub_contractor_name ?? project.contractor ?? '').trim();
}

/**
 * ログイン発注用: 物件に紐づく元請・下請名を解決
 * @param {object} project
 * @param {Array} customers
 * @param {{ contractorCustomer?: object | null }} [options]
 *   - contractorCustomer: 代理発注時の発注先業者（指定時はその company_name を元請とする）
 */
export function resolveProjectContractorLabels(project, customers, { contractorCustomer = null } = {}) {
  const subContractorName = resolveProjectSubContractorName(project);

  let primeContractorName = '';
  if (contractorCustomer && typeof contractorCustomer === 'object') {
    primeContractorName = String(
      contractorCustomer.company_name ?? contractorCustomer.name ?? '',
    ).trim();
  } else {
    const customerId = String(project?.customer_id ?? '').trim();
    const hit = (customers || []).find((c) => c && String(c.id) === customerId);
    primeContractorName = String(hit?.company_name ?? hit?.name ?? '').trim();
  }

  return { primeContractorName, subContractorName };
}

/**
 * 業者表示モードに応じた order_data.contractorName を解決
 * @param {'prime' | 'sub' | 'custom'} mode
 * @param {string} customText
 * @param {{ primeContractorName?: string, subContractorName?: string }} labels
 */
export function resolveContractorDisplayName(mode, customText, labels = {}) {
  const prime = String(labels.primeContractorName ?? '').trim();
  const sub = String(labels.subContractorName ?? '').trim();
  const normalizedMode = String(mode || 'prime');

  if (normalizedMode === 'sub') return sub || prime;
  if (normalizedMode === 'custom') {
    const custom = String(customText ?? '').trim();
    return custom || prime;
  }
  return prime;
}
