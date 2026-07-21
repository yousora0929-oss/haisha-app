import React, { useCallback, useState } from 'react';
import { buildProjectMapEditorUrl, openMapEditorWindow } from '../mapEditorConstants.js';

/**
 * 物件マスタの基本現場地図エディタ（スポット注文と同じ MapEditor）
 */
export function ProjectMapEditorUrlActions({
  projectId,
  projectName,
  project,
  variant = 'default',
  onCopied,
}) {
  const [copied, setCopied] = useState(false);
  const id = String(projectId || project?.id || '').trim();
  const name = String(projectName || project?.name || '').trim();

  const resolveMapEditorUrl = useCallback(() => buildProjectMapEditorUrl(id), [id]);

  const hasDefaultMap = Boolean(
    project?.default_map_image_url ||
      project?.map_base_image_url ||
      project?.map_annotations,
  );
  const mapImageUrl = String(
    project?.default_map_image_url || project?.map_base_image_url || '',
  ).trim();

  if (!id) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-3">
        <p className="text-xs font-bold text-slate-600">
          現場地図は物件を一度保存したあとに編集できます。
        </p>
      </div>
    );
  }

  const handleCopy = async (e) => {
    e?.stopPropagation?.();
    const url = resolveMapEditorUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      onCopied?.();
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('地図URLのコピーに失敗', err);
      window.prompt('以下のURLをコピーしてください', url);
    }
  };

  const openEditor = (e) => {
    e?.stopPropagation?.();
    const url = resolveMapEditorUrl();
    if (!url) return;
    openMapEditorWindow(url);
  };

  const previewUrl = resolveMapEditorUrl();
  const btn =
    'min-h-[40px] rounded-lg border-2 px-3 text-xs font-black transition sm:text-sm ' +
    (variant === 'compact' ? 'min-h-[36px] px-2' : '');

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/90 p-3">
      <div className="min-w-0">
        <p className="text-xs font-black uppercase tracking-wider text-slate-600">🗺️ 現場地図（基本マップ）</p>
        <p className="mt-0.5 text-xs font-medium text-slate-600">
          {hasDefaultMap
            ? 'スポット注文と同じ地図エディタで登録済み（再編集可）'
            : 'スポット注文と同じ地図エディタで図面・スタンプを配置できます'}
        </p>
      </div>
      {mapImageUrl ? (
        <button
          type="button"
          onClick={openEditor}
          className="mt-3 block w-full overflow-hidden rounded-lg border-2 border-emerald-200 bg-white text-left shadow-sm transition hover:border-emerald-400 hover:ring-2 hover:ring-emerald-200/70"
          title="クリックで地図エディタを開く"
        >
          <img
            src={mapImageUrl}
            alt="登録済みの現場地図"
            className="mx-auto h-28 w-full max-w-xs object-contain bg-slate-100 sm:h-32"
          />
          <span className="block border-t border-emerald-100 bg-emerald-50/80 px-2 py-1 text-center text-[10px] font-bold text-emerald-900">
            サムネイルをタップして地図を開く
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={openEditor}
          className="mt-3 flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 bg-white/80 px-3 py-6 text-center transition hover:border-slate-400 hover:bg-slate-50"
          title="地図エディタを開く"
        >
          <span className="text-3xl" aria-hidden>
            🗺️
          </span>
          <span className="text-sm font-black text-slate-700">まだ地図が作成されていません</span>
          <span className="text-xs font-medium text-slate-500">タップして地図エディタを開く</span>
        </button>
      )}
      {variant !== 'compact' && previewUrl ? (
        <p className="mt-2 break-all font-mono text-[10px] leading-snug text-slate-600 sm:text-xs">{previewUrl}</p>
      ) : null}
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={openEditor}
          className={btn + ' border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'}
        >
          現場地図を開く
        </button>
        <button
          type="button"
          onClick={(e) => void handleCopy(e)}
          className={btn + ' border-slate-300 bg-white text-slate-800 hover:bg-slate-100'}
        >
          {copied ? 'コピー済み' : 'URLコピー'}
        </button>
      </div>
    </div>
  );
}
