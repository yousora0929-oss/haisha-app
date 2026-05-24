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
