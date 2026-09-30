import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LayersControl, TileLayer, useMap } from 'react-leaflet';
import {
  DEFAULT_GSI_LAYER_ID,
  GSI_ATTRIBUTION,
  GSI_TILE_LAYERS,
  getGsiTileLayer,
} from '../mapTiles.js';

const { BaseLayer } = LayersControl;

/**
 * 標準／淡色／写真の LayersControl（デフォルト＝標準）
 */
export function GsiLayersControl({
  position = 'topright',
  defaultLayerId = DEFAULT_GSI_LAYER_ID,
  onLayerChange,
  crossOrigin = 'anonymous',
}) {
  return (
    <>
      <LayersControl position={position}>
        {Object.values(GSI_TILE_LAYERS).map((layer) => (
          <BaseLayer
            key={layer.id}
            checked={layer.id === defaultLayerId}
            name={layer.name}
          >
            <TileLayer
              attribution={GSI_ATTRIBUTION}
              url={layer.url}
              maxNativeZoom={layer.maxNativeZoom}
              maxZoom={layer.maxZoom}
              crossOrigin={crossOrigin}
            />
          </BaseLayer>
        ))}
      </LayersControl>
      {onLayerChange ? (
        <BaselayerChangeBridge onLayerChange={onLayerChange} />
      ) : null}
    </>
  );
}

function BaselayerChangeBridge({ onLayerChange }) {
  const map = useMap();
  useEffect(() => {
    const handler = (e) => {
      const name = String(e?.name || '');
      const hit = Object.values(GSI_TILE_LAYERS).find((l) => l.name === name);
      if (hit) onLayerChange(hit.id);
    };
    map.on('baselayerchange', handler);
    return () => {
      map.off('baselayerchange', handler);
    };
  }, [map, onLayerChange]);
  return null;
}

/** LayersControl なしの単一タイル（印刷・ビューポート用） */
export function GsiSingleTileLayer({
  layerId = DEFAULT_GSI_LAYER_ID,
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

/**
 * タイル読み込み失敗が一定数続いたら地図上に短く表示（デバウンス）
 */
export function TileLoadErrorBanner({
  failureThreshold = 6,
  debounceMs = 1500,
  hideAfterMs = 6000,
}) {
  const map = useMap();
  const [visible, setVisible] = useState(false);
  const failCountRef = useRef(0);
  const debounceTimerRef = useRef(null);
  const hideTimerRef = useRef(null);

  useEffect(() => {
    const onTileError = () => {
      failCountRef.current += 1;
      if (failCountRef.current < failureThreshold) return;
      if (debounceTimerRef.current) return;

      debounceTimerRef.current = window.setTimeout(() => {
        debounceTimerRef.current = null;
        setVisible(true);
        if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = window.setTimeout(() => {
          setVisible(false);
          failCountRef.current = 0;
          hideTimerRef.current = null;
        }, hideAfterMs);
      }, debounceMs);
    };

    map.on('tileerror', onTileError);
    return () => {
      map.off('tileerror', onTileError);
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
  }, [map, failureThreshold, debounceMs, hideAfterMs]);

  if (!visible) return null;

  const container = map.getContainer?.();
  if (!container) return null;

  return createPortal(
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-[1000] max-w-[90%] -translate-x-1/2 rounded-md border border-amber-300 bg-amber-50/95 px-2.5 py-1.5 text-center text-[11px] font-bold text-amber-900 shadow map-tile-error-banner">
      地図の読み込みに失敗しました。通信状況を確認してください
    </div>,
    container,
  );
}
