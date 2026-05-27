import { MAP_STAMP_TYPES } from '../mapEditorConstants.js';

export const MAP_ANNOTATION_VERSION = 1;
export const DEFAULT_MAP_CENTER = { lat: 33.238, lng: 131.609, zoom: 17 };
export const DEFAULT_UNLOAD_RADIUS_M = 12;

export function createAnnotationId(prefix) {
  const p = String(prefix || 'ann').trim() || 'ann';
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${p}_${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${p}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function emptyMapAnnotations(center = DEFAULT_MAP_CENTER) {
  const c = center && Number.isFinite(center.lat) && Number.isFinite(center.lng)
    ? { lat: Number(center.lat), lng: Number(center.lng), zoom: Number(center.zoom) || 17 }
    : { ...DEFAULT_MAP_CENTER };
  return {
    version: MAP_ANNOTATION_VERSION,
    center: c,
    imageOverlay: null,
    stamps: [],
    unloadPoints: [],
    comments: [],
  };
}

function clampLatLng(lat, lng) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: la, lng: ln };
}

function normalizeBounds(raw) {
  if (!Array.isArray(raw) || raw.length !== 2) return null;
  const sw = clampLatLng(raw[0]?.[0] ?? raw[0]?.lat, raw[0]?.[1] ?? raw[0]?.lng);
  const ne = clampLatLng(raw[1]?.[0] ?? raw[1]?.lat, raw[1]?.[1] ?? raw[1]?.lng);
  if (!sw || !ne) return null;
  return [
    [sw.lat, sw.lng],
    [ne.lat, ne.lng],
  ];
}

/** 中心座標と画像アスペクトから ImageOverlay 用 bounds を生成 */
export function boundsFromCenter(lat, lng, aspect = 4 / 3, spanM = 180) {
  const la = Number(lat);
  const ln = Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  const latDelta = spanM / 111320;
  const lngDelta = (spanM * Math.max(0.5, aspect)) / (111320 * Math.cos((la * Math.PI) / 180));
  return [
    [la - latDelta / 2, ln - lngDelta / 2],
    [la + latDelta / 2, ln + lngDelta / 2],
  ];
}

/** 正規化座標 0〜1 を bounds 内の緯度経度へ */
export function ratioToLatLng(x, y, bounds) {
  const b = normalizeBounds(bounds);
  if (!b) return null;
  const [[sLat, sLng], [nLat, nLng]] = b;
  const rx = Math.min(1, Math.max(0, Number(x)));
  const ry = Math.min(1, Math.max(0, Number(y)));
  return {
    lat: nLat - ry * (nLat - sLat),
    lng: sLng + rx * (nLng - sLng),
  };
}

export function latLngToRatio(lat, lng, bounds) {
  const b = normalizeBounds(bounds);
  const p = clampLatLng(lat, lng);
  if (!b || !p) return null;
  const [[sLat, sLng], [nLat, nLng]] = b;
  const x = (p.lng - sLng) / (nLng - sLng || 1);
  const y = (nLat - p.lat) / (nLat - sLat || 1);
  return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
}

function normalizeStamp(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '').trim();
  if (!MAP_STAMP_TYPES.includes(type)) return null;

  const scale = Number(raw.scale);
  const id = String(raw.id || '').trim() || createAnnotationId('stamp');

  const geo = clampLatLng(raw.lat, raw.lng);
  if (geo) {
    return { id, type, lat: geo.lat, lng: geo.lng, scale: Number.isFinite(scale) && scale > 0 ? scale : 1 };
  }

  const x = Number(raw.x);
  const y = Number(raw.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return { id, type, x, y, scale: Number.isFinite(scale) && scale > 0 ? scale : 1, _legacyRatio: true };
  }
  return null;
}

function normalizeUnload(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const geo = clampLatLng(raw.lat, raw.lng);
  if (!geo) return null;
  const radiusM = Number(raw.radiusM ?? raw.radius);
  return {
    id: String(raw.id || '').trim() || createAnnotationId('unload'),
    lat: geo.lat,
    lng: geo.lng,
    radiusM: Number.isFinite(radiusM) && radiusM > 0 ? radiusM : DEFAULT_UNLOAD_RADIUS_M,
  };
}

function normalizeComment(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const geo = clampLatLng(raw.lat, raw.lng);
  const text = String(raw.text ?? '').trim();
  if (!geo || !text) return null;
  return {
    id: String(raw.id || '').trim() || createAnnotationId('comment'),
    lat: geo.lat,
    lng: geo.lng,
    text,
  };
}

