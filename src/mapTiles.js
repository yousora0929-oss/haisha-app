/** 国土地理院タイル（Leaflet 共通設定） */

export const GSI_ATTRIBUTION =
  '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener noreferrer">地理院タイル</a>';

export const GSI_TILE_COMMON = {
  maxNativeZoom: 18,
  maxZoom: 20,
  attribution: GSI_ATTRIBUTION,
};

/** @type {Record<string, { id: string, name: string, url: string, maxNativeZoom: number, maxZoom: number, attribution: string }>} */
export const GSI_TILE_LAYERS = {
  std: {
    id: 'std',
    name: '標準',
    url: 'https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png',
    ...GSI_TILE_COMMON,
  },
  pale: {
    id: 'pale',
    name: '淡色',
    url: 'https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png',
    ...GSI_TILE_COMMON,
  },
  seamlessphoto: {
    id: 'seamlessphoto',
    name: '写真',
    url: 'https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg',
    ...GSI_TILE_COMMON,
  },
};

export const DEFAULT_GSI_LAYER_ID = 'std';

export function getGsiTileLayer(layerId = DEFAULT_GSI_LAYER_ID) {
  return GSI_TILE_LAYERS[layerId] || GSI_TILE_LAYERS.std;
}

/** スナップショット用: Leaflet URL テンプレの {z}/{x}/{y} を埋める */
export function buildGsiTileUrl(z, x, y, layerId = DEFAULT_GSI_LAYER_ID) {
  const layer = getGsiTileLayer(layerId);
  return layer.url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}
