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

const SNAPSHOT_MIN_SPAN_M = 180;
const SNAPSHOT_MAX_SPAN_M = 4000;
const SNAPSHOT_SPAN_PADDING = 1.3;

/**
 * 保存 PNG（800×600, 4:3）用の bounds を注釈データから算出する。
 * - 中心は applyInitialViewCenter と同じ基準（荷卸し地点 → スタンプ → コメント → center）
 * - すべてのマーカーが収まるよう表示範囲（spanM）を自動拡大する（最小180m）
 * タイル背景・マーカー描画・保存される imageOverlay.bounds はすべてこの関数の
 * 結果を共有することで、座標変換のズレを防ぐ。
 */
export function snapshotBoundsForAnnotations(annotations, aspect = 4 / 3) {
  const first = firstAnnotationLatLng(annotations);
  const centerLat = Number(first?.lat ?? annotations?.center?.lat);
  const centerLng = Number(first?.lng ?? annotations?.center?.lng);
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) return null;

  const cosLat = Math.cos((centerLat * Math.PI) / 180) || 1;
  const widthRatio = Math.max(0.5, aspect);
  let neededSpanM = 0;
  const markers = [
    ...(annotations?.unloadPoints || []),
    ...(annotations?.stamps || []),
    ...(annotations?.comments || []),
  ];
  for (const m of markers) {
    const lat = Number(m?.lat);
    const lng = Number(m?.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const dyM = Math.abs(lat - centerLat) * 111320;
    const dxM = Math.abs(lng - centerLng) * 111320 * cosLat;
    // spanM は縦方向の実距離。横方向は spanM * aspect まで収まる
    neededSpanM = Math.max(neededSpanM, dyM * 2, (dxM * 2) / widthRatio);
  }
  const spanM = Math.min(
    SNAPSHOT_MAX_SPAN_M,
    Math.max(SNAPSHOT_MIN_SPAN_M, neededSpanM * SNAPSHOT_SPAN_PADDING),
  );
  return boundsFromCenter(centerLat, centerLng, aspect, spanM);
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
  // label（納入先名称・任意）は保存・読み込みの両方で保持する
  const label = String(raw.label ?? '').trim();
  return {
    id: String(raw.id || '').trim() || createAnnotationId('unload'),
    lat: geo.lat,
    lng: geo.lng,
    radiusM: Number.isFinite(radiusM) && radiusM > 0 ? radiusM : DEFAULT_UNLOAD_RADIUS_M,
    ...(label ? { label } : {}),
  };
}

export const COMMENT_SCALE_MIN = 0.5;
export const COMMENT_SCALE_MAX = 3;
export const COMMENT_SCALE_STEP = 0.1;
export const COMMENT_ICON_BASE_ZOOM = 17;

/** コメント scale を 0.5〜3 にクランプ（未設定・非数は 1） */
export function clampCommentScale(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 1;
  return Math.min(COMMENT_SCALE_MAX, Math.max(COMMENT_SCALE_MIN, n));
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
    scale: clampCommentScale(raw.scale),
  };
}

/**
 * 地図上コメント吹き出しのフォント・枠・パディング（編集・印刷共通）。
 * scale 一つで文字サイズと枠サイズを比例させる。
 */
export function commentBubbleLayout(text, scale = 1, mapZoom = COMMENT_ICON_BASE_ZOOM) {
  const label = String(text || '').slice(0, 80);
  const sc = clampCommentScale(scale);
  const z = Number.isFinite(Number(mapZoom)) ? Number(mapZoom) : COMMENT_ICON_BASE_ZOOM;
  const zoomFactor = 2 ** (z - COMMENT_ICON_BASE_ZOOM);
  const fontSize = Math.max(9, Math.min(42, Math.round(11 * sc * zoomFactor)));
  const padX = Math.max(4, Math.round(6 * sc * zoomFactor));
  const padY = Math.max(3, Math.round(4 * sc * zoomFactor));
  const borderW = Math.max(1, Math.round(2 * Math.min(2, sc)));
  const baseW = Math.min(200, Math.max(80, label.length * 7));
  const iconW = Math.min(400, Math.max(48, Math.round(baseW * sc * zoomFactor)));
  const iconH = Math.max(20, Math.min(120, Math.round(36 * sc * zoomFactor)));
  return { label, fontSize, padX, padY, borderW, iconW, iconH, scale: sc, zoomFactor };
}

