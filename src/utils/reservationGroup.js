import { pad2, todayLocalISODate } from '../haishaConstants.js';

export const RESERVATION_GROUP_STATUS_LABELS = {
  pending: '回答待ち',
  matched: '確定',
  conflict: '要調整',
};

export const RESERVATION_GROUP_MIN_DAYS = 2;
export const RESERVATION_GROUP_MAX_DAYS = 7;

const WATCH_STORAGE_KEY = 'haisha_reservation_group_watch_v1';

export function reservationGroupStatusLabel(status) {
  const key = String(status || '').trim();
  return RESERVATION_GROUP_STATUS_LABELS[key] || key || '—';
}

export function addDaysIso(isoDate, days) {
  const raw = String(isoDate || '').trim();
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const base = match
    ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
    : new Date();
  const dt = new Date(base.getFullYear(), base.getMonth(), base.getDate() + Number(days || 0));
  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

export function defaultReservationDayDates(today = todayLocalISODate(), count = RESERVATION_GROUP_MIN_DAYS) {
  const n = Math.min(
    RESERVATION_GROUP_MAX_DAYS,
    Math.max(RESERVATION_GROUP_MIN_DAYS, Number(count) || RESERVATION_GROUP_MIN_DAYS),
  );
  return Array.from({ length: n }, (_, offset) => addDaysIso(today, offset));
}

export function nextReservationDate(existingDates, today = todayLocalISODate()) {
  const used = new Set(
    (Array.isArray(existingDates) ? existingDates : [])
      .map((d) => String(d || '').trim())
      .filter(Boolean),
  );
  const start = [...used].sort().pop();
  let candidate = start && start >= today ? addDaysIso(start, 1) : today;
  while (used.has(candidate)) {
    candidate = addDaysIso(candidate, 1);
  }
  return candidate;
}

export function reservationDayCountError(count) {
  const n = Number(count);
  if (!Number.isInteger(n) || n < RESERVATION_GROUP_MIN_DAYS || n > RESERVATION_GROUP_MAX_DAYS) {
    return `予約日は${RESERVATION_GROUP_MIN_DAYS}〜${RESERVATION_GROUP_MAX_DAYS}日で指定してください。`;
  }
  return '';
}

export function unwrapReservationGroupEmbed(raw) {
  if (!raw) return null;
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== 'object') return null;
  const id = String(row.id || '').trim();
  if (!id) return null;
  return {
    id,
    status: String(row.status || 'pending').trim() || 'pending',
    same_factory_required: row.same_factory_required === true,
  };
}

export function attachReservationGroupFromRow(row) {
  const fromCol = String(row?.reservation_group_id || '').trim();
  const group = unwrapReservationGroupEmbed(row?.reservation_groups);
  const reservation_group_id = fromCol || group?.id || '';
  const reservation_group =
    group && (!reservation_group_id || group.id === reservation_group_id) ? group : null;
  return { reservation_group_id, reservation_group };
}

export function mergeReservationGroupFields(updated, previous) {
  if (!updated) return updated;
  const reservation_group_id = String(
    updated.reservation_group_id || previous?.reservation_group_id || '',
  ).trim();
  return {
    ...updated,
    reservation_group_id,
    reservation_group: updated.reservation_group || previous?.reservation_group || null,
  };
}

export function reservationGroupIdOf(order) {
  return String(order?.reservation_group_id || order?.reservation_group?.id || '').trim();
}

export function reservationGroupStatusOf(order) {
  return String(order?.reservation_group?.status || '').trim();
}

export function reservationGroupMonitorBadgeText(status) {
  const key = String(status || 'pending').trim() || 'pending';
  return `予約グループ：${reservationGroupStatusLabel(key)}`;
}

export function reservationGroupMonitorBadgeClass(status) {
  const key = String(status || 'pending').trim();
  if (key === 'matched') return 'border-emerald-400 bg-emerald-50 text-emerald-900';
  if (key === 'conflict') return 'border-rose-500 bg-rose-100 text-rose-950';
  return 'border-slate-300 bg-slate-100 text-slate-700';
}

