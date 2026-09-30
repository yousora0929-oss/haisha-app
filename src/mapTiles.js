/** 地図ベースレイヤー定義（ストリート / 写真 / 地理院） */

export const MAP_BASE_LAYER_STORAGE_KEY = 'haisha_map_base_layer_v1';

export const MAP_BASE_LAYERS = {
  street: {
    id: 'street',
    label: 'ストリート',
    type: 'maplibre',
    style: 'https://tiles.openfreemap.org/styles/liberty',
    attribution:
      '<a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">OpenFreeMap</a> &copy; OpenMapTiles Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a>',
    attributionPlain: 'OpenFreeMap / OpenMapTiles / OpenStreetMap',
  },
  photo: {
    id: 'photo',
    label: '写真',
    type: 'raster',
    url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
    maxNativeZoom: 18,
    maxZoom: 20,
    attribution:
      '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地理院タイル</a>',
    attributionPlain: '地理院タイル（写真）',
  },
  gsi: {
    id: 'gsi',
    label: '地理院',
    type: 'raster',
    url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
    maxNativeZoom: 18,
    maxZoom: 20,
    attribution:
      '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地理院タイル</a>',
    attributionPlain: '地理院タイル',
  },
};

/** 既定はストリート（保存・印刷は raster フォールバック） */
export const DEFAULT_MAP_BASE_LAYER_ID = 'street';

/** @deprecated 互換エイリアス */
export const DEFAULT_GSI_LAYER_ID = DEFAULT_MAP_BASE_LAYER_ID;

/**
 * 旧 ID（std / pale / seamlessphoto）も正規化する
 * @param {unknown} id
 */
export function normalizeMapBaseLayerId(id) {
  const raw = String(id || '').trim();
  if (raw === 'std' || raw === 'pale') return 'gsi';
  if (raw === 'seamlessphoto') return 'photo';
  if (MAP_BASE_LAYERS[raw]) return raw;
  return DEFAULT_MAP_BASE_LAYER_ID;
}

export function getMapBaseLayer(layerId = DEFAULT_MAP_BASE_LAYER_ID) {
  return MAP_BASE_LAYERS[normalizeMapBaseLayerId(layerId)];
}

export function readStoredMapBaseLayerId() {
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_MAP_BASE_LAYER_ID;
    return normalizeMapBaseLayerId(localStorage.getItem(MAP_BASE_LAYER_STORAGE_KEY));
  } catch {
    return DEFAULT_MAP_BASE_LAYER_ID;
  }
}

export function writeStoredMapBaseLayerId(layerId) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(MAP_BASE_LAYER_STORAGE_KEY, normalizeMapBaseLayerId(layerId));
  } catch {
    /* ignore */
  }
}

/**
 * 保存PNG・印刷用: street(WebGL) は安定のため地理院ラスターへ逃がす
 * @returns {{ layer: typeof MAP_BASE_LAYERS[string], usedFallback: boolean }}
 */
export function resolveRasterLayerForExport(layerId) {
  const id = normalizeMapBaseLayerId(layerId);
  if (id === 'photo') {
    return { layer: MAP_BASE_LAYERS.photo, usedFallback: false };
  }
  if (id === 'gsi') {
    return { layer: MAP_BASE_LAYERS.gsi, usedFallback: false };
  }
  return { layer: MAP_BASE_LAYERS.gsi, usedFallback: true };
}

/** スナップショット用タイル URL */
export function buildRasterTileUrl(z, x, y, layerId = DEFAULT_MAP_BASE_LAYER_ID) {
  const { layer } = resolveRasterLayerForExport(layerId);
  return String(layer.url || '')
    .replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}

/** @deprecated 旧 API 互換 */
export function getGsiTileLayer(layerId) {
  const { layer } = resolveRasterLayerForExport(layerId);
  return {
    id: layer.id,
    name: layer.label,
    url: layer.url,
    maxNativeZoom: layer.maxNativeZoom ?? 18,
    maxZoom: layer.maxZoom ?? 20,
    attribution: layer.attribution,
  };
}

/** @deprecated */
export function buildGsiTileUrl(z, x, y, layerId) {
  return buildRasterTileUrl(z, x, y, layerId);
}

/** @deprecated 旧 LayersControl 用 */
export const GSI_ATTRIBUTION = MAP_BASE_LAYERS.gsi.attribution;
export const GSI_TILE_LAYERS = {
  std: getGsiTileLayer('gsi'),
  pale: getGsiTileLayer('gsi'),
  seamlessphoto: getGsiTileLayer('photo'),
};
