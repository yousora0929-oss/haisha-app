import React, { useMemo } from 'react';
import { getOrderVisibilityScope } from '../utils/orderVisibilityScope.js';

/**
 * 一覧用: 公開範囲の簡易バッジ
 */
export function OrderVisibilityScopeBadge({ order, escalationCtx, factoryNameById }) {
  const scope = useMemo(
    () => (order && escalationCtx ? getOrderVisibilityScope(order, escalationCtx, factoryNameById) : null),
    [order, escalationCtx, factoryNameById],
  );

  if (!scope) return null;

  const { listIcon } = scope;
  const isAssociation = scope.kind === 'association_pending';
  const count = listIcon.count;

  return (
    <span
      className={
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-black sm:text-[11px] ' +
        (isAssociation
          ? 'border-violet-400 bg-violet-100 text-violet-900'
          : count != null && count > 1
            ? 'border-indigo-300 bg-indigo-50 text-indigo-900'
            : count === 1
              ? 'border-slate-300 bg-slate-100 text-slate-800'
              : 'border-slate-200 bg-slate-50 text-slate-500')
      }
      title={scope.summary}
    >
      <span aria-hidden>{listIcon.emoji}</span>
      {!isAssociation && count != null && count > 0 ? (
        <span className="font-mono">×{count}</span>
      ) : null}
      <span className="max-w-[5.5rem] truncate">{listIcon.shortLabel}</span>
    </span>
  );
}
