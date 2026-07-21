import { orderPartyInfo } from './orderPartyInfo.js';

/** 実際の時刻値（分）で並べるためのキー。表示ラベルの文字列比較はしない */
export function resolveOrderTimeMinutes(order) {
  const candidates = [order?.timeSlotMinutes, order?.scheduleMatchMinutes, order?.timeSlot];
  for (const c of candidates) {
    const n = typeof c === 'string' ? parseInt(c, 10) : Number(c);
    if (Number.isFinite(n)) return n;
  }
  const label = String(order?.timePointLabel || order?.timeSlotLabel || '').trim();
  const m = label.match(/(\d{1,2}):(\d{2})/);
  if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
  return Number.POSITIVE_INFINITY;
}

/** 日付＋時刻の実値ソートキー（複数日が混在する一覧用） */
export function resolveOrderDateTimeSortValue(order) {
  const day = String(order?.preferredDate || order?.preferred_date || order?.scheduleMatchDate || '').slice(0, 10);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00`) : NaN;
  const dayMs = Number.isFinite(parsed) ? parsed : 0;
  const minutes = resolveOrderTimeMinutes(order);
  return dayMs + (Number.isFinite(minutes) ? minutes * 60 * 1000 : 24 * 60 * 60 * 1000);
}

function defaultGetSite(order) {
  return String(orderPartyInfo(order, { preferSiteContact: true })?.site || '').trim();
}

/**
 * 割当物件（main_factory_id が設定された物件）に紐づく注文を現場名でグルーピングする。
 * スポット注文・現場名なし等はグループ化せず個別エントリのまま。
 * グループ内・エントリ全体とも sortValue（既定は時刻の分値）の昇順で並べる。
 *
 * @param {object[]} orders
 * @param {Record<string, object>} projectById
 * @param {{ sortValue?: (order: object) => number, getSite?: (order: object) => string }} [options]
 * @returns {Array<
 *   | { type: 'group', key: string, site: string, orders: object[], sortMinutes: number }
 *   | { type: 'single', key: string, order: object, sortMinutes: number }
 * >}
 */
export function groupOrdersBySiteForAssignedProjects(orders, projectById = {}, options = {}) {
  const sortValue = typeof options.sortValue === 'function' ? options.sortValue : resolveOrderTimeMinutes;
  const getSite = typeof options.getSite === 'function' ? options.getSite : defaultGetSite;

  const groupsBySite = new Map();
  const entries = [];
  for (const order of Array.isArray(orders) ? orders : []) {
    if (!order) continue;
    const projectId = String(order?.project_id ?? order?.projectId ?? '').trim();
    const project = projectId ? projectById?.[projectId] : null;
    const isSpot = Boolean(order?.is_spot ?? order?.isSpot);
    const assignedFactoryId = String(
      project?.main_factory_id ?? order?.main_factory_id ?? order?.mainFactoryId ?? '',
    ).trim();
    const site = getSite(order);
    if (!isSpot && projectId && assignedFactoryId && site) {
      let entry = groupsBySite.get(site);
      if (!entry) {
        entry = { type: 'group', key: `site:${site}`, site, orders: [] };
        groupsBySite.set(site, entry);
        entries.push(entry);
      }
      entry.orders.push(order);
    } else {
      entries.push({ type: 'single', key: `order:${order?.id}`, order });
    }
  }
  for (const entry of entries) {
    if (entry.type === 'group') {
      entry.orders.sort((a, b) => sortValue(a) - sortValue(b));
      entry.sortMinutes = sortValue(entry.orders[0]);
    } else {
      entry.sortMinutes = sortValue(entry.order);
    }
  }
  entries.sort((a, b) => a.sortMinutes - b.sortMinutes);
  return entries;
}
