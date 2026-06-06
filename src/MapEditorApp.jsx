import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MapEditorInteractive } from './components/MapEditorInteractive.jsx';
import { MapEditorToolbar } from './components/MapEditorToolbar.jsx';
import {
  fetchOrderForMapEditor,
  saveOrderOverrideMap,
  saveProjectDefaultMap,
} from './haishaDb.js';
import { ensureMapEditorPanelAuth, hasAnyPanelSession, parseMapEditorGuestTokenFromUrl } from './supabaseClient.js';
import {
  MAP_EDITOR_TOOLS,
  navigateAfterMapEditorSave,
  navigateBackFromMapEditor,
  parseMapEditorOrderId,
} from './mapEditorConstants.js';
import { isValidExternalUrl, normalizeExternalUrl } from './utils/urlValidation.js';
import { boundsFromCenter, emptyMapAnnotations } from './utils/mapAnnotations.js';
import { MapEditorPrintModal } from './components/MapEditorPrintModal.jsx';
import { MapEditorPrintSheet } from './components/MapEditorPrintSheet.jsx';
import { resolvePrintMapViewport } from './utils/mapEditorPrintViewport.js';
import { shouldShowBlueprintOverlay, stripSavedSnapshotOverlay } from './utils/mapEditorOverlay.js';

const MAP_SOURCE_LABEL = {
  override: 'この打設日の専用マップ',
  default: 'プロジェクトの基本マップ',
  none: '白紙（ベース画像未設定）',
  upload: 'アップロードしたベース画像',
};

function withImageOverlayLocal(annotations, imageUrl) {
  const url = String(imageUrl || '').trim();
  if (!url) return annotations;
  const bounds =
    annotations?.imageOverlay?.bounds ||
    boundsFromCenter(annotations?.center?.lat, annotations?.center?.lng);
  return {
    ...annotations,
    imageOverlay: { url, bounds },
  };
}

