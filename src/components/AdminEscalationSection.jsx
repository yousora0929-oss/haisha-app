import React, { useCallback, useEffect, useState } from 'react';
import * as db from '../haishaDb.js';

const SECTION =
  'rounded-2xl border border-gray-200 bg-white p-4 text-gray-900 shadow-md dark:border-gray-700 dark:bg-gray-800 dark:text-white sm:p-6';

const ESCALATION_SCOPE_OPTIONS = [
  { value: 'admin', label: '本部管理者のみ' },
  { value: 'area', label: '近隣エリアの連携工場まで拡大' },
  { value: 'all', label: '全工場へ一斉警告' },
];

const DEFAULT_ROW = {
  enabled: false,
  unread_idle_minutes: 15,
  escalation_scope: 'admin',
};

function buildRowDrafts(factories, savedByFactoryId) {
  const list = (factories || []).filter((f) => f?.id);
  list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja'));
  return list.map((f) => {
      const id = String(f.id);
      const saved = savedByFactoryId.get(id);
      return {
        factory_id: id,
        factory_name: f.name || id,
        enabled: saved?.enabled ?? DEFAULT_ROW.enabled,
        unread_idle_minutes: saved?.unread_idle_minutes ?? DEFAULT_ROW.unread_idle_minutes,
        escalation_scope: saved?.escalation_scope ?? DEFAULT_ROW.escalation_scope,
      };
    });
}

function factoryIdsKey(factories) {
  return (factories || [])
    .map((f) => String(f?.id || ''))
    .filter(Boolean)
    .sort()
    .join('|');
}

/**
 * 管理者画面 — 工場別自動エスカレーション設定
 */
