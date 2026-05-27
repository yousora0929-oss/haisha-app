import { isValidSiteOrderUrlToken } from './urlValidation.js';

/** パス /order/:token からトークンを取得 */
export function parseSiteOrderTokenFromPath() {
  if (typeof window === 'undefined') return '';
  const pathMatch = window.location.pathname.match(/\/order\/([^/?#]+)/i);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]).trim();
  const q = new URLSearchParams(window.location.search).get('token');
  return q ? String(q).trim() : '';
}

/** 現場専用発注ページ URL */
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

/** 物件・業者レコードから表示用の業者名・商社名・現場名を解決 */
export function resolveSiteOrderPartiesFromProject(project, customer) {
  const siteName = String(project?.name ?? '').trim();
  const customerName = String(
    customer?.company_name ?? customer?.name ?? project?.contractor ?? '',
  ).trim();
  const traderName = String(
    project?.trading_company_name ?? project?.trading_company ?? '',
  ).trim();
  return { siteName, customerName, traderName };
}

/** 業者・商社の表示ラベル（例: 〇〇建設 / △△商社） */
export function formatSiteOrderVendorLabel({ customerName, traderName, contractorName } = {}) {
  const customer = String(customerName || contractorName || '').trim();
  const trader = String(traderName || '').trim();
  if (customer && trader && customer !== trader) return `${customer} / ${trader}`;
  return customer || trader || '';
}

export function withCustomerHonorific(name) {
  const s = String(name || '').trim();
  if (!s || s === '—') return '';
  return s.endsWith('様') ? s : `${s}様`;
}

/** LINE・メール共有用のコピーテキスト */
export function buildSiteOrderShareMessage(url, parties = {}) {
  const site = String(parties.siteName || '').trim() || '現場';
  const vendor = formatSiteOrderVendorLabel(parties);
  const vendorPart = withCustomerHonorific(vendor) || '御中';
  const link = String(url || '').trim();
  return `${vendorPart} / ${site} の専用発注フォームはこちら: ${link}`;
}