/** レガシー stamps（x,y 比率）を緯度経度付きへ変換 */
export function resolveAnnotationsGeo(annotations, bounds) {
  const b = normalizeBounds(bounds);
  if (!b) return annotations;
  const stamps = (annotations.stamps || []).map((s) => {
    if (s._legacyRatio && Number.isFinite(s.x) && Number.isFinite(s.y)) {
      const g = ratioToLatLng(s.x, s.y, b);
      if (!g) return s;
      const { _legacyRatio, x, y, ...rest } = s;
      return { ...rest, lat: g.lat, lng: g.lng };
    }
    return s;
  });
  return { ...annotations, stamps };
}

export function normalizeMapAnnotations(raw, options = {}) {
  const { legacyStamps = [], projectCenter = null, imageUrl = '' } = options;
  const centerRaw = raw?.center || projectCenter || DEFAULT_MAP_CENTER;
  const center = {
    lat: Number(centerRaw?.lat ?? DEFAULT_MAP_CENTER.lat),
    lng: Number(centerRaw?.lng ?? DEFAULT_MAP_CENTER.lng),
    zoom: Number(centerRaw?.zoom ?? DEFAULT_MAP_CENTER.zoom) || 17,
  };

  const base = emptyMapAnnotations(center);
  if (!raw || typeof raw !== 'object') {
    if (legacyStamps.length) {
      const bounds = boundsFromCenter(center.lat, center.lng);
      const stamps = legacyStamps
        .map((s) => normalizeStamp(s))
        .filter(Boolean);
      return resolveAnnotationsGeo({ ...base, stamps }, bounds);
    }
    return base;
  }

  const imageOverlay =
    raw.imageOverlay && typeof raw.imageOverlay === 'object'
      ? {
          url: String(raw.imageOverlay.url || imageUrl || '').trim(),
          bounds: normalizeBounds(raw.imageOverlay.bounds),
        }
      : imageUrl
        ? { url: String(imageUrl).trim(), bounds: normalizeBounds(raw.imageOverlay?.bounds) }
        : null;

  const bounds =
    imageOverlay?.bounds || boundsFromCenter(center.lat, center.lng);

  let stamps = (Array.isArray(raw.stamps) ? raw.stamps : [])
    .map((s) => normalizeStamp(s))
    .filter(Boolean);
  if (!stamps.length && legacyStamps.length) {
    stamps = legacyStamps.map((s) => normalizeStamp(s)).filter(Boolean);
  }
  stamps = resolveAnnotationsGeo({ stamps }, bounds).stamps;

  const unloadPoints = (Array.isArray(raw.unloadPoints) ? raw.unloadPoints : [])
    .map((u) => normalizeUnload(u))
    .filter(Boolean);

  const comments = (Array.isArray(raw.comments) ? raw.comments : [])
    .map((c) => normalizeComment(c))
    .filter(Boolean);

  return applyInitialViewCenter({
    version: MAP_ANNOTATION_VERSION,
    center,
    imageOverlay: imageOverlay?.url && imageOverlay.bounds ? imageOverlay : null,
    stamps,
    unloadPoints,
    comments,
  });
}

const MIN_BOUNDS_SPAN_DEG = 0.00045; /* 約50m — 単一点でも fitBounds 可能に */

function metersToLatDelta(m) {
  return Number(m) / 111320;
}

function metersToLngDelta(m, lat) {
  const la = Number(lat);
  const cos = Number.isFinite(la) ? Math.cos((la * Math.PI) / 180) : 1;
  return Number(m) / (111320 * Math.max(0.2, Math.abs(cos)));
}

/** stamps / unloadPoints / comments に緯度経度付きの要素があるか */
export function hasAnnotationGeoFeatures(annotations) {
  if (!annotations || typeof annotations !== 'object') return false;
  const hasStamp = (annotations.stamps || []).some(
    (s) => s && Number.isFinite(s.lat) && Number.isFinite(s.lng),
  );
  const hasUnload = (annotations.unloadPoints || []).some(
    (u) => u && Number.isFinite(u.lat) && Number.isFinite(u.lng),
  );
  const hasComment = (annotations.comments || []).some(
    (c) => c && Number.isFinite(c.lat) && Number.isFinite(c.lng),
  );
  return hasStamp || hasUnload || hasComment;
}

