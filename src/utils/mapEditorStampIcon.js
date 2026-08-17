import L from 'leaflet';
import { commentBubbleLayout } from './mapAnnotations.js';

/** このズームレベルで scale=1 のとき baseSizePx を基準にする */
export const STAMP_ICON_BASE_ZOOM = 17;
const STAMP_ICON_BASE_PX = 28;
const STAMP_ICON_MIN_PX = 12;
const STAMP_ICON_MAX_PX = 72;

export const LEAFLET_DIV_ICON_CLASS = 'map-editor-leaflet-div-icon';

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

/**
 * コメント吹き出し DivIcon。scale で文字・枠・パディングを連動。
 * @param {{ showResizeHandle?: boolean }} [options]
 */
export function createCommentDivIcon(text, scale, mapZoom, selected = false, options = {}) {
  const layout = commentBubbleLayout(text, scale, mapZoom);
  const border = selected ? '#6366f1' : '#334155';
  const showResizeHandle = Boolean(options.showResizeHandle);
  const handle = showResizeHandle
    ? `<span data-comment-resize="1" style="position:absolute;right:-6px;bottom:-6px;width:14px;height:14px;border-radius:3px;background:#6366f1;border:2px solid #fff;cursor:nwse-resize;box-shadow:0 1px 3px rgba(0,0,0,0.3);pointer-events:auto;touch-action:none;"></span>`
    : '';
  const html = `<div style="position:relative;max-width:${layout.iconW}px;padding:${layout.padY}px ${layout.padX}px;border:${layout.borderW}px solid ${border};border-radius:8px;background:rgba(255,255,255,0.96);font-size:${layout.fontSize}px;font-weight:700;line-height:1.35;color:#0f172a;box-shadow:0 2px 6px rgba(0,0,0,0.15);white-space:pre-wrap;pointer-events:auto;">${escapeHtml(layout.label)}${handle}</div>`;
  return L.divIcon({
    className: LEAFLET_DIV_ICON_CLASS,
    html,
    iconSize: [layout.iconW, layout.iconH],
    iconAnchor: [layout.iconW / 2, layout.iconH],
  });
}
