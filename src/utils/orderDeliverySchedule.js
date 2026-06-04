import { todayLocalISODate } from '../haishaConstants.js';

/** 予定日（delivery_date / preferredDate）を YYYY-MM-DD で取得 */
export function getOrderDeliveryDateISO(order) {
  return String(order?.delivery_date ?? order?.preferredDate ?? order?.preferred_date ?? '').slice(0, 10);
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
export function isOrderDeliveryOnOrAfterToday(order, todayIso = todayLocalISODate()) {
  const d = getOrderDeliveryDateISO(order);
  if (!isValidDeliveryDateISO(d)) return true;
  return d >= todayIso;
}

/** 予定日が今日より過去（昨日以前） */
export function isOrderDeliveryBeforeToday(order, todayIso = todayLocalISODate()) {
  const d = getOrderDeliveryDateISO(order);
  if (!isValidDeliveryDateISO(d)) return false;
  return d < todayIso;
}

/**
 * 進行中一覧: 手動完了・キャンセル以外で、予定日が今日以降（または未設定）
 */
export function isOrderInProgressView(order, todayIso = todayLocalISODate()) {
  if (!order) return false;
  if (isOrderCancelledForHistory(order)) return false;
  if (isOrderManuallyCompleted(order)) return false;
  if (isOrderDeliveryBeforeToday(order, todayIso)) return false;
  return true;
}

/**
 * 履歴一覧: 手動完了 OR 予定日が昨日以前 OR キャンセル系
 */
export function isOrderInHistoryView(order, todayIso = todayLocalISODate()) {
  if (!order) return false;
  if (isOrderCancelledForHistory(order)) return true;
  if (isOrderManuallyCompleted(order)) return true;
  if (isOrderDeliveryBeforeToday(order, todayIso)) return true;
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
