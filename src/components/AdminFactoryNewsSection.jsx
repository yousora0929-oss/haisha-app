import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as db from '../haishaDb.js';
import {
  buildFactoryReadStatuses,
  describeNewsTargets,
  formatFactoryNewsDate,
  formatFactoryNewsDateShort,
} from '../utils/factoryNews.js';
import { FactoryNewsReadStatus } from './FactoryNewsReadStatus.jsx';

const SECTION =
  'rounded-2xl border border-slate-200 bg-white p-4 shadow-md dark:border-slate-700 dark:bg-slate-800 sm:p-6';

/**
 * 管理画面 — ニュース配信タブ
 */
export function AdminFactoryNewsSection({ factories = [] }) {
  const [news, setNews] = useState([]);
  const [reads, setReads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedFactoryIds, setSelectedFactoryIds] = useState(() => new Set());
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);

  const factoryNameById = useMemo(
    () => Object.fromEntries((factories || []).filter((f) => f?.id).map((f) => [String(f.id), f.name || f.id])),
    [factories],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const feed = await db.fetchFactoryNewsAdminFeed();
      setNews(feed.news || []);
      setReads(feed.reads || []);
    } catch (e) {
      console.error('[AdminFactoryNewsSection] load failed', e);
      setError(e?.message || '配信履歴の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let unsub = () => {};
    void (async () => {
      unsub = await db.subscribeHaishaRealtime((payload) => {
        const table = payload?.table;
        if (table === 'factory_news' || table === 'factory_news_reads') {
          void load();
        }
      });
    })();
    return () => unsub();
  }, [load]);

  const allSelected = factories.length > 0 && selectedFactoryIds.size === factories.length;
  const broadcastAll = selectedFactoryIds.size === 0;

  const toggleFactory = (id) => {
    setSelectedFactoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllFactories = () => {
    setSelectedFactoryIds(new Set(factories.map((f) => String(f.id))));
  };

  const clearTargets = () => setSelectedFactoryIds(new Set());

  const handlePublish = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const targetIds = broadcastAll ? [] : [...selectedFactoryIds];
      await db.publishFactoryNews({
        title,
        body,
        targetFactoryIds: targetIds,
      });
      setTitle('');
      setBody('');
      setSelectedFactoryIds(new Set());
      setNotice('ニュースを配信しました。');
      await load();
      window.setTimeout(() => setNotice(''), 4000);
    } catch (err) {
      setError(err?.message || '配信に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const fieldClass =
    'mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 outline-none focus:border-indigo-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

  return (
    <div className="space-y-6">
      <section className={SECTION}>
        <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">ニュース配信</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          工場タブレットの「お知らせ」に即時反映されます。配信先を未選択の場合は全工場向けです。
        </p>

        {error ? (
          <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800 dark:border-red-800 dark:bg-red-950/40" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40" role="status">
            {notice}
          </p>
        ) : null}

        <form onSubmit={handlePublish} className="mt-4 space-y-4">
          <div>
            <label className="text-xs font-bold text-slate-600 dark:text-slate-300" htmlFor="news-title">
              件名（タイトル） <span className="text-red-600">*</span>
            </label>
            <input
              id="news-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={fieldClass}
              required
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600 dark:text-slate-300" htmlFor="news-body">
              本文（内容） <span className="text-red-600">*</span>
            </label>
            <textarea
              id="news-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              className={fieldClass + ' min-h-[120px] resize-y'}
              required
            />
          </div>

          <fieldset className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-900/40">
            <legend className="px-1 text-xs font-black text-slate-700 dark:text-slate-200">配信対象の工場</legend>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={selectAllFactories}
                className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-xs font-black text-indigo-900 dark:border-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-100"
              >
                全工場にチェック
              </button>
              <button
                type="button"
                onClick={clearTargets}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-700 dark:border-slate-600 dark:bg-slate-800"
              >
                全工場向け（チェックなし）
              </button>
            </div>
            <p className="mt-2 text-[10px] font-medium text-slate-500">
              {broadcastAll
                ? '現在: 全工場向けに配信します'
                : allSelected
                  ? '現在: 全工場を個別指定（全工場向けと同等）'
                  : `現在: ${selectedFactoryIds.size} 工場を指定`}
            </p>
            <ul className="mt-3 max-h-40 space-y-1 overflow-y-auto">
              {factories.map((f) => (
                <li key={f.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm font-bold dark:border-slate-600 dark:bg-slate-800">
                    <input
                      type="checkbox"
                      checked={selectedFactoryIds.has(String(f.id))}
                      onChange={() => toggleFactory(String(f.id))}
                      className="h-4 w-4 rounded"
                    />
                    {f.name || f.id}
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>

          <button
            type="submit"
            disabled={saving}
            className="min-h-[48px] w-full rounded-xl bg-indigo-600 text-sm font-black text-white shadow hover:bg-indigo-700 disabled:opacity-50 sm:w-auto sm:px-8"
          >
            {saving ? '配信中…' : 'ニュースを配信する'}
          </button>
        </form>
      </section>

      <section className={SECTION}>
        <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">配信履歴</h2>
        <p className="mt-1 text-xs text-slate-500">各工場の既読状況はリアルタイムで更新されます</p>

        {loading ? <p className="mt-4 text-sm text-slate-500">読み込み中…</p> : null}

        {!loading && news.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-600">
            配信履歴はありません
          </p>
        ) : null}

        {!loading && news.length > 0 ? (
          <div
            className="mt-4 max-h-[400px] overflow-y-auto overscroll-y-contain rounded-xl border border-slate-200 bg-slate-50/80 shadow-inner dark:border-slate-600 dark:bg-slate-900/50"
            role="region"
            aria-label="配信履歴（過去ログ）"
          >
            <div className="sticky top-0 z-10 grid grid-cols-[5.5rem_1fr_auto] gap-2 border-b border-slate-200 bg-slate-100/95 px-3 py-2 text-[10px] font-black uppercase tracking-wide text-slate-500 backdrop-blur-sm dark:border-slate-600 dark:bg-slate-800/95 dark:text-slate-400">
              <span>送信日</span>
              <span>件名</span>
              <span className="text-right">進捗</span>
            </div>
            <ul>
              {news.map((item) => {
                const statuses = buildFactoryReadStatuses(item, reads, factories);
                const readCount = statuses.filter((s) => s.read).length;
                const total = statuses.length;
                const expanded = expandedHistoryId === String(item.id);
                const readNames = statuses.filter((s) => s.read).map((s) => s.factoryName);
                const unreadNames = statuses.filter((s) => !s.read).map((s) => s.factoryName);
                const hasUnread = unreadNames.length > 0;

                return (
                  <li key={item.id} className="border-b border-slate-100 last:border-b-0 dark:border-slate-700/80">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      onClick={() =>
                        setExpandedHistoryId((prev) => (prev === String(item.id) ? null : String(item.id)))
                      }
                      className={
                        'grid w-full min-h-[40px] grid-cols-[5.5rem_1fr_auto] items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-white dark:hover:bg-slate-800 ' +
                        (expanded ? 'bg-white dark:bg-slate-800' : '')
                      }
                    >
                      <span className="text-[11px] font-bold tabular-nums text-slate-500 dark:text-slate-400">
                        {formatFactoryNewsDateShort(item.created_at)}
                      </span>
                      <span className="flex min-w-0 items-center gap-1.5">
                        {hasUnread ? (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full bg-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.25)]"
                            title="未読の工場あり"
                            aria-hidden
                          />
                        ) : null}
                        <span className="truncate text-sm font-black text-slate-900 dark:text-slate-100">{item.title}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 justify-self-end">
                        <span
                          className={
                            'rounded-full px-2 py-0.5 text-[10px] font-black ' +
                            (readCount === total && total > 0
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200'
                              : 'bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100')
                          }
                        >
                          {total > 0 ? `${readCount}/${total}` : '—'}
                        </span>
                        <span
                          className={
                            'text-slate-400 transition-transform duration-200 dark:text-slate-500 ' +
                            (expanded ? 'rotate-180' : '')
                          }
                          aria-hidden
                        >
                          ▾
                        </span>
                      </span>
                    </button>

                    {expanded ? (
                      <div className="border-t border-slate-100 bg-white px-3 pb-4 pt-2 dark:border-slate-700 dark:bg-slate-800/80">
                        <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                          {formatFactoryNewsDate(item.created_at)} · 対象: {describeNewsTargets(item, factoryNameById)}
                        </p>
                        <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                          {item.body}
                        </p>
                        <p className="mt-3 text-xs font-bold text-emerald-800 dark:text-emerald-300">
                          既読: {readNames.length ? readNames.join('、') : '—'}
                        </p>
                        <p className="mt-1 text-xs font-bold text-amber-800 dark:text-amber-200">
                          未読: {unreadNames.length ? unreadNames.join('、') : '—'}
                        </p>
                        <div className="mt-3">
                          <FactoryNewsReadStatus news={item} reads={reads} factories={factories} compact />
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </section>
    </div>
  );
}
