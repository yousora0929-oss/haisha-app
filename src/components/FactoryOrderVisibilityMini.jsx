import React, { useMemo } from 'react';
import { getOrderVisibilityScope, chipRoleLabel } from '../utils/orderVisibilityScope.js';

const CHIP_CLASS =
  'inline-flex max-w-full items-center rounded-full border px-1.5 py-0.5 text-[10px] font-black leading-none';

function chipClassForRole(role) {
  if (role === 'admin') {
    return (
      CHIP_CLASS +
      ' border-violet-400 bg-violet-100 text-violet-950 dark:border-violet-500 dark:bg-violet-950/50 dark:text-violet-100'
    );
  }
  if (role === 'association') {
    return (
      CHIP_CLASS +
      ' border-violet-500 bg-violet-100 text-violet-950 dark:border-violet-500 dark:bg-violet-950/50 dark:text-violet-100'
    );
  }
  if (role === 'assigned') {
    return (
      CHIP_CLASS +
      ' border-emerald-500 bg-emerald-100 text-emerald-950 dark:border-emerald-500 dark:bg-emerald-950/45 dark:text-emerald-100'
    );
  }
  if (role === 'preferred') {
    return (
      CHIP_CLASS +
      ' border-sky-500 bg-sky-100 text-sky-950 dark:border-sky-500 dark:bg-sky-950/45 dark:text-sky-100'
    );
  }
  if (role === 'main') {
    return (
      CHIP_CLASS +
      ' border-indigo-400 bg-indigo-100 text-indigo-900 dark:border-indigo-500 dark:bg-indigo-950/40 dark:text-indigo-100'
    );
  }
  if (role === 'sub') {
    return (
      CHIP_CLASS +
      ' border-amber-400 bg-amber-100 text-amber-900 dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-100'
    );
  }
  return (
    CHIP_CLASS +
    ' border-slate-300 bg-slate-100 text-slate-800 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-200'
  );
}

/**
 * 工場新着カード向けの公開範囲サマリー（割当物件のみ）。
 * 管理画面の OrderVisibilityScopePanel はコピーせず、getOrderVisibilityScope の戻り値だけ使う。
 */
export function FactoryOrderVisibilityMini({ order, escalationCtx, factoryNameById }) {
  const scope = useMemo(
    () => (order && escalationCtx ? getOrderVisibilityScope(order, escalationCtx, factoryNameById) : null),
    [order, escalationCtx, factoryNameById],
  );

  if (!order || !scope) return null;

  return (
    <div className="mt-1.5 min-w-0" aria-label="公開範囲">
      <p className="truncate text-[11px] font-bold leading-tight text-slate-600 dark:text-slate-300">
        {scope.summary}
      </p>
      {scope.chips.length > 0 ? (
        <div className="mt-1 flex flex-wrap gap-1">
          {scope.chips.map((chip) => (
            <span
              key={chip.id + (chip.role || '')}
              className={chipClassForRole(chip.role)}
              title={chip.id}
            >
              <span className="truncate">{chip.name}</span>
              <span className="ml-1 shrink-0 opacity-80">{chipRoleLabel(chip.role)}</span>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
