import { isValidExternalUrl } from './urlValidation.js';

/** 現場名フィールドにURLが誤って入っていないか */
export function looksLikeUrlText(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  if (/^www\./i.test(s)) return true;
  if (/\/map-editor\//i.test(s) || /\/order\//i.test(s)) return true;
  if (isValidExternalUrl(s)) return true;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return true;
  return false;
}

/** 現場名として保存・表示してよい文字列（URLは空にする） */
export function sanitizeSiteNameValue(value) {
  const s = String(value || '').trim();
  if (!s || looksLikeUrlText(s)) return '';
  return s;
}

/**
 * 注文の現場名表示用（URLや地図リンクを除外し、物件名などから補完）
 * @param {object} order
 * @param {object} [project]
 */
export function resolveOrderSiteDisplayName(order, project) {
  const candidates = [
    order?.siteName,
    order?.site_name,
    order?.projectName,
    order?.project_name,
    project?.name,
  ];
  for (const raw of candidates) {
    const clean = sanitizeSiteNameValue(raw);
    if (clean) return clean;
  }
  const addr = sanitizeSiteNameValue(order?.siteAddress ?? order?.site_address);
  return addr || '';
}
