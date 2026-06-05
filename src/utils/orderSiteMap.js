import { hasSubmittedSiteMap, isLocationPendingOrder } from './orderWorkflow.js';

function parseCoord(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickCoordPair(latRaw, lngRaw) {
  const lat = parseCoord(latRaw);
  const lng = parseCoord(lngRaw);
  if (lat == null || lng == null) return null;
  return { lat, lng };
}

/** 注文・物件マスタから地図表示用の緯度経度を解決 */
export function resolveOrderMapCoords(order, project) {
  const candidates = [
    [order?.delivery_lat, order?.delivery_lng],
    [order?.deliveryLat, order?.deliveryLng],
    [order?.lat, order?.lng],
    [order?.latitude, order?.longitude],
    [order?.representative_lat, order?.representative_lng],
    [order?.representativeLat, order?.representativeLng],
    [order?.rough_lat, order?.rough_lng],
    [project?.lat, project?.lng],
    [project?.latitude, project?.longitude],
  ];
  for (const [latRaw, lngRaw] of candidates) {
    const pair = pickCoordPair(latRaw, lngRaw);
    if (pair) return pair;
  }
  return null;
}

/** 地図画像 URL（override / エディタオーバーレイ等） */
export function resolveOrderMapImageUrl(order) {
  if (!order || typeof order !== 'object') return '';
  const direct = String(
    order.override_map_image_url ??
      order.overrideMapImageUrl ??
      order.map_image_url ??
      order.mapImageUrl ??
      '',
  ).trim();
  if (direct) return direct;
  const ann = order.map_annotations ?? order.mapAnnotations;
  if (ann && typeof ann === 'object') {
    const overlay = String(ann.imageOverlay?.url ?? '').trim();
    if (overlay) return overlay;
  }
  return '';
}

/** 地図エリアに実データを描画できるか（座標 or 画像 URL） */
export function hasOrderSiteMapDisplay(order, project) {
  if (resolveOrderMapCoords(order, project)) return true;
  if (resolveOrderMapImageUrl(order)) return true;
  return false;
}

/** 地図関連データの有無（座標・画像・エディタ送付済み） */
export function hasOrderSiteMapData(order, project) {
  if (hasOrderSiteMapDisplay(order, project)) return true;
  if (hasSubmittedSiteMap(order)) return true;
  return false;
}

/** プレースホルダー補足文 */
export function resolveOrderMapPlaceholderHint(order, project) {
  if (isLocationPendingOrder(order)) {
    return '（現場地図がまだ送信されていません）';
  }
  const projectId = String(order?.project_id ?? order?.projectId ?? '').trim();
  if (projectId) {
    if (!resolveOrderMapCoords(null, project) && !resolveOrderMapImageUrl(order)) {
      return '（物件マスタに位置情報が設定されていません）';
    }
  }
  return '（位置情報または地図画像が未登録です）';
}
