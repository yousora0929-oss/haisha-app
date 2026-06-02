import React, { forwardRef, useImperativeHandle, useRef } from 'react';
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

/**
 * A4運行指示書 — 画面外に配置して印刷専用 DOM を描画
 */
export const MapEditorPrintSheet = forwardRef(function MapEditorPrintSheet(
  { session, order, project, siteTitle, annotations },
  ref,
) {
  const leafletMapRef = useRef(null);

  useImperativeHandle(ref, () => ({
    invalidateMapSize() {
      const map = leafletMapRef.current;
      if (!map) return;
      map.invalidateSize({ animate: false });
    },
    prepareForPrint() {
      const map = leafletMapRef.current;
      if (!map) return Promise.resolve();
      map.invalidateSize({ animate: false });
      return waitForMapTiles(map);
    },
  }));

  if (!session?.active) return null;

  const { includeMap, includeDetails, viewport } = session;
  const shellClass =
    'map-editor-print-sheet' +
    (includeMap ? ' print-include-map' : '') +
    (includeDetails ? ' print-include-details' : '');

  return (
    <div className={shellClass}>
      <div className="map-editor-a4-instruction-page">
        {includeDetails ? (
          <MapEditorPrintDetails order={order} project={project} siteTitle={siteTitle} />
        ) : null}

        {includeMap ? (
          <div className="map-editor-print-map-slot">
            <p className="map-editor-print-map-caption">現場周辺地図</p>
            <div
              className="map-editor-print-map-frame"
              style={{ height: PRINT_MAP_HEIGHT_PX, minHeight: PRINT_MAP_HEIGHT_PX }}
            >
              <MapEditorViewportMap
                annotations={annotations}
                viewport={viewport}
                fixedHeightPx={PRINT_MAP_HEIGHT_PX}
                onMapReady={(map) => {
                  leafletMapRef.current = map;
                }}
                mapKey={`print-${viewport?.lat}-${viewport?.lng}-${viewport?.zoom}`}
                className="h-full w-full"
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
});
