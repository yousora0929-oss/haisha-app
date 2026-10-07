import { normalizeCompanyName } from './projectCustomerMatch.js';
import { resolveProjectTradingCompanyName } from './projectTradingCompany.js';

/** 商社なしの表示ラベル。保存値にはしない。 */
export const DIRECT_TRADE_HISTORY_LABEL = '直取引';

/**
 * 請求先のルールは get_contractor_order_history（DB）と同一。変更時は両方を揃える。
 * billing_target が sub のときは下請名、それ以外は元請（customers.company_name）。
 * 返すのは表示用の元の文字列。
 */
export function resolveProjectBilledPartyName(project, customerById) {
  if (!project || typeof project !== 'object') return '';
  if (String(project.billing_target || '').trim() === 'sub') {
    return String(project.sub_contractor_name || project.contractor || '').trim();
  }
  const customer = lookupCustomer(customerById, project.customer_id);
  return String(customer?.company_name || customer?.name || '').trim();
}

/**
 * 請求先の業者が partyName と同じ会社の物件だけを、商社名ごとに集計する。
 * 会社名の一致ルールは normalizeCompanyName（JS）と public.normalize_company_name（DB）と同一。
 * get_contractor_order_history・projectMatchRole・本ファイルは、必ずこの正規化を使う。
 * 件数の多い順。商社なしは表示ラベル「直取引」。
 */
export function buildTradingHistoryForParty(projects, partyName, options = {}) {
  const partyKey = normalizeCompanyName(partyName);
  if (!partyKey) return [];
  const customerById = options.customerById;
  const excludeProjectId = String(options.excludeProjectId || '').trim();
  const grouped = new Map();

  for (const project of Array.isArray(projects) ? projects : []) {
    if (!project) continue;
    const projectId = String(project.id || '').trim();
    if (excludeProjectId && projectId === excludeProjectId) continue;
    const billedName = resolveProjectBilledPartyName(project, customerById);
    if (normalizeCompanyName(billedName) !== partyKey) continue;

    const tradingName = resolveProjectTradingCompanyName(project);
    const label = tradingName || DIRECT_TRADE_HISTORY_LABEL;
    const createdAt = String(project.created_at || project.createdAt || '');
    const projectName = String(project.name || '').trim();
    const current = grouped.get(label);
    if (!current) {
      grouped.set(label, {
        tradingCompanyName: label,
        count: 1,
        latestProjectName: projectName,
        latestDate: createdAt,
      });
      continue;
    }
    current.count += 1;
    if (isNewerTimestamp(createdAt, current.latestDate)) {
      current.latestDate = createdAt;
      current.latestProjectName = projectName;
    }
  }

  return [...grouped.values()].sort((a, b) => b.count - a.count);
}

/**
 * 実績行のクリックで商社欄に入れる値。
 * 「直取引」は表示ラベルなので空文字を返し、商社なしと同じ状態にする。
 */
export function tradingCompanyDraftFromHistoryLabel(label) {
  const name = String(label ?? '').trim();
  if (!name || name === DIRECT_TRADE_HISTORY_LABEL) return '';
  return name;
}

function lookupCustomer(customerById, id) {
  const key = String(id || '').trim();
  if (!key || !customerById) return null;
  if (customerById instanceof Map) return customerById.get(key) || null;
  return customerById[key] || null;
}

function isNewerTimestamp(next, current) {
  const nextMs = Date.parse(String(next || ''));
  const currentMs = Date.parse(String(current || ''));
  const nextOk = Number.isFinite(nextMs);
  const currentOk = Number.isFinite(currentMs);
  if (nextOk && currentOk) return nextMs > currentMs;
  if (nextOk && !currentOk) return true;
  return false;
}
