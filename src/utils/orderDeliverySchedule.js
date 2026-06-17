/** 純粋ユーティリティ（db / コンポーネントへ依存しない） */

function pad2(n) {
  return String(n).padStart(2, '0');
}

function getTodayLocalISODate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function resolveTodayIso(todayIso) {
  const iso = String(todayIso ?? '').slice(0, 10);
  return isValidDeliveryDateISO(iso) ? iso : getTodayLocalISODate();
}

/** 予定日（delivery_date / preferredDate / scheduleMatchDate 等）を YYYY-MM-DD で取得 */
export function getOrderDeliveryDateISO(order) {
  if (!order || typeof order !== 'object') return '';
  const candidates = [
    order.delivery_date,
    order.deliveryDate,
    order.preferredDate,
    order.preferred_date,
    order.scheduleMatchDate,
    order.schedule_match_date,
  ];
  for (const raw of candidates) {
    if (raw == null || raw === '') continue;
    const iso = String(raw).trim().slice(0, 10);
    if (isValidDeliveryDateISO(iso)) return iso;
  }
  return '';
}

export function isValidDeliveryDateISO(iso) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(iso ?? ''));
}

/** 手動「完了」系ステータス */
export function isOrderManuallyCompleted(order) {
  const st = String(order?.status || order?.factoryResponseStatus || '').trim();
  return ['completed', 'complete', 'done', 'delivered'].includes(st);
}

export function isOrderCancelledForHistory(order) {
  const st = String(order?.status || order?.factoryResponseStatus || '').trim();
  return ['customer_cancelled', 'cancelled', 'deleted'].includes(st);
}

/** 予定日が今日以降（当日含む）。日付未設定は進行中に残す */
export function isOrderDeliveryOnOrAfterToday(order, todayIso) {
  const today = resolveTodayIso(todayIso);
  const d = getOrderDeliveryDateISO(order);
  if (!isValidDeliveryDateISO(d)) return true;
  return d >= today;
}

/** 予定日が今日より過去（昨日以前） */
export function isOrderDeliveryBeforeToday(order, todayIso) {
  const today = resolveTodayIso(todayIso);
  const d = getOrderDeliveryDateISO(order);
  if (!isValidDeliveryDateISO(d)) return false;
  return d < today;
}

export function getOrderAcceptedAtTimestamp(order) {
  const raw =
    order?.accepted_at ??
    order?.acceptedAt ??
    order?.updated_at ??
    order?.updatedAt ??
    order?.created_at ??
    order?.createdAt;
  if (raw == null || raw === '') return NaN;
  const t = Date.parse(String(raw));
  return Number.isFinite(t) ? t : NaN;
}

export function getAssignedFactoryId(order) {
  return String(order?.factory_site_id ?? order?.factorySiteId ?? '').trim();
}

/** 閲覧工場以外が受注した accepted 注文か */
export function isOrderAcceptedByOtherFactory(order, viewerFactoryId) {
  const viewer = String(viewerFactoryId ?? '').trim();
  if (!viewer) return false;
  const st = String(order?.status ?? order?.factoryResponseStatus ?? '').trim();
  if (st !== 'accepted') return false;
  const assigned = getAssignedFactoryId(order);
  if (!assigned) return false;
  return assigned !== viewer;
}

function tokyoYmdFromTimestamp(ts) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo' }).format(new Date(ts));
}

function addOneCalendarDayYmd(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d + 1);
  const nd = new Date(t);
  return `${nd.getUTCFullYear()}-${pad2(nd.getUTCMonth() + 1)}-${pad2(nd.getUTCDate())}`;
}

/** Asia/Tokyo の YYYY-MM-DD 00:00 の UTC ミリ秒 */
function tokyoMidnightMs(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return Date.UTC(y, m - 1, d) - 9 * 60 * 60 * 1000;
}

/** 他工場受注が受注日の翌日0時（Asia/Tokyo）を過ぎて履歴対象か */
export function isOtherFactoryAcceptedPastHistoryCutoff(order, viewerFactoryId, nowMs = Date.now()) {
  if (!isOrderAcceptedByOtherFactory(order, viewerFactoryId)) return false;
  const ts = getOrderAcceptedAtTimestamp(order);
  if (!Number.isFinite(ts)) return false;
  const acceptedYmd = tokyoYmdFromTimestamp(ts);
  const nextDayYmd = addOneCalendarDayYmd(acceptedYmd);
  const nextDay0 = tokyoMidnightMs(nextDayYmd);
  return nowMs >= nextDay0;
}

export function formatAcceptedAtTimeJp(order) {
  const ts = getOrderAcceptedAtTimestamp(order);
  if (!Number.isFinite(ts)) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(ts));
}

export function formatAcceptedAtDateTimeJp(order) {
  const ts = getOrderAcceptedAtTimestamp(order);
  if (!Number.isFinite(ts)) return '—';
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ts));
  const pick = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}/${pick('month')}/${pick('day')} ${pick('hour')}:${pick('minute')}`;
}

/**
 * 進行中一覧: 手動完了・キャンセル以外で、予定日が今日以降（または未設定）
 * viewerFactoryId 指定時: 他工場受注は翌日0時過ぎで除外
 */
export function isOrderInProgressView(order, todayIso, viewerFactoryId) {
  if (!order) return false;
  const today = resolveTodayIso(todayIso);
  if (isOrderCancelledForHistory(order)) return false;
  if (isOrderManuallyCompleted(order)) return false;
  if (isOrderDeliveryBeforeToday(order, today)) return false;
  if (viewerFactoryId && isOtherFactoryAcceptedPastHistoryCutoff(order, viewerFactoryId)) return false;
  return true;
}

/**
 * 履歴一覧: 手動完了 OR 予定日が昨日以前 OR キャンセル系
 * viewerFactoryId 指定時: 他工場受注は翌日0時過ぎで履歴へ
 */
export function isOrderInHistoryView(order, todayIso, viewerFactoryId) {
  if (!order) return false;
  const today = resolveTodayIso(todayIso);
  if (isOrderCancelledForHistory(order)) return true;
  if (isOrderManuallyCompleted(order)) return true;
  if (isOrderDeliveryBeforeToday(order, today)) return true;
  if (viewerFactoryId && isOtherFactoryAcceptedPastHistoryCutoff(order, viewerFactoryId)) return true;
  return false;
}

/** 履歴ソート: 予定日降順 → 作成日時降順 */
export function compareOrdersForHistoryDesc(a, b) {
  const da = getOrderDeliveryDateISO(a);
  const db = getOrderDeliveryDateISO(b);
  const aValid = isValidDeliveryDateISO(da);
  const bValid = isValidDeliveryDateISO(db);
  if (aValid && bValid && da !== db) return da < db ? 1 : -1;
  if (aValid && !bValid) return -1;
  if (!aValid && bValid) return 1;
  const ca = new Date(a?.createdAt ?? a?.created_at ?? 0).getTime();
  const cb = new Date(b?.createdAt ?? b?.created_at ?? 0).getTime();
  return cb - ca;
}

export function sortOrdersForHistory(orders) {
  return [...(orders || [])].sort(compareOrdersForHistoryDesc);
}