/** スナップショット / Canvas 用のコメント寸法（固定解像度向け） */
export function commentCanvasLayout(text, scale = 1) {
  const sc = clampCommentScale(scale);
  const label = String(text || '').slice(0, 120);
  return {
    label,
    fontSize: Math.max(11, Math.round(13 * sc)),
    pad: Math.max(6, Math.round(8 * sc)),
    borderW: Math.max(1, Math.round(2 * Math.min(2, sc))),
    height: Math.max(22, Math.round(28 * sc)),
    scale: sc,
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

/** jsonb が文字列や配列で返ってきた場合もオブジェクトへ揃える */
export function coerceMapAnnotationsRaw(raw) {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return coerceMapAnnotationsRaw(parsed);
    } catch {
      return null;
    }
  }
  if (Array.isArray(raw)) return null;
  if (typeof raw === 'object') return raw;
  return null;
}

export function normalizeMapAnnotations(rawInput, options = {}) {
  const raw = coerceMapAnnotationsRaw(rawInput);
  const { legacyStamps = [], projectCenter = null, imageUrl = '' } = options;
  const centerRaw = raw?.center || projectCenter || DEFAULT_MAP_CENTER;
  const center = {
    lat: Number(centerRaw?.lat ?? DEFAULT_MAP_CENTER.lat),
    lng: Number(centerRaw?.lng ?? DEFAULT_MAP_CENTER.lng),
    zoom: Number(centerRaw?.zoom ?? DEFAULT_MAP_CENTER.zoom) || 17,
  };

  const base = emptyMapAnnotations(center);
  if (!raw) {
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

function firstAnnotationLatLng(annotations) {
  const unload = (annotations?.unloadPoints || []).find(
    (u) => u && Number.isFinite(Number(u.lat)) && Number.isFinite(Number(u.lng)),
  );
  if (unload) return { lat: Number(unload.lat), lng: Number(unload.lng) };
  const stamp = (annotations?.stamps || []).find(
    (s) => s && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng)),
  );
  if (stamp) return { lat: Number(stamp.lat), lng: Number(stamp.lng) };
  const comment = (annotations?.comments || []).find(
    (c) => c && Number.isFinite(Number(c.lat)) && Number.isFinite(Number(c.lng)),
  );
  if (comment) return { lat: Number(comment.lat), lng: Number(comment.lng) };
  return null;
}

/**
 * 荷下ろし地点 → スタンプ → コメントの順で初期表示の中心にする
 * @returns {{ annotations: object, flyTarget: { lat: number, lng: number, zoom: number } | null }}
 */
export function getInitialMapViewFromAnnotations(annotations) {
  const ann = applyInitialViewCenter(annotations || emptyMapAnnotations());
  const first = firstAnnotationLatLng(ann);
  const flyTarget = first
    ? {
        lat: first.lat,
        lng: first.lng,
        zoom: Number(ann.center?.zoom) || 17,
      }
    : null;
  return { annotations: ann, flyTarget };
}

/** 荷卸し地点 → スタンプ → 注釈中心の順で projects.lat/lng 用座標を取得 */
export function pickCoordsFromMapAnnotations(annotations) {
  const first = firstAnnotationLatLng(annotations);
  if (first) return first;
  const clat = Number(annotations?.center?.lat);
  const clng = Number(annotations?.center?.lng);
  if (Number.isFinite(clat) && Number.isFinite(clng)) {
    return { lat: clat, lng: clng };
  }
  return null;
}

/** 注釈座標があれば center に反映（地図起動時の表示用） */
export function applyInitialViewCenter(annotations) {
  if (!annotations || typeof annotations !== 'object') return annotations;
  const first = firstAnnotationLatLng(annotations);
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
