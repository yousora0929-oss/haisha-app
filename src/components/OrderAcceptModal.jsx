import React from 'react';

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

/** 工場画面：受注前の最終確認 */
export function OrderAcceptModal({ order, open, submitting, onClose, onConfirm }) {
  if (!open || !order) return null;

  const siteName =
    String(order.siteName || order.projectName || '').trim() || '（現場名未入力）';
  const mix = String(order.mixText || '').trim() || '（配合未入力）';

  return (
    <div
      className="fixed inset-0 z-[220] flex items-center justify-center bg-black/55 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onClose();
      }}
    >
      <div
        className="flex w-full max-w-md flex-col overflow-hidden rounded-2xl border-2 border-blue-200 bg-white shadow-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="factory-order-accept-title"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-200 px-4 py-3 sm:px-5">
          <h2 id="factory-order-accept-title" className="text-lg font-black text-slate-900 sm:text-xl">
            この注文を受注しますか？
          </h2>
        </div>

        <div className="px-4 py-3 sm:px-5 sm:py-4">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm">
            <div>
              <dt className="text-[11px] font-bold text-slate-500">日付</dt>
              <dd className="font-black text-slate-900">{formatPreferredDateJp(order.preferredDate)}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold text-slate-500">時刻</dt>
              <dd className="font-black text-slate-900">{formatOrderTime(order)}</dd>
            </div>
            <div className="col-span-2">
              <dt className="text-[11px] font-bold text-slate-500">現場</dt>
              <dd className="break-words font-black text-slate-900">{siteName}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold text-slate-500">配合</dt>
              <dd className="font-mono font-black text-slate-900">{mix}</dd>
            </div>
            <div>
              <dt className="text-[11px] font-bold text-slate-500">数量</dt>
              <dd className="font-black text-slate-900">{formatQuantity(order)}</dd>
            </div>
          </dl>
        </div>

        <div className="flex gap-2 border-t border-slate-200 px-4 py-3 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="min-h-[48px] flex-1 rounded-xl border-2 border-slate-300 bg-white text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            className="min-h-[48px] flex-1 rounded-xl border-2 border-blue-700 bg-blue-600 text-sm font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? '処理中…' : '受注する'}
          </button>
        </div>
      </div>
    </div>
  );
}
