import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { MapEditorPrintDetails } from './MapEditorPrintDetails.jsx';
import { MapEditorViewportMap } from './MapEditorViewportMap.jsx';

/**
 * A4運行指示書 — 画面上は非表示、印刷時のみ1枚レイアウトで出力
 */
export const MapEditorPrintSheet = forwardRef(function MapEditorPrintSheet(
  { session, order, project, siteTitle, annotations },
  ref,
) {
  const leafletMapRef = useRef(null);

  useImperativeHandle(ref, () => ({
    invalidateMapSize() {
      leafletMapRef.current?.invalidateSize?.();
    },
  }));

  if (!session?.active) return null;

  const { includeMap, includeDetails, viewport } = session;
  const shellClass =
    'map-editor-print-sheet' +
    (includeMap ? ' print-include-map' : '') +
    (includeDetails ? ' print-include-details' : '');

  return (
    <div className={shellClass} aria-hidden="true">
      <div className="map-editor-a4-instruction-page print:max-h-screen print:overflow-hidden">
        {includeDetails ? (
          <MapEditorPrintDetails order={order} project={project} siteTitle={siteTitle} />
        ) : null}

        {includeMap ? (
          <div className="map-editor-print-map-slot mt-2 print:break-inside-avoid">
            <p className="map-editor-print-map-caption mb-1 text-[9pt] font-black text-slate-700">
              現場周辺地図
            </p>
            <div className="map-editor-print-map-frame h-[280px] w-full overflow-hidden rounded border border-slate-400 print:block print:h-[550px] print:min-h-[550px] print:w-full">
              <MapEditorViewportMap
                annotations={annotations}
                viewport={viewport}
                onMapReady={(map) => {
                  leafletMapRef.current = map;
                }}
                mapKey={`print-${viewport?.lat}-${viewport?.lng}-${viewport?.zoom}`}
                className="h-full w-full min-h-[280px] print:min-h-[550px]"
              />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
});