export function MapEditorApp() {
  const orderId = parseMapEditorOrderId();
  const editorRef = useRef(null);
  const baseUploadRef = useRef(null);
  const localBlobUrlRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [siteLabel, setSiteLabel] = useState('');
  const [resolvedOrderId, setResolvedOrderId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [baseImageUrl, setBaseImageUrl] = useState('');
  const [mapSource, setMapSource] = useState('none');
  const [overrideMapUrl, setOverrideMapUrl] = useState('');
  const [defaultMapUrl, setDefaultMapUrl] = useState('');

  const [annotations, setAnnotations] = useState(() => emptyMapAnnotations());
  const [activeTool, setActiveTool] = useState(MAP_EDITOR_TOOLS.PAN);
  const [selectedStampType, setSelectedStampType] = useState('PUMP');
  const [unloadRadius, setUnloadRadius] = useState(12);

  const [saving, setSaving] = useState(false);
  const [confirmMode, setConfirmMode] = useState(null);
  const [toast, setToast] = useState('');
  const [lastSavedUrl, setLastSavedUrl] = useState('');
  const [selection, setSelection] = useState(null);
  const [editorOrder, setEditorOrder] = useState(null);
  const [editorProject, setEditorProject] = useState(null);
  const [flyTarget, setFlyTarget] = useState(null);
  const [printModalOpen, setPrintModalOpen] = useState(false);
  const [printSession, setPrintSession] = useState(null);
  const printSheetRef = useRef(null);
  const printRunIdRef = useRef(0);

  const initialPrintViewport = useMemo(
    () => resolvePrintMapViewport(editorOrder, annotations),
    [editorOrder, annotations],
  );

  const showToast = useCallback((msg) => {
    setToast(msg);
    const t = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(t);
  }, []);

  const safeParseFloat = useCallback((value) => {
    const n = parseFloat(String(value ?? ''));
    return Number.isFinite(n) ? n : null;
  }, []);

  const closeOrNavigateBack = useCallback(() => {
    try {
      if (window.opener || window.history.length <= 1) {
        window.close();
        return;
      }
    } catch {
      /* ignore */
    }

    if (!navigateBackFromMapEditor()) {
      try {
        window.history.back();
      } catch {
        navigateAfterMapEditorSave();
      }
    }
  }, []);

  const revokeLocalBlob = useCallback(() => {
    if (localBlobUrlRef.current) {
      URL.revokeObjectURL(localBlobUrlRef.current);
      localBlobUrlRef.current = null;
    }
  }, []);

  useEffect(() => {
    return () => revokeLocalBlob();
  }, [revokeLocalBlob]);

  const selectedStamp = useMemo(() => {
    if (selection?.kind !== 'stamp') return null;
    return (annotations.stamps || []).find((s) => s.id === selection.id) || null;
  }, [annotations.stamps, selection]);

  const selectedUnload = useMemo(() => {
    if (selection?.kind !== 'unload') return null;
    return (annotations.unloadPoints || []).find((u) => u.id === selection.id) || null;
  }, [annotations.unloadPoints, selection]);

  useEffect(() => {
    if (selectedUnload?.radiusM != null) setUnloadRadius(selectedUnload.radiusM);
  }, [selectedUnload?.id, selectedUnload?.radiusM]);

  const handleStampScaleChange = (scale) => {
    if (!selectedStamp) return;
    setAnnotations((prev) => ({
      ...prev,
      stamps: (prev.stamps || []).map((s) => (s.id === selectedStamp.id ? { ...s, scale } : s)),
    }));
  };

  const handleUnloadRadiusChange = (radiusM) => {
    setUnloadRadius(radiusM);
    if (selectedUnload) {
      setAnnotations((prev) => ({
        ...prev,
        unloadPoints: (prev.unloadPoints || []).map((u) =>
          u.id === selectedUnload.id ? { ...u, radiusM } : u,
        ),
      }));
    }
  };

  const handleDeleteSelection = () => {
    editorRef.current?.deleteSelected?.();
  };

  const handlePrint = useCallback(() => {
    setPrintModalOpen(true);
  }, []);

  const handlePrintConfirm = useCallback(({ includeMap, includeDetails, viewport }) => {
    setPrintModalOpen(false);
    printRunIdRef.current += 1;
    const runId = printRunIdRef.current;
    setPrintSession({
      active: true,
      includeMap,
      includeDetails,
      viewport,
      runId,
    });
  }, []);

  useEffect(() => {
    if (!printSession?.active) return undefined;

    const onAfterPrint = () => {
      setPrintSession(null);
    };
    const onBeforePrint = () => {
      printSheetRef.current?.invalidateMapSize?.();
    };

    window.addEventListener('afterprint', onAfterPrint);
    window.addEventListener('beforeprint', onBeforePrint);

    const runId = printSession.runId;
    let cancelled = false;

    const startPrint = async () => {
      await new Promise((r) => window.setTimeout(r, 80));
      if (cancelled || printRunIdRef.current !== runId) return;
      await printSheetRef.current?.prepareForPrint?.();
      if (cancelled || printRunIdRef.current !== runId) return;
      printSheetRef.current?.invalidateMapSize?.();
      await new Promise((r) => window.setTimeout(r, 150));
      if (cancelled || printRunIdRef.current !== runId) return;
      window.print();
    };

    startPrint();

    return () => {
      cancelled = true;
      window.removeEventListener('afterprint', onAfterPrint);
      window.removeEventListener('beforeprint', onBeforePrint);
    };
  }, [printSession]);

  const askReturnAfterSave = useCallback(() => {
    window.alert('地図を保存しました。');
    closeOrNavigateBack();
  }, [closeOrNavigateBack]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!orderId) {
        setLoadError('URLに注文IDがありません（/map-editor/:order_id）');
        setLoading(false);
        return;
      }

      setLoading(true);
      setLoadError('');
      try {
        await ensureMapEditorPanelAuth();
        const result = await fetchOrderForMapEditor(orderId);
        if (cancelled) return;

        if (!result) {
          const hasAuth = hasAnyPanelSession() || Boolean(parseMapEditorGuestTokenFromUrl());
          setLoadError(
            hasAuth
              ? '注文が見つからないか、無効です。'
              : '認証情報がありません。発注画面・工場画面・管理画面から開くか、専用URL（?token=）付きのリンクをご利用ください。',
          );
          return;
        }

        revokeLocalBlob();
        setEditorOrder(result.order);
        setEditorProject(result.project || null);
        setResolvedOrderId(result.order.id);
        setProjectId(result.projectId || '');
        setSiteLabel(result.title);
        setBaseImageUrl(result.displayImageUrl || '');
        setMapSource(result.mapSource || 'none');
        setOverrideMapUrl(result.overrideMapImageUrl || '');
        setDefaultMapUrl(result.defaultMapImageUrl || '');
        const loaded = result.mapAnnotations || emptyMapAnnotations();
        const centerLat = safeParseFloat(loaded?.center?.lat);
        const centerLng = safeParseFloat(loaded?.center?.lng);
        const centerZoom = safeParseFloat(loaded?.center?.zoom);
        if (centerLat != null && centerLng != null) {
          loaded.center = {
            ...loaded.center,
            lat: centerLat,
            lng: centerLng,
            zoom: Number.isFinite(centerZoom) ? centerZoom : loaded?.center?.zoom ?? 17,
          };
        }
        setAnnotations(stripSavedSnapshotOverlay(loaded, result.displayImageUrl || ''));
        if (result.initialFlyTarget) {
          const lat = safeParseFloat(result.initialFlyTarget.lat);
          const lng = safeParseFloat(result.initialFlyTarget.lng);
          const zoom = safeParseFloat(result.initialFlyTarget.zoom);
          if (lat != null && lng != null) {
            setFlyTarget({ lat, lng, zoom: Number.isFinite(zoom) ? zoom : 17, key: Date.now() });
          }
        }
      } catch (err) {
        if (!cancelled) {
          setLoadError(err?.message || 'データの読み込みに失敗しました');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [orderId, revokeLocalBlob, safeParseFloat]);

  const handleBaseImageUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) {
      showToast('画像ファイルを選択してください');
      return;
    }
    revokeLocalBlob();
    const url = URL.createObjectURL(file);
    localBlobUrlRef.current = url;
    setBaseImageUrl(url);
    setMapSource('upload');
    setAnnotations((prev) => withImageOverlayLocal(prev, url));
    e.target.value = '';
  };

  const handleUndo = () => {
    const stamps = annotations.stamps || [];
    const unloads = annotations.unloadPoints || [];
    const comments = annotations.comments || [];
    if (!stamps.length && !unloads.length && !comments.length) {
      showToast('戻す項目がありません');
      return;
    }
    if (comments.length) {
      setAnnotations((prev) => ({ ...prev, comments: comments.slice(0, -1) }));
    } else if (unloads.length) {
      setAnnotations((prev) => ({ ...prev, unloadPoints: unloads.slice(0, -1) }));
    } else {
      setAnnotations((prev) => ({ ...prev, stamps: stamps.slice(0, -1) }));
    }
  };

  const handleClear = () => {
    const total =
      (annotations.stamps?.length || 0) +
      (annotations.unloadPoints?.length || 0) +
      (annotations.comments?.length || 0);
    if (total === 0) return;
    if (!window.confirm('配置したマーカー・コメントをすべて消去しますか？')) return;
    setAnnotations((prev) => ({
      ...prev,
      stamps: [],
      unloadPoints: [],
      comments: [],
    }));
  };

  const handleCloseEditor = () => {
    if (saving) return;
    const stampCount =
      (annotations.stamps?.length || 0) +
      (annotations.unloadPoints?.length || 0) +
      (annotations.comments?.length || 0);
    const dirty = stampCount > 0 || mapSource === 'upload';
    if (dirty && !window.confirm('保存していません。地図エディタを閉じて前の画面に戻りますか？')) {
      return;
    }
    closeOrNavigateBack();
  };

  const runSave = async (mode) => {
    if (saving || !resolvedOrderId) return;
    setSaving(true);
    try {
      const dataUrl = await editorRef.current?.toDataURL?.();
      if (!dataUrl) throw new Error('画像の生成に失敗しました');

      const payload = withImageOverlayLocal(annotations, baseImageUrl);

      if (mode === 'project') {
        if (!projectId) {
          throw new Error('スポット注文など、物件に紐づいていないため基本マップは保存できません');
        }
        const result = await saveProjectDefaultMap(projectId, dataUrl, payload);
        if (result.publicUrl) {
          setDefaultMapUrl(result.publicUrl);
          setLastSavedUrl(result.publicUrl);
        }
        setAnnotations(result.map_annotations || payload);
        setConfirmMode(null);
        if (result.savedFully) {
          showToast('変更を保存しました（基本マップ）');
          askReturnAfterSave();
        } else if (result.storageUploadFailed && result.storageWarning) {
          showToast(`注釈データは保存しました。${result.storageWarning}`);
        } else {
          showToast('変更を保存しました（基本マップ）');
        }
      } else {
        const result = await saveOrderOverrideMap(resolvedOrderId, dataUrl, payload);
        if (result.publicUrl) {
          setOverrideMapUrl(result.publicUrl);
          setBaseImageUrl(result.publicUrl);
          setMapSource('override');
          setLastSavedUrl(result.publicUrl);
        }
        setAnnotations(result.map_annotations || payload);
        setConfirmMode(null);
        if (result.locationPendingCleared) {
          if (result.savedFully) {
            showToast('変更を保存しました（地図待ちを解除しました）');
            askReturnAfterSave();
          } else if (result.storageUploadFailed && result.storageWarning) {
            showToast(`地図待ちを解除しました。${result.storageWarning}`);
          } else {
            showToast('地図待ちを解除しました');
          }
        } else if (result.savedFully) {
          showToast('変更を保存しました');
          askReturnAfterSave();
        } else if (result.storageUploadFailed && result.storageWarning) {
          showToast(`注釈データは保存しました。${result.storageWarning}`);
        } else {
          showToast('変更を保存しました');
        }
      }
    } catch (err) {
      showToast(err?.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  if (!orderId) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-100 p-6">
        <ErrorCard title="URLが不正です" message="パスに注文IDを含めてください。例: /map-editor/ord_xxxx" />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-100">
        <p className="text-sm font-bold text-slate-600">読み込み中…</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-slate-100 p-6">
        <ErrorCard title="表示できません" message={loadError} />
      </div>
    );
  }

  const sourceLabel = MAP_SOURCE_LABEL[mapSource] || mapSource;
  const annCount =
    (annotations.stamps?.length || 0) +
    (annotations.unloadPoints?.length || 0) +
    (annotations.comments?.length || 0);

  const siteSubtitle = siteLabel.trim() || '（現場名未設定）';

  const blueprintOverlayUrl = shouldShowBlueprintOverlay(
    mapSource,
    annotations?.imageOverlay?.url || baseImageUrl,
  )
    ? String(annotations?.imageOverlay?.url || baseImageUrl).trim()
    : '';

  const actionBtn =
    'min-h-[44px] rounded-xl px-3 text-xs font-black shadow-md active:scale-[0.98] disabled:opacity-50 sm:text-sm';
  const mobileBarBtn =
    'flex min-h-[44px] w-full items-center justify-center rounded-xl px-2 text-xs font-black shadow-md active:scale-[0.98] disabled:opacity-50';

  return (
    <div className="map-editor-app relative h-[100dvh] w-screen overflow-hidden bg-gray-100 text-slate-900 dark:bg-gray-900 dark:text-gray-100">
      <MapEditorPrintSheet
        ref={printSheetRef}
        session={printSession}
        order={editorOrder}
        project={editorProject}
        siteTitle={siteSubtitle}
        annotations={annotations}
      />

      <MapEditorPrintModal
        open={printModalOpen}
        initialIncludeMap
        initialIncludeDetails
        initialViewport={initialPrintViewport}
        annotations={annotations}
        onCancel={() => setPrintModalOpen(false)}
        onConfirm={handlePrintConfirm}
      />

      <div className="map-editor-screen-ui absolute inset-0 z-0 h-full w-full">
        <MapEditorInteractive
          ref={editorRef}
          annotations={annotations}
          onAnnotationsChange={setAnnotations}
          activeTool={activeTool}
          selectedStampType={selectedStampType}
          defaultUnloadRadius={unloadRadius}
          flyTarget={flyTarget}
          disabled={saving}
          selected={selection}
          onSelectionChange={setSelection}
          blueprintOverlayUrl={blueprintOverlayUrl}
          className="h-full w-full"
        />
      </div>

      <div className="map-editor-no-print pointer-events-none absolute inset-x-0 top-0 z-10 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] md:hidden">
        <p className="truncate rounded-lg bg-white/90 px-2 py-1 text-[11px] font-black text-slate-800 shadow-sm backdrop-blur dark:bg-slate-900/90 dark:text-slate-100" title={siteSubtitle}>
          {siteSubtitle}
        </p>
        <p className="mt-0.5 truncate px-1 text-[9px] font-bold text-slate-500">
          {sourceLabel} · 注釈 {annCount}
        </p>
      </div>

      <input
        ref={baseUploadRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleBaseImageUpload}
      />

      <MapEditorToolbar
        activeTool={activeTool}
        onToolChange={setActiveTool}
        selectedStampType={selectedStampType}
        onStampTypeChange={(t) => {
          setSelectedStampType(t);
          setActiveTool(MAP_EDITOR_TOOLS.STAMP);
        }}
        selectedUnloadRadius={unloadRadius}
        onUnloadRadiusChange={handleUnloadRadiusChange}
        selection={selection}
        selectedStampScale={selectedStamp?.scale ?? 1}
        onStampScaleChange={handleStampScaleChange}
        onDeleteSelection={handleDeleteSelection}
        disabled={saving}
        className="map-editor-no-print absolute left-4 top-[calc(env(safe-area-inset-top)+3.25rem)] z-10 max-h-[min(48vh,24rem)] overflow-y-auto rounded-2xl border border-slate-200 bg-white/95 shadow-lg backdrop-blur md:top-4 md:max-h-[calc(100dvh-6rem)] dark:border-slate-600 dark:bg-slate-900/95"
      />

      <div className="map-editor-no-print fixed inset-x-0 bottom-0 z-20 border-t border-slate-200/80 bg-white/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-8px_24px_rgba(15,23,42,0.12)] backdrop-blur md:absolute md:inset-x-auto md:bottom-auto md:left-auto md:right-4 md:top-4 md:max-w-md md:border-0 md:bg-transparent md:p-0 md:shadow-none md:backdrop-blur-none dark:border-slate-700 dark:bg-slate-900/95 md:dark:bg-transparent">
        {/* スマホ: 閉じる | 図面 | 保存 を 1:1:2 で1列 */}
        <div className="grid w-full grid-cols-[1fr_1fr_2fr] gap-2 md:hidden">
          <button
            type="button"
            onClick={handleCloseEditor}
            disabled={saving}
            className={mobileBarBtn + ' border border-slate-300 bg-white text-slate-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200'}
            aria-label="閉じる"
          >
            閉じる
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => baseUploadRef.current?.click()}
            className={mobileBarBtn + ' border border-slate-300 bg-white text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'}
          >
            <span aria-hidden="true">📷</span>
            <span> 図面</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmMode('order')}
            disabled={saving}
            className={mobileBarBtn + ' bg-emerald-600 text-white ring-2 ring-emerald-300/50'}
          >
            <span aria-hidden="true">💾</span>
            <span> 保存</span>
          </button>
        </div>

        {/* PC: 従来の2段レイアウト */}
        <div className="hidden flex-col gap-2 md:flex">
        <div className="flex w-full flex-wrap gap-2 md:justify-end">
          <button
            type="button"
            disabled={saving}
            onClick={() => baseUploadRef.current?.click()}
            className={actionBtn + ' border border-slate-300 bg-white text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'}
          >
            <span aria-hidden="true">📷</span>
            <span className="hidden sm:inline"> 図面</span>
          </button>
          <button
            type="button"
            onClick={handleUndo}
            disabled={saving}
            className={actionBtn + ' hidden border border-slate-300 bg-white text-slate-800 md:inline-flex dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'}
          >
            ↩️ 戻す
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={saving}
            className={actionBtn + ' hidden border border-red-200 bg-red-50 text-red-800 md:inline-flex'}
          >
            🗑️ 消去
          </button>
          <button
            type="button"
            onClick={handlePrint}
            disabled={saving}
            className={actionBtn + ' hidden border border-slate-300 bg-white text-slate-800 md:inline-flex dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'}
            title="運行指示書の印刷プレビューを開く"
          >
            🖨️ 印刷
          </button>
        </div>
        <div className="flex w-auto gap-2">
          <button
            type="button"
            onClick={handleCloseEditor}
            disabled={saving}
            className={actionBtn + ' border-2 border-slate-400 bg-white text-slate-800 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-100'}
            aria-label="閉じる"
          >
            <span aria-hidden="true">✕</span>
            <span> 閉じる</span>
          </button>
          <button
            type="button"
            onClick={() => setConfirmMode('order')}
            disabled={saving}
            className={actionBtn + ' bg-emerald-600 text-white ring-2 ring-emerald-300/50'}
          >
            <span aria-hidden="true">💾</span>
            <span> 保存する</span>
          </button>
        </div>
        </div>
      </div>

      {confirmMode ? (
        <div className="map-editor-no-print fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-6">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
            <h2 className="text-base font-black">
              {confirmMode === 'project' ? '基本マップとして保存' : '打設日用として保存'}
            </h2>
            <p className="mt-2 text-sm font-bold leading-relaxed text-slate-600">
              地図上の注釈（赤〇・スタンプ・コメント）と合成画像を保存します。
            </p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setConfirmMode('order')}
                className={
                  'w-full rounded-xl border-2 px-3 py-2 text-sm font-black transition ' +
                  (confirmMode === 'order'
                    ? 'border-indigo-600 bg-indigo-600 text-white'
                    : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-white')
                }
              >
                🚀 打設日用として保存
              </button>
              <button
                type="button"
                disabled={saving || !projectId}
                title={!projectId ? '物件に紐づく注文のみ利用可能' : ''}
                onClick={() => setConfirmMode('project')}
                className={
                  'w-full rounded-xl border-2 px-3 py-2 text-sm font-black transition ' +
                  (confirmMode === 'project'
                    ? 'border-emerald-700 bg-emerald-600 text-white'
                    : 'border-slate-200 bg-slate-50 text-slate-800 hover:bg-white') +
                  (!projectId ? ' opacity-50' : '')
                }
              >
                💾 基本マップとして保存
              </button>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                type="button"
                disabled={saving}
                onClick={() => setConfirmMode(null)}
                className="flex-1 rounded-xl border border-slate-200 bg-slate-50 py-2.5 text-sm font-bold"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => runSave(confirmMode)}
                className="flex-1 rounded-xl bg-emerald-600 py-2.5 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50"
              >
                {saving ? '保存中…' : '保存する'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {lastSavedUrl ? (
        <div className="map-editor-no-print pointer-events-none fixed bottom-[calc(4rem+env(safe-area-inset-bottom))] right-4 z-40 max-w-[min(90vw,280px)] rounded-lg bg-emerald-800 px-3 py-2 text-[11px] font-bold text-white shadow-lg md:bottom-4">
          変更を保存しました
          {isValidExternalUrl(lastSavedUrl) ? (
            <a
              className="pointer-events-auto ml-1 underline"
              href={normalizeExternalUrl(lastSavedUrl)}
              target="_blank"
              rel="noreferrer"
            >
              画像を開く
            </a>
          ) : null}
        </div>
      ) : null}

      {toast ? (
        <div className="map-editor-no-print pointer-events-none fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom))] left-1/2 z-40 max-w-[90vw] -translate-x-1/2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white shadow-lg md:bottom-6">
          {toast}
        </div>
      ) : null}
    </div>
  );
}

function ErrorCard({ title, message }) {
  return (
    <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-lg">
      <h1 className="text-lg font-black text-red-600">{title}</h1>
      <p className="mt-3 text-sm font-bold leading-relaxed text-slate-600">{message}</p>
    </div>
  );
}
