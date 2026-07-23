import React from 'react';
import { useAppReleaseControl } from '../hooks/useAppReleaseControl.js';

/**
 * 古いバンドル検知時の更新バナー（全アプリ共通）
 */
export default function AppUpdateBanner() {
  const { release, outdated, reloadNow } = useAppReleaseControl();
  if (!outdated) return null;

  const forceLabel = release?.force_reload_at
    ? new Date(release.force_reload_at).toLocaleString('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div
      className="fixed inset-x-0 top-0 z-[9999] flex flex-wrap items-center justify-center gap-3 bg-amber-500 px-4 py-2 text-sm font-bold text-white shadow"
      role="status"
    >
      <span>
        🔄 新しいバージョンがあります。
        {release?.message ? ` ${release.message}` : ''}
        {forceLabel ? `（${forceLabel} に自動更新されます）` : ''}
      </span>
      <button
        type="button"
        onClick={() => void reloadNow()}
        className="rounded bg-white px-3 py-1 text-xs font-black text-amber-700 hover:bg-amber-50"
      >
        今すぐ更新
      </button>
    </div>
  );
}
