import React, { useMemo } from 'react';
import {
  getOrderVisibilityScope,
  chipRoleLabel,
  formatPriorityFactoryLabel,
} from '../utils/orderVisibilityScope.js';
import { OrderVisibilityScopePopover } from './OrderVisibilityScopePopover.jsx';

const CHIP_CLASS =
  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-black';

function chipClassForRole(role) {
  if (role === 'admin') return CHIP_CLASS + ' border-violet-400 bg-violet-100 text-violet-950';
  if (role === 'association') return CHIP_CLASS + ' border-violet-500 bg-violet-100 text-violet-950';
  if (role === 'assigned') return CHIP_CLASS + ' border-emerald-500 bg-emerald-100 text-emerald-950';
  if (role === 'preferred') return CHIP_CLASS + ' border-sky-500 bg-sky-100 text-sky-950';
  if (role === 'main') return CHIP_CLASS + ' border-indigo-400 bg-indigo-100 text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100';
  if (role === 'sub') return CHIP_CLASS + ' border-amber-400 bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100';
  return CHIP_CLASS + ' border-slate-300 bg-slate-100 text-slate-800';
}

/**
 * 管理画面: 注文の公開・エスカレーション範囲
 */
export function OrderVisibilityScopePanel({ order, escalationCtx, factoryNameById, compact = false }) {
  const scope = useMemo(
    () => (order && escalationCtx ? getOrderVisibilityScope(order, escalationCtx, factoryNameById) : null),
    [order, escalationCtx, factoryNameById],
  );

  if (!order || !scope) return null;

  return (
    <section
      className={
        compact
          ? 'rounded-xl border-2 border-sky-200 bg-sky-50/80 p-3'
          : 'rounded-xl border-2 border-sky-300 bg-gradient-to-br from-sky-50 to-indigo-50/60 p-4 shadow-inner'
      }
      aria-labelledby="order-visibility-scope-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h4 id="order-visibility-scope-title" className="text-sm font-black text-sky-950 sm:text-base">
          👀 現在の公開・エスカレーション範囲
        </h4>
        <OrderVisibilityScopePopover
          order={order}
          escalationCtx={escalationCtx}
          factoryNameById={factoryNameById}
        />
      </div>
      <p className="mt-2 text-sm font-bold leading-relaxed text-slate-900">{scope.summary}</p>
      {scope.detail ? <p className="mt-1 text-xs font-medium leading-relaxed text-slate-600">{scope.detail}</p> : null}
      {scope.escalationMinutes != null ? (
        <p className="mt-2 text-xs font-mono font-bold text-slate-500">
          経過（営業時間ベース）: 約 {Math.floor(scope.escalationMinutes)} 分 · {scope.escalationTierLabel}
        </p>
      ) : null}
      {scope.chips.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {scope.chips.map((chip, index) => {
            const isTop = Boolean(chip.isTopPriority) || index === 0;
            return (
              <span
                key={chip.id + (chip.role || '')}
                className={
                  chipClassForRole(chip.role) +
                  (isTop ? ' ring-2 ring-amber-300/80 border-amber-400 bg-amber-50 text-amber-950' : '')
                }
                title={chip.id}
              >
                <span>{formatPriorityFactoryLabel(chip.priorityIndex ?? index, chip.name)}</span>
                {isTop ? (
                  <span className="rounded bg-amber-200/90 px-1 py-0.5 text-[10px] font-bold text-amber-950">
                    最優先
                  </span>
                ) : null}
                <span className="rounded bg-white/60 px-1 py-0.5 text-[10px] font-bold uppercase opacity-80">
                  {chipRoleLabel(chip.role)}
                </span>
              </span>
            );
          })}
        </div>
      ) : (
        <p className="mt-2 text-xs font-bold text-slate-500">表示対象の工場はありません。</p>
      )}
    </section>
  );
}
