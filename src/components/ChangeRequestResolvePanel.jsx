import React, { useEffect, useMemo, useState } from 'react';
import { listChangeRequestItems } from '../utils/changeRequestItems.js';

function decisionButtonClass(active, tone) {
  const base =
    'min-h-[40px] flex-1 rounded-lg border-2 px-2 text-xs font-black transition sm:text-sm ';
  if (tone === 'accept') {
    return (
      base +
      (active
        ? 'border-emerald-700 bg-emerald-600 text-white'
        : 'border-emerald-300 bg-white text-emerald-900 hover:bg-emerald-50 dark:bg-slate-900 dark:text-emerald-100')
    );
  }
  return (
    base +
    (active
      ? 'border-slate-600 bg-slate-600 text-white'
      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-500 dark:bg-slate-900 dark:text-slate-100')
  );
}

/**
 * 変更依頼を項目ごとに承諾／対応不可する工場向けパネル
 */
export function ChangeRequestResolvePanel({ order, disabled = false, onResolve }) {
  const patch = order?.pending_change_request_patch;
  const items = useMemo(() => listChangeRequestItems(patch), [patch]);
  const itemKey = items.map((item) => item.id).join('|');
  const [decisions, setDecisions] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const next = {};
    for (const item of items) next[item.id] = 'accept';
    setDecisions(next);
  }, [order?.id, itemKey]);

  if (!items.length) return null;

  const locked = disabled || busy || typeof onResolve !== 'function';
  const acceptedKeys = items
    .filter((item) => decisions[item.id] === 'accept')
    .flatMap((item) => item.keys);

  const submit = async () => {
    if (locked) return;
    setBusy(true);
    try {
      await onResolve(acceptedKeys);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 grid gap-2" onClick={(e) => e.stopPropagation()}>
      <ul className="grid gap-2">
        {items.map((item) => {
          const decision = decisions[item.id] || 'accept';
          return (
            <li
              key={item.id}
              className="rounded-lg border border-orange-200 bg-white/80 px-2.5 py-2 dark:border-orange-800 dark:bg-slate-900/50"
            >
              <p className="text-sm font-black text-slate-900 dark:text-slate-100">
                {item.label}
                <span className="ml-2 font-bold text-slate-600 dark:text-slate-300">{item.display}</span>
              </p>
              <div className="mt-1.5 flex gap-1.5">
                <button
                  type="button"
                  disabled={locked}
                  aria-pressed={decision === 'accept'}
                  onClick={() => setDecisions((prev) => ({ ...prev, [item.id]: 'accept' }))}
                  className={decisionButtonClass(decision === 'accept', 'accept')}
                >
                  承諾
                </button>
                <button
                  type="button"
                  disabled={locked}
                  aria-pressed={decision === 'decline'}
                  onClick={() => setDecisions((prev) => ({ ...prev, [item.id]: 'decline' }))}
                  className={decisionButtonClass(decision === 'decline', 'decline')}
                >
                  対応不可
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        disabled={locked}
        onClick={() => void submit()}
        className={
          'min-h-[44px] rounded-lg border-2 px-4 py-2 text-sm font-black shadow-sm transition sm:text-base ' +
          (locked
            ? 'cursor-wait border-slate-300 bg-slate-200 text-slate-500'
            : 'border-orange-700 bg-orange-600 text-white hover:bg-orange-700 active:scale-[0.99]')
        }
      >
        {busy ? '反映中…' : 'この内容で回答する'}
      </button>
    </div>
  );
}
