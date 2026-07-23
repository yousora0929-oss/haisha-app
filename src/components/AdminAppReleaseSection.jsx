import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as db from '../haishaDb.js';
import {
  APP_VERSION,
  formatAppVersionLabel,
} from '../hooks/useAppReleaseControl.js';

function toDatetimeLocalValue(isoOrNull) {
  if (!isoOrNull) return '';
  const d = new Date(isoOrNull);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(local) {
  const s = String(local || '').trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

/**
 * Admin: アプリ配信バージョン管理
 */
export default function AdminAppReleaseSection() {
  const [minVersion, setMinVersion] = useState('0');
  const [forceLocal, setForceLocal] = useState('');
  const [message, setMessage] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const row = await db.fetchAppReleaseControl();
      setMinVersion(String(row?.min_version || '0'));
      setForceLocal(toDatetimeLocalValue(row?.force_reload_at));
      setMessage(String(row?.message || ''));
      setUpdatedAt(row?.updated_at ? String(row.updated_at) : '');
    } catch (e) {
      console.error('[AdminAppReleaseSection] load failed', e);
      setError(e?.message || '配信設定の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const localOutdated = useMemo(
    () => Number(APP_VERSION) < Number(minVersion || '0'),
    [minVersion],
  );

  const savePatch = async (patch, okMessage) => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const saved = await db.saveAppReleaseControl(patch);
      setMinVersion(String(saved?.min_version || patch.min_version || minVersion));
      setForceLocal(toDatetimeLocalValue(saved?.force_reload_at));
      setMessage(String(saved?.message ?? patch.message ?? message));
      setUpdatedAt(saved?.updated_at ? String(saved.updated_at) : '');
      setNotice(okMessage || '保存しました');
      window.setTimeout(() => setNotice(''), 4000);
    } catch (e) {
      console.error('[AdminAppReleaseSection] save failed', e);
      setError(e?.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handlePublishThisVersion = () => {
    if (
      !window.confirm(
        'この管理画面のバージョンを最新版として配信しますか？\n（デプロイ後にこの画面をリロードしてから実行してください）',
      )
    ) {
      return;
    }
    void savePatch(
      { min_version: APP_VERSION },
      'このバージョンを最新版として配信しました',
    );
  };

  const handleSaveSchedule = (e) => {
    e.preventDefault();
    void savePatch(
      {
        force_reload_at: fromDatetimeLocalValue(forceLocal),
        message: message.trim() || null,
      },
      '強制反映時刻・メッセージを保存しました',
    );
  };

  const fieldClass =
    'mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

  return (
    <section className="mt-6 rounded-2xl border-2 border-indigo-200 bg-indigo-50/50 p-4 shadow-md dark:border-indigo-800 dark:bg-indigo-950/30 sm:p-6">
      <h2 className="text-lg font-black text-slate-900 dark:text-white">🚀 アプリ配信管理</h2>
      <p className="mt-1 text-xs font-medium text-slate-600 dark:text-slate-400">
        全端末（注文・工場・管理者・チャーター・地図）にバージョン要求と強制リロード時刻を配信します。
      </p>

      {error ? (
        <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800" role="status">
          {notice}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-slate-500">読み込み中…</p>
      ) : (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-600 dark:bg-slate-900">
            <p className="text-xs font-black text-slate-500">現在の状態</p>
            <dl className="mt-2 space-y-1 text-sm font-bold text-slate-800 dark:text-slate-100">
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-slate-500">この画面のバージョン</dt>
                <dd>
                  {formatAppVersionLabel(APP_VERSION)}
                  <span className="ml-2 font-mono text-xs text-slate-400">({APP_VERSION})</span>
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-slate-500">配信中 min_version</dt>
                <dd>
                  {formatAppVersionLabel(minVersion)}
                  <span className="ml-2 font-mono text-xs text-slate-400">({minVersion})</span>
                </dd>
              </div>
              <div className="flex flex-wrap gap-x-2">
                <dt className="text-slate-500">強制反映時刻</dt>
                <dd>{forceLocal ? new Date(fromDatetimeLocalValue(forceLocal)).toLocaleString('ja-JP') : '未設定（強制なし）'}</dd>
              </div>
              {updatedAt ? (
                <div className="flex flex-wrap gap-x-2">
                  <dt className="text-slate-500">最終更新</dt>
                  <dd>{new Date(updatedAt).toLocaleString('ja-JP')}</dd>
                </div>
              ) : null}
            </dl>
            {localOutdated ? (
              <p className="mt-2 text-xs font-black text-amber-800">
                ⚠️ この管理画面自体が配信中バージョンより古いです。先にリロードしてください。
              </p>
            ) : null}
          </div>

          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/40">
            <p className="text-xs font-black leading-relaxed text-amber-950 dark:text-amber-100">
              ⚠️ デプロイ後、この管理画面自体をリロードしてから実行してください（古い画面から実行すると古いバージョンが配信されます）
            </p>
            <button
              type="button"
              disabled={saving || localOutdated}
              onClick={handlePublishThisVersion}
              className="mt-3 min-h-[44px] rounded-lg bg-indigo-600 px-4 text-sm font-black text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              このバージョンを最新版として配信
            </button>
          </div>

          <form onSubmit={handleSaveSchedule} className="space-y-3 rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-600 dark:bg-slate-900">
            <div>
              <label htmlFor="app-release-force-at" className="text-xs font-black text-slate-600 dark:text-slate-300">
                強制反映時刻
              </label>
              <input
                id="app-release-force-at"
                type="datetime-local"
                value={forceLocal}
                onChange={(e) => setForceLocal(e.target.value)}
                className={fieldClass}
              />
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setForceLocal(toDatetimeLocalValue(new Date().toISOString()))}
                  className="rounded-lg border border-slate-300 bg-slate-50 px-3 py-1.5 text-xs font-black text-slate-800 hover:bg-slate-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
                >
                  即時（いま）
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setForceLocal('')}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                >
                  クリア（強制なし）
                </button>
              </div>
            </div>
            <div>
              <label htmlFor="app-release-message" className="text-xs font-black text-slate-600 dark:text-slate-300">
                バナーメッセージ（任意）
              </label>
              <input
                id="app-release-message"
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="例：配車ロジック更新のため"
                className={fieldClass}
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="min-h-[44px] rounded-lg border-2 border-indigo-300 bg-indigo-600 px-4 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {saving ? '保存中…' : '強制反映時刻・メッセージを保存'}
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
