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
