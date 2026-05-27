import React, { useEffect, useId, useRef, useState } from 'react';
import { getOrderVisibilityScope, chipRoleLabel } from '../utils/orderVisibilityScope.js';

/**
 * 公開範囲バッジ（クリックで工場一覧ポップオーバー）
 */
export function OrderVisibilityScopePopover({ order, escalationCtx, factoryNameById, className = '' }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const panelId = useId();

  const scope =
    order && escalationCtx ? getOrderVisibilityScope(order, escalationCtx, factoryNameById) : null;

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!scope) return null;

  const { listIcon } = scope;
  const isAssociation = scope.kind === 'association_pending';
  const count = listIcon.count;
  const factoryNames =
    scope.visibleFactoryNames?.length > 0
      ? scope.visibleFactoryNames
      : scope.chips.map((c) => c.name).filter(Boolean);

  const badgeClass =
    'inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black transition hover:ring-2 hover:ring-indigo-300/60 sm:text-[11px] ' +
    (isAssociation
      ? 'cl-glare-alert cl-glare-alert--association border-violet-500 bg-violet-600 text-white'
      : count != null && count > 1
        ? 'border-indigo-300 bg-indigo-50 text-indigo-900'
        : count === 1
          ? 'border-slate-300 bg-slate-100 text-slate-800'
          : 'border-slate-200 bg-slate-50 text-slate-500') +
    (className ? ` ${className}` : '');

  return (
    <span ref={rootRef} className="relative inline-block">
      <button
        type="button"
        className={badgeClass}
        aria-expanded={open}
        aria-controls={panelId}
        title={`${scope.summary}（クリックで工場一覧）`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
      >
        <span aria-hidden>{listIcon.emoji}</span>
        {!isAssociation && count != null && count > 0 ? (
          <span className="font-mono">×{count}</span>
        ) : null}
        <span className="max-w-[5.5rem] truncate">{listIcon.shortLabel}</span>
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          className="absolute right-0 top-full z-[80] mt-1.5 w-[min(18rem,calc(100vw-2rem))] rounded-xl border-2 border-slate-200 bg-white p-3 text-left shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-xs font-black text-slate-900">表示中の工場</p>
          <p className="mt-1 text-[11px] font-medium leading-snug text-slate-600">{scope.summary}</p>
          {scope.escalationTierLabel && scope.escalationTierLabel !== '—' ? (
            <p className="mt-1 text-[10px] font-bold text-slate-500">{scope.escalationTierLabel}</p>
          ) : null}
          {factoryNames.length > 0 ? (
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
              {scope.chips.length > 0
                ? scope.chips.map((chip) => (
                    <li
                      key={chip.id + (chip.role || '')}
                      className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2 py-1.5 text-xs font-bold text-slate-800"
                    >
                      <span className="min-w-0 truncate">{chip.name}</span>
                      <span className="shrink-0 rounded bg-white px-1.5 py-0.5 text-[10px] font-black text-slate-500">
                        {chipRoleLabel(chip.role)}
                      </span>
                    </li>
                  ))
                : factoryNames.map((name) => (
                    <li
                      key={name}
                      className="rounded-lg bg-slate-50 px-2 py-1.5 text-xs font-bold text-slate-800"
                    >
                      {name}
                    </li>
                  ))}
            </ul>
          ) : (
            <p className="mt-2 text-xs font-bold text-slate-500">工場には未公開です。</p>
          )}
          <button
            type="button"
            className="mt-2 w-full rounded-lg border border-slate-200 bg-slate-50 py-1.5 text-[11px] font-black text-slate-700 hover:bg-slate-100"
            onClick={() => setOpen(false)}
          >
            閉じる
          </button>
        </div>
      ) : null}
    </span>
  );
}
