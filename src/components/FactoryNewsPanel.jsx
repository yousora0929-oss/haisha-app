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
  'max-h-[min(70vh,640px)] overflow-y-auto overscroll-y-contain rounded-2xl border-2 border-slate-200 bg-white shadow-inner dark:border-slate-600 dark:bg-slate-800/90';

const ROW_BASE =
  'flex w-full min-h-[56px] items-center gap-3 border-b-2 border-slate-100 px-4 py-3.5 text-left transition-colors last:border-b-0 sm:min-h-[60px] sm:gap-4 sm:px-5 dark:border-slate-700/80';
const ROW_HOVER = 'hover:bg-slate-50 active:bg-slate-100 dark:hover:bg-slate-700/40 dark:active:bg-slate-700/60';
const ROW_UNREAD = 'bg-indigo-50/50 dark:bg-indigo-950/25';
const ROW_EXPANDED = 'bg-slate-50 dark:bg-slate-900/60';

/**
 * 工場画面 — お知らせタブ（縮小1行 + アコーディオン展開・タブレット向け大きめUI）
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
      <p className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center text-base font-medium text-slate-600 dark:border-slate-600 dark:bg-slate-900">
        工場にログインするとお知らせを表示できます。
      </p>
    );
  }

  return (
    <div className="mx-auto w-full max-w-4xl space-y-5 px-1 pb-10 sm:px-2">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-black tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">お知らせ</h2>
          <p className="mt-2 text-sm font-medium text-slate-600 dark:text-slate-400 sm:text-base">
            行をタップして本文を表示 · 過去のお知らせは下の枠内でスクロール
          </p>
        </div>
        {unreadCount > 0 ? (
          <span className="rounded-full bg-red-500 px-4 py-2 text-sm font-black text-white shadow-md sm:text-base">
            未読 {unreadCount}
          </span>
        ) : null}
      </header>

      {error ? (
        <p
          className="rounded-xl border-2 border-red-300 bg-red-50 px-4 py-3 text-base font-bold text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-base font-medium text-slate-500 dark:text-slate-400">読み込み中…</p> : null}

      {!loading && news.length === 0 ? (
        <p className="rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-14 text-center text-base font-medium text-slate-600 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-400">
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
                    <span className="w-[6.5rem] shrink-0 text-sm font-bold tabular-nums text-slate-600 dark:text-slate-400 sm:w-[7.5rem] sm:text-base">
                      {formatFactoryNewsDateShort(item.created_at)}
                    </span>
                    <span className="flex min-w-0 flex-1 items-center gap-2.5">
                      {!read ? (
                        <span
                          className="h-3 w-3 shrink-0 rounded-full bg-red-500 shadow-[0_0_0_3px_rgba(239,68,68,0.3)] sm:h-3.5 sm:w-3.5"
                          title="未読"
                          aria-hidden
                        />
                      ) : null}
                      <span className="line-clamp-2 text-base font-black leading-snug text-slate-900 dark:text-slate-100 sm:text-lg">
                        {item.title}
                      </span>
                    </span>
                    <span
                      className={
                        'shrink-0 rounded-full px-3 py-1 text-xs font-black sm:text-sm ' +
                        (read
                          ? 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                          : 'bg-red-500 text-white shadow-sm')
                      }
                    >
                      {read ? '既読' : '未読'}
                    </span>
                    <span
                      className={
                        'shrink-0 text-xl leading-none text-slate-400 transition-transform duration-200 dark:text-slate-500 ' +
                        (expanded ? 'rotate-180' : '')
                      }
                      aria-hidden
                    >
                      ▾
                    </span>
                  </button>

                  {expanded ? (
                    <div className="border-b-2 border-slate-100 bg-slate-50/90 px-4 pb-6 pt-2 transition-colors duration-200 sm:px-5 dark:border-slate-700 dark:bg-slate-900/50">
                      <p className="text-sm font-bold text-slate-600 dark:text-slate-400 sm:text-base">
                        {formatFactoryNewsDate(item.created_at)} · 配信先:{' '}
                        {describeNewsTargets(item, factoryNameById)}
                      </p>
                      {marking ? (
                        <p className="mt-3 text-sm font-bold text-indigo-600 dark:text-indigo-300 sm:text-base">
                          既読を記録中…
                        </p>
                      ) : null}
                      <div className="mt-4 whitespace-pre-wrap text-base leading-relaxed text-slate-800 dark:text-slate-200 sm:text-lg sm:leading-loose">
                        {item.body}
                      </div>
                      <div className="mt-5 border-t-2 border-slate-200 pt-4 dark:border-slate-600">
                        <FactoryNewsReadStatus
                          news={item}
                          reads={reads}
                          factories={factories}
                          comfortable
                        />
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
