import React from 'react';

function formatAdminHistoryYearMonth(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}/${date.getMonth() + 1}`;
}

/**
 * 管理画面の物件フォームで使っている「過去の商社利用実績」。
 * 件数の多い順は呼び出し側の並びをそのまま出す。
 */
export function TradingHistoryChips({ rows, onSelectName }) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.length === 0) return null;
  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white/80 px-3 py-2">
      <p className="text-[11px] font-black text-slate-700">過去の商社利用実績:</p>
      <ul className="mt-1 space-y-1">
        {list.map((row) => {
          const yearMonth = formatAdminHistoryYearMonth(row.latestDate);
          return (
            <li key={row.tradingCompanyName} className="text-[11px] font-medium text-slate-700">
              ・
              <button
                type="button"
                onClick={() => onSelectName?.(row.tradingCompanyName)}
                className="font-black text-indigo-700 underline-offset-2 hover:underline"
                title="商社名欄に入力"
              >
                {row.tradingCompanyName}
              </button>
              （{row.count}件）
              {row.latestProjectName ? (
                <span className="text-slate-500">
                  {' '}
                  最新: {row.latestProjectName}
                  {yearMonth ? `（${yearMonth}）` : ''}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
