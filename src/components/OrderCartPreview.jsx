import React, { useState } from 'react';
import { LocationPendingBadge } from './LocationPendingBadge.jsx';
import { TIME_SLOTS } from '../haishaConstants.js';

function formatOrderDateLabel(order) {
  const raw = String(order?.preferredDate || '').trim();
  if (!raw) return '—';
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return raw;
  return `${m[1]}/${m[2]}/${m[3]}`;
}

function buildEditDraft(order) {
  const o = order || {};
  return {
    preferredDate: String(o.preferredDate || '').trim(),
    timeSlot: String(o.timeSlot || '').trim(),
    quantityM3: String(o.quantityM3 ?? '').trim(),
    mixText: String(o.mixText ?? '').trim(),
    siteAddress: String(o.siteAddress ?? o.site_address ?? '').trim(),
    hasTest: Boolean(o.has_test ?? o.hasTest),
  };
}

/** 編集ドラフトから item.order 用のパッチを組み立てる（派生フィールドも同期） */
function buildOrderPatch(order, draft) {
  const date = String(draft.preferredDate || '').trim();
  const slot = String(draft.timeSlot || '').trim();
  const slotMeta = TIME_SLOTS.find((s) => s.value === slot);
  const minutes = parseInt(slot, 10);
  const qty = String(draft.quantityM3 ?? '').trim();
  const mix = String(draft.mixText ?? '').trim();
  const addr = String(draft.siteAddress ?? '').trim();

  const patch = {
    preferredDate: date,
    scheduleMatchDate: date,
    timeSlot: slot,
    timeSlotMinutes: Number.isFinite(minutes) ? minutes : null,
    scheduleMatchMinutes: Number.isFinite(minutes) ? minutes : null,
    timeSlotLabel: slotMeta?.label ?? '',
    timePointLabel: slotMeta?.label ?? '',
    quantityM3: qty,
    mixText: mix,
    has_test: Boolean(draft.hasTest),
    hasTest: Boolean(draft.hasTest),
  };

  const prevAddr = String(order?.siteAddress ?? order?.site_address ?? '').trim();
  if (addr !== prevAddr) {
    patch.siteAddress = addr;
    patch.site_address = addr;
    // 納入エリア（deliveryArea）は保持し、詳細部分だけ差し替える
    const area = String(order?.deliveryArea ?? order?.delivery_area ?? '').trim();
    patch.siteAddressDetail =
      area && addr.startsWith(area) ? addr.slice(area.length).trim() : addr;
  }
  return patch;
}

/**
 * 発注カート（買い物かご）プレビュー
 */
