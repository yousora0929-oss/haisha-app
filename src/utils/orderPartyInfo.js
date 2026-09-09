import { resolveOrderSiteDisplayName } from './siteNameDisplay.js';
import {
  resolveOrdererName,
  resolveSiteContactName,
  resolveSitePhone,
} from './orderContactInfo.js';
import { formatPhoneNumberJP } from './phoneFormat.js';
import { buildAgentOrganizationSyncPatch } from './orderAgentOrganization.js';

function lookupById(map, id) {
  const key = String(id || '').trim();
  if (!key || map == null) return null;
  if (typeof map.get === 'function') return map.get(key) || null;
  if (typeof map === 'object') return map[key] || null;
  return null;
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

function customerCompanyName(customer) {
  return firstNonEmpty(customer?.company_name, customer?.name);
}

function organizationName(org) {
  return firstNonEmpty(org?.name, org?.company_name);
}

export function orderContractorCustomerId(order) {
  return String(order?.contractor_customer_id ?? order?.contractorCustomerId ?? '').trim();
}

export function orderAgentOrganizationId(order) {
  return String(order?.agent_organization_id ?? order?.agentOrganizationId ?? '').trim();
}

export function orderTradingAgentCustomerId(order) {
  return String(order?.trading_agent_customer_id ?? order?.tradingAgentCustomerId ?? '').trim();
}

function snapshotContractorName(order) {
  return firstNonEmpty(
    order?.displayContractorName,
    order?.contractorName,
    order?.contractor_name,
  );
}

function snapshotTraderName(order) {
  return firstNonEmpty(
    order?.displayTraderName,
    order?.trading_company_name,
    order?.projectTradingCompanyName,
    order?.projectTradingCompany,
    order?.tradingCompanyName,
    order?.traderName,
  );
}

/**
 * 注文の当事者（業者・商社組織・商社担当者・発注者）を ID 優先で解決する。
 * customerName（発注アカウント本人）は業者欄に使わない。
 *
 * @param {object|null|undefined} order
 * @param {{ customersById?: object|Map, organizationsById?: object|Map }} [lookups]
 */
export function resolveOrderParties(order, { customersById, organizationsById } = {}) {
  const contractorCustomerId = orderContractorCustomerId(order);
  const agentOrganizationId = orderAgentOrganizationId(order);
  const tradingAgentCustomerId = orderTradingAgentCustomerId(order);

  const contractorCustomer =
    lookupById(customersById, contractorCustomerId) ||
    (order?.contractorCustomer &&
    String(order.contractorCustomer.id || '').trim() === contractorCustomerId
      ? order.contractorCustomer
      : null);
  const tradingAgentCustomer =
    lookupById(customersById, tradingAgentCustomerId) ||
    (order?.tradingAgentCustomer &&
    String(order.tradingAgentCustomer.id || '').trim() === tradingAgentCustomerId
      ? order.tradingAgentCustomer
      : null);
  const agentOrganization = lookupById(organizationsById, agentOrganizationId);

  const contractorName =
    customerCompanyName(contractorCustomer) || snapshotContractorName(order);
  const tradingAgentCompanyName = customerCompanyName(tradingAgentCustomer);
  const orgType = String(agentOrganization?.type || '').trim();
  const agentOrgDisplayName =
    agentOrganization && orgType !== 'cooperative'
      ? organizationName(agentOrganization)
      : '';
  const traderName =
    agentOrgDisplayName ||
    tradingAgentCompanyName ||
    snapshotTraderName(order);
  const ordererName = firstNonEmpty(order?.customerName, order?.customer_name);

  return {
    contractorCustomerId,
    agentOrganizationId,
    tradingAgentCustomerId,
    contractorName,
    traderName,
    tradingAgentCompanyName,
    ordererName,
    contractorCustomer: contractorCustomer || null,
    tradingAgentCustomer: tradingAgentCustomer || null,
    agentOrganization: agentOrganization || null,
  };
}

/**
 * 帳票・一覧用の業者名。
 * contractor_customer_id → customers.company_name を最優先。
 * なければ order_data.contractorName。発注者名（customerName）は使わない。
 */
export function resolveOrderContractorDisplayName(order, lookups) {
  return resolveOrderParties(order, lookups).contractorName;
}

/** 発注者名（orders.customer_id 側。業者名と混同しない） */
export function resolveOrderOrdererDisplayName(order) {
  return String(order?.customerName ?? order?.customer_name ?? '').trim();
}

export function resolveOrderTradingCompanyDisplayName(order, lookups) {
  return resolveOrderParties(order, lookups).traderName;
}

/**
 * 選択した当事者 ID から、DB カラムと表示用スナップショットを同時に組み立てる。
 */
export function buildOrderPartyPersistPatch(
  {
    contractorCustomerId,
    agentOrganizationId,
    tradingAgentCustomerId,
  } = {},
  { customersById, organizationsById, previousOrder } = {},
) {
  const nextContractorId = String(contractorCustomerId || '').trim();
  const nextAgentId = String(agentOrganizationId || '').trim();
  const nextTradingAgentId = String(tradingAgentCustomerId || '').trim();
  const prevContractorId = orderContractorCustomerId(previousOrder);
  const prevAgentId = orderAgentOrganizationId(previousOrder);
  const prevTradingAgentId = orderTradingAgentCustomerId(previousOrder);
  const nextOrder = {
    ...(previousOrder && typeof previousOrder === 'object' ? previousOrder : {}),
    contractor_customer_id: nextContractorId || null,
    contractorCustomerId: nextContractorId || null,
    agent_organization_id: nextAgentId || null,
    agentOrganizationId: nextAgentId || null,
    trading_agent_customer_id: nextTradingAgentId || null,
    tradingAgentCustomerId: nextTradingAgentId || null,
  };
  // ID を外したときだけスナップショット名を消す。直接発注（IDなし＋contractorName）は保持する。
  if (!nextContractorId && prevContractorId) {
    nextOrder.contractorName = '';
    nextOrder.contractor_name = '';
    nextOrder.displayContractorName = '';
  }
  if (!nextAgentId && !nextTradingAgentId && (prevAgentId || prevTradingAgentId)) {
    nextOrder.traderName = '';
    nextOrder.trading_company_name = '';
    nextOrder.projectTradingCompanyName = '';
    nextOrder.displayTraderName = '';
  }
  const parties = resolveOrderParties(nextOrder, { customersById, organizationsById });
  const agentSync = buildAgentOrganizationSyncPatch(
    parties.agentOrganizationId || null,
    parties.agentOrganization || organizationsById || [],
  );
  return {
    contractor_customer_id: parties.contractorCustomerId || null,
    contractorName: parties.contractorName,
    trading_agent_customer_id: parties.tradingAgentCustomerId || null,
    ...agentSync,
    trading_company_name: parties.traderName,
    projectTradingCompanyName: parties.traderName,
    traderName: parties.traderName,
  };
}

/**
 * 注文カード等の当事者表示
 * @param {object} order
 * @param {{ preferSiteContact?: boolean, customersById?: object|Map, organizationsById?: object|Map }} [options]
 */
export function orderPartyInfo(
  order,
  { preferSiteContact = false, customersById, organizationsById } = {},
) {
  const parties = resolveOrderParties(order, { customersById, organizationsById });
  const contractor = parties.contractorName;
  const tradingCompany = parties.traderName;
  const orderer = parties.ordererName;
  const site = resolveOrderSiteDisplayName(order);
  const orderedBy = preferSiteContact
    ? resolveSiteContactName(order)
    : resolveOrdererName(order);
  const phoneRaw = resolveSitePhone(order);
  const phone = formatPhoneNumberJP(phoneRaw);
  return {
    contractor: tradingCompany && contractor ? `${contractor} (商社: ${tradingCompany})` : contractor || '—',
    contractorName: contractor || '—',
    traderName: tradingCompany || '—',
    /** 発注者（customer_id）。チャット相手表示などに使用。業者(contractor)とは別 */
    orderer: orderer || '—',
    site: site || '—',
    orderedBy: orderedBy || '—',
    phone: phone || '—',
  };
}
