import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as db from '../haishaDb.js';
import { MixDesignRequestPrint } from './MixDesignRequestPrint.jsx';
import {
  mixDesignPrintPropsFromDb,
  mixDesignStatusLabel,
} from '../utils/mixDesignRequest.js';
import './mixDesignPrint.css';

function formatRequestedAt(value) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw.slice(0, 16);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

/**
 * 配合計画書依頼履歴の検索・一覧・印刷プレビュー
 */
export function MixDesignRequestHistorySection({ factories = [], active = true }) {
  const [keyword, setKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [printLoadingId, setPrintLoadingId] = useState('');
  const [printBundle, setPrintBundle] = useState(null);

  const factoryNameById = useMemo(() => {
    const map = new Map();
    for (const f of Array.isArray(factories) ? factories : []) {
      if (!f?.id) continue;
      map.set(String(f.id), String(f.name || f.id));
    }
    return map;
  }, [factories]);

  const loadRows = useCallback(async (q) => {
    setLoading(true);
    setError('');
    try {
      const list = await db.searchMixDesignRequests({ keyword: q, limit: 50 });
      setRows(list);
    } catch (err) {
      console.error('配合計画書依頼履歴の取得に失敗しました', err);
      setError(err?.message || '依頼履歴の取得に失敗しました');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    void loadRows(submittedKeyword);
    return undefined;
  }, [active, submittedKeyword, loadRows]);

  const handleSearch = (event) => {
    event?.preventDefault?.();
    setSubmittedKeyword(String(keyword || '').trim());
  };

  const openPrint = async (requestId) => {
    const id = String(requestId || '').trim();
    if (!id) return;
    setPrintLoadingId(id);
    setError('');
    try {
      const { request, items } = await db.fetchMixDesignRequestWithItems(id);
      setPrintBundle(mixDesignPrintPropsFromDb(request, items));
    } catch (err) {
      console.error('配合計画書依頼の印刷データ取得に失敗しました', err);
      const message = err?.message || '印刷データの取得に失敗しました';
      setError(message);
      window.alert(message);
    } finally {
      setPrintLoadingId('');
    }
  };

  const runPrint = () => {
    document.body.classList.add('mix-design-printing');
    const cleanup = () => {
      document.body.classList.remove('mix-design-printing');
      window.removeEventListener('afterprint', cleanup);
    };
    window.addEventListener('afterprint', cleanup);
    window.setTimeout(() => window.print(), 50);
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-md sm:p-6 lg:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-base font-black text-slate-900">配合計画書依頼履歴</h2>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            過去の配合計画書作成依頼を検索・確認・印刷できます。現場名・業者名・商社名・現場住所のいずれかに部分一致します。
          </p>
        </div>
      </div>

      <form onSubmit={handleSearch} className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="min-w-0 flex-1 text-xs font-black text-slate-600">
          検索
          <input
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="現場名・業者名・商社名・現場住所"
            className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300"
          />
        </label>
        <button
          type="submit"
          className="min-h-[48px] shrink-0 rounded-xl border-2 border-indigo-600 bg-indigo-600 px-5 text-sm font-black text-white hover:bg-indigo-700"
        >
          検索
        </button>
      </form>

      {error ? (
        <p className="mt-3 text-sm font-bold text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="mt-5 text-center text-sm font-bold text-slate-400">読み込み中…</p>
      ) : rows.length === 0 ? (
        <p className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-500">
          {submittedKeyword ? '条件に一致する依頼はありません。' : 'まだ配合計画書の依頼がありません。'}
        </p>
      ) : (
        <ul className="mt-5 grid grid-cols-1 gap-3">
          {rows.map((row) => {
            const factoryName =
              factoryNameById.get(String(row.requested_to_factory_id || '')) ||
              (row.requested_to_factory_id ? String(row.requested_to_factory_id) : '未指定');
            return (
              <li key={row.id}>
                <article className="rounded-2xl border-2 border-slate-200 bg-slate-50 p-4 shadow-sm">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-black text-slate-900">
                        {row.project_name || '（現場名なし）'}
                      </p>
                      <dl className="mt-2 grid gap-1 text-xs font-bold text-slate-600 sm:grid-cols-2">
                        <div>
                          <dt className="inline text-slate-400">業者名 </dt>
                          <dd className="inline text-slate-800">{row.contractor_name || '—'}</dd>
                        </div>
                        <div>
                          <dt className="inline text-slate-400">依頼先工場 </dt>
                          <dd className="inline text-slate-800">{factoryName}</dd>
                        </div>
                        <div>
                          <dt className="inline text-slate-400">依頼日 </dt>
                          <dd className="inline text-slate-800">{formatRequestedAt(row.created_at)}</dd>
                        </div>
                        <div>
                          <dt className="inline text-slate-400">ステータス </dt>
                          <dd className="inline text-slate-800">{mixDesignStatusLabel(row.status)}</dd>
                        </div>
                        {row.trading_company_name ? (
                          <div className="sm:col-span-2">
                            <dt className="inline text-slate-400">商社名 </dt>
                            <dd className="inline text-slate-800">{row.trading_company_name}</dd>
                          </div>
                        ) : null}
                        {row.site_address ? (
                          <div className="sm:col-span-2">
                            <dt className="inline text-slate-400">現場住所 </dt>
                            <dd className="inline break-words text-slate-800">{row.site_address}</dd>
                          </div>
                        ) : null}
                      </dl>
                    </div>
                    <button
                      type="button"
                      onClick={() => void openPrint(row.id)}
                      disabled={printLoadingId === String(row.id)}
                      className="min-h-[44px] shrink-0 rounded-xl border-2 border-slate-800 bg-slate-900 px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300"
                    >
                      {printLoadingId === String(row.id) ? '読込中…' : '印刷'}
                    </button>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}

      {printBundle ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
          <div className="flex max-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[92dvh] sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div>
                <h3 className="text-base font-black text-slate-900">印刷プレビュー</h3>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  {printBundle.header?.projectName || '現場未設定'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPrintBundle(null)}
                className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
              >
                閉じる
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              <div className="mix-design-print-root">
                <div className="mix-design-print-preview">
                  <MixDesignRequestPrint
                    header={printBundle.header}
                    request={printBundle.request}
                    items={printBundle.items}
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-2 border-t border-slate-200 px-4 py-3">
              <button
                type="button"
                onClick={() => setPrintBundle(null)}
                className="min-h-[48px] flex-1 rounded-xl border-2 border-slate-300 bg-white text-sm font-black text-slate-700"
              >
                閉じる
              </button>
              <button
                type="button"
                onClick={runPrint}
                className="min-h-[48px] flex-1 rounded-xl border-2 border-slate-900 bg-slate-900 text-sm font-black text-white"
              >
                印刷 / PDF
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