export function OrderCartPreview({
  items,
  onRemove,
  onEditItem,
  validateItem,
  onConfirmBulk,
  bulkLoading,
  siteAddressLabel = '現場住所',
}) {
  const [editingId, setEditingId] = useState('');
  const [draft, setDraft] = useState(null);
  const [editError, setEditError] = useState('');

  const list = (Array.isArray(items) ? items : []).slice().sort((a, b) => {
    const ta = Number(a?.addedAt ?? 0);
    const tb = Number(b?.addedAt ?? 0);
    if (ta !== tb) return ta - tb;
    return String(a?.cartId || '').localeCompare(String(b?.cartId || ''));
  });
  if (list.length === 0) return null;

  const startEdit = (item) => {
    setEditingId(item.cartId);
    setDraft(buildEditDraft(item.order));
    setEditError('');
  };

  const cancelEdit = () => {
    setEditingId('');
    setDraft(null);
    setEditError('');
  };

  const saveEdit = (item) => {
    if (!draft) return;
    const patch = buildOrderPatch(item.order, draft);
    const nextOrder = { ...(item.order || {}), ...patch };
    if (typeof validateItem === 'function') {
      const missing = validateItem(nextOrder) || [];
      if (missing.length) {
        setEditError(`次の項目を確認してください: ${missing.join('、')}`);
        return;
      }
    }
    onEditItem?.(item.cartId, patch);
    cancelEdit();
  };

  const setDraftField = (key, value) => {
    setDraft((prev) => ({ ...(prev || {}), [key]: value }));
  };

  const editInput =
    'mt-1 min-h-[40px] w-full rounded-lg border-2 border-violet-200 bg-white px-2 text-sm font-bold text-slate-900 focus:border-violet-500 focus:outline-none';

  return (
    <section
      className="rounded-2xl border-2 border-violet-300 bg-violet-50/70 p-4 shadow-sm sm:p-5"
      aria-labelledby="order-cart-title"
    >
      <h3 id="order-cart-title" className="text-base font-black text-violet-950 sm:text-lg">
        発注リスト（カート）
        <span className="ml-2 inline-flex rounded-full bg-violet-600 px-2 py-0.5 text-xs font-black text-white">
          {list.length}件
        </span>
      </h3>
      <p className="mt-1 text-xs font-medium text-violet-900/85 sm:text-sm">
        条件の異なる注文をまとめて登録できます。行の「編集」で内容を修正、✖ で削除できます。
      </p>

      <ul className="mt-4 grid gap-3">
        {list.map((item, index) => {
          const o = item?.order || {};
          const isEditing = editingId === item.cartId && draft;
          return (
            <li
              key={item.cartId}
              className="relative rounded-xl border border-violet-200/90 bg-white p-4 pr-11 shadow-sm"
            >
              <button
                type="button"
                onClick={() => onRemove?.(item.cartId)}
                disabled={bulkLoading || Boolean(isEditing)}
                className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-lg font-black leading-none text-slate-600 hover:border-red-200 hover:bg-red-50 hover:text-red-700 disabled:opacity-40"
                aria-label={`リスト${index + 1}を削除`}
              >
                ✖
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <p className="flex flex-wrap items-center gap-2 text-sm font-black text-slate-900">
                  注文 {index + 1}
                  <LocationPendingBadge order={o} />
                </p>
                {!isEditing ? (
                  <button
                    type="button"
                    onClick={() => startEdit(item)}
                    disabled={bulkLoading}
                    className="rounded-lg border border-violet-300 bg-violet-50 px-2.5 py-1 text-xs font-black text-violet-800 hover:bg-violet-100 disabled:opacity-40"
                    aria-label={`リスト${index + 1}を編集`}
                  >
                    ✏️ 編集
                  </button>
                ) : null}
              </div>

              {isEditing ? (
                <div className="mt-2">
                  <div className="grid gap-2 text-sm sm:grid-cols-2">
                    <label className="text-xs font-bold text-slate-500">
                      日付
                      <input
                        type="date"
                        value={draft.preferredDate}
                        onChange={(e) => setDraftField('preferredDate', e.target.value)}
                        className={editInput}
                      />
                    </label>
                    <label className="text-xs font-bold text-slate-500">
                      時間
                      <select
                        value={draft.timeSlot}
                        onChange={(e) => setDraftField('timeSlot', e.target.value)}
                        className={editInput}
                      >
                        <option value="">選択してください</option>
                        {TIME_SLOTS.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-xs font-bold text-slate-500">
                      数量（m³）
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={draft.quantityM3}
                        onChange={(e) => setDraftField('quantityM3', e.target.value)}
                        className={editInput}
                      />
                    </label>
                    <label className="text-xs font-bold text-slate-500">
                      配合
                      <input
                        type="text"
                        value={draft.mixText}
                        onChange={(e) => setDraftField('mixText', e.target.value)}
                        placeholder="例: 24-18-25N"
                        className={editInput + ' font-mono'}
                      />
                    </label>
                    <label className="text-xs font-bold text-slate-500 sm:col-span-2">
                      {siteAddressLabel}
                      <input
                        type="text"
                        value={draft.siteAddress}
                        onChange={(e) => setDraftField('siteAddress', e.target.value)}
                        className={editInput}
                      />
                    </label>
                    <label className="flex items-center gap-2 text-xs font-bold text-slate-600 sm:col-span-2">
                      <input
                        type="checkbox"
                        checked={draft.hasTest}
                        onChange={(e) => setDraftField('hasTest', e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300"
                      />
                      試験あり
                    </label>
                  </div>
                  {editError ? (
                    <p className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-bold text-red-700" role="alert">
                      {editError}
                    </p>
                  ) : null}
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="min-h-[40px] flex-1 rounded-lg border-2 border-slate-300 bg-white text-sm font-black text-slate-700 hover:bg-slate-50"
                    >
                      キャンセル
                    </button>
                    <button
                      type="button"
                      onClick={() => saveEdit(item)}
                      className="min-h-[40px] flex-1 rounded-lg border-2 border-violet-700 bg-violet-600 text-sm font-black text-white hover:bg-violet-700"
                    >
                      保存
                    </button>
                  </div>
                </div>
              ) : (
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
                    <dt className="text-xs font-bold text-slate-500">{siteAddressLabel}</dt>
                    <dd className="break-words font-bold text-slate-800">{o.siteAddress || '—'}</dd>
                  </div>
                  <div className="sm:col-span-2">
                    <dt className="text-xs font-bold text-slate-500">試験</dt>
                    <dd className="font-black text-slate-900">{o.has_test ? '試験あり' : '試験なし'}</dd>
                  </div>
                </dl>
              )}
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
