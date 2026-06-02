import React from 'react';

/**
 * 管理画面 — CSVダウンロード（UTF-8 BOM・セカンダリスタイル）
 */
export function AdminCsvDownloadButton({
  label = 'CSVダウンロード',
  disabled = false,
  onDownload,
  title = '登録データをCSVでダウンロード（Excel文字化け防止BOM付き）',
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={onDownload}
      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-lg border-2 border-slate-300 bg-white px-4 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span aria-hidden className="text-base leading-none">
        ⬇
      </span>
      {label}
    </button>
  );
}
