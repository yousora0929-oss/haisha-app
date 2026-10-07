import React, { useEffect, useState } from 'react';
import * as db from '../haishaDb.js';
import {
  OWN_COMPANY_HISTORY_NOTE,
  billingPartyNote,
  formatHistoryMonthDay,
  formatTradingHistoryLine,
  isContractorHistoryEmpty,
  isContractorHistoryHidden,
  isHistoryProjectSelected,
  readContractorHistoryCache,
  recentProjectTitle,
  recentProjectTraderName,
  resolveTappableProject,
  sortTradingCompanies,
  writeContractorHistoryCache,
} from '../utils/contractorHistoryDisplay.js';

function RestrictedNote({ show }) {
  if (!show) return null;
  return <span className="ml-1 text-[10px] font-medium text-slate-500">{OWN_COMPANY_HISTORY_NOTE}</span>;
}

export function ContractorHistoryPanel({
  contractorCustomerId,
  selectableProjects,
  selectedProjectId,
  onSelectProject,
  getProjectLabel,
  reloadToken = 0,
}) {
  const [history, setHistory] = useState(undefined);
  const [status, setStatus] = useState('idle');

  useEffect(() => {
    const id = String(contractorCustomerId || '').trim();
    if (!id) {
      setHistory(undefined);
      setStatus('idle');
      return undefined;
    }
    const cached = readContractorHistoryCache(id);
    if (cached !== undefined) {
      setHistory(cached);
      setStatus('ready');
      return undefined;
    }
    let cancelled = false;
    setHistory(undefined);
    setStatus('loading');
    db.fetchContractorOrderHistory(id)
      .then((data) => {
        if (cancelled) return;
        writeContractorHistoryCache(id, data ?? null);
        setHistory(data ?? null);
        setStatus('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[ContractorHistoryPanel] 実績の取得に失敗', err);
        setHistory(undefined);
        setStatus('error');
      });
    return () => {
      cancelled = true;
    };
  }, [contractorCustomerId, reloadToken]);

  if (!String(contractorCustomerId || '').trim()) return null;
  if (status === 'loading') {
    return <p className="mt-2 text-[11px] font-medium text-amber-800">実績を確認中…</p>;
  }
  if (status === 'error') {
    return <p className="mt-2 text-[11px] font-medium text-slate-400">実績を取得できませんでした</p>;
  }
  if (isContractorHistoryHidden(history)) return null;

  const trading = sortTradingCompanies(history.trading_companies);
  const projects = Array.isArray(history.recent_projects) ? history.recent_projects : [];
  const spotCount = Number(history.recent_spot?.order_count) || 0;
  const spotDate = formatHistoryMonthDay(history.recent_spot?.last_ordered_at);
  const restricted = history.restricted_to_own === true;

  if (isContractorHistoryEmpty(history)) {
    return (
      <div className="mt-2 rounded-lg border border-amber-200 bg-white px-3 py-2 text-[11px] font-bold text-slate-600">
        この業者の実績はまだありません
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-2">
      {trading.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-white px-3 py-2">
          <p className="text-[11px] font-black text-slate-700">
            過去の商社実績
            <RestrictedNote show={restricted} />
          </p>
          <ul className="mt-1 space-y-1">
            {trading.map((row, index) => (
              <li key={`${tradingCompanyKey(row)}-${index}`} className="text-[11px] font-medium text-slate-700">
                {formatTradingHistoryLine(row)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {projects.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-white px-3 py-2">
          <p className="text-[11px] font-black text-slate-700">
            最近の物件実績（直近90日）
            <RestrictedNote show={restricted} />
          </p>
          <ul className="mt-1 space-y-1">
            {projects.map((row) => {
              const project = resolveTappableProject(row, selectableProjects);
              const title = recentProjectTitle(row, project, getProjectLabel);
              const trader = recentProjectTraderName(row);
              const monthDay = formatHistoryMonthDay(row.last_ordered_at);
              const note = billingPartyNote(row);
              const muted = row.billed_to_contractor === false;
              const selected = isHistoryProjectSelected(row, selectedProjectId);
              const line = (
                <>
                  <span className="font-black text-slate-900">{title}</span>
                  <span> / </span>
                  <span className={muted ? 'text-slate-400' : 'text-slate-700'}>{trader}</span>
                  <span>{` / 発注${Number(row.order_count) || 0}件`}</span>
                  {monthDay ? <span>{` / 最終 ${monthDay}`}</span> : null}
                  {selected ? (
                    <span className="ml-2 inline-flex rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-black text-white">
                      選択中
                    </span>
                  ) : null}
                  {note ? <span className="mt-0.5 block text-[10px] font-medium text-slate-500">{note}</span> : null}
                </>
              );
              if (!project) {
                return (
                  <li
                    key={String(row.project_id || title)}
                    className="min-h-[44px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-medium text-slate-400"
                  >
                    {line}
                    <span className="mt-0.5 block text-[10px] font-medium text-slate-400">この発注先では選択できません</span>
                  </li>
                );
              }
              return (
                <li key={String(row.project_id || title)}>
                  <button
                    type="button"
                    onClick={() => onSelectProject?.(project)}
                    aria-label={`${title}を選択`}
                    className="min-h-[44px] w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-left text-[11px] font-medium text-slate-700 hover:border-amber-400 hover:bg-amber-50 active:scale-[0.99]"
                  >
                    {line}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {spotCount > 0 ? (
        <p className="rounded-lg border border-amber-200 bg-white px-3 py-2 text-[11px] font-medium text-slate-600">
          {`スポット: 直近90日 ${spotCount}件${spotDate ? `（最終 ${spotDate}）` : ''}`}
          {trading.length === 0 && projects.length === 0 ? <RestrictedNote show={restricted} /> : null}
        </p>
      ) : null}
    </div>
  );
}

function tradingCompanyKey(row) {
  return `${tradingLabel(row)}|${String(row?.organization_id || '')}`;
}

function tradingLabel(row) {
  return String(row?.name ?? '');
}
