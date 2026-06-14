import { parseSpotThresholdVolume } from './deliveryAreas.js';

/** 現場地図が送付済みか（地図待ちバッジ解除の判定用） */
export function hasSubmittedSiteMap(order) {
  if (!order || typeof order !== 'object') return false;
  const url = String(
    order.override_map_image_url ?? order.overrideMapImageUrl ?? order.map_image_url ?? order.mapImageUrl ?? '',
  ).trim();
  if (url) return true;
  if (order.map_submitted_at || order.mapSubmittedAt) return true;
  const ann = order.map_annotations ?? order.mapAnnotations;
  if (ann && typeof ann === 'object') {
    if (String(ann.imageOverlay?.url || '').trim()) return true;
    const n =
      (Array.isArray(ann.stamps) ? ann.stamps.length : 0) +
      (Array.isArray(ann.unloadPoints) ? ann.unloadPoints.length : 0) +
      (Array.isArray(ann.comments) ? ann.comments.length : 0);
    if (n > 0) return true;
  }
  const legacyStamps = order.map_stamps ?? order.mapStamps;
  if (Array.isArray(legacyStamps) && legacyStamps.length > 0) return true;
  return false;
}

export function isLocationPendingOrder(order) {
  if (hasSubmittedSiteMap(order)) return false;
  return Boolean(order?.is_location_pending ?? order?.isLocationPending);
}

export function resolveInitialOrderStatus({ isSpot, totalVolumeM3, spotThresholdVolume }) {
  const threshold = parseSpotThresholdVolume(spotThresholdVolume);
  const vol = Number(totalVolumeM3);
  if (isSpot && Number.isFinite(vol) && vol > threshold) {
    return 'pending_association';
  }
  return 'pending';
}

export function sumOrderVolumesM3(orders) {
  return (Array.isArray(orders) ? orders : []).reduce((sum, o) => {
    const n = Number(o?.quantityM3 ?? o?.quantityCube ?? 0);
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

export function orderStatusBlocksFactoryDispatch(status) {
  return String(status || '').trim() === 'pending_association';
}

/** 顧客画面のステータス表示用（status 列と factoryResponseStatus の整合） */
export function resolveOrderDisplayStatus(order) {
  if (!order || typeof order !== 'object') return 'pending';
  const status = String(order.status || '').trim();
  const factoryResponse = String(order.factoryResponseStatus || '').trim();

  if (status === 'customer_cancelled' || factoryResponse === 'customer_cancelled') return 'customer_cancelled';
  if (status === 'deleted') return 'deleted';
  if (['completed', 'complete', 'done', 'delivered'].includes(status)) return status;
  if (status === 'accepted' || factoryResponse === 'accepted') return 'accepted';
  if (factoryResponse === 'rejected') return 'rejected';
  if (factoryResponse === 'pending') return 'pending';
  if (status === 'pending_association') return 'pending_association';
  return status || factoryResponse || 'pending';
}
