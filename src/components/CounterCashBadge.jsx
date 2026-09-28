import React from 'react';

export function isCounterCashOrder(order) {
  return order?.is_counter_cash === true || order?.isCounterCash === true;
}

/** 工場・管理・組合/商社向け。カスタマー（業者）自身の画面では使わないこと。 */
export function CounterCashBadge({ order, className = '' }) {
  if (!isCounterCashOrder(order)) return null;
  return (
    <span
      className={
        'inline-flex max-w-full items-center rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-black text-amber-900 sm:text-[11px] ' +
        className
      }
    >
      💴 窓口現金
    </span>
  );
}

export default CounterCashBadge;
