import L from 'leaflet';

/** このズームレベルで scale=1 のとき baseSizePx を基準にする */
export const STAMP_ICON_BASE_ZOOM = 17;
const STAMP_ICON_BASE_PX = 28;
const STAMP_ICON_MIN_PX = 12;
const STAMP_ICON_MAX_PX = 72;

export const LEAFLET_DIV_ICON_CLASS = 'map-editor-leaflet-div-icon';

/** 地図ズームに連動したスタンプ表示サイズ（ズームアウトで小さく、ズームインで大きく） */
export function stampIconSizePx(scale, mapZoom) {
  const sc = Number(scale) > 0 ? Number(scale) : 1;
  const z = Number.isFinite(Number(mapZoom)) ? Number(mapZoom) : STAMP_ICON_BASE_ZOOM;
  const zoomFactor = 2 ** (z - STAMP_ICON_BASE_ZOOM);
  return Math.max(
    STAMP_ICON_MIN_PX,
    Math.min(STAMP_ICON_MAX_PX, Math.round(STAMP_ICON_BASE_PX * sc * zoomFactor)),
  );
}

export function createStampDivIcon(emoji, scale, mapZoom, selected = false) {
  const size = stampIconSizePx(scale, mapZoom);
  const ring = selected
    ? 'box-shadow:0 0 0 3px rgba(99,102,241,0.55);border-radius:10px;'
    : '';
  return L.divIcon({
    className: LEAFLET_DIV_ICON_CLASS,
    html: `<div style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.88)}px;line-height:1;display:flex;align-items:center;justify-content:center;pointer-events:auto;${ring}">${emoji}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}
