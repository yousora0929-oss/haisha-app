import React from 'react';
import { buildMixTextFromAnalysis } from '../utils/analyzeOrderText.js';

function patchOrderField(order, field, rawValue) {
  const next = { ...order, [field]: rawValue };
  if (field === 'volume') {
    const n = Number(rawValue);
    next.volume = Number.isFinite(n) ? n : rawValue;
  } else if (field === 'strength' || field === 'slump' || field === 'aggregate_size') {
    const n = Number(rawValue);
    next[field] = Number.isFinite(n) ? n : rawValue;
    next.mixText = buildMixTextFromAnalysis(next);
  }
  return next;
}

/**
 * AI 抽出結果のプレビュー・編集・一括登録
 */
export function AiGeneratedOrderList({
  orders,
  onOrdersChange,
  onBulkRegister,
  bulkLoading,
  bulkDisabled,
  bulkDisabledReason,
}) {
  const list = Array.isArray(orders) ? orders : [];
  if (list.length === 0) return null;

  const updateAt = (index, field, value) => {
    const next = list.map((row, i) => (i === index ? patchOrderField(row, field, value) : row));
    onOrdersChange?.(next);
  };

  const removeAt = (index) => {
    onOrdersChange?.(list.filter((_, i) => i !== index));
  };

  return (
    <section
      className="rounded-2xl border-2 border-amber-300 bg-amber-50/60 p-4 shadow-sm sm:p-5"
      aria-labelledby="ai-generated-orders-title"
    >
      <h3 id="ai-generated-orders-title" className="text-base font-black text-amber-950 sm:text-lg">
        AI抽出結果（未確定）
        <span className="ml-2 inline-flex rounded-full bg-amber-600 px-2 py-0.5 text-xs font-black text-white">
          {list.length}件
        </span>
      </h3>
      <p className="mt-1 text-xs font-medium text-amber-900/90 sm:text-sm">
        内容を確認・修正のうえ、下のボタンで一括登録してください。共通の業者・現場・注文種別はフォームの設定が適用されます。
      </p>

      <ul className="mt-4 grid gap-3">
        {list.map((order, index) => (
          <li
            key={order._key ?? `ai-order-${index}`}
            className="relative rounded-xl border border-amber-200/90 bg-white p-4 pr-10 shadow-sm"
          >
            <button
              type="button"
              onClick={() => removeAt(index)}
              disabled={bulkLoading || list.length <= 1}
              className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-lg font-black leading-none text-slate-600 hover:bg-red-50 hover:border-red-200 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              aria-label={`注文${index + 1}を削除`}
              title={list.length <= 1 ? '最低1件必要です' : 'この行を削除'}
            >
              ×
            </button>
            <p className="text-sm font-black text-slate-900">注文 {index + 1}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-xs font-bold text-slate-600">
                日付
                <input
                  type="date"
                  value={order.date || ''}
                  disabled={bulkLoading}
                  onChange={(e) => updateAt(index, 'date', e.target.value)}
                  className="mt-1 block min-h-[44px] w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm font-bold text-slate-900"
                />
              </label>
              <label className="block text-xs font-bold text-slate-600">
                時間
                <input
                  type="time"
                  value={order.time || ''}
                  disabled={bulkLoading}
                  onChange={(e) => updateAt(index, 'time', e.target.value)}
                  className="mt-1 block min-h-[44px] w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm font-bold text-slate-900"
                />
              </label>
              <label className="block text-xs font-bold text-slate-600">
                数量（m³）
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  inputMode="decimal"
                  value={order.volume ?? ''}
                  disabled={bulkLoading}
                  onChange={(e) => updateAt(index, 'volume', e.target.value)}
                  className="mt-1 block min-h-[44px] w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm font-bold text-slate-900"
                />
              </label>
              <label className="block text-xs font-bold text-slate-600">
                配合（自動）
                <input
                  type="text"
                  readOnly
                  value={order.mixText || ''}
                  className="mt-1 block min-h-[44px] w-full rounded-lg border-2 border-slate-100 bg-slate-50 px-3 py-2 font-mono text-sm font-bold text-slate-700"
                />
              </label>
              <label className="block text-xs font-bold text-slate-600">
                呼び強度
                <input
                  type="number"
                  min="0"
                  value={order.strength ?? ''}
                  disabled={bulkLoading}
                  onChange={(e) => updateAt(index, 'strength', e.target.value)}
                  className="mt-1 block min-h-[44px] w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm font-bold text-slate-900"
                />
              </label>
              <label className="block text-xs font-bold text-slate-600">
                スランプ（cm）
                <input
                  type="number"
                  min="0"
                  value={order.slump ?? ''}
                  disabled={bulkLoading}
                  onChange={(e) => updateAt(index, 'slump', e.target.value)}
                  className="mt-1 block min-h-[44px] w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm font-bold text-slate-900"
                />
              </label>
              <label className="block text-xs font-bold text-slate-600 sm:col-span-2">
                粗骨材（mm）
                <input
                  type="number"
                  min="0"
                  value={order.aggregate_size ?? ''}
                  disabled={bulkLoading}
                  onChange={(e) => updateAt(index, 'aggregate_size', e.target.value)}
                  className="mt-1 block min-h-[44px] w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm font-bold text-slate-900"
                />
              </label>
            </div>
          </li>
        ))}
      </ul>

      {bulkDisabledReason ? (
        <p className="mt-3 text-xs font-bold text-amber-900">{bulkDisabledReason}</p>
      ) : null}

      <button
        type="button"
        onClick={onBulkRegister}
        disabled={bulkLoading || bulkDisabled || list.length === 0}
        className="mt-4 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl border-2 border-emerald-700 bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-3 text-base font-black text-white shadow-lg transition hover:from-emerald-700 hover:to-teal-700 disabled:cursor-not-allowed disabled:border-slate-300 disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none"
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
          `一括で発注を確定する（${list.length}件）`
        )}
      </button>
    </section>
  );
}