/**
 * スタンプ・荷下ろし（半径込み）・コメントの LatLng から Leaflet fitBounds 用 bounds
 * @returns {[[number, number], [number, number]] | null} [[south, west], [north, east]]
 */
export function boundsFromAnnotations(annotations) {
  if (!annotations || typeof annotations !== 'object') return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;

  const include = (lat, lng) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  };

  for (const s of annotations.stamps || []) {
    include(Number(s.lat), Number(s.lng));
  }
  for (const c of annotations.comments || []) {
    include(Number(c.lat), Number(c.lng));
  }
  for (const u of annotations.unloadPoints || []) {
    const la = Number(u.lat);
    const ln = Number(u.lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) continue;
    const r = Number(u.radiusM ?? u.radius);
    const radiusM = Number.isFinite(r) && r > 0 ? r : DEFAULT_UNLOAD_RADIUS_M;
    include(la, ln);
    include(la + metersToLatDelta(radiusM), ln);
    include(la - metersToLatDelta(radiusM), ln);
    include(la, ln + metersToLngDelta(radiusM, la));
    include(la, ln - metersToLngDelta(radiusM, la));
  }

  if (!Number.isFinite(minLat)) return null;

  if (maxLat - minLat < MIN_BOUNDS_SPAN_DEG) {
    const pad = (MIN_BOUNDS_SPAN_DEG - (maxLat - minLat)) / 2;
    minLat -= pad;
    maxLat += pad;
  }
  if (maxLng - minLng < MIN_BOUNDS_SPAN_DEG) {
    const pad = (MIN_BOUNDS_SPAN_DEG - (maxLng - minLng)) / 2;
    minLng -= pad;
    maxLng += pad;
  }

  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}

/** fitBounds 用パディング（px）とモバイル時の追加ズームアウト */
export function getAnnotationFitBoundsOptions(annotations, { isMobile = false } = {}) {
  const savedZoom = Number(annotations?.center?.zoom);
  const maxZoom = Number.isFinite(savedZoom) && savedZoom > 0 ? savedZoom : 18;
  return {
    padding: isMobile ? [56, 56] : [36, 36],
    maxZoom: isMobile ? Math.max(10, maxZoom - 1) : maxZoom,
    extraZoomOut: isMobile ? 1 : 0,
  };
}

/**
 * 荷下ろし地点（赤〇）があれば center に反映。flyTarget はアノテーションが無いときのみ（全体 fitBounds と競合しない）
 * @returns {{ annotations: object, flyTarget: { lat: number, lng: number, zoom: number } | null }}
 */
export function getInitialMapViewFromAnnotations(annotations) {
  const ann = applyInitialViewCenter(annotations || emptyMapAnnotations());
  const first = ann.unloadPoints?.[0];
  const flyTarget =
    !hasAnnotationGeoFeatures(ann) &&
    first &&
    Number.isFinite(first.lat) &&
    Number.isFinite(first.lng)
      ? {
          lat: first.lat,
          lng: first.lng,
          zoom: Number(ann.center?.zoom) || 17,
        }
      : null;
  return { annotations: ann, flyTarget };
}

/** unloadPoints 先頭の座標を center に反映（地図起動時の表示用） */
export function applyInitialViewCenter(annotations) {
  if (!annotations || typeof annotations !== 'object') return annotations;
  const first = (annotations.unloadPoints || []).find(
    (u) => u && Number.isFinite(u.lat) && Number.isFinite(u.lng),
  );
  if (!first) return annotations;
  const zoom = Number(annotations.center?.zoom) || 17;
  return {
    ...annotations,
    center: { lat: first.lat, lng: first.lng, zoom },
  };
}

/** map_annotations からレガシー map_stamps（x,y）を生成（互換用） */
export function annotationsToLegacyStamps(annotations) {
  const bounds = annotations?.imageOverlay?.bounds || boundsFromCenter(
    annotations?.center?.lat,
    annotations?.center?.lng,
  );
  return (annotations?.stamps || [])
    .map((s) => {
      if (Number.isFinite(s.lat) && Number.isFinite(s.lng) && bounds) {
        const r = latLngToRatio(s.lat, s.lng, bounds);
        if (!r) return null;
        return { type: s.type, x: r.x, y: r.y, scale: s.scale };
      }
      if (Number.isFinite(s.x) && Number.isFinite(s.y)) {
        return { type: s.type, x: s.x, y: s.y, scale: s.scale };
      }
      return null;
    })
    .filter(Boolean);
}
