import {
  combineDeliveryAddress,
  extractProjectAddressFields,
  normalizeAllowedDeliveryAreas,
} from './deliveryAreas.js';
import { resolveProjectTradingCompanyName } from './projectTradingCompany.js';
import { isValidSiteOrderUrlToken } from './urlValidation.js';

/** パス /order/:token または /guest-order/:token からトークンを取得 */
export function parseSiteOrderTokenFromPath() {
  if (typeof window === 'undefined') return '';
  const pathMatch = window.location.pathname.match(/\/(?:order|guest-order)\/([^/?#]+)/i);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]).trim();
  const q = new URLSearchParams(window.location.search).get('token');
  return q ? String(q).trim() : '';
}

/** 物件専用発注ページ URL */
export function buildSiteOrderUrl(urlToken, baseOrigin) {
  const token = String(urlToken || '').trim();
  if (!isValidSiteOrderUrlToken(token)) return '';
  const envOrigin =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_PUBLIC_APP_ORIGIN
      ? String(import.meta.env.VITE_PUBLIC_APP_ORIGIN).replace(/\/$/, '')
      : '';
  const origin =
    (baseOrigin && String(baseOrigin).replace(/\/$/, '')) ||
    envOrigin ||
    (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '');
  if (!origin) return '';
  return `${origin}/order/${encodeURIComponent(token)}`;
}

export function siteOrderUrlValidationMessage(urlToken) {
  const token = String(urlToken || '').trim();
  if (!token) return '専用発注URLが未設定です（管理画面で url_token を確認してください）';
  if (!isValidSiteOrderUrlToken(token)) {
    return '専用発注URLが不正です（Googleの内部IDなどが url_token に入っている可能性があります）';
  }
  return '';
}

/** 物件・業者レコードから表示用の業者名・商社名・物件名を解決 */
export function resolveSiteOrderPartiesFromProject(project, customer) {
  const projectName = String(project?.name ?? '').trim();
  const customerName = String(customer?.company_name ?? customer?.name ?? '').trim();
  const traderName = resolveProjectTradingCompanyName(project);
  return { projectName, siteName: projectName, customerName, traderName };
}

function readPartyField(parties, snakeKey, camelKey) {
  if (!parties || typeof parties !== 'object') return '';
  return String(parties[snakeKey] ?? parties[camelKey] ?? '').trim();
}

/**
 * ゲスト専用発注: RPC コンテキストから確認ブロック・フォーム初期値用の確定情報を解決
 * - 業者（元請）: customers.company_name（projects.customer_id 経由）
 * - 業者（下請）: projects.sub_contractor_name（なければ contractor）
 * - 商社: organizations 紐付け優先、なければ trading_company_name
 */
export function resolveGuestOrderLockedFields(siteOrderContext, allowedAreasInput) {
  const project = siteOrderContext?.project;
  const customer = siteOrderContext?.customer;
  const parties = siteOrderContext?.parties;
  const areas = normalizeAllowedDeliveryAreas(allowedAreasInput);
  const { deliveryArea, siteAddressDetail } = extractProjectAddressFields(project, areas);

  const addressFromParts = combineDeliveryAddress(deliveryArea, siteAddressDetail);
  const address =
    readPartyField(parties, 'project_address', 'projectAddress') ||
    addressFromParts ||
    String(project?.site_address ?? project?.address ?? '').trim();

  const primeContractorName =
    readPartyField(parties, 'prime_contractor_name', 'primeContractorName') ||
    String(customer?.company_name ?? customer?.name ?? '').trim();

  const subContractorName =
    readPartyField(parties, 'sub_contractor_name', 'subContractorName') ||
    String(project?.sub_contractor_name ?? project?.contractor ?? '').trim();

  const traderNameRaw =
    readPartyField(parties, 'trading_company_name', 'tradingCompanyName') ||
    resolveProjectTradingCompanyName(project);

  const projectName =
    readPartyField(parties, 'project_name', 'projectName') || String(project?.name ?? '').trim();

  return {
    address,
    primeContractorName,
    subContractorName,
    /** 発注 payload の contractorName（下請）用 */
    contractorName: subContractorName,
    primeContractorDisplay: primeContractorName || '—',
    subContractorDisplay: subContractorName || '（未設定）',
    traderNameRaw,
    traderNameDisplay: traderNameRaw || '直取引',
    deliveryArea,
    siteAddressDetail,
    projectName,
  };
}

/** 業者（元請）・商社のヘッダー表示（例: 〇〇建設 / △△商社） */
export function formatSiteOrderVendorLabel({
  customerName,
  primeContractorName,
  traderName,
  contractorName,
} = {}) {
  const prime = String(primeContractorName || customerName || '').trim();
  const trader = String(traderName || '').trim();
  if (prime && trader && prime !== trader) return `${prime} / ${trader}`;
  return prime || trader || String(contractorName || '').trim();
}

export function withCustomerHonorific(name) {
  const s = String(name || '').trim();
  if (!s || s === '—') return '';
  return s.endsWith('様') ? s : `${s}様`;
}

/** LINE・メール共有用のコピーテキスト */
export function buildSiteOrderShareMessage(url, parties = {}) {
  const site = String(parties.projectName || parties.siteName || '').trim() || '物件';
  const vendor = formatSiteOrderVendorLabel(parties);
  const vendorPart = withCustomerHonorific(vendor) || '御中';
  const link = String(url || '').trim();
  return `${vendorPart} / ${site} の専用発注フォームはこちら: ${link}`;
}
