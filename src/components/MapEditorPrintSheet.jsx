import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { MapEditorPrintDetails } from './MapEditorPrintDetails.jsx';
import { MapEditorViewportMap } from './MapEditorViewportMap.jsx';
import { PRINT_MAP_HEIGHT_PX, PRINT_PAGE_HEIGHT_PX } from '../utils/mapEditorPrintLayout.js';

/** 詳細+地図同時印刷時の地図枠フォールバック高さ（計測前・計測失敗時） */
const PRINT_BOTH_MAP_FALLBACK_PX = Math.max(280, PRINT_PAGE_HEIGHT_PX - 420);

function countLoadedTiles(map) {
  return map?.getContainer?.()?.querySelectorAll?.('img.leaflet-tile-loaded')?.length ?? 0;
}

function waitForMapTiles(map, timeoutMs = 3500) {
  return new Promise((resolve) => {
    if (!map) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);

    const tryFinish = () => {
      if (countLoadedTiles(map) >= 4) {
        window.clearTimeout(timer);
        window.setTimeout(finish, 280);
        return true;
      }
      return false;
    };

    map.whenReady(() => {
      map.invalidateSize({ animate: false });
      if (tryFinish()) return;

      const tileLayer = Object.values(map._layers || {}).find((l) => l?._url);
      const onTiles = () => {
        if (countLoadedTiles(map) >= 1) {
          window.clearTimeout(timer);
          window.setTimeout(finish, 320);
        }
      };
      if (tileLayer?.on) {
        tileLayer.on('load', onTiles);
        tileLayer.on('tileload', onTiles);
      }

      const poll = window.setInterval(() => {
        if (tryFinish()) window.clearInterval(poll);
      }, 120);
      window.setTimeout(() => window.clearInterval(poll), timeoutMs);
    });
  });
}

function waitForFrameHeight(el, minPx = 80, timeoutMs = 1200) {
  return new Promise((resolve) => {
    if (!el) {
      resolve(0);
      return;
    }
    const started = performance.now();
    const tick = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h >= minPx || performance.now() - started >= timeoutMs) {
        resolve(h);
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
  });
}

/**
 * A4運行指示書 — 画面外に配置して印刷専用 DOM を描画
 */
export const MapEditorPrintSheet = forwardRef(function MapEditorPrintSheet(
  { session, order, project, siteTitle, annotations },
  ref,
) {
  const leafletMapRef = useRef(null);
  const mapFrameRef = useRef(null);

  const includeMap = Boolean(session?.includeMap);
  const includeDetails = Boolean(session?.includeDetails);
  const includeBoth = includeMap && includeDetails;
  const viewport = session?.viewport;

  const [mapFrameHeightPx, setMapFrameHeightPx] = useState(
    () => PRINT_MAP_HEIGHT_PX,
  );

  const resolveMapHeightPx = (measuredPx) => {
    if (!includeBoth) return PRINT_MAP_HEIGHT_PX;
    if (measuredPx >= 80) return measuredPx;
    return PRINT_BOTH_MAP_FALLBACK_PX;
  };

  const applyMapFrameHeight = (h) => {
    const px = resolveMapHeightPx(h);
    if (mapFrameRef.current) {
      mapFrameRef.current.style.height = `${px}px`;
      mapFrameRef.current.style.minHeight = `${px}px`;
    }
    return px;
  };

  useLayoutEffect(() => {
    if (!session?.active || !includeMap) return undefined;

    if (!includeBoth) {
      flushSync(() => setMapFrameHeightPx(PRINT_MAP_HEIGHT_PX));
      applyMapFrameHeight(PRINT_MAP_HEIGHT_PX);
      return undefined;
    }

    flushSync(() => setMapFrameHeightPx(PRINT_BOTH_MAP_FALLBACK_PX));
    applyMapFrameHeight(PRINT_BOTH_MAP_FALLBACK_PX);

    const el = mapFrameRef.current;
    if (!el) return undefined;

    const measure = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      const px = resolveMapHeightPx(h);
      setMapFrameHeightPx((prev) => (prev !== px ? px : prev));
      applyMapFrameHeight(h);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [session?.active, session?.runId, includeMap, includeBoth, order]);

  useImperativeHandle(ref, () => ({
    invalidateMapSize() {
      const map = leafletMapRef.current;
      if (!map) return;
      map.invalidateSize({ animate: false });
    },
    async prepareForPrint() {
      const map = leafletMapRef.current;
      if (!map) return;

      if (includeBoth) {
        const h = await waitForFrameHeight(mapFrameRef.current);
        const px = applyMapFrameHeight(h);
        flushSync(() => setMapFrameHeightPx(px));
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise((r) => window.setTimeout(r, 120));
      }

      map.invalidateSize({ animate: false });
      await waitForMapTiles(map);
      map.invalidateSize({ animate: false });
      await new Promise((r) => window.setTimeout(r, 200));
    },
  }));

  if (!session?.active) return null;

  const shellClass = [
    'map-editor-print-sheet',
    includeMap && 'print-include-map',
    includeDetails && 'print-include-details',
    includeBoth && 'print-include-both',
  ]
    .filter(Boolean)
    .join(' ');

  const mapHeightPx = resolveMapHeightPx(mapFrameHeightPx);
  const mapFrameStyle = {
    height: mapHeightPx,
    minHeight: mapHeightPx,
  };

  return (
    <div className={shellClass}>
      <div className="map-editor-a4-instruction-page">
        {includeDetails ? (
          <MapEditorPrintDetails order={order} project={project} siteTitle={siteTitle} />
        ) : null}

        {includeMap ? (
          <div className="map-editor-print-map-slot">
            <p className="map-editor-print-map-caption">現場周辺地図</p>
            <div ref={mapFrameRef} className="map-editor-print-map-frame" style={mapFrameStyle}>
              <MapEditorViewportMap
                annotations={annotations}
                viewport={viewport}
                fixedHeightPx={mapHeightPx}
                onMapReady={(map) => {
                  leafletMapRef.current = map;
                }}
                mapKey={`print-${viewport?.lat}-${viewport?.lng}-${viewport?.zoom}-${includeBoth ? 'both' : 'map'}`}
                className="h-full w-full"
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
});
