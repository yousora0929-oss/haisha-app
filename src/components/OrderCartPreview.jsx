import React from 'react';

function formatOrderDateLabel(order) {
  const raw = String(order?.preferredDate || '').trim();
  if (!raw) return '—';
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw;
  return `${m[1]}/${m[2]}/${m[3]}`;
}

/**
 * 発注カート（買い物かご）プレビュー
 */
export function OrderCartPreview({ items, onRemove, onConfirmBulk, bulkLoading }) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return null;

  return (
    <section
      className="rounded-2xl border-2 border-violet-300 bg-violet-50/70 p-4 shadow-sm sm:p-5 lg:col-span-2"
      aria-labelledby="order-cart-title"
    >
      <h3 id="order-cart-title" className="text-base font-black text-violet-950 sm:text-lg">
        発注リスト（カート）
        <span className="ml-2 inline-flex rounded-full bg-violet-600 px-2 py-0.5 text-xs font-black text-white">
          {list.length}件
        </span>
      </h3>
      <p className="mt-1 text-xs font-medium text-violet-900/85 sm:text-sm">
        条件の異なる注文をまとめて登録できます。不要な行は ✖ で削除してください。
      </p>

      <ul className="mt-4 grid gap-3">
        {list.map((item, index) => {
          const o = item?.order || {};
          return (
            <li
              key={item.cartId}
              className="relative rounded-xl border border-violet-200/90 bg-white p-4 pr-11 shadow-sm"
            >
              <button
                type="button"
                onClick={() => onRemove?.(item.cartId)}
                disabled={bulkLoading}
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-lg font-black leading-none text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                aria-label={`リスト${index + 1}を削除`}
              >
                ✖
              </button>
              <p className="text-sm font-black text-slate-900">注文 {index + 1}</p>
              <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-xs font-bold text-slate-500">日付</dt>
                  <dd className="font-black text-slate-900">{formatOrderDateLabel(o)}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold text-slate-500">時間</dt>
                  <dd className="font-black text-slate-900">{o.timePointLabel || o.timeSlotLabel || '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold text-slate-500">数量</dt>
                  <dd className="font-black text-slate-900">{o.quantityM3 || '—'} m³</dd>
                </div>
                <div>
                  <dt className="text-xs font-bold text-slate-500">配合</dt>
                  <dd className="font-mono font-black text-slate-900">{o.mixText || '—'}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs font-bold text-slate-500">試験</dt>
                  <dd className="font-black text-slate-900">{o.has_test ? '試験あり' : '試験なし'}</dd>
                </div>
              </dl>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={onConfirmBulk}
        disabled={bulkLoading}
        className="mt-4 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl border-2 border-emerald-700 bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-base font-black text-white shadow-lg transition hover:from-emerald-700 hover:to-teal-700 disabled:cursor-not-allowed disabled:border-slate-300 disabled:from-slate-300 disabled:to-slate-300"
      >
        {bulkLoading ? (
          <>
            <span
              className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
              aria-hidden="true"
            />
            登録中…
          </>
        ) : (
          `カート内の${list.length}件を一括で発注確定する`
        )}
      </button>
    </section>
  );
}
