import React, { useEffect, useRef, useState } from 'react';
import { reservationGroupDayCount } from '../utils/reservationGroup.js';

function formatPreferredDateJp(iso) {
  const raw = String(iso || '').trim().slice(0, 10);
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw || '—';
  return `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

function formatOrderTime(order) {
  return (
    order?.timePointLabel ||
    order?.timeSlotLabel ||
    (order?.timeSlot != null ? String(order.timeSlot) : '') ||
    '—'
  );
}

function formatQuantity(order) {
  const raw = order?.quantityM3 ?? order?.quantityCube;
  const s = raw != null ? String(raw).trim() : '';
  return s ? `${s} m³` : '—';
}

export function ReservationGroupAvailabilityCard({
  groupId,
  orders = [],
  submitting = false,
  forceExpanded = false,
  onRespond,
}) {
  const list = Array.isArray(orders) ? orders.filter(Boolean) : [];
  const dayCount = reservationGroupDayCount(list);
  const [expanded, setExpanded] = useState(true);
  const articleRef = useRef(null);
  const siteName =
    String(list[0]?.siteName || list[0]?.projectName || '').trim() || '（現場名未入力）';

  useEffect(() => {
    if (!forceExpanded) return;
    setExpanded(true);
    window.setTimeout(() => {
      articleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  }, [forceExpanded]);

  return (
    <article
      ref={articleRef}
      className="overflow-hidden rounded-xl border-2 border-violet-400 bg-white shadow-sm dark:border-violet-600 dark:bg-slate-800"
    >
      <div className="border-b border-violet-200 bg-violet-50 px-3 py-2.5 dark:border-violet-700 dark:bg-violet-950/50">
        <p className="text-[11px] font-black uppercase tracking-wider text-violet-800 dark:text-violet-200">
          複数日予約 · 可否確認
        </p>
        <h3 className="mt-0.5 text-base font-black text-slate-900 dark:text-slate-100 sm:text-lg">
          この{dayCount}日間、全部対応できますか？
        </h3>
        <p className="mt-1 truncate text-sm font-bold text-slate-700 dark:text-slate-200">{siteName}</p>
      </div>
      <div className="px-3 py-2">
        <button
          type="button"
          className="mb-2 rounded-lg px-1.5 py-1 text-xs font-black text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '日程を折りたたむ ▲' : '日程を開く ▼'}
        </button>
        {expanded ? (
          <ul className="space-y-1.5">
            {list.map((order) => (
              <li
                key={order.id}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900/60"
              >
                <p className="font-black text-slate-900 dark:text-slate-100">
                  {formatPreferredDateJp(order.preferredDate)} · {formatOrderTime(order)}
                </p>
                <p className="mt-0.5 text-xs font-bold text-slate-600 dark:text-slate-300">
                  {formatQuantity(order)}
                  {order.mixText ? ` · ${order.mixText}` : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs font-bold text-slate-500">{dayCount}日分の予約</p>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-violet-100 bg-violet-50/80 px-3 py-2 dark:border-violet-800 dark:bg-violet-950/40">
        <button
          type="button"
          disabled={submitting || !groupId}
          onClick={() => onRespond?.(groupId, true)}
          className="min-h-[46px] rounded-xl border-2 border-emerald-700 bg-emerald-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
        >
          可
        </button>
        <button
          type="button"
          disabled={submitting || !groupId}
          onClick={() => onRespond?.(groupId, false)}
          className="min-h-[46px] rounded-xl border-2 border-slate-400 bg-slate-100 px-4 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-200 disabled:cursor-wait disabled:opacity-60 dark:bg-slate-800 dark:text-slate-100"
        >
          不可
        </button>
      </div>
    </article>
  );
}
