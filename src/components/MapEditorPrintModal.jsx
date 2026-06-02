import React, { useEffect, useState } from 'react';
import { MapEditorViewportMap } from './MapEditorViewportMap.jsx';

/**
 * 印刷プレビュー — 項目選択とアングル調整ミニマップ
 */
export function MapEditorPrintModal({
  open,
  initialIncludeMap = true,
  initialIncludeDetails = true,
  initialViewport,
  annotations,
  onCancel,
  onConfirm,
}) {
  const [includeMap, setIncludeMap] = useState(initialIncludeMap);
  const [includeDetails, setIncludeDetails] = useState(initialIncludeDetails);
  const [viewport, setViewport] = useState(initialViewport);

  useEffect(() => {
    if (!open) return;
    setIncludeMap(initialIncludeMap);
    setIncludeDetails(initialIncludeDetails);
    setViewport(initialViewport);
  }, [open, initialIncludeMap, initialIncludeDetails, initialViewport]);

  if (!open) return null;

  const canPrint = includeMap || includeDetails;

  return (
    <div
      className="map-editor-no-print fixed inset-0 z-[200] flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
      role="presentation"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="map-print-modal-title"
        className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="map-print-modal-title" className="text-lg font-black text-slate-900">
          印刷プレビュー・アングル調整
        </h2>
        <p className="mt-1 text-xs font-medium leading-relaxed text-slate-600">
          荷下ろし地点を中心にミニマップで範囲を調整してください。ここで決めた表示が、そのまま印刷に反映されます。
        </p>

        <div className="mt-4 space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-800">
            <input
              type="checkbox"
              name="print_modal_include_details"
              checked={includeDetails}
              onChange={(e) => setIncludeDetails(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            物件詳細を印刷する
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-bold text-slate-800">
            <input
              type="checkbox"
              name="print_modal_include_map"
              checked={includeMap}
              onChange={(e) => setIncludeMap(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            現場地図を印刷する
          </label>
        </div>

        {includeMap ? (
          <div className="mt-4">
            <p className="text-xs font-black text-slate-700">アングル調整用ミニマップ</p>
            <p className="mt-0.5 text-[10px] font-medium text-slate-500">
              ドラッグで移動・ホイールでズーム（荷下ろし地点＝赤い円）
            </p>
            <div className="mt-2 h-52 overflow-hidden rounded-xl border-2 border-slate-300 shadow-inner sm:h-56">
              <MapEditorViewportMap
                annotations={annotations}
                viewport={viewport}
                onViewportChange={setViewport}
                mapKey="modal-preview"
                className="h-full w-full"
              />
            </div>
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs font-bold text-slate-500">
            地図は印刷しません
          </p>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-[48px] rounded-xl border-2 border-slate-300 bg-white text-sm font-black text-slate-800"
          >
            キャンセル
          </button>
          <button
            type="button"
            disabled={!canPrint}
            onClick={() =>
              onConfirm({
                includeMap,
                includeDetails,
                viewport: {
                  lat: viewport.lat,
                  lng: viewport.lng,
                  zoom: viewport.zoom,
                },
              })
            }
            className="min-h-[48px] rounded-xl bg-indigo-600 text-sm font-black text-white disabled:opacity-50"
          >
            印刷を実行
          </button>
        </div>
      </div>
    </div>
  );
}
