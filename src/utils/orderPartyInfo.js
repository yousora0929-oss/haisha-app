import { resolveOrderSiteDisplayName } from './siteNameDisplay.js';
import {
  resolveOrdererName,
  resolveSiteContactName,
  resolveSitePhone,
} from './orderContactInfo.js';
import { formatPhoneNumberJP } from './phoneFormat.js';

/** 帳票・一覧用の業者名（order_data.contractorName 優先、なければログイン業者名） */
export function resolveOrderContractorDisplayName(order) {
  return String(
    order?.contractorName ??
      order?.contractor_name ??
      order?.displayContractorName ??
      order?.customerName ??
      order?.customer_name ??
      '',
  ).trim();
}

export function resolveOrderTradingCompanyDisplayName(order) {
  return String(
    order?.trading_company_name ??
      order?.projectTradingCompanyName ??
      order?.projectTradingCompany ??
      order?.tradingCompanyName ??
      order?.traderName ??
      '',
  ).trim();
}

/**
 * 注文カード等の当事者表示
 * @param {object} order
 * @param {{ preferSiteContact?: boolean }} [options]
 *   preferSiteContact: true のとき現場担当者名を担当者欄に優先（DispatchApp）
 */
export function orderPartyInfo(order, { preferSiteContact = false } = {}) {
  const tradingCompany = resolveOrderTradingCompanyDisplayName(order);
  const contractor = resolveOrderContractorDisplayName(order);
  const site = resolveOrderSiteDisplayName(order);
  const orderedBy = preferSiteContact
    ? resolveSiteContactName(order)
    : resolveOrdererName(order);
  const phoneRaw = resolveSitePhone(order);
  const phone = formatPhoneNumberJP(phoneRaw);
  return {
    contractor: tradingCompany && contractor ? `${contractor} (商社: ${tradingCompany})` : contractor || '—',
    site: site || '—',
    orderedBy: orderedBy || '—',
    phone: phone || '—',
  };
}
