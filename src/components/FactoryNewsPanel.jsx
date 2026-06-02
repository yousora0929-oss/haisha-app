import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as db from '../haishaDb.js';
import {
  countUnreadNewsForFactory,
  describeNewsTargets,
  formatFactoryNewsDate,
} from '../utils/factoryNews.js';
import { FactoryNewsReadStatus } from './FactoryNewsReadStatus.jsx';

const CARD =
  'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-indigo-200 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-indigo-600';

/**
 * 工場画面 — お知らせタブ
 */
export function FactoryNewsPanel({ factoryId, factories = [] }) {
  const [news, setNews] = useState([]);
  const [reads, setReads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [opening, setOpening] = useState(false);

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

  const openNews = async (item) => {
    if (!item?.id) return;
    setOpening(true);
    setSelected(item);
    try {
      if (!isSelfRead(item.id)) {
        await db.markFactoryNewsRead(item.id);
        await load();
      }
    } catch (e) {
      console.error('[FactoryNewsPanel] mark read failed', e);
      setError(e?.message || '既読の記録に失敗しました');
    } finally {
      setOpening(false);
    }
  };

  const closeModal = () => setSelected(null);

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
            管理者からのニュース · 他工場の既読状況も確認できます
          </p>
        </div>
        {unreadCount > 0 ? (
          <span className="rounded-full bg-red-500 px-2.5 py-1 text-xs font-black text-white">
            未読 {unreadCount}
          </span>
        ) : null}
      </header>

      {error ? (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? <p className="text-sm text-slate-500">読み込み中…</p> : null}

      {!loading && news.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm text-slate-600 dark:border-slate-600 dark:bg-slate-900/50">
          お知らせはまだありません。
        </p>
      ) : null}

      <ul className="space-y-3">
        {!loading
          ? news.map((item) => {
              const read = isSelfRead(item.id);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => void openNews(item)}
                    className={'w-full text-left ' + CARD + (read ? '' : ' ring-2 ring-indigo-200 dark:ring-indigo-700')}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <p className="text-[10px] font-bold text-slate-500 dark:text-slate-400">
                        {formatFactoryNewsDate(item.created_at)}
                      </p>
                      <span
                        className={
                          'shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ' +
                          (read
                            ? 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                            : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200')
                        }
                      >
                        {read ? '既読' : '未読'}
                      </span>
                    </div>
                    <h3 className="mt-2 text-base font-black text-slate-900 dark:text-slate-100">{item.title}</h3>
                    <p className="mt-1 line-clamp-2 text-sm text-slate-600 dark:text-slate-300">{item.body}</p>
                    <p className="mt-2 text-[10px] font-bold text-slate-500">
                      配信先: {describeNewsTargets(item, factoryNameById)}
                    </p>
                    <div className="mt-3 border-t border-slate-100 pt-3 dark:border-slate-700">
                      <FactoryNewsReadStatus news={item} reads={reads} factories={factories} compact />
                    </div>
                  </button>
                </li>
              );
            })
          : null}
      </ul>

      {selected ? (
        <div
          className="fixed inset-0 z-[250] flex items-end justify-center bg-slate-900/50 p-4 sm:items-center"
          role="presentation"
          onClick={closeModal}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-600 dark:bg-slate-800"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-[10px] font-bold text-slate-500">{formatFactoryNewsDate(selected.created_at)}</p>
            <h3 className="mt-1 text-lg font-black text-slate-900 dark:text-slate-100">{selected.title}</h3>
            <p className="mt-1 text-xs font-bold text-slate-500">
              配信先: {describeNewsTargets(selected, factoryNameById)}
            </p>
            <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-slate-800 dark:text-slate-200">
              {selected.body}
            </div>
            <div className="mt-4 border-t border-slate-200 pt-4 dark:border-slate-600">
              <FactoryNewsReadStatus news={selected} reads={reads} factories={factories} />
            </div>
            <button
              type="button"
              disabled={opening}
              onClick={closeModal}
              className="mt-5 min-h-[44px] w-full rounded-xl bg-indigo-600 text-sm font-black text-white disabled:opacity-50"
            >
              閉じる
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
