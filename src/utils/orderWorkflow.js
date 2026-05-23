import { parseSpotThresholdVolume } from './deliveryAreas.js';

export function isLocationPendingOrder(order) {
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
