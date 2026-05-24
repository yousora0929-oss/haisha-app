import React, { useCallback, useEffect, useRef, useState } from 'react';
import { MapEditorCanvas, MapStampPalette } from './components/MapEditorCanvas.jsx';
import {
  fetchOrderForMapEditor,
  saveOrderOverrideMap,
  saveProjectDefaultMap,
} from './haishaDb.js';
import { parseMapEditorOrderId } from './mapEditorConstants.js';
import { isValidExternalUrl, normalizeExternalUrl } from './utils/urlValidation.js';

const MAP_SOURCE_LABEL = {
  override: 'この打設日の専用マップ',
  default: 'プロジェクトの基本マップ',
  none: '白紙（ベース画像未設定）',
  upload: 'アップロードしたベース画像',
};

export function MapEditorApp() {
  const orderId = parseMapEditorOrderId();
  const canvasRef = useRef(null);
  const baseUploadRef = useRef(null);
  const localBlobUrlRef = useRef(null);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [title, setTitle] = useState('地図スタンプ配置');
  const [resolvedOrderId, setResolvedOrderId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [baseImageUrl, setBaseImageUrl] = useState('');
  const [mapSource, setMapSource] = useState('none');
  const [overrideMapUrl, setOverrideMapUrl] = useState('');
  const [defaultMapUrl, setDefaultMapUrl] = useState('');

  const [stamps, setStamps] = useState([]);
  const [selectedType, setSelectedType] = useState('PUMP');
  const [saving, setSaving] = useState(false);
  const [confirmMode, setConfirmMode] = useState(null);
  const [toast, setToast] = useState('');
  const [lastSavedUrl, setLastSavedUrl] = useState('');

  const showToast = useCallback((msg) => {
    setToast(msg);
    const t = setTimeout(() => setToast(''), 2800);
    return () => clearTimeout(t);
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
        const result = await fetchOrderForMapEditor(orderId);
        if (cancelled) return;

        if (!result) {
          setLoadError('注文が見つからないか、無効です。');
          return;
        }

        revokeLocalBlob();
        setResolvedOrderId(result.order.id);
        setProjectId(result.projectId || '');
        setTitle(result.title);
        setBaseImageUrl(result.displayImageUrl || '');
        setMapSource(result.mapSource || 'none');
        setOverrideMapUrl(result.overrideMapImageUrl || '');
        setDefaultMapUrl(result.defaultMapImageUrl || '');
        setStamps(result.existingStamps?.length ? result.existingStamps : []);
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
  }, [orderId, revokeLocalBlob]);

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
    e.target.value = '';
  };

  const handleUndo = () => {
    if (stamps.length === 0) {
      showToast('戻すスタンプがありません');
      return;
    }
    setStamps((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    if (stamps.length === 0) return;
    if (!window.confirm('配置したスタンプをすべて消去しますか？')) return;
    setStamps([]);
  };

  const runSave = async (mode) => {
    if (saving || !resolvedOrderId) return;
    setSaving(true);
    try {
      const dataUrl = canvasRef.current?.toDataURL?.('image/png');
      if (!dataUrl) throw new Error('画像の生成に失敗しました');

      if (mode === 'project') {
        if (!projectId) {
          throw new Error('スポット注文など、物件に紐づいていないため基本マップは保存できません');
        }
        const result = await saveProjectDefaultMap(projectId, dataUrl, stamps);
        setDefaultMapUrl(result.publicUrl);
        setLastSavedUrl(result.publicUrl);
        showToast('プロジェクトの基本マップを保存しました');
      } else {
        const result = await saveOrderOverrideMap(resolvedOrderId, dataUrl, stamps);
        setOverrideMapUrl(result.publicUrl);
        setBaseImageUrl(result.publicUrl);
        setMapSource('override');
        setLastSavedUrl(result.publicUrl);
        showToast('この打設日用マップを保存しました');
      }
      setConfirmMode(null);
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

  const useBlankCanvas = !baseImageUrl;
  const sourceLabel = MAP_SOURCE_LABEL[mapSource] || mapSource;

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-slate-100 text-slate-900">
      <header className="shrink-0 border-b border-slate-200 bg-white px-3 py-2">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-black sm:text-base">{title}</h1>
            <p className="mt-0.5 text-[10px] font-bold text-slate-500 sm:text-xs">表示中: {sourceLabel}</p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1">
            <button
              type="button"
              onClick={handleUndo}
              disabled={saving}
              className="rounded-lg bg-slate-100 px-2 py-1.5 text-[11px] font-bold text-slate-800 active:scale-95 sm:text-xs"
            >
              ↩️ 戻る
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={saving}
              className="rounded-lg bg-red-50 px-2 py-1.5 text-[11px] font-bold text-red-700 active:scale-95 sm:text-xs"
            >
              🗑️ 消去
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={saving || !projectId}
            title={!projectId ? '物件に紐づく注文のみ利用可能' : ''}
            onClick={() => setConfirmMode('project')}
            className="rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-[11px] font-bold text-emerald-800 active:scale-95 disabled:opacity-40 sm:text-xs"
          >
            💾 基本マップとして保存
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => setConfirmMode('order')}
            className="rounded-lg bg-indigo-600 px-2.5 py-1.5 text-[11px] font-bold text-white active:scale-95 disabled:opacity-50 sm:text-xs"
          >
            🚀 打設日用として保存
          </button>
        </div>
      </header>

      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <input
          ref={baseUploadRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleBaseImageUpload}
        />
        <button
          type="button"
          disabled={saving}
          onClick={() => baseUploadRef.current?.click()}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-700 active:scale-95 sm:text-xs"
        >
          📷 ベース画像をアップロード
        </button>
        {useBlankCanvas ? (
          <span className="text-[10px] font-bold text-amber-700 sm:text-xs">
            基本・専用マップが未設定です。白紙で編集するか、画像をアップロードしてください。
          </span>
        ) : null}
      </div>

      {(overrideMapUrl || defaultMapUrl) && (
        <p className="shrink-0 bg-slate-100 px-3 py-1 text-center text-[10px] font-bold text-slate-500">
          {overrideMapUrl ? '専用マップあり' : '専用マップなし'}
          {' · '}
          {defaultMapUrl ? '基本マップあり' : '基本マップなし'}
        </p>
      )}

      <MapEditorCanvas
        ref={canvasRef}
        baseImageUrl={baseImageUrl}
        blankCanvas
        stamps={stamps}
        onStampsChange={setStamps}
        selectedType={selectedType}
        disabled={saving}
      />

      <MapStampPalette selectedType={selectedType} onSelectType={setSelectedType} disabled={saving} />

      {confirmMode ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-6">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-xl">
            <h2 className="text-base font-black">
              {confirmMode === 'project' ? '基本マップとして保存' : '打設日用として保存'}
            </h2>
            <p className="mt-2 text-sm font-bold leading-relaxed text-slate-600">
              {confirmMode === 'project'
                ? 'このキャンバス内容を物件の基本マップ（default_map_image_url）として保存します。今後の注文のデフォルト背景になります。'
                : 'このキャンバス内容をこの注文専用の上書きマップ（override_map_image_url）として保存します。基本マップより優先して表示されます。'}
            </p>
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
                className="flex-1 rounded-xl bg-indigo-600 py-2.5 text-sm font-bold text-white disabled:opacity-50"
              >
                {saving ? '保存中…' : '保存する'}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {lastSavedUrl ? (
        <div className="pointer-events-none fixed top-20 left-1/2 z-40 max-w-[90vw] -translate-x-1/2 rounded-lg bg-emerald-800 px-3 py-2 text-center text-[11px] font-bold text-white shadow-lg">
          保存完了
          {isValidExternalUrl(lastSavedUrl) ? (
            <a
              className="pointer-events-auto ml-1 underline"
              href={normalizeExternalUrl(lastSavedUrl)}
              target="_blank"
              rel="noreferrer"
            >
              画像を開く
            </a>
          ) : (
            <span className="pointer-events-auto ml-1 text-amber-200">（画像URLが不正のため開けません）</span>
          )}
        </div>
      ) : null}

      {toast ? (
        <div className="pointer-events-none fixed bottom-24 left-1/2 z-40 -translate-x-1/2 rounded-lg bg-slate-800 px-4 py-2 text-sm font-bold text-white shadow-lg">
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
