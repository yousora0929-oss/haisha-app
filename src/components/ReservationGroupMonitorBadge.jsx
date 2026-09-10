import React from 'react';
import {
  reservationGroupIdOf,
  reservationGroupMonitorBadgeClass,
  reservationGroupMonitorBadgeText,
  reservationGroupStatusOf,
  reservationGroupStatusLabel,
} from '../utils/reservationGroup.js';

export function ReservationGroupMonitorBadge({
  order,
  siblings = [],
  highlighted = false,
  popoverOpen = false,
  onHoverStart,
  onHoverEnd,
  onToggle,
}) {
  const gid = reservationGroupIdOf(order);
  if (!gid) return null;
  const status = reservationGroupStatusOf(order) || 'pending';
  const label = reservationGroupMonitorBadgeText(status);
  const showPopover = status === 'conflict' && popoverOpen && siblings.length > 0;
  const title =
    status === 'conflict'
      ? [label, ...siblings.map((s) => `${s.dateLabel} · ${s.factoryLine}`)].join('\n')
      : label;

  return (
    <span className="relative inline-flex" onMouseEnter={onHoverStart} onMouseLeave={onHoverEnd}>
      <button
        type="button"
        aria-pressed={highlighted}
        title={title}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggle?.();
        }}
        className={
          'inline-flex rounded-full border px-2 py-0.5 text-xs font-black ' +
          reservationGroupMonitorBadgeClass(status)
        }
      >
        {label}
      </button>
      {showPopover ? (
        <div
          role="tooltip"
          className="absolute left-0 top-full z-30 mt-1 w-72 rounded-lg border-2 border-rose-300 bg-white p-2 text-left shadow-lg dark:border-rose-700 dark:bg-slate-900"
        >
          <p className="text-[11px] font-black text-rose-950 dark:text-rose-100">グループ内の工場</p>
          <ul className="mt-1 space-y-1">
            {siblings.map((sibling) => (
              <li key={sibling.id} className="text-[11px] font-bold text-slate-700 dark:text-slate-200">
                <span className="font-black text-slate-900 dark:text-slate-100">{sibling.dateLabel}</span>
                <span className="mt-0.5 block">{sibling.factoryLine}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </span>
  );
}

export function ReservationGroupStatusBadge({ order, className = '' }) {
  const gid = reservationGroupIdOf(order);
  if (!gid) return null;
  const status = reservationGroupStatusOf(order) || 'pending';
  return (
    <span
      className={
        'inline-flex rounded-full border px-2 py-0.5 text-[11px] font-black ' +
        reservationGroupMonitorBadgeClass(status) +
        (className ? ` ${className}` : '')
      }
    >
      {reservationGroupStatusLabel(status)}
    </span>
  );
}