export function siblingReservationFactoryLine(order, factoryNameById = {}) {
  const factoryId = String(order?.factory_site_id || '').trim();
  const preferredId = String(order?.preferred_factory_id || '').trim();
  const accepted =
    Boolean(String(order?.accepted_at || order?.acceptedAt || '').trim()) ||
    String(order?.status || '') === 'accepted';
  if (accepted) {
    return `確定工場: ${factoryNameById[factoryId] || factoryId || '—'}`;
  }
  return `未確定（第一希望: ${factoryNameById[preferredId] || preferredId || '指定なし'}）`;
}

export function reservationGroupMonitorHighlightClass({ status, highlighted } = {}) {
  const parts = [];
  if (status === 'conflict') {
    parts.push('bg-rose-50 shadow-[inset_0_0_0_2px_#f43f5e]');
  } else if (highlighted) {
    parts.push('bg-indigo-50');
  }
  if (highlighted) parts.push('ring-2 ring-inset ring-indigo-400');
  return parts.join(' ');
}

export function parseSubmitReservationGroupResult(data) {
  let raw = data;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { groupId: '', orderIds: [], orders: [] };
  }
  const groupId = String(raw.group_id ?? raw.groupId ?? '').trim();
  const list = Array.isArray(raw.orders) ? raw.orders : [];
  const orders = list.filter((row) => row && typeof row === 'object');
  const orderIds = orders.map((row) => String(row.id || '').trim()).filter(Boolean);
  return { groupId, orderIds, orders };
}

export function mapReservationOrderRow(row, factoryNameById = {}) {
  if (!row || typeof row !== 'object') return null;
  const od = row.order_data && typeof row.order_data === 'object' && !Array.isArray(row.order_data)
    ? row.order_data
    : {};
  const factoryId = String(row.factory_site_id ?? '').trim();
  const preferredFactoryId = String(row.preferred_factory_id ?? od.preferred_factory_id ?? '').trim();
  return {
    id: String(row.id || '').trim(),
    reservation_group_id: String(row.reservation_group_id || '').trim(),
    factory_site_id: factoryId || null,
    preferred_factory_id: preferredFactoryId || null,
    factoryName: factoryId ? factoryNameById[factoryId] || factoryId : '',
    preferredFactoryName: preferredFactoryId
      ? factoryNameById[preferredFactoryId] || preferredFactoryId
      : '',
    accepted_at: row.accepted_at || null,
    status: String(row.status || '').trim(),
    customer_id: String(row.customer_id || '').trim(),
    project_id: String(row.project_id || '').trim(),
    preferredDate: String(od.preferredDate ?? od.delivery_date ?? od.scheduleMatchDate ?? '').trim(),
    timeSlotLabel: String(od.timeSlotLabel ?? od.timePointLabel ?? od.timeSlot ?? '').trim(),
    siteName: String(od.siteName ?? od.projectName ?? '').trim(),
    quantityM3: od.quantityM3 ?? od.quantityCube ?? '',
    mixText: String(od.mixText ?? '').trim(),
  };
}

export function readWatchedReservationGroups() {
  try {
    const raw = window.sessionStorage.getItem(WATCH_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => x && x.groupId) : [];
  } catch {
    return [];
  }
}

export function rememberWatchedReservationGroup(entry) {
  const groupId = String(entry?.groupId || '').trim();
  if (!groupId) return;
  const next = {
    groupId,
    orderIds: Array.isArray(entry.orderIds) ? entry.orderIds.map((id) => String(id).trim()).filter(Boolean) : [],
    token: String(entry.token || '').trim(),
    submittedAt: entry.submittedAt || new Date().toISOString(),
  };
  const prev = readWatchedReservationGroups().filter((x) => x.groupId !== groupId);
  try {
    window.sessionStorage.setItem(WATCH_STORAGE_KEY, JSON.stringify([next, ...prev].slice(0, 8)));
  } catch {
    /* ignore */
  }
}

const FACTORY_RESPONSE_STORAGE_KEY = 'haisha_reservation_group_factory_responses_v1';

