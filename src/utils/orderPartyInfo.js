import { resolveOrderSiteDisplayName } from './siteNameDisplay.js';
import {
  resolveOrdererName,
  resolveSiteContactName,
  resolveSitePhone,
} from './orderContactInfo.js';
import { formatPhoneNumberJP } from './phoneFormat.js';

/**
 * 帳票・一覧用の業者名。
 * contractor_*（納品責任業者）を優先し、未設定時のみ customerName（発注者）へフォールバック。
 * ただし代理発注（contractor_customer_id ≠ customer_id）で業者名が空のときは
 * 発注操作者名を業者の代役にしない（組合名・商社名の誤表示を防ぐ）。
 */
export function resolveOrderContractorDisplayName(order) {
  const fromContractorFields = String(
    order?.contractorName ??
      order?.contractor_name ??
      order?.displayContractorName ??
      '',
  ).trim();
  if (fromContractorFields) return fromContractorFields;

  const contractorId = String(
    order?.contractor_customer_id ?? order?.contractorCustomerId ?? '',
  ).trim();
  const customerId = String(order?.customer_id ?? order?.customerId ?? '').trim();
  if (contractorId && customerId && contractorId !== customerId) {
    return '';
  }

  return String(order?.customerName ?? order?.customer_name ?? '').trim();
}

/** 発注者名（orders.customer_id 側。業者名と混同しない） */
export function resolveOrderOrdererDisplayName(order) {
  return String(order?.customerName ?? order?.customer_name ?? '').trim();
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
  const orderer = resolveOrderOrdererDisplayName(order);
  const site = resolveOrderSiteDisplayName(order);
  const orderedBy = preferSiteContact
    ? resolveSiteContactName(order)
    : resolveOrdererName(order);
  const phoneRaw = resolveSitePhone(order);
  const phone = formatPhoneNumberJP(phoneRaw);
  return {
    contractor: tradingCompany && contractor ? `${contractor} (商社: ${tradingCompany})` : contractor || '—',
    /** 発注者（customer_id）。チャット相手表示などに使用。業者(contractor)とは別 */
    orderer: orderer || '—',
    site: site || '—',
    orderedBy: orderedBy || '—',
    phone: phone || '—',
  };
}
