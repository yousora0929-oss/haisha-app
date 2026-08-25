/**
 * 掛売可バッジ表示判定（商社経由の物件では出さない）
 * @param {object|null|undefined} project
 * @param {object|null|undefined} customer
 */
export function shouldShowCreditBadge(project, customer) {
  const hasTradingCompany = Boolean(
    String(project?.trading_company_name || project?.trading_company || '').trim() ||
      project?.trading_company_organization_id,
  );
  return !hasTradingCompany && Boolean(customer?.is_credit_eligible);
}

/** 一覧用の短いバッジ文言 */
export function creditEligibleBadgeLabel(customer) {
  if (!customer?.is_credit_eligible) return '';
  return '掛売可';
}
