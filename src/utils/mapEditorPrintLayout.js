/** A4縦 — @page margin 8mm 差し引き後の有効高さ */
export const PRINT_PAGE_HEIGHT_MM = 281;

/** 地図のみ印刷時: 有効領域の約70% */
export const PRINT_MAP_ONLY_HEIGHT_MM = 197;

/** 地図のみ印刷時の Leaflet 初期化高さ（96dpi 基準） */
export const PRINT_MAP_HEIGHT_PX = 745;

export function mmToPrintPx(mm) {
  return Math.round((Number(mm) * 96) / 25.4);
}

export const PRINT_PAGE_HEIGHT_PX = mmToPrintPx(PRINT_PAGE_HEIGHT_MM);

/** 荷下ろしラベルの候補。先頭の右上が、収まらないときの既定 */
export const UNLOAD_LABEL_DIRECTIONS = [
  { id: 'ne', dx: 1, dy: -1 },
  { id: 'nw', dx: -1, dy: -1 },
  { id: 'se', dx: 1, dy: 1 },
  { id: 'sw', dx: -1, dy: 1 },
  { id: 'e', dx: 1, dy: 0 },
  { id: 'w', dx: -1, dy: 0 },
  { id: 'n', dx: 0, dy: -1 },
  { id: 's', dx: 0, dy: 1 },
];

function rectsOverlap(a, b, pad = 0) {
  return !(
    a.x + a.w + pad <= b.x ||
    b.x + b.w + pad <= a.x ||
    a.y + a.h + pad <= b.y ||
    b.y + b.h + pad <= a.y
  );
}

function rectEdgeToward(rect, target) {
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  const dx = target.x - cx;
  const dy = target.y - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scaleX = dx !== 0 ? rect.w / 2 / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? rect.h / 2 / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

function circleEdgeToward(center, radiusPx, from) {
  const dx = from.x - center.x;
  const dy = from.y - center.y;
  const len = Math.hypot(dx, dy) || 1;
  const radius = Math.max(0, Number(radiusPx) || 0);
  return { x: center.x + (dx / len) * radius, y: center.y + (dy / len) * radius };
}

/**
 * 荷下ろし円の中心が画面外なら null。
 * ラベルは円の縁から 70〜100px。地図内で他の印と重ならない方向を選び、無ければ右上。
 */
export function chooseUnloadLabelPlacement({
  centerX,
  centerY,
  radiusPx = 0,
  mapWidth,
  mapHeight,
  labelWidth,
  labelHeight,
  obstacles = [],
  gapPx = 85,
}) {
  const width = Number(mapWidth);
  const height = Number(mapHeight);
  const cx0 = Number(centerX);
  const cy0 = Number(centerY);
  if (!Number.isFinite(cx0) || !Number.isFinite(cy0) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return null;
  }
  if (cx0 < 0 || cy0 < 0 || cx0 > width || cy0 > height) return null;

  const gap = Math.min(100, Math.max(70, Number(gapPx) || 85));
  const reach = Math.max(0, Number(radiusPx) || 0) + gap;
  const candidates = UNLOAD_LABEL_DIRECTIONS.map((dir) => {
    const len = Math.hypot(dir.dx, dir.dy) || 1;
    const cx = cx0 + (dir.dx / len) * reach;
    const cy = cy0 + (dir.dy / len) * reach;
    const rect = {
      x: cx - labelWidth / 2,
      y: cy - labelHeight / 2,
      w: labelWidth,
      h: labelHeight,
    };
    return { id: dir.id, cx, cy, rect };
  });
  const inside = (rect) =>
    rect.x >= 2 &&
    rect.y >= 2 &&
    rect.x + rect.w <= width - 2 &&
    rect.y + rect.h <= height - 2;
  const blocked = (rect) => (obstacles || []).some((item) => item && rectsOverlap(rect, item, 6));
  const chosen = candidates.find((item) => inside(item.rect) && !blocked(item.rect)) || candidates[0];
  return {
    ...chosen,
    labelEdge: rectEdgeToward(chosen.rect, { x: cx0, y: cy0 }),
    circleEdge: circleEdgeToward({ x: cx0, y: cy0 }, radiusPx, { x: chosen.cx, y: chosen.cy }),
  };
}
