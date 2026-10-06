import { isAwaitingCustomerChangeDecision } from './changeRequestItems.js';
import { needsPreferredCustomerChoice } from './escalationUtils.js';
import { normalizeCompanyName } from './csvImport.js';
import {
  orderPartyInfo,
  resolveOrderContractorDisplayName,
  resolveOrderTradingCompanyDisplayName,
} from './orderPartyInfo.js';
import { resolveOrderSiteDisplayName } from './siteNameDisplay.js';

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

function reservationGroupIdOfOrder(order) {
  return String(order?.reservation_group_id || order?.reservation_group?.id || '').trim();
}

/** 進行中グループに載せる複数日予約 ID（重複なし・出現順） */
export function reservationGroupIdsFromOrders(orders) {
  const ids = [];
  const seen = new Set();
  for (const order of Array.isArray(orders) ? orders : []) {
    const gid = reservationGroupIdOfOrder(order);
    if (!gid || seen.has(gid)) continue;
    seen.add(gid);
    ids.push(gid);
  }
  return ids;
}

/**
 * 割当物件（main_factory_id が設定された物件）に紐づく注文を現場名でグルーピングする。
 * スポット注文・現場名なし等はグループ化せず個別エントリのまま。
 * グループ内・エントリ全体とも sortValue（既定は時刻の分値）の昇順で並べる。
 *
 * @param {object[]} orders
 * @param {Record<string, object>} projectById
 * @param {{ sortValue?: (order: object) => number, getSite?: (order: object) => string, includeReservationGroups?: boolean }} [options]
 * @returns {Array<
 *   | { type: 'group', key: string, site: string, orders: object[], sortMinutes: number }
 *   | { type: 'single', key: string, order: object, sortMinutes: number }
 * >}
 */
