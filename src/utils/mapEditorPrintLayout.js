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