export function reservationGroupSameFactoryRequired(order) {
  if (order?.reservation_group?.same_factory_required === false) return false;
  if (order?.same_factory_required === false) return false;
  return true;
}

/** 工場アプリの専用可否確認対象（個別受注とは別ルート） */
export function isPendingReservationGroupAvailability(order) {
  const gid = reservationGroupIdOf(order);
  if (!gid) return false;
  const status = reservationGroupStatusOf(order) || 'pending';
  if (status !== 'pending') return false;
  if (String(order?.status || 'pending').trim() === 'customer_cancelled') return false;
  if (String(order?.factory_site_id ?? order?.factorySiteId ?? '').trim()) return false;
  if (String(order?.accepted_at ?? order?.acceptedAt ?? '').trim()) return false;
  return reservationGroupSameFactoryRequired(order);
}

export function reservationGroupDayCount(orders) {
  const dates = new Set();
  for (const order of Array.isArray(orders) ? orders : []) {
    const day = String(order?.preferredDate || order?.preferred_date || order?.scheduleMatchDate || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) dates.add(day);
  }
  if (dates.size) return dates.size;
  return (Array.isArray(orders) ? orders : []).filter(Boolean).length;
}

function reservationGroupSortValue(order) {
  const day = String(order?.preferredDate || order?.preferred_date || order?.scheduleMatchDate || '').slice(0, 10);
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00`) : 0;
  return Number.isFinite(parsed) ? parsed : 0;
}

export function sortReservationGroupOrders(orders) {
  return [...(Array.isArray(orders) ? orders : []).filter(Boolean)].sort(
    (a, b) => reservationGroupSortValue(a) - reservationGroupSortValue(b),
  );
}

export function declinedReservationGroupIdSet(ids) {
  return new Set(
    [...(ids instanceof Set ? ids : Array.isArray(ids) ? ids : [])]
      .map((id) => String(id || '').trim())
      .filter(Boolean),
  );
}

/**
 * エスカレーションで見えている注文のうち pending グループは1枚の可否確認にまとめ、
 * 全日（raw 側の同一グループ）をカードに載せる。
 */
export function splitFactoryInboxForReservationGroups(visibleOrders, allOrders, declinedGroupIds) {
  const declined = declinedReservationGroupIdSet(declinedGroupIds);
  const visibleList = Array.isArray(visibleOrders) ? visibleOrders.filter(Boolean) : [];
  const sourceList = Array.isArray(allOrders) && allOrders.length ? allOrders.filter(Boolean) : visibleList;
  const visibleGroupIds = [];
  const seen = new Set();
  for (const order of visibleList) {
    if (!isPendingReservationGroupAvailability(order)) continue;
    const gid = reservationGroupIdOf(order);
    if (!gid || declined.has(gid) || seen.has(gid)) continue;
    seen.add(gid);
    visibleGroupIds.push(gid);
  }
  const groups = visibleGroupIds.map((groupId) => {
    const members = sortReservationGroupOrders(
      sourceList.filter((order) => reservationGroupIdOf(order) === groupId),
    );
    return {
      groupId,
      orders: members,
      dayCount: reservationGroupDayCount(members),
    };
  });
  const groupedVisibleIds = new Set();
  for (const group of groups) {
    for (const order of group.orders) {
      if (order?.id) groupedVisibleIds.add(String(order.id));
    }
  }
  const singles = visibleList.filter((order) => {
    const gid = reservationGroupIdOf(order);
    if (gid && declined.has(gid) && isPendingReservationGroupAvailability(order)) return false;
    return !order?.id || !groupedVisibleIds.has(String(order.id));
  });
  return { groups, singles };
}

export function parseRespondReservationGroupAvailabilityResult(data) {
  let raw = data;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  if (Array.isArray(raw)) raw = raw[0] || null;
  if (!raw || typeof raw !== 'object') {
    return { won: false, reason: '', available: null };
  }
  const reason = String(raw.reason ?? raw.error ?? raw.code ?? '').trim();
  const won = raw.won === true || raw.matched === true || raw.ok === true;
  const available = typeof raw.available === 'boolean' ? raw.available : null;
  return { won, reason, available };
}

export function reservationGroupAvailabilityResultMessage(result, available) {
  if (!available) return '回答を送信しました';
  if (result?.won) return '確定しました';
  const reason = String(result?.reason || '').trim();
  if (reason === 'already_filled' || reason === 'already_matched' || !result?.won) {
    return '他の工場に決まりました';
  }
  return '回答を送信しました';
}

/** 「可」確定後に工場の可否確認カードへ出す案内（受注ボタンを促さない） */
export const RESERVATION_GROUP_CONFIRMED_GUIDANCE =
  'この内容で確定しました。通常の注文一覧に新しいカードとして届きますので、内容をご確認ください';

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return '';
}

/** 可否確認カード用。order_data 由来の正規化済みフィールドを先頭注文から拾う */
export function reservationGroupAvailabilitySummary(orders) {
  const order = (Array.isArray(orders) ? orders : []).find(Boolean) || {};
  const vehicleType = String(order.vehicleType || '').trim();
  return {
    contractorName: firstNonEmpty(order.contractorName),
    traderName: firstNonEmpty(order.trading_company_name, order.projectTradingCompanyName),
    orderedBy: firstNonEmpty(order.orderedBy),
    vehicleLabel: firstNonEmpty(
      order.vehicleLabel,
      vehicleType === 'small' ? '小型車' : vehicleType === 'large' ? '大型車' : '',
    ),
    siteName: firstNonEmpty(order.siteName, order.projectName),
    siteAddress: firstNonEmpty(order.siteAddress),
  };
}

export function mergeConfirmedAvailabilityGroups(pendingGroups, confirmedGroups) {
  const pending = Array.isArray(pendingGroups) ? pendingGroups.filter((g) => g?.groupId) : [];
  const seen = new Set(pending.map((g) => String(g.groupId)));
  const extras = (Array.isArray(confirmedGroups) ? confirmedGroups : []).filter(
    (g) => g?.groupId && !seen.has(String(g.groupId)),
  );
  return extras.length ? [...pending, ...extras] : pending;
}

function readFactoryResponseStore() {
  try {
    const raw = window.localStorage.getItem(FACTORY_RESPONSE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function readLocalDeclinedReservationGroupIds(factoryId) {
  const fid = String(factoryId || '').trim();
  if (!fid) return new Set();
  const byFactory = readFactoryResponseStore()[fid];
  const declined = new Set();
  if (!byFactory || typeof byFactory !== 'object') return declined;
  for (const [groupId, row] of Object.entries(byFactory)) {
    if (row && row.available === false && groupId) declined.add(String(groupId));
  }
  return declined;
}

export function rememberLocalReservationGroupFactoryResponse(factoryId, groupId, available) {
  const fid = String(factoryId || '').trim();
  const gid = String(groupId || '').trim();
  if (!fid || !gid) return;
  const store = readFactoryResponseStore();
  const byFactory = store[fid] && typeof store[fid] === 'object' ? { ...store[fid] } : {};
  byFactory[gid] = { available: Boolean(available), at: new Date().toISOString() };
  try {
    window.localStorage.setItem(
      FACTORY_RESPONSE_STORAGE_KEY,
      JSON.stringify({ ...store, [fid]: byFactory }),
    );
  } catch {
    /* ignore */
  }
}

export function mergeDeclinedReservationGroupIds(factoryId, rows) {
  const declined = readLocalDeclinedReservationGroupIds(factoryId);
  for (const row of Array.isArray(rows) ? rows : []) {
    const gid = String(row?.reservation_group_id || row?.group_id || row?.groupId || '').trim();
    if (!gid) continue;
    if (row?.available === false) declined.add(gid);
  }
  return declined;
}

export function isReservationGroupMatchedOrder(order) {
  if (reservationGroupStatusOf(order) !== 'matched') return false;
  return Boolean(
    String(order?.factory_site_id ?? order?.factorySiteId ?? '').trim() ||
      String(order?.accepted_at ?? order?.acceptedAt ?? '').trim(),
  );
}
