import { DEFAULT_MAP_CENTER } from './mapAnnotations.js';

export function safeParseCoord(value) {
  const n = parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * 印刷用マップの初期中心（荷下ろし地点 → delivery_lat/lng → 注釈中心）
 */
export function resolvePrintMapViewport(order, annotations) {
  const firstUnload = Array.isArray(annotations?.unloadPoints) ? annotations.unloadPoints[0] : null;
  if (firstUnload) {
    const lat = safeParseCoord(firstUnload.lat);
    const lng = safeParseCoord(firstUnload.lng);
    if (lat != null && lng != null) {
      const z = safeParseCoord(annotations?.center?.zoom);
      return { lat, lng, zoom: z ?? 17 };
    }
  }

  const dlat = safeParseCoord(order?.delivery_lat ?? order?.deliveryLat);
  const dlng = safeParseCoord(order?.delivery_lng ?? order?.deliveryLng);
  if (dlat != null && dlng != null) {
    return { lat: dlat, lng: dlng, zoom: 17 };
  }

  const clat = safeParseCoord(annotations?.center?.lat);
  const clng = safeParseCoord(annotations?.center?.lng);
  if (clat != null && clng != null) {
    const z = safeParseCoord(annotations?.center?.zoom);
    return { lat: clat, lng: clng, zoom: z ?? 17 };
  }

  return {
    lat: DEFAULT_MAP_CENTER.lat,
    lng: DEFAULT_MAP_CENTER.lng,
    zoom: DEFAULT_MAP_CENTER.zoom,
  };
}
