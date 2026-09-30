import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import { ensureMaplibreWorker } from '../maplibreSetup.js';
import { maplibreGL } from '@maplibre/maplibre-gl-leaflet';
import {
  DEFAULT_MAP_BASE_LAYER_ID,
  MAP_BASE_LAYERS,
  getMapBaseLayer,
  normalizeMapBaseLayerId,
} from '../mapTiles.js';

ensureMaplibreWorker();

const STREET_LOAD_TIMEOUT_MS = 8000;

function supportsWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(
      canvas.getContext('webgl') || canvas.getContext('experimental-webgl'),
    );
  } catch {
    return false;
  }
}

function createRasterLayer(def) {
  return L.tileLayer(def.url, {
    attribution: def.attribution,
    maxNativeZoom: def.maxNativeZoom ?? 18,
    maxZoom: def.maxZoom ?? 20,
    crossOrigin: 'anonymous',
  });
}

function createStreetLayer(def) {
  return maplibreGL({
    style: def.style,
    attribution: def.attribution,
    preserveDrawingBuffer: true,
    interactive: false,
  });
}

/**
 * ストリート／写真／地理院／淡色のセグメント切替 UI
 */
export function MapBaseLayerSwitch({
  layerId = DEFAULT_MAP_BASE_LAYER_ID,
  onChange,
  disabled = false,
  className = '',
}) {
  const current = normalizeMapBaseLayerId(layerId);
  return (
    <div
      className={
        'map-editor-no-print map-base-layer-switch pointer-events-auto inline-flex max-w-full flex-wrap overflow-hidden rounded-xl border-2 border-slate-300 bg-white/95 shadow-md backdrop-blur dark:border-slate-600 dark:bg-slate-900/95 ' +
        className
      }
      role="group"
      aria-label="地図の種類"
    >
      {Object.values(MAP_BASE_LAYERS).map((layer) => {
        const pressed = current === layer.id;
        return (
          <button
            key={layer.id}
            type="button"
            disabled={disabled}
            aria-pressed={pressed}
            onClick={() => onChange?.(layer.id)}
            className={
              'min-h-[40px] min-w-[3.75rem] flex-1 basis-[calc(50%-1px)] px-2 text-[11px] font-black transition active:scale-[0.98] disabled:opacity-50 sm:min-w-[4.75rem] sm:basis-auto sm:text-xs ' +
              (pressed
                ? 'bg-indigo-600 text-white'
                : 'bg-transparent text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800')
            }
          >
            {layer.label}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Leaflet 地図上にベースレイヤーを載せる（useMap）
 * forceRaster: 印刷・プレビュー用。street は地理院ラスターへ逃がす
 */
export function MapBaseLayerController({
  layerId = DEFAULT_MAP_BASE_LAYER_ID,
  forceRaster = false,
  onFallbackToGsi,
}) {
  const map = useMap();
  const layerRef = useRef(null);
  const [notice, setNotice] = useState('');
  const generatingRef = useRef(0);
  const onFallbackRef = useRef(onFallbackToGsi);
  onFallbackRef.current = onFallbackToGsi;

  useEffect(() => {
    let cancelled = false;
    const gen = ++generatingRef.current;
    setNotice('');
    /** @type {ReturnType<typeof setTimeout> | null} */
    let loadTimer = null;
    /** @type {(() => void) | null} */
    let detachGlListeners = null;

    const removeCurrent = () => {
      if (detachGlListeners) {
        try {
          detachGlListeners();
        } catch {
          /* ignore */
        }
        detachGlListeners = null;
      }
      if (layerRef.current) {
        try {
          map.removeLayer(layerRef.current);
        } catch {
          /* ignore */
        }
        layerRef.current = null;
      }
    };

    const addGsiFallback = (reason) => {
      if (cancelled || gen !== generatingRef.current) return;
      removeCurrent();
      const gsi = createRasterLayer(MAP_BASE_LAYERS.gsi);
      gsi.addTo(map);
      layerRef.current = gsi;
      setNotice('ストリート地図を表示できないため地理院に切り替えました');
      console.warn('[MapBaseLayerController] fallback to gsi', reason);
      onFallbackRef.current?.('gsi');
    };

    const waitForStreetReady = (glMap) =>
      new Promise((resolve, reject) => {
        if (!glMap) {
          reject(new Error('maplibre-map-missing'));
          return;
        }
        if (glMap.loaded?.()) {
          resolve();
          return;
        }

        let settled = false;
        const finishOk = () => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve();
        };
        const finishErr = (err) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err?.message || err || 'maplibre-error')));
        };

        const onLoad = () => finishOk();
        const onIdle = () => finishOk();
        const onError = (ev) => {
          const err = ev?.error || ev;
          const msg = String(err?.message || err || '');
          finishErr(err || new Error(msg || 'maplibre-error'));
        };

        const cleanup = () => {
          try {
            glMap.off('load', onLoad);
            glMap.off('idle', onIdle);
            glMap.off('error', onError);
          } catch {
            /* ignore */
          }
          if (loadTimer) {
            window.clearTimeout(loadTimer);
            loadTimer = null;
          }
        };

        glMap.on('load', onLoad);
        glMap.on('idle', onIdle);
        glMap.on('error', onError);
        detachGlListeners = cleanup;

        loadTimer = window.setTimeout(() => {
          finishErr(new Error('style-load-timeout'));
        }, STREET_LOAD_TIMEOUT_MS);
      });

    const apply = async () => {
      removeCurrent();
      const id = normalizeMapBaseLayerId(layerId);
      const effectiveId = forceRaster && id === 'street' ? 'gsi' : id;
      const def = getMapBaseLayer(effectiveId);

      try {
        if (def.type === 'maplibre') {
          if (!supportsWebGL()) {
            addGsiFallback('webgl-unavailable');
            return;
          }
          ensureMaplibreWorker();
          const glLayer = createStreetLayer(def);
          glLayer.addTo(map);
          layerRef.current = glLayer;

          const glMap = glLayer.getMaplibreMap?.();
          try {
            await waitForStreetReady(glMap);
          } catch (err) {
            if (cancelled || gen !== generatingRef.current) return;
            addGsiFallback(err);
            return;
          }

          if (cancelled || gen !== generatingRef.current) {
            try {
              map.removeLayer(glLayer);
            } catch {
              /* ignore */
            }
            return;
          }

          // 以降の非同期エラー（タイル／スタイル後続失敗）もフォールバック
          if (glMap) {
            const onLateError = (ev) => {
              if (cancelled || gen !== generatingRef.current) return;
              console.warn('[MapBaseLayerController] late maplibre error', ev?.error || ev);
              addGsiFallback(ev?.error || ev || new Error('late-maplibre-error'));
            };
            glMap.on('error', onLateError);
            const prevDetach = detachGlListeners;
            detachGlListeners = () => {
              try {
                glMap.off('error', onLateError);
              } catch {
                /* ignore */
              }
              prevDetach?.();
            };
          }
        } else {
          const raster = createRasterLayer(def);
          raster.addTo(map);
          layerRef.current = raster;
        }
      } catch (err) {
        if (cancelled || gen !== generatingRef.current) return;
        if (normalizeMapBaseLayerId(layerId) === 'street') {
          addGsiFallback(err);
        } else {
          console.warn('[MapBaseLayerController] layer failed', err);
          setNotice('地図の読み込みに失敗しました。別の地図に切り替えてください');
        }
      }
    };

    void apply();

    return () => {
      cancelled = true;
      if (loadTimer) window.clearTimeout(loadTimer);
      removeCurrent();
    };
  }, [map, layerId, forceRaster]);

  if (!notice) return null;
  const container = map.getContainer?.();
  if (!container) return null;
  return createPortal(
    <div className="map-editor-no-print map-tile-error-banner pointer-events-none absolute bottom-3 left-1/2 z-[1000] max-w-[92%] -translate-x-1/2 rounded-md border border-amber-300 bg-amber-50/95 px-2.5 py-1.5 text-center text-[11px] font-bold text-amber-900 shadow dark:border-amber-700 dark:bg-amber-950/90 dark:text-amber-100">
      {notice}
    </div>,
    container,
  );
}

/**
 * raster の tileerror を検知し、一定数失敗したら表示
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
    <div className="map-editor-no-print map-tile-error-banner pointer-events-none absolute bottom-12 left-1/2 z-[1000] max-w-[90%] -translate-x-1/2 rounded-md border border-amber-300 bg-amber-50/95 px-2.5 py-1.5 text-center text-[11px] font-bold text-amber-900 shadow dark:border-amber-700 dark:bg-amber-950/90 dark:text-amber-100">
      地図の読み込みに失敗しました。別の地図に切り替えてください
    </div>,
    container,
  );
}
