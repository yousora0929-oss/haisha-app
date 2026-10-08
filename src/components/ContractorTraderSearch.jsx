import React, { useEffect, useState } from 'react';
import * as db from '../haishaDb.js';
import { ContractorTraderHistory } from './ContractorTraderHistory.jsx';

const DAY_OPTIONS = [90, 180, 365];

export function ContractorTraderSearch({ onClose }) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [candidates, setCandidates] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [selected, setSelected] = useState(null);
  const [days, setDays] = useState(90);
  const [history, setHistory] = useState(undefined);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(String(query || '').trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (debouncedQuery.length < 1) {
      setCandidates([]);
      setSearching(false);
      setSearchError('');
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    setSearchError('');
    db.searchContractorsForHistory(debouncedQuery, 20)
      .then((rows) => {
        if (cancelled) return;
        setCandidates(rows);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[ContractorTraderSearch] 候補の取得に失敗', err);
        setCandidates([]);
        setSearchError(err?.message || '候補を取得できませんでした');
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery]);

  useEffect(() => {
    const id = String(selected?.customer_id || '').trim();
    if (!id) {
      setHistory(undefined);
      setHistoryError('');
      setHistoryLoading(false);
      return undefined;
    }
    let cancelled = false;
    setHistoryLoading(true);
    setHistoryError('');
    db.fetchContractorOrderHistory(id, days)
      .then((data) => {
        if (cancelled) return;
        setHistory(data ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[ContractorTraderSearch] 実績の取得に失敗', err);
        setHistory(undefined);
        setHistoryError(err?.message || '実績を取得できませんでした');
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected, days]);

  return (
    <div className="flex max-h-[85vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-base font-black text-slate-900">商社検索</h2>
          <p className="mt-1 text-xs text-slate-500">候補から業者を選ぶと、その請求先の商社実績を表示します</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] rounded-lg px-3 text-sm font-bold text-slate-600 hover:bg-slate-100"
        >
          閉じる
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <label className="block text-xs font-black text-slate-600">
          業者名
          <input
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(null);
            }}
            placeholder="業者名の一部"
            className="mt-1 min-h-[44px] w-full rounded-xl border-2 border-slate-300 px-3 text-base font-semibold text-slate-900 outline-none focus:border-sky-500"
          />
        </label>
        {searchError ? <p className="text-sm font-bold text-red-700">{searchError}</p> : null}
        {searching ? <p className="text-xs font-bold text-slate-400">候補を検索中…</p> : null}
        {!searching && debouncedQuery && candidates.length === 0 && !searchError ? (
          <p className="text-sm font-bold text-slate-500">該当する業者がありません</p>
        ) : null}
        {candidates.length > 0 && !selected ? (
          <ul className="space-y-2">
            {candidates.map((row) => (
              <li key={row.customer_id}>
                <button
                  type="button"
                  onClick={() => {
                    setSelected(row);
                    setQuery(row.company_name);
                  }}
                  className="min-h-[44px] w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm font-black text-slate-900 hover:border-sky-400 hover:bg-sky-50"
                >
                  {row.company_name}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {selected ? (
          <div className="space-y-3">
            <p className="text-sm font-black text-slate-900">選択中：{selected.company_name}</p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="集計期間">
              {DAY_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setDays(option)}
                  className={
                    'min-h-[44px] rounded-xl border-2 px-4 text-sm font-black ' +
                    (days === option
                      ? 'border-sky-600 bg-sky-600 text-white'
                      : 'border-slate-300 bg-white text-slate-800')
                  }
                >
                  {option}日
                </button>
              ))}
            </div>
            {historyError ? <p className="text-sm font-bold text-red-700">{historyError}</p> : null}
            {historyLoading ? <p className="text-sm font-bold text-slate-400">実績を読み込み中…</p> : null}
            {!historyLoading && !historyError ? <ContractorTraderHistory history={history} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
