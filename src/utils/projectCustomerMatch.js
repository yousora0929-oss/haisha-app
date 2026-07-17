/** 名前比較用の正規化（空白除去・小文字化） */
export function normalizeCompanyName(value) {
  return String(value ?? '').replace(/\s+/g, '').trim().toLowerCase();
}

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
