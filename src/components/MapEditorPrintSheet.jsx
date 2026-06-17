import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { MapEditorPrintDetails } from './MapEditorPrintDetails.jsx';
import { MapEditorViewportMap } from './MapEditorViewportMap.jsx';
import { PRINT_MAP_HEIGHT_PX } from '../utils/mapEditorPrintLayout.js';

function waitForMapTiles(map, timeoutMs = 1400) {
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
    map.whenReady(() => {
      map.invalidateSize({ animate: false });
      const tileLayer = Object.values(map._layers || {}).find((l) => l?._url);
      if (tileLayer?.once) {
        tileLayer.once('load', () => {
          window.clearTimeout(timer);
          window.setTimeout(finish, 200);
        });
      } else {
        window.clearTimeout(timer);
        window.setTimeout(finish, 350);
      }
    });
  });
}

function waitForFrameHeight(el, minPx = 80, timeoutMs = 600) {
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
  const [mapFrameHeightPx, setMapFrameHeightPx] = useState(0);

  const includeMap = Boolean(session?.includeMap);
  const includeDetails = Boolean(session?.includeDetails);
  const includeBoth = includeMap && includeDetails;
  const viewport = session?.viewport;

  useLayoutEffect(() => {
    if (!session?.active || !includeMap) return undefined;

    if (!includeBoth) {
      setMapFrameHeightPx(PRINT_MAP_HEIGHT_PX);
      return undefined;
    }

    const el = mapFrameRef.current;
    if (!el) return undefined;

    const measure = () => {
      const h = Math.round(el.getBoundingClientRect().height);
      if (h >= 80) setMapFrameHeightPx(h);
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
        if (h >= 80) setMapFrameHeightPx(h);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }

      map.invalidateSize({ animate: false });
      await waitForMapTiles(map);
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

  const mapHeightPx = includeBoth
    ? mapFrameHeightPx >= 80
      ? mapFrameHeightPx
      : 0
    : PRINT_MAP_HEIGHT_PX;
  const mapFrameStyle = includeBoth
    ? undefined
    : { height: PRINT_MAP_HEIGHT_PX, minHeight: PRINT_MAP_HEIGHT_PX };

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