export function AdminEscalationSection({ factories = [] }) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const saved = await db.fetchEscalationSettings();
      const savedByFactoryId = new Map(saved.map((s) => [String(s.factory_id), s]));
      setRows(buildRowDrafts(factories, savedByFactoryId));
    } catch (e) {
      console.error('[AdminEscalationSection] load failed', e);
      setError(e?.message || 'エスカレーション設定の取得に失敗しました');
      setRows(buildRowDrafts(factories, new Map()));
    } finally {
      setLoading(false);
    }
  }, [factories]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let unsub = () => {};
    void (async () => {
      unsub = await db.subscribeHaishaRealtime((payload) => {
        if (payload?.table === 'factory_escalation_settings') void load();
      });
    })();
    return () => unsub();
  }, [load]);

  const factoryIds = factoryIdsKey(factories);

  useEffect(() => {
    if (loading) return;
    setRows((prev) => {
      const prevById = new Map(prev.map((r) => [r.factory_id, r]));
      return buildRowDrafts(
        factories,
        new Map(
          [...prevById.entries()].map(([id, r]) => [
            id,
            {
              factory_id: id,
              enabled: r.enabled,
              unread_idle_minutes: r.unread_idle_minutes,
              escalation_scope: r.escalation_scope,
            },
          ]),
        ),
      );
    });
  }, [factoryIds, factories, loading]);

  const updateRow = (factoryId, patch) => {
    setRows((prev) =>
      prev.map((r) => (r.factory_id === factoryId ? { ...r, ...patch } : r)),
    );
  };

  const copyFirstRowToAll = () => {
    if (rows.length === 0) return;
    const first = rows[0];
    const minutes = Math.max(1, Number(first.unread_idle_minutes) || 15);
    const scope = first.escalation_scope || 'admin';
    setRows((prev) =>
      prev.map((r) => ({
        ...r,
        unread_idle_minutes: minutes,
        escalation_scope: scope,
      })),
    );
    setNotice('先頭行の「時間」と「範囲」を全工場へコピーしました（有効/無効は変更しません）');
    window.setTimeout(() => setNotice(''), 4000);
  };

  const handleSave = async () => {
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await db.saveEscalationSettings(
        rows.map((r) => ({
          factory_id: r.factory_id,
          enabled: r.enabled,
          unread_idle_minutes: Math.max(1, Number(r.unread_idle_minutes) || 15),
          escalation_scope: r.escalation_scope,
        })),
      );
      setNotice('エスカレーション設定を保存しました');
      await load();
      window.setTimeout(() => setNotice(''), 4000);
    } catch (e) {
      console.error('[AdminEscalationSection] save failed', e);
      setError(e?.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={SECTION}>
      <h2 className="text-lg font-black text-gray-900 dark:text-white">🚨 工場別自動エスカレーション設定</h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        工場で通知が未読のまま放置された場合の、警告範囲の自動拡大ルールを工場ごとに設定します（管理者のみ）。
      </p>

      {error ? (
        <p
          className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">読み込み中…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">登録されている工場がありません。</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
          <table className="min-w-[720px] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-slate-50 text-left dark:border-gray-700 dark:bg-slate-900/80">
                <th className="px-3 py-3 font-black text-gray-900 dark:text-white">有効</th>
                <th className="px-3 py-3 font-black text-gray-900 dark:text-white">工場名</th>
                <th className="px-3 py-3 font-black text-gray-900 dark:text-white">
                  <div className="flex flex-wrap items-center gap-2">
                    <span>未読放置時間</span>
                    <button
                      type="button"
                      onClick={copyFirstRowToAll}
                      className="rounded-lg border border-indigo-300 bg-indigo-50 px-2 py-1 text-[11px] font-black text-indigo-900 hover:bg-indigo-100 dark:border-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-200 dark:hover:bg-indigo-900/60"
                      title="一覧先頭の工場の「分」と「範囲」を全行へコピー"
                    >
                      全工場にこの設定をコピー
                    </button>
                  </div>
                </th>
                <th className="px-3 py-3 font-black text-gray-900 dark:text-white">通知エスカレーション範囲</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.factory_id}
                  className="border-b border-gray-100 hover:bg-slate-50/80 dark:border-gray-700 dark:hover:bg-slate-700/40"
                >
                  <td className="px-3 py-3 align-middle">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={Boolean(row.enabled)}
                        onChange={(e) => updateRow(row.factory_id, { enabled: e.target.checked })}
                        className="h-5 w-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 dark:border-gray-600 dark:bg-gray-900"
                      />
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-300">
                        {row.enabled ? 'ON' : 'OFF'}
                      </span>
                    </label>
                  </td>
                  <td className="px-3 py-3 align-middle font-bold text-gray-900 dark:text-white">
                    {row.factory_name}
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number"
                        min={1}
                        value={row.unread_idle_minutes}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10);
                          updateRow(row.factory_id, {
                            unread_idle_minutes: Number.isFinite(n) && n >= 1 ? n : 1,
                          });
                        }}
                        className="w-20 rounded border border-gray-200 bg-white px-2 py-1.5 text-center font-bold text-gray-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 dark:border-gray-600 dark:bg-gray-900 dark:text-white dark:focus:border-indigo-500"
                        aria-label={`${row.factory_name} の未読放置時間（分）`}
                      />
                      <span className="text-xs font-bold text-slate-600 dark:text-slate-400">分</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 align-middle">
                    <select
                      value={row.escalation_scope}
                      onChange={(e) => updateRow(row.factory_id, { escalation_scope: e.target.value })}
                      className="min-w-[12rem] max-w-full rounded border border-gray-200 bg-white px-2 py-1.5 text-sm font-medium text-gray-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 dark:border-gray-600 dark:bg-gray-900 dark:text-white dark:focus:border-indigo-500"
                      aria-label={`${row.factory_name} のエスカレーション範囲`}
                    >
                      {ESCALATION_SCOPE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 flex justify-end">
        <button
          type="button"
          disabled={saving || loading || rows.length === 0}
          onClick={() => void handleSave()}
          className="min-h-[48px] rounded-xl border-2 border-blue-500 bg-blue-600 px-6 text-sm font-black text-white shadow-lg shadow-blue-900/30 transition hover:bg-blue-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:border-slate-500 disabled:bg-slate-600 dark:border-blue-400 dark:bg-blue-500 dark:shadow-blue-950/50 dark:hover:bg-blue-400"
        >
          {saving ? '保存中…' : 'エスカレーション設定を保存する'}
        </button>
      </div>
    </section>
  );
}
