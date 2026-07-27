/**
 * 代理発注時の「実質業者」customer_id。
 * 現場名サジェスト / 現場担当者サジェスト / site_history_contractor_id で共通利用。
 */
export function resolveEffectiveContractorCustomerId({
  isAgentOrCooperative = false,
  contractorCustomerId = '',
  currentCustomerId = '',
} = {}) {
  if (isAgentOrCooperative) {
    return String(contractorCustomerId || currentCustomerId || '').trim();
  }
  return String(currentCustomerId || '').trim();
}
