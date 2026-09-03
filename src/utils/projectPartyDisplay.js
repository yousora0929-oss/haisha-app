function lookupById(map, id) {
  const key = String(id || '').trim();
  if (!key || map == null) return null;
  if (typeof map.get === 'function') return map.get(key) || null;
  if (typeof map === 'object') return map[key] || null;
  return null;
}

function joinOrdererOrgAndPerson(orgName, personName) {
  const org = String(orgName || '').trim();
  const person = String(personName || '').trim();
  if (org && person) {
    if (org.includes(person)) return org;
    return `${org} ${person}`;
  }
  return org || person || '—';
}

/**
 * 発注者の担当者名。orders.ordered_by（ログイン時のスナップショット）を優先する。
 * @param {object|null|undefined} order
 * @param {object|null} [customer]
 */
export function resolveOrdererPersonName(order, customer = null) {
  return String(
    order?.ordered_by ||
      order?.order_placer_name ||
      order?.orderPlacerName ||
      customer?.manager_name ||
      '',
  ).trim();
}

/**
 * 発注者の組織名。
 * customer_id → customers.organization_id → organizations.name、なければ customers.company_name。
 * agent_organization_id（担当商社）は使わない。
 * @param {object|null|undefined} order
 * @param {Record<string, object>|Map<string, object>} [customerById]
 * @param {Record<string, object>|Map<string, object>} [organizationById]
 * @param {object|null} [orderingCustomer]
 */
export function resolveOrdererOrgName(
  order,
  customerById = {},
  organizationById = {},
  orderingCustomer = null,
) {
  const customerId = String(order?.customer_id ?? order?.customerId ?? '').trim();
  const customer = orderingCustomer || lookupById(customerById, customerId);
  const orgId = String(customer?.organization_id || '').trim();
  const org = lookupById(organizationById, orgId);
  return String(
    org?.name ||
      org?.company_name ||
      customer?.company_name ||
      customer?.name ||
      order?.customerName ||
      order?.customer_name ||
      '',
  ).trim();
}

/**
 * 発注者表示 = ログインアカウント（orders.customer_id）の所属組織名 + 担当者名。
 * 担当商社（agent_organization_id）は混入させない。
 * @param {object|null|undefined} order
 * @param {Record<string, object>|Map<string, object>} [customerById]
 * @param {Record<string, object>|Map<string, object>} [organizationById]
 */
export function resolveOrdererLabel(order, customerById = {}, organizationById = {}) {
  const customerId = String(order?.customer_id ?? order?.customerId ?? '').trim();
  const customer = lookupById(customerById, customerId);
  const orgName = resolveOrdererOrgName(order, customerById, organizationById, customer);
  const personName = resolveOrdererPersonName(order, customer);
  return joinOrdererOrgAndPerson(orgName, personName);
}

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
 * 注文カード・モーダル用の当事者表示
 *
 * 優先順位:
 * - 物件がある注文は、発注者に関係なく元請・下請・商社・請求先を必ず物件基準で確定する
 * - 物件がない注文だけ、発注先業者（contractor_customer_id）から注文スナップショットへフォールバックする
 * - 発注者表示は当事者表示と独立して、orders.customer_id の所属組織（または company_name）から解決する
 *   ※ agent_organization_id（担当商社）は発注者ではない
 * @param {object} order
 * @param {{
 *   project?: object|null,
 *   customer?: object|null,
 *   contractorCustomer?: object|null,
 *   orderingCustomer?: object|null,
 *   organizationById?: Record<string, object>
 * }} [options]
 */
export function resolveOrderPartyDisplay(
  order,
  {
    project = null,
    customer = null,
    contractorCustomer = null,
    orderingCustomer = null,
    organizationById = {},
  } = {},
) {
  const explicitTrader = String(order?.traderName ?? order?.trader_name ?? '').trim();
  const explicitContractor = String(
    order?.contractorName ?? order?.contractor_name ?? '',
  ).trim();
  const customerFallback = String(order?.customerName ?? order?.customer_name ?? '').trim();
  const orderCustomer = orderingCustomer || customer;
  const ordererCustomerById = {};
  const orderCustomerId = String(
    orderCustomer?.id || order?.customer_id || order?.customerId || '',
  ).trim();
  if (orderCustomer && orderCustomerId) {
    ordererCustomerById[orderCustomerId] = orderCustomer;
  }
  const orderedByName = resolveOrdererOrgName(
    order,
    ordererCustomerById,
    organizationById,
    orderCustomer,
  ) || customerFallback;
  const orderedByLabel = resolveOrdererLabel(order, ordererCustomerById, organizationById);

  const withOrderedBy = (party) => {
    const comparisonPrime = String(
      party.prime !== '—' ? party.prime : '',
    ).trim();
    return {
      ...party,
      orderedByLabel,
      /** 発注元の組織名（担当者名は含まない。担当商社名は使わない） */
      orderedByCompanyName: orderedByName || '',
      orderedByIsProxy: Boolean(
        orderedByName &&
          comparisonPrime &&
          orderedByName !== comparisonPrime,
      ),
    };
  };

  if (project && typeof project === 'object') {
    const party = resolveProjectPartyDisplay(project, customer);
    return withOrderedBy(party);
  }

  const contractorCustomerName = String(
    contractorCustomer?.company_name || contractorCustomer?.name || '',
  ).trim();
  const prime =
    contractorCustomerName ||
    explicitContractor ||
    String(order?.displayContractorName ?? customerFallback).trim();
  const trader =
    explicitTrader || String(order?.displayTraderName ?? '').trim();
  return withOrderedBy({
    prime: prime || '—',
    sub: '—',
    trader: trader || '—',
    billingIsSub: false,
    billOnPrime: false,
    billOnSub: false,
  });
}
