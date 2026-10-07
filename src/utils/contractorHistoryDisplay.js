const historyDateFormat = new Intl.DateTimeFormat('ja-JP', {
  timeZone: 'Asia/Tokyo',
  month: 'numeric',
  day: 'numeric',
});

/** JST の M/D。不正な日時は空文字。 */
export function formatHistoryMonthDay(value) {
  if (value == null || value === '') return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = historyDateFormat.formatToParts(date);
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!month || !day) return '';
  return `${month}/${day}`;
}

export function tradingCompanyDisplayName(row) {
  const name = String(row?.name ?? '').trim();
  if (!name || row?.is_direct === true) return '直取引';
  return name;
}

/** last_used_at の新しい順。日時がない行は後ろ。 */
export function sortTradingCompanies(rows) {
  const list = Array.isArray(rows) ? rows : [];
  return [...list].sort((a, b) => {
    const at = Date.parse(String(a?.last_used_at ?? ''));
    const bt = Date.parse(String(b?.last_used_at ?? ''));
    const aMs = Number.isFinite(at) ? at : Number.NEGATIVE_INFINITY;
    const bMs = Number.isFinite(bt) ? bt : Number.NEGATIVE_INFINITY;
    return bMs - aMs;
  });
}

export function formatTradingHistoryLine(row) {
  const name = tradingCompanyDisplayName(row);
  const projects = Number(row?.project_count) || 0;
  const orders = Number(row?.order_count) || 0;
  const monthDay = formatHistoryMonthDay(row?.last_used_at);
  const datePart = monthDay ? `・最終 ${monthDay}` : '';
  return `${name}（物件${projects}・発注${orders}${datePart}）`;
}

/** 請求先が相手側のときだけ注記する。請求先が自分なら空。 */
export function billingPartyNote(row) {
  if (row?.billed_to_contractor !== false) return '';
  if (row?.role === 'main' && row?.billing_target === 'sub') {
    return `請求先は下請（${String(row?.sub_name ?? '').trim()}）`;
  }
  if (row?.role === 'sub' && row?.billing_target === 'main') {
    return `請求先は元請（${String(row?.prime_name ?? '').trim()}）`;
  }
  return '';
}

export function recentProjectTitle(row, project, getProjectLabel) {
  if (project && typeof getProjectLabel === 'function') {
    const label = String(getProjectLabel(project) || '').trim();
    if (label) return label;
  }
  const name = String(row?.name || '').trim();
  if (row?.role === 'sub' && name) return `${name}（下請）`;
  return name;
}

export function recentProjectTraderName(row) {
  const name = String(row?.trading_company_name ?? '').trim();
  if (!name) return '直取引';
  return name;
}

export function isContractorHistoryHidden(data) {
  return data == null;
}

export function isContractorHistoryEmpty(data) {
  if (data == null) return false;
  const trading = Array.isArray(data.trading_companies) ? data.trading_companies.length : 0;
  const projects = Array.isArray(data.recent_projects) ? data.recent_projects.length : 0;
  const spot = Number(data.recent_spot?.order_count) || 0;
  return trading === 0 && projects === 0 && spot === 0;
}

export const OWN_COMPANY_HISTORY_NOTE = '（自社分のみ表示）';

/** selectableProjects から project_id が一致する物件。型が違っても文字列で比較する。 */
export function resolveTappableProject(row, selectableProjects) {
  const id = String(row?.project_id ?? '').trim();
  if (!id) return null;
  const list = Array.isArray(selectableProjects) ? selectableProjects : [];
  return list.find((project) => String(project?.id ?? '').trim() === id) || null;
}

export function isHistoryProjectSelected(row, selectedProjectId) {
  const id = String(row?.project_id ?? '').trim();
  if (!id) return false;
  return id === String(selectedProjectId ?? '').trim();
}

const historyCache = new Map();

export function readContractorHistoryCache(contractorCustomerId) {
  const id = String(contractorCustomerId || '').trim();
  if (!id || !historyCache.has(id)) return undefined;
  return historyCache.get(id);
}

export function writeContractorHistoryCache(contractorCustomerId, data) {
  const id = String(contractorCustomerId || '').trim();
  if (!id) return;
  historyCache.set(id, data);
}

export function invalidateContractorOrderHistoryCache() {
  historyCache.clear();
}
