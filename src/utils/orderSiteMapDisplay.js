import { hasSubmittedSiteMap, isLocationPendingOrder } from './orderWorkflow.js';

/** 物件・注文から座標を null セーフに取得 */
export function resolveOrderProjectCoords(order, project) {
  const latRaw =
    project?.lat ??
    project?.latitude ??
    order?.delivery_lat ??
    order?.deliveryLat ??
    order?.representative_lat ??
    order?.representativeLat ??
    order?.site_lat ??
    order?.siteLat ??
    null;
  const lngRaw =
    project?.lng ??
    project?.longitude ??
    order?.delivery_lng ??
    order?.deliveryLng ??
    order?.representative_lng ??
    order?.representativeLng ??
    order?.site_lng ??
    order?.siteLng ??
    null;
  const lat = latRaw != null && latRaw !== '' ? Number(latRaw) : NaN;
  const lng = lngRaw != null && lngRaw !== '' ? Number(lngRaw) : NaN;
  return {
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
  };
}

/** 予定日を null セーフに取得 */
export function resolveOrderScheduleMatchDate(order) {
  if (!order || typeof order !== 'object') return '';
  const raw =
    order.scheduleMatchDate ??
    order.schedule_match_date ??
    order.preferredDate ??
    order.preferred_date ??
    '';
  return raw != null ? String(raw).trim() : '';
}

/** 「📍 地図未送信」プレースホルダーを表示すべきか */
export function shouldShowMapPendingPlaceholder(order, project) {
  try {
    if (!order || typeof order !== 'object') return false;
    if (hasSubmittedSiteMap(order)) return false;
    return isLocationPendingOrder(order);
  } catch {
    return false;
  }
}
