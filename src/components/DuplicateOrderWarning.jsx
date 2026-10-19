import React, { useEffect, useState } from 'react';
import {
  duplicateProceedBlocked,
  duplicateWarningLevel,
  formatDuplicateOrderLine,
  groupDuplicateRowsByDate,
} from '../utils/duplicateOrderCheck.js';

export function DuplicateOrderWarningBanner({
  rows,
  acknowledged = false,
  onAcknowledgedChange,
}) {
  const level = duplicateWarningLevel(rows);
  if (!level) return null;
  const strong = level === 'strong';
  const groups = groupDuplicateRowsByDate(rows);
  return (
    <div
      className={
        'rounded-xl border-2 px-3 py-3 ' +
        (strong ? 'border-red-500 bg-red-50' : 'border-amber-400 bg-amber-50')
      }
      role="alert"
    >
      <p className={'text-sm font-black sm:text-base ' + (strong ? 'text-red-900' : 'text-amber-950')}>
        {strong ? '⚠️ 同じ内容の注文がすでにあります' : 'この現場・この日に、別の注文があります'}
      </p>
      <div className="mt-2 space-y-2">
        {groups.map((group) => (
          <div key={group.key}>
            {groups.length > 1 ? (
              <p className={'text-xs font-black ' + (strong ? 'text-red-800' : 'text-amber-900')}>{group.label}</p>
            ) : null}
            <ul className="mt-1 space-y-1">
              {group.rows.map((row, index) => (
                <li
                  key={`${group.key}-${index}-${row?.relation || ''}-${row?.status || ''}`}
                  className={'text-sm font-bold leading-relaxed ' + (strong ? 'text-red-950' : 'text-amber-950')}
                >
                  {formatDuplicateOrderLine(row)}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {strong ? (
        <label className="mt-3 flex items-start gap-2 text-sm font-black text-red-950">
          <input
            type="checkbox"
            checked={Boolean(acknowledged)}
            onChange={(e) => onAcknowledgedChange?.(e.target.checked)}
            className="mt-0.5 h-5 w-5 shrink-0 rounded border-red-400 text-red-700 focus:ring-red-500"
          />
          <span>重複ではないことを確認しました</span>
        </label>
      ) : null}
    </div>
  );
}

export function DuplicateOrderConfirmModal({
  open,
  rows,
  proceeding = false,
  proceedLabel = '',
  onCancel,
  onProceed,
  children,
}) {
  const [acknowledged, setAcknowledged] = useState(false);
  useEffect(() => {
    if (open) setAcknowledged(false);
  }, [open, rows]);

  if (!open) return null;
  const level = duplicateWarningLevel(rows);
  const blocked = duplicateProceedBlocked(rows, acknowledged) || proceeding;
  const proceedText = proceedLabel || (level ? 'それでも発注する' : 'この内容で発注する');
  const proceedClass =
    level === 'strong'
      ? 'border-red-800 bg-red-600 text-white hover:bg-red-700'
      : level === 'notice'
        ? 'border-amber-700 bg-amber-500 text-amber-950 hover:bg-amber-600'
        : 'border-emerald-700 bg-emerald-600 text-white hover:bg-emerald-700';
  return (
    <div
      className="fixed inset-0 z-[720] flex items-end justify-center bg-slate-900/50 p-3 sm:items-center"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !proceeding) onCancel?.();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="duplicate-order-confirm-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 id="duplicate-order-confirm-title" className="text-lg font-black text-slate-900">
          発注内容の確認
        </h2>
        <div className="mt-3">
          <DuplicateOrderWarningBanner
            rows={rows}
            acknowledged={acknowledged}
            onAcknowledgedChange={setAcknowledged}
          />
        </div>
        {children ? <div className="mt-3">{children}</div> : null}
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={onCancel}
            disabled={proceeding}
            className="min-h-[52px] flex-1 rounded-xl border-2 border-slate-300 bg-white text-base font-black text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            発注をやめる
          </button>
          <button
            type="button"
            onClick={onProceed}
            disabled={blocked}
            className={
              'min-h-[52px] flex-1 rounded-xl border-2 text-base font-black shadow disabled:cursor-not-allowed disabled:opacity-60 ' +
              proceedClass
            }
          >
            {proceeding ? '送信中…' : proceedText}
          </button>
        </div>
      </div>
    </div>
  );
}
