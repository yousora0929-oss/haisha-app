import React from 'react';
import {
  externalUrlValidationMessage,
  isValidExternalUrl,
  normalizeExternalUrl,
} from '../utils/urlValidation.js';

function UrlOpenButton({ label, rawUrl, variant = 'default' }) {
  const normalized = normalizeExternalUrl(rawUrl);
  const valid = Boolean(normalized);
  const msg = externalUrlValidationMessage(rawUrl);
  const btnClass =
    'min-h-[36px] rounded-lg border-2 px-3 text-xs font-black transition sm:text-sm ' +
    (valid
      ? 'border-sky-500 bg-sky-50 text-sky-900 hover:bg-sky-100'
      : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400');

  const open = (e) => {
    e?.stopPropagation?.();
    if (!valid) {
      window.alert(msg || 'URLが登録されていません');
      return;
    }
    window.open(normalized, '_blank', 'noopener,noreferrer');
  };

  if (variant === 'compact') {
    return (
      <button type="button" disabled={!valid} onClick={open} className={btnClass} title={valid ? normalized : msg}>
        {label}
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
      <p className="text-xs font-bold text-slate-600">{label}</p>
      {valid ? (
        <p className="mt-0.5 break-all font-mono text-[10px] text-slate-500">{normalized}</p>
      ) : (
        <p className="mt-0.5 text-xs font-bold text-amber-800">{msg}</p>
      )}
      <button type="button" disabled={!valid} onClick={open} className={'mt-2 ' + btnClass}>
        URLを開く
      </button>
    </div>
  );
}

/**
 * 物件の Google Drive / スプレッドシート等の外部リンク
 */
export function ProjectExternalUrlActions({ folderUrl, sheetUrl, variant = 'default' }) {
  const hasFolder = Boolean(String(folderUrl || '').trim());
  const hasSheet = Boolean(String(sheetUrl || '').trim());
  if (!hasFolder && !hasSheet) {
    if (variant === 'compact') return null;
    return (
      <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-500">
        フォルダURL・シートURLは未登録です（管理画面の物件編集で設定できます）
      </p>
    );
  }

  return (
    <div className={'grid gap-2 ' + (variant === 'inline' ? 'sm:grid-cols-2' : '')}>
      {hasFolder ? <UrlOpenButton label="📁 フォルダURLを開く" rawUrl={folderUrl} variant={variant} /> : null}
      {hasSheet ? <UrlOpenButton label="📊 シートURLを開く" rawUrl={sheetUrl} variant={variant} /> : null}
    </div>
  );
}

export function hasAnyValidProjectExternalUrl(project) {
  return (
    isValidExternalUrl(project?.folder_url ?? project?.folderUrl) ||
    isValidExternalUrl(project?.sheet_url ?? project?.sheetUrl)
  );
}
