import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as db from '../haishaDb.js';
import {
  countUnreadNewsForFactory,
  describeNewsTargets,
  formatFactoryNewsDate,
  formatFactoryNewsDateShort,
} from '../utils/factoryNews.js';
import { FactoryNewsReadStatus } from './FactoryNewsReadStatus.jsx';

const SCROLL_LOG =
  'max-h-[500px] overflow-y-auto overscroll-y-contain rounded-xl border border-slate-200 bg-white shadow-inner dark:border-slate-600 dark:bg-slate-800/90';

const ROW_BASE =
  'flex w-full min-h-[44px] items-center gap-2 border-b border-slate-100 px-3 py-2 text-left transition-colors last:border-b-0 dark:border-slate-700/80';
const ROW_HOVER = 'hover:bg-slate-50 dark:hover:bg-slate-700/40';
const ROW_UNREAD = 'bg-indigo-50/40 dark:bg-indigo-950/20';
const ROW_EXPANDED = 'bg-slate-50 dark:bg-slate-900/60';

/**
 * 工場画面 — お知らせタブ（縮小1行 + アコーディオン展開）
 */
export function FactoryNewsPanel({ factoryId, factories = [] }) {
  const [news, setNews] = useState([]);
  const [reads, setReads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const [markingId, setMarkingId] = useState(null);

  const factoryNameById = useMemo(
    () => Object.fromEntries((factories || []).filter((f) => f?.id).map((f) => [String(f.id), f.name || f.id])),
    [factories],
  );

  const load = useCallback(async () => {
    if (!factoryId) {
      setNews([]);
      setReads([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const feed = await db.fetchFactoryNewsFeed(factoryId);
      setNews(feed.news || []);
      setReads(feed.reads || []);
    } catch (e) {
      console.error('[FactoryNewsPanel] load failed', e);
      setError(e?.message || 'お知らせの取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [factoryId]);

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

  const unreadCount = useMemo(
    () => countUnreadNewsForFactory(news, reads, factoryId),
    [news, reads, factoryId],
  );

  const isSelfRead = useCallback(
    (newsId) => reads.some((r) => String(r.news_id) === String(newsId) && String(r.factory_id) === String(factoryId)),
    [reads, factoryId],
  );

  const toggleRow = async (item) => {
    if (!item?.id) return;
    const id = String(item.id);
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (!isSelfRead(id)) {
      setMarkingId(id);
      try {
        await db.markFactoryNewsRead(id, factoryId);
        await load();
      } catch (e) {
        console.error('[FactoryNewsPanel] mark read failed', e);
        setError(e?.message || '既読の記録に失敗しました');
      } finally {
        setMarkingId(null);
      }
    }
  };

  if (!factoryId) {
    return (
      <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600 dark:border-slate-600 dark:bg-slate-900">
        工場にログインするとお知らせを表示できます。
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 pb-8">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">お知らせ</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            行をタップして本文を表示 · 過去ログは下の枠内でスクロール
          </p>
        </div>
        {unreadCount > 0 ? (
          <span className="rounded-full bg-red-500 px-2.5 py-1 text-xs font-black text-white shadow-sm">
            未読 {unreadCount}
          </span>
        ) : null}
      </header>

      {error ? (
        <p
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-slate-500 dark:text-slate-400">読み込み中…</p> : null}

      {!loading && news.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-600 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-400">
          お知らせはまだありません。
        </p>
      ) : null}

      {!loading && news.length > 0 ? (
        <div className={SCROLL_LOG} role="region" aria-label="お知らせ一覧（過去ログ）">
          <ul>
            {news.map((item) => {
              const read = isSelfRead(item.id);
              const expanded = expandedId === String(item.id);
              const marking = markingId === String(item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => void toggleRow(item)}
                    className={
                      ROW_BASE +
                      ROW_HOVER +
                      (expanded ? ' ' + ROW_EXPANDED : '') +
                      (!read && !expanded ? ' ' + ROW_UNREAD : '')
                    }
                  >
                    <span className="w-[5.5rem] shrink-0 text-[11px] font-bold tabular-nums text-slate-500 dark:text-slate-400">
                      {formatFactoryNewsDateShort(item.created_at)}
                    </span>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      {!read ? (
                        <span
                          className="h-2 w-2 shrink-0 rounded-full bg-red-500 shadow-[0_0_0_2px_rgba(239,68,68,0.25)]"
                          title="未読"
                          aria-hidden
                        />
                      ) : null}
                      <span className="truncate text-sm font-black text-slate-900 dark:text-slate-100">{item.title}</span>
                    </span>
                    <span
                      className={
                        'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ' +
                        (read
                          ? 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
                          : 'bg-red-500 text-white shadow-sm')
                      }
                    >
                      {read ? '既読' : '未読'}
                    </span>
                    <span
                      className={
                        'shrink-0 text-slate-400 transition-transform duration-200 dark:text-slate-500 ' +
                        (expanded ? 'rotate-180' : '')
                      }
                      aria-hidden
                    >
                      ▾
                    </span>
                  </button>

                  {expanded ? (
                    <div className="border-b border-slate-100 bg-slate-50/90 px-3 pb-4 pt-1 transition-colors duration-200 dark:border-slate-700 dark:bg-slate-900/50">
                      <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                        {formatFactoryNewsDate(item.created_at)} · 配信先:{' '}
                        {describeNewsTargets(item, factoryNameById)}
                      </p>
                      {marking ? (
                        <p className="mt-2 text-xs font-bold text-indigo-600 dark:text-indigo-300">既読を記録中…</p>
                      ) : null}
                      <div className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200">
                        {item.body}
                      </div>
                      <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-600">
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
    </div>
  );
}
