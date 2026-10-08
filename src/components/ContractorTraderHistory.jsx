import React from 'react';
import { sortTradingCompanies } from '../utils/contractorHistoryDisplay.js';

const NOTE = '商社実績は請求先の業者で集計しています（下請請求の物件は下請側に表示）';

function formatYmd(value) {
  if (value == null || value === '') return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const day = parts.find((part) => part.type === 'day')?.value;
  if (!year || !month || !day) return '—';
  return `${year}/${month}/${day}`;
}

function traderListName(row) {
  const name = String(row?.name ?? '').trim();
  if (!name || row?.is_direct === true) return '直接（商社なし）';
  return name;
}

function projectTraderName(row) {
  const name = String(row?.trading_company_name ?? '').trim();
  return name || '直接（商社なし）';
}

function HistorySection({ title, children }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white px-3 py-3">
      <h3 className="text-sm font-black text-slate-800">{title}</h3>
      <ul className="mt-2 space-y-2">{children}</ul>
    </section>
  );
}

function TradingRow({ row }) {
  return (
    <li className="min-h-[44px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
      <p className="font-black text-slate-900">{traderListName(row)}</p>
      <p className="mt-0.5 text-xs font-semibold text-slate-600">
        物件 {Number(row?.project_count) || 0} ・ 注文 {Number(row?.order_count) || 0} ・ 最終利用{' '}
        {formatYmd(row?.last_used_at)}
      </p>
    </li>
  );
}

export function isContractorTraderHistoryEmpty(history) {
  if (history == null) return true;
  const trading = Array.isArray(history.trading_companies) ? history.trading_companies.length : 0;
  const spotTrading = Array.isArray(history.spot_trading_companies) ? history.spot_trading_companies.length : 0;
  const projects = Array.isArray(history.recent_projects) ? history.recent_projects.length : 0;
  const spots = Array.isArray(history.recent_spot_orders) ? history.recent_spot_orders.length : 0;
  return trading + spotTrading + projects + spots === 0;
}

/** 工場の商社検索用。既存の発注画面パネルとは別表示。 */
export function ContractorTraderHistory({ history }) {
  if (isContractorTraderHistoryEmpty(history)) {
    return (
      <div className="space-y-3">
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-sm font-bold text-slate-500">
          実績がありません
        </p>
        <p className="text-xs leading-relaxed text-slate-500">{NOTE}</p>
      </div>
    );
  }

  const trading = sortTradingCompanies(history.trading_companies);
  const spotTrading = sortTradingCompanies(history.spot_trading_companies);
  const projects = Array.isArray(history.recent_projects) ? history.recent_projects : [];
  const spots = Array.isArray(history.recent_spot_orders) ? history.recent_spot_orders : [];

  return (
    <div className="space-y-3">
      {trading.length > 0 ? (
        <HistorySection title="使用商社一覧">
          {trading.map((row, index) => (
            <TradingRow key={`${traderListName(row)}-${index}`} row={row} />
          ))}
        </HistorySection>
      ) : null}
      {spotTrading.length > 0 ? (
        <HistorySection title="スポット注文の商社">
          {spotTrading.map((row, index) => (
            <TradingRow key={`spot-${traderListName(row)}-${index}`} row={row} />
          ))}
        </HistorySection>
      ) : null}
      {projects.length > 0 ? (
        <HistorySection title="最近の物件">
          {projects.map((row, index) => {
            const subBill = String(row?.billing_target || '') === 'sub';
            const prime = String(row?.role || '') === 'sub' ? String(row?.prime_name || '').trim() : '';
            return (
              <li
                key={String(row?.project_id || row?.name || index)}
                className="min-h-[44px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
              >
                <p className="font-black text-slate-900">
                  {String(row?.name || '').trim() || '（物件名なし）'}
                  {subBill ? (
                    <span className="ml-2 inline-flex rounded-full bg-amber-200 px-2 py-0.5 text-[11px] font-black text-amber-950">
                      下請請求
                    </span>
                  ) : null}
                </p>
                {prime ? <p className="mt-0.5 text-xs font-semibold text-slate-500">元請 {prime}</p> : null}
                <p className="mt-0.5 text-xs font-semibold text-slate-600">
                  {projectTraderName(row)} ・ 注文 {Number(row?.order_count) || 0} ・ 最終発注{' '}
                  {formatYmd(row?.last_ordered_at)}
                </p>
              </li>
            );
          })}
        </HistorySection>
      ) : null}
      {spots.length > 0 ? (
        <HistorySection title="最近のスポット現場">
          {spots.map((row, index) => (
            <li
              key={`${String(row?.site_name || '')}-${index}`}
              className="min-h-[44px] rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
            >
              <p className="font-black text-slate-900">{String(row?.site_name || '').trim() || '（現場名なし）'}</p>
              <p className="mt-0.5 text-xs font-semibold text-slate-600">
                {projectTraderName(row)} ・ {Number(row?.order_count) || 0}件 ・ 最終 {formatYmd(row?.last_ordered_at)}
              </p>
            </li>
          ))}
        </HistorySection>
      ) : null}
      <p className="text-xs leading-relaxed text-slate-500">{NOTE}</p>
    </div>
  );
}
