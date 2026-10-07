import { normalizeCompanyName } from './projectCustomerMatch.js';

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

export const UNREGISTERED_CONTRACTOR_HISTORY_NOTE =
  '業者マスタ未登録の名称です（スポットの履歴のみ照合）';

export const SPOT_HISTORY_EMPTY_MESSAGE = 'この業者のスポット・物件の実績はまだありません';

/** スポット注文の商社チップ。「商社名（発注N・最終 M/D）」。 */
export function formatSpotTradingChip(row) {
  const name = tradingCompanyDisplayName(row);
  const orders = Number(row?.order_count) || 0;
  const monthDay = formatHistoryMonthDay(row?.last_used_at);
  const datePart = monthDay ? `・最終 ${monthDay}` : '';
  return `${name}（発注${orders}${datePart}）`;
}

/**
 * 物件の商社実績。物件数が 0 のときは「物件0」を出さず発注数だけにする。
 * 物件数が 1 以上のときは物件モードと同じ「物件N・発注M」。
 */
export function formatProjectTradingHistoryLine(row) {
  const projects = Number(row?.project_count) || 0;
  if (projects <= 0) return formatSpotTradingChip(row);
  return formatTradingHistoryLine(row);
}

/** 「現場名 / 商社名 / N件 / 最終 M/D」。現場名なし・商社なしは表示用の語にする。 */
export function formatRecentSpotOrderLine(row) {
  const site = String(row?.site_name ?? '').trim() || '（現場名なし）';
  const trader = String(row?.trading_company_name ?? '').trim() || '直取引';
  const orders = Number(row?.order_count) || 0;
  const monthDay = formatHistoryMonthDay(row?.last_ordered_at);
  const datePart = monthDay ? ` / 最終 ${monthDay}` : '';
  return `${site} / ${trader} / ${orders}件${datePart}`;
}

export function isSpotContractorHistoryEmpty(data) {
  if (data == null) return false;
  const spotTrading = Array.isArray(data.spot_trading_companies) ? data.spot_trading_companies.length : 0;
  const spotOrders = Array.isArray(data.recent_spot_orders) ? data.recent_spot_orders.length : 0;
  const trading = Array.isArray(data.trading_companies) ? data.trading_companies.length : 0;
  const projects = Array.isArray(data.recent_projects) ? data.recent_projects.length : 0;
  return spotTrading === 0 && spotOrders === 0 && trading === 0 && projects === 0;
}

/** 組合だけ商社チップから経由商社担当者を選べる。商社ロールはタップ不可。 */
export function canApplyHistoryTraderChip(role) {
  return role === 'cooperative';
}

/**
 * 商社組織に対応する顧客。
 * 代表は role=agent かつ担当者名・電話番号が両方空の行。複数いるときは id 昇順の先頭。
 * 代表が無いときは、担当者1人ならその人、2人以上は候補を返す。
 */
export function resolveAgentContactForOrganization(organizationId, agentCustomers) {
  const orgId = String(organizationId || '').trim();
  if (!orgId) return { kind: 'none' };
  const people = (Array.isArray(agentCustomers) ? agentCustomers : [])
    .filter(
      (customer) =>
        customer
        && String(customer.role ?? 'contractor') === 'agent'
        && String(customer.organization_id || '').trim() === orgId,
    )
    .slice()
    .sort((a, b) => String(a.id || '').localeCompare(String(b.id || '')));
  const representatives = people.filter(
    (customer) =>
      !String(customer.manager_name || '').trim()
      && !String(customer.phone_number || '').trim(),
  );
  if (representatives.length > 0) {
    return { kind: 'representative', customer: representatives[0] };
  }
  if (people.length === 1) return { kind: 'person', customer: people[0] };
  if (people.length > 1) return { kind: 'ambiguous', customers: people };
  return { kind: 'none' };
}

/** 組合のスポット商社チップ。直取引は選択解除、組織IDが無い商社はタップ不可。 */
export function spotTraderChipAction(row, role) {
  if (!canApplyHistoryTraderChip(role)) return { type: 'disabled' };
  const direct = !row || row.is_direct === true || !String(row.name ?? '').trim();
  if (direct) return { type: 'clear' };
  const organizationId = String(row.organization_id || '').trim();
  if (!organizationId) return { type: 'missing-org' };
  return { type: 'resolve', organizationId };
}

/** 選択中の経由商社担当者の所属組織と、チップの organization_id が一致するか。 */
export function isHistoryTraderOrganizationSelected(row, selectedCustomer) {
  if (!row || row.is_direct === true || !String(row.name ?? '').trim()) return false;
  const chipOrgId = String(row.organization_id || '').trim();
  const selectedOrgId = String(selectedCustomer?.organization_id || '').trim();
  if (!chipOrgId || !selectedOrgId) return false;
  return chipOrgId === selectedOrgId;
}

export const SPOT_TRADER_CHIP_HINT =
  '商社を押すと、その商社の代表（担当者指定なし）が選ばれます。担当者が分かる場合は「経由商社担当者」で選び直してください。';

export const MISSING_AGENT_CUSTOMER_NOTE = 'この商社の顧客が登録されていません';

/**
 * チップを商社名欄へ入れる値。組織IDがマスタにあればその名前を優先する。
 * 直取引は空文字。文字列「直取引」は返さない。
 */
export function historyChipTraderValue(row, agentOrganizations) {
  if (!row || row.is_direct === true || !String(row.name ?? '').trim()) return '';
  const orgId = String(row.organization_id || '').trim();
  if (orgId) {
    const org = (Array.isArray(agentOrganizations) ? agentOrganizations : []).find(
      (item) => String(item?.id || '') === orgId,
    );
    const orgName = String(org?.name || '').trim();
    if (orgName) return orgName;
  }
  return String(row.name || '').trim();
}

/** 商社名欄とチップが同じ会社か。表記ゆれは normalizeCompanyName で吸収する。 */
export function isHistoryTraderChipSelected(row, traderName, agentOrganizations) {
  return (
    normalizeCompanyName(historyChipTraderValue(row, agentOrganizations))
    === normalizeCompanyName(traderName)
  );
}

export function spotHistoryCacheKey(contractorCustomerId, companyName) {
  return `${String(contractorCustomerId || '').trim()}|${normalizeCompanyName(companyName)}`;
}

/** スポットの会社名照会に足りる長さか。正規化結果が2文字未満は取得しない。 */
export function canQuerySpotHistory(companyName) {
  return normalizeCompanyName(companyName).length >= 2;
}

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

export function readContractorHistoryCache(contractorCustomerId, cacheKey) {
  const id = cacheKey != null ? String(cacheKey) : String(contractorCustomerId || '').trim();
  if (!id || !historyCache.has(id)) return undefined;
  return historyCache.get(id);
}

export function writeContractorHistoryCache(contractorCustomerId, data, cacheKey) {
  const id = cacheKey != null ? String(cacheKey) : String(contractorCustomerId || '').trim();
  if (!id) return;
  historyCache.set(id, data);
}

export function invalidateContractorOrderHistoryCache() {
  historyCache.clear();
}