export function groupOrdersBySiteForAssignedProjects(orders, projectById = {}, options = {}) {
  const sortValue = typeof options.sortValue === 'function' ? options.sortValue : resolveOrderTimeMinutes;
  const getSite = typeof options.getSite === 'function' ? options.getSite : defaultGetSite;
  const includeReservationGroups = options.includeReservationGroups === true;

  const groupsByKey = new Map();
  const entries = [];
  const pushGroup = (key, site, order) => {
    let entry = groupsByKey.get(key);
    if (!entry) {
      entry = { type: 'group', key, site, orders: [] };
      groupsByKey.set(key, entry);
      entries.push(entry);
    }
    entry.orders.push(order);
  };
  for (const order of Array.isArray(orders) ? orders : []) {
    if (!order) continue;
    const projectId = String(order?.project_id ?? order?.projectId ?? '').trim();
    const project = projectId ? projectById?.[projectId] : null;
    const isSpot = Boolean(order?.is_spot ?? order?.isSpot);
    const assignedFactoryId = String(
      project?.main_factory_id ?? order?.main_factory_id ?? order?.mainFactoryId ?? '',
    ).trim();
    const site = getSite(order);
    const reservationGroupId = reservationGroupIdOfOrder(order);
    const canAssignedGroup = !isSpot && Boolean(projectId) && Boolean(assignedFactoryId) && Boolean(site);
    const canReservationSiteGroup = includeReservationGroups && Boolean(reservationGroupId) && Boolean(site);
    if (canAssignedGroup || canReservationSiteGroup) {
      pushGroup(`site:${site}`, site, order);
    } else if (includeReservationGroups && reservationGroupId) {
      pushGroup(`reservation:${reservationGroupId}`, site || '複数日予約', order);
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

function cloneInboxEntries(entries) {
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    if (entry?.type === 'group') {
      return {
        ...entry,
        orders: [...(entry.orders || [])],
        availabilityGroups: [...(entry.availabilityGroups || [])],
      };
    }
    return entry;
  });
}

function siteOfAvailabilityGroup(group, getSite) {
  for (const order of Array.isArray(group?.orders) ? group.orders : []) {
    const site = String(getSite(order) || '').trim();
    if (site) return site;
  }
  return '';
}

/**
 * 工場新着の可否確認カードを、同じ現場名のグループへ収める。
 * 該当グループがなければ現場グループを作る。現場名なしは leftover に残す。
 */
export function attachAvailabilityGroupsToSiteEntries(entries, availabilityGroups, options = {}) {
  const getSite = typeof options.getSite === 'function' ? options.getSite : defaultGetSite;
  const next = cloneInboxEntries(entries);
  const leftoverAvailabilityGroups = [];

  for (const group of Array.isArray(availabilityGroups) ? availabilityGroups : []) {
    if (!group) continue;
    const site = siteOfAvailabilityGroup(group, getSite);
    if (!site) {
      leftoverAvailabilityGroups.push(group);
      continue;
    }
    let match = next.find((entry) => entry?.type === 'group' && entry.site === site);
    if (!match) {
      match = {
        type: 'group',
        key: `site:${site}`,
        site,
        orders: [],
        sortMinutes: resolveOrderDateTimeSortValue(group.orders?.[0]),
        availabilityGroups: [],
      };
      next.push(match);
    }
    if (!Array.isArray(match.availabilityGroups)) match.availabilityGroups = [];
    match.availabilityGroups.push(group);
  }

  const groups = next.filter((entry) => entry?.type === 'group');
  const folded = [];
  for (const entry of next) {
    if (entry?.type === 'group') {
      folded.push(entry);
      continue;
    }
    const site = String(getSite(entry?.order) || '').trim();
    const match = site ? groups.find((group) => group.site === site) : null;
    if (match) {
      match.orders.push(entry.order);
    } else {
      folded.push(entry);
    }
  }
  return { entries: folded, leftoverAvailabilityGroups };
}

export function compareSiteLabels(a, b, dir = 'asc') {
  const sa = String(a || '').trim();
  const sb = String(b || '').trim();
  if (sa && !sb) return -1;
  if (!sa && sb) return 1;
  const cmp = sa.localeCompare(sb, 'ja');
  return dir === 'desc' ? -cmp : cmp;
}

export function compareOrdersForFactoryInbox(a, b, sortKey = 'deliveryDate', sortDir = 'asc') {
  if (sortKey === 'siteName') {
    const cmp = compareSiteLabels(defaultGetSite(a), defaultGetSite(b), sortDir);
    if (cmp !== 0) return cmp;
  }
  const va = resolveOrderDateTimeSortValue(a);
  const vb = resolveOrderDateTimeSortValue(b);
  const cmp = va - vb;
  if (cmp !== 0) return sortDir === 'desc' ? -cmp : cmp;
  return 0;
}

function representativeOrderForInboxEntry(entry) {
  if (!entry) return null;
  if (entry.type === 'group') {
    return entry.orders?.[0] || entry.availabilityGroups?.[0]?.orders?.[0] || null;
  }
  return entry.order || null;
}

/** 工場新着の現場グループ／単票を、日付順または現場名順に並べ替える */
export function sortFactoryInboxEntries(entries, sortKey = 'deliveryDate', sortDir = 'asc') {
  const list = cloneInboxEntries(entries).map((entry) => {
    if (entry?.type !== 'group') return entry;
    return {
      ...entry,
      orders: [...(entry.orders || [])].sort((a, b) =>
        compareOrdersForFactoryInbox(a, b, sortKey, sortDir),
      ),
    };
  });
  list.sort((a, b) => {
    if (sortKey === 'siteName') {
      const sa = a?.type === 'group' ? a.site : defaultGetSite(a?.order);
      const sb = b?.type === 'group' ? b.site : defaultGetSite(b?.order);
      const cmp = compareSiteLabels(sa, sb, sortDir);
      if (cmp !== 0) return cmp;
    }
    return compareOrdersForFactoryInbox(
      representativeOrderForInboxEntry(a) || {},
      representativeOrderForInboxEntry(b) || {},
      'deliveryDate',
      sortDir,
    );
  });
  return list;
}

/** 進行中グループの開閉状態を localStorage に保存するときの安定キー（物件ID優先） */
export function resolveInProgressGroupStorageId(entry) {
  if (!entry || entry.type !== 'group') return '';
  const projectIds = [
    ...new Set(
      (Array.isArray(entry.orders) ? entry.orders : [])
        .map((o) => String(o?.project_id ?? o?.projectId ?? '').trim())
        .filter(Boolean),
    ),
  ];
  if (projectIds.length === 1) return `project:${projectIds[0]}`;
  return String(entry.key || (entry.site ? `site:${entry.site}` : '')).trim();
}

/** カード表示と同じ日付ラベル（例: 2026/7/28） */
export function formatOrderDateLabel(order) {
  const iso = String(order?.preferredDate || order?.preferred_date || order?.scheduleMatchDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '—';
  const p = iso.split('-');
  return `${p[0]}/${Number(p[1])}/${Number(p[2])}`;
}

/** カード表示と同じ日時サマリ（例: 2026/7/28 · 10:30） */
export function formatOrderDateTimeSummary(order) {
  if (!order) return '';
  const time = order.timePointLabel || order.timeSlotLabel || '—';
  return `${formatOrderDateLabel(order)} · ${time}`;
}

/**
 * 配下注文から「いまから見て最も近い予定」の注文を返す。
 * 現在以降で最も早いものを優先し、すべて過去なら直近（最も新しい）を返す。
 */
export function resolveNearestUpcomingOrder(orders, nowMs = Date.now()) {
  const list = (Array.isArray(orders) ? orders : []).filter(Boolean);
  if (!list.length) return null;
  const scored = list.map((order) => ({
    order,
    ts: resolveOrderDateTimeSortValue(order),
  }));
  const upcoming = scored
    .filter((row) => Number.isFinite(row.ts) && row.ts >= nowMs)
    .sort((a, b) => a.ts - b.ts);
  if (upcoming.length) return upcoming[0].order;
  const pastOrUnknown = scored
    .filter((row) => Number.isFinite(row.ts))
    .sort((a, b) => b.ts - a.ts);
  return pastOrUnknown[0]?.order || list[0];
}

/** 現場名のゆれを吸収する。空白除去と括弧の統一のみ。 */
export function normalizeSiteText(value) {
  let text = String(value ?? '').normalize('NFKC');
  text = text.replace(/[\s\u3000]+/g, '');
  text = text.replace(/[（［【〔]/g, '(').replace(/[）］】〕]/g, ')');
  return text;
}

function lookupCustomer(customersById, id) {
  const key = String(id || '').trim();
  if (!key || customersById == null) return null;
  if (typeof customersById.get === 'function') return customersById.get(key) || null;
  if (typeof customersById === 'object') return customersById[key] || null;
  return null;
}

/**
 * グルーピング用の業者名。
 * 取得時に付く displayContractorName は contractor_customer_id 由来なので使わない。
 * resolveOrderContractorDisplayName は空文字を通すので、こちらで未設定にする。
 */
function contractorNameForGroup(order) {
  const source =
    order && typeof order === 'object' ? { ...order, displayContractorName: '' } : order;
  const name = String(resolveOrderContractorDisplayName(source) ?? '').trim();
  return name || null;
}

function contractorKeyForOrder(order, customersById) {
  const name = contractorNameForGroup(order);
  if (name) {
    const normalized = normalizeCompanyName(name);
    if (normalized) return normalized;
  }
  const customerId = String(order?.contractor_customer_id ?? order?.contractorCustomerId ?? '').trim();
  const customer = lookupCustomer(customersById, customerId) || order?.contractorCustomer || null;
  const orgId = String(customer?.organization_id ?? customer?.organizationId ?? '').trim();
  if (orgId) return `org:${orgId}`;
  return 'unknown';
}

function projectIdOf(order) {
  return String(order?.project_id ?? order?.projectId ?? '').trim();
}

function siteKeyForOrder(order) {
  const projectId = projectIdOf(order);
  if (projectId) return `project:${projectId}`;
  return `site:${normalizeSiteText(resolveOrderSiteDisplayName(order))}`;
}

function deliveryDateISO(order) {
  const day = String(order?.preferredDate || order?.preferred_date || order?.scheduleMatchDate || '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '';
}

function deliveryInstant(order) {
  const day = deliveryDateISO(order);
  if (!day) return null;
  const parsed = Date.parse(`${day}T00:00:00`);
  if (!Number.isFinite(parsed)) return null;
  const minutes = resolveOrderTimeMinutes(order);
  if (!Number.isFinite(minutes) || minutes === Number.POSITIVE_INFINITY) return parsed;
  return parsed + minutes * 60 * 1000;
}

function localTodayISO(now = new Date()) {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

function orderCreatedAtMs(order) {
  const parsed = Date.parse(String(order?.createdAt ?? order?.created_at ?? ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareInProgressGroups(a, b, sortMode) {
  const priority = Number(Boolean(b.needsAttention)) - Number(Boolean(a.needsAttention));
  if (priority !== 0) return priority;
  if (sortMode === 'createdAt') {
    if (a.latestCreatedAt !== b.latestCreatedAt) return b.latestCreatedAt - a.latestCreatedAt;
    return String(a.title || '').localeCompare(String(b.title || ''), 'ja');
  }
  const aUpcoming = a.nearestUpcomingAt != null;
  const bUpcoming = b.nearestUpcomingAt != null;
  if (aUpcoming !== bUpcoming) return aUpcoming ? -1 : 1;
  if (aUpcoming && a.nearestUpcomingAt !== b.nearestUpcomingAt) {
    return a.nearestUpcomingAt - b.nearestUpcomingAt;
  }
  const aLatest = a.latestAt ?? Number.NEGATIVE_INFINITY;
  const bLatest = b.latestAt ?? Number.NEGATIVE_INFINITY;
  if (aLatest !== bLatest) return bLatest - aLatest;
  return String(a.title || '').localeCompare(String(b.title || ''), 'ja');
}

function orderNeedsCustomerAction(order) {
  return isAwaitingCustomerChangeDecision(order) || needsPreferredCustomerChoice(order);
}

/**
 * 進行中注文を「業者 × 現場」でまとめる。
 * project_id がある現場は現場名の文字列では分けない。
 *
 * @param {object[]} orders
 * @param {{ projectById?: Record<string, object>, customersById?: Record<string, object>|Map, hasUnread?: (order: object) => boolean, today?: string, sortMode?: 'deliveryDate' | 'createdAt' }} [ctx]
 */
export function groupInProgressOrders(
  orders,
  { projectById = {}, customersById, hasUnread, today, sortMode = 'deliveryDate' } = {},
) {
  const todayISO = /^\d{4}-\d{2}-\d{2}$/.test(String(today || '').slice(0, 10))
    ? String(today).slice(0, 10)
    : localTodayISO();
  const list = (Array.isArray(orders) ? orders : []).filter(Boolean);
  const buckets = new Map();
  for (const order of list) {
    const key = `${contractorKeyForOrder(order, customersById)}|${siteKeyForOrder(order)}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, orders: [] };
      buckets.set(key, bucket);
    }
    bucket.orders.push(order);
  }

  const groups = [];
  for (const bucket of buckets.values()) {
    const sorted = [...bucket.orders].sort(
      (a, b) => resolveOrderDateTimeSortValue(a) - resolveOrderDateTimeSortValue(b),
    );
    const first = sorted[0];
    const projectId = projectIdOf(first);
    const project = projectId ? projectById?.[projectId] || null : null;
    const title =
      String(project?.name || '').trim() ||
      resolveOrderSiteDisplayName(first, project) ||
      '現場未設定';
    const party = orderPartyInfo({ ...first, displayContractorName: '' });
    const dates = sorted.map(deliveryDateISO).filter(Boolean).sort();
    let earliestAt = null;
    let latestAt = null;
    let nearestUpcomingAt = null;
    for (const order of sorted) {
      const instant = deliveryInstant(order);
      if (instant == null) continue;
      if (earliestAt == null || instant < earliestAt) earliestAt = instant;
      if (latestAt == null || instant > latestAt) latestAt = instant;
      if (deliveryDateISO(order) >= todayISO && (nearestUpcomingAt == null || instant < nearestUpcomingAt)) {
        nearestUpcomingAt = instant;
      }
    }
    const unread = typeof hasUnread === 'function' ? hasUnread : () => false;
    groups.push({
      key: bucket.key,
      title,
      contractorLabel: party.contractorName || '',
      tradingCompanyLabel: resolveOrderTradingCompanyDisplayName(first) || '',
      orders: sorted,
      earliestAt,
      nearestUpcomingAt,
      latestAt,
      latestCreatedAt: sorted.reduce((max, order) => Math.max(max, orderCreatedAtMs(order)), 0),
      earliestDate: dates[0] || '',
      latestDate: dates.length ? dates[dates.length - 1] : '',
      needsAttention: sorted.some((order) => orderNeedsCustomerAction(order) || unread(order)),
    });
  }

  groups.sort((a, b) => compareInProgressGroups(a, b, sortMode));
  return groups;
}
