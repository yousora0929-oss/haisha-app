/**
 * 後方互換の薄い再エクスポート（新規は MapBaseLayerSwitch を使う）
 */
export {
  MapBaseLayerController as GsiSingleTileLayerCompat,
  TileLoadErrorBanner,
} from './MapBaseLayerSwitch.jsx';

import React from 'react';
import { TileLayer } from 'react-leaflet';
import { DEFAULT_MAP_BASE_LAYER_ID, GSI_ATTRIBUTION, getGsiTileLayer } from '../mapTiles.js';

/** @deprecated LayersControl は MapBaseLayerSwitch に置換済み */
export function GsiLayersControl() {
  return null;
}

/** LayersControl なしの単一タイル（互換） */
export function GsiSingleTileLayer({
  layerId = DEFAULT_MAP_BASE_LAYER_ID,
  crossOrigin,
  updateWhenIdle,
  keepBuffer,
}) {
  const layer = getGsiTileLayer(layerId);
  return (
    <TileLayer
      attribution={GSI_ATTRIBUTION}
      url={layer.url}
      maxNativeZoom={layer.maxNativeZoom}
      maxZoom={layer.maxZoom}
      {...(crossOrigin != null ? { crossOrigin } : {})}
      {...(updateWhenIdle != null ? { updateWhenIdle } : {})}
      {...(keepBuffer != null ? { keepBuffer } : {})}
    />
  );
}
