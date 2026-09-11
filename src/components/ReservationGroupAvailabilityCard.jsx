import React, { useEffect, useRef, useState } from 'react';
import {
  reservationGroupDayCount,
  reservationGroupAvailabilitySummary,
  RESERVATION_GROUP_CONFIRMED_GUIDANCE,
} from '../utils/reservationGroup.js';

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

function displayOrDash(value) {
  const text = String(value || '').trim();
  return text || '—';
}

/** 個別受注確定カードと同じメタ情報サイズ */
const metaLabelClass = 'text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300';
const metaValueClass = 'text-xl font-bold text-slate-900 dark:text-slate-100';
const metaValueMutedClass = 'text-xl font-bold leading-snug text-slate-700 dark:text-slate-100';

export function ReservationGroupAvailabilityCard({
  groupId,
  orders = [],
  submitting = false,
  forceExpanded = false,
  confirmed = false,
  onRespond,
}) {
  const list = Array.isArray(orders) ? orders.filter(Boolean) : [];
  const dayCount = reservationGroupDayCount(list);
  const [expanded, setExpanded] = useState(true);
  const articleRef = useRef(null);
  const summary = reservationGroupAvailabilitySummary(list);

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
      className="overflow-hidden rounded-2xl border-2 border-violet-400 bg-white shadow-xl dark:border-violet-600 dark:bg-slate-800"
    >
      <div className="border-b border-violet-200 bg-violet-50 px-3 py-3 dark:border-violet-700 dark:bg-violet-950/50 sm:px-3.5">
        <p className="text-sm font-black uppercase tracking-wider text-violet-800 dark:text-violet-200">
          複数日予約 · 可否確認
        </p>
        <h3 className="mt-1 text-lg font-black text-slate-900 dark:text-slate-100 sm:text-xl">
          この{dayCount}日間、全部対応できますか？
        </h3>
      </div>
      <div className="px-3 py-3 sm:px-3.5">
        <dl className="grid grid-cols-2 gap-x-3 gap-y-3">
          <div className="min-w-0">
            <dt className={metaLabelClass}>業者名</dt>
            <dd className={'mt-0.5 break-words ' + metaValueClass}>{displayOrDash(summary.contractorName)}</dd>
          </div>
          <div className="min-w-0">
            <dt className={metaLabelClass}>商社名</dt>
            <dd className={'mt-0.5 break-words ' + metaValueClass}>{displayOrDash(summary.traderName)}</dd>
          </div>
          <div className="min-w-0">
            <dt className={metaLabelClass}>発注者名</dt>
            <dd className={'mt-0.5 break-words ' + metaValueClass}>{displayOrDash(summary.orderedBy)}</dd>
          </div>
          <div className="min-w-0">
            <dt className={metaLabelClass}>車両</dt>
            <dd className={'mt-0.5 break-words ' + metaValueClass}>{displayOrDash(summary.vehicleLabel)}</dd>
          </div>
        </dl>
        <p className={'mt-3 break-words ' + metaValueClass}>
          現場名：{displayOrDash(summary.siteName)}
        </p>
        <p className={'mt-1 break-words ' + metaValueMutedClass}>
          現場住所：{displayOrDash(summary.siteAddress)}
        </p>
        <button
          type="button"
          className="mt-3 rounded-lg px-1.5 py-1 text-sm font-black text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? '日程を折りたたむ ▲' : '日程を開く ▼'}
        </button>
        {expanded ? (
          <ul className="mt-2 space-y-1.5">
            {list.map((order) => (
              <li
                key={order.id}
                className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 text-base dark:border-slate-600 dark:bg-slate-900/60"
              >
                <p className="font-black text-slate-900 dark:text-slate-100">
                  {formatPreferredDateJp(order.preferredDate)} · {formatOrderTime(order)}
                </p>
                <p className="mt-0.5 text-sm font-bold text-slate-600 dark:text-slate-300">
                  {formatQuantity(order)}
                  {order.mixText ? ` · ${order.mixText}` : ''}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-sm font-bold text-slate-500">{dayCount}日分の予約</p>
        )}
      </div>
      {confirmed ? (
        <div
          className="border-t border-emerald-200 bg-emerald-50 px-3 py-3 dark:border-emerald-800 dark:bg-emerald-950/40 sm:px-3.5"
          role="status"
        >
          <p className="text-base font-black leading-relaxed text-emerald-950 dark:text-emerald-100">
            {RESERVATION_GROUP_CONFIRMED_GUIDANCE}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 border-t border-violet-100 bg-violet-50/80 px-3 py-2.5 dark:border-violet-800 dark:bg-violet-950/40 sm:px-3.5">
          <button
            type="button"
            disabled={submitting || !groupId}
            onClick={() => onRespond?.(groupId, true)}
            className="min-h-[52px] rounded-xl border-2 border-emerald-700 bg-emerald-600 px-4 text-base font-black text-white shadow-sm transition hover:bg-emerald-700 disabled:cursor-wait disabled:opacity-60"
          >
            可
          </button>
          <button
            type="button"
            disabled={submitting || !groupId}
            onClick={() => onRespond?.(groupId, false)}
            className="min-h-[52px] rounded-xl border-2 border-slate-400 bg-slate-100 px-4 text-base font-black text-slate-700 shadow-sm transition hover:bg-slate-200 disabled:cursor-wait disabled:opacity-60 dark:bg-slate-800 dark:text-slate-100"
          >
            不可
          </button>
        </div>
      )}
    </article>
  );
}
