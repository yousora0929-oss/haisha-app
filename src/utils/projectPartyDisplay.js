/**
 * 物件の業者（元請/下請）・商社・請求先マークの表示情報を解決
 * - contractor_display_name が商社名と同一なら元請名として使わず customers マスタへフォールバック
 * - billing_target（'main'|'sub'）に応じて請求マークの付与先を返す
 * @param {object} project mapProjectRow 済みの物件
 * @param {object|null} customer projects.customer_id に対応する customers 行
 */
export function resolveProjectPartyDisplay(project, customer) {
  const trader = String(
    project?.trading_company_name || project?.trading_company || '',
  ).trim();
  const display = String(project?.contractor_display_name || '').trim();
  const masterName = String(customer?.company_name || customer?.name || '').trim();
  const prime = display && display !== trader ? display : masterName;
  const sub = String(
    project?.sub_contractor_name || project?.contractor || '',
  ).trim();
  const billingIsSub = project?.billing_target === 'sub';
  return {
    prime: prime || '—',
    sub: sub || '—',
    trader: trader || '—',
    billingIsSub,
    billOnPrime: !billingIsSub,
    billOnSub: billingIsSub,
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
    const party = resolveProjectPartyDisplay(project, customer);
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
      sub: party.sub,
      trader: trader || '—',
      billingIsSub: party.billingIsSub,
      billOnPrime: party.billOnPrime,
      billOnSub: party.billOnSub,
    };
  }

  const prime =
    explicitContractor ||
    String(order?.displayContractorName ?? customerFallback).trim();
  const trader =
    explicitTrader || String(order?.displayTraderName ?? '').trim();
  return {
    prime: prime || '—',
    sub: '—',
    trader: trader || '—',
    billingIsSub: false,
    billOnPrime: false,
    billOnSub: false,
  };
}
