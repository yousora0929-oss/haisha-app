import React from 'react';
import { isLocationPendingOrder } from '../utils/orderWorkflow.js';

export function LocationPendingBadge({ order, className = '' }) {
  if (!isLocationPendingOrder(order)) return null;
  return (
    <span
      className={
        'cl-alert-map-pending inline-flex items-center rounded-full border-2 border-amber-500 bg-amber-400 px-2 py-0.5 text-[10px] font-black text-amber-950 shadow-sm sm:text-[11px] ' +
        className
      }
    >
      ⚠️地図待ち
    </span>
  );
}
