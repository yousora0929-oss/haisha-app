/** 請求先ラベル */
export function billingTargetLabel(billingTarget) {
  return billingTarget === 'sub' ? '下請' : '元請';
}

/**
 * 物件の業者（元請/下請）表示名を解決（商社名との重複を排除）
 * @param {object} project mapProjectRow 済みの物件
 * @param {object|null} customer projects.customer_id に対応する customers 行
 */
export function resolveProjectContractorLabel(project, customer) {
  const trader = String(
    project?.trading_company_name || project?.trading_company || '',
  ).trim();
  const display = String(project?.contractor_display_name || '').trim();
  const masterName = String(customer?.company_name || customer?.name || '').trim();
  const prime = display && display !== trader ? display : masterName;
  return {
    prime: prime || '—',
    sub: String(project?.sub_contractor_name || project?.contractor || '').trim(),
    trader: trader || '—',
    billing: billingTargetLabel(project?.billing_target),
    billingIsSub: project?.billing_target === 'sub',
  };
}

/**
 * 注文カード・モーダル用の当事者表示（明示スナップショット > 物件 > 顧客）
 * @param {object} order
 * @param {{ project?: object|null, customer?: object|null }} [options]
 */
export function resolveOrderPartyDisplay(order, { project = null, customer = null } = {}) {
  const explicitTrader = String(order?.traderName ?? order?.trader_name ?? '').trim();
  const explicitContractor = String(
    order?.contractorName ?? order?.contractor_name ?? '',
  ).trim();
  const customerFallback = String(order?.customerName ?? order?.customer_name ?? '').trim();

  if (project && typeof project === 'object') {
    const party = resolveProjectContractorLabel(project, customer);
    const prime =
      explicitContractor ||
      (party.prime !== '—' ? party.prime : '') ||
      customerFallback;
    const trader =
      explicitTrader ||
      (party.trader !== '—' ? party.trader : '') ||
      String(order?.displayTraderName ?? '').trim();
    return {
      prime: prime || '—',
      sub: party.sub || '',
      trader: trader || '—',
      billing: party.billing,
      billingIsSub: party.billingIsSub,
    };
  }

  const prime =
    explicitContractor ||
    String(order?.displayContractorName ?? customerFallback).trim();
  const trader =
    explicitTrader || String(order?.displayTraderName ?? '').trim();
  return {
    prime: prime || '—',
    sub: '',
    trader: trader || '—',
    billing: '',
    billingIsSub: false,
  };
}
