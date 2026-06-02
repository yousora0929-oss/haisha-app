import React from 'react';
import { buildFactoryReadStatuses } from '../utils/factoryNews.js';

/**
 * 全工場の既読／未読バッジ一覧
 */
export function FactoryNewsReadStatus({ news, reads, factories, compact = false }) {
  const statuses = buildFactoryReadStatuses(news, reads, factories);
  if (statuses.length === 0) {
    return <p className="text-xs font-medium text-slate-500 dark:text-slate-400">対象工場がありません</p>;
  }

  const readCount = statuses.filter((s) => s.read).length;

  return (
    <div className={compact ? 'space-y-1' : 'space-y-2'}>
      <p className="text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
        全工場の既読状況（{readCount}/{statuses.length} 既読）
      </p>
      <ul className={'flex flex-wrap gap-1.5 ' + (compact ? '' : 'max-h-32 overflow-y-auto')}>
        {statuses.map((s) => (
          <li
            key={s.factoryId}
            className={
              'rounded-full border px-2 py-0.5 text-[10px] font-bold sm:text-xs ' +
              (s.read
                ? 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200'
                : 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100')
            }
          >
            {s.factoryName}:{s.read ? '既読' : '未読'}
          </li>
        ))}
      </ul>
    </div>
  );
}
