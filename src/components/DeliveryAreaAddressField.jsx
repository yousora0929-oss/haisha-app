import React from 'react';
import { combineDeliveryAddress, getDeliveryAreaValidationMessage } from '../utils/deliveryAreas.js';

const DEFAULT_DETAIL_LABEL = '町名・地名';
const DEFAULT_DETAIL_PLACEHOLDER = '町名・地名を入力してください';
const DEFAULT_DETAIL_HINT = '例：横尾（番地・現場名が未定の場合は町名まで）';

/**
 * 組合設定の納入エリアをプルダウンで選び、町名・地名を入力する住所入力
 */
export function DeliveryAreaAddressField({
  idPrefix = 'delivery',
  label = '現場住所',
  allowedAreas = [],
  deliveryArea,
  onDeliveryAreaChange,
  addressDetail,
  onAddressDetailChange,
  detailLabel = DEFAULT_DETAIL_LABEL,
  detailPlaceholder = DEFAULT_DETAIL_PLACEHOLDER,
  detailHint = DEFAULT_DETAIL_HINT,
  detailRequired = true,
  showWarning = true,
  disabled = false,
}) {
  const areas = Array.isArray(allowedAreas) ? allowedAreas.filter(Boolean) : [];
  const full = combineDeliveryAddress(deliveryArea, addressDetail);
  const warning = showWarning ? getDeliveryAreaValidationMessage(full, areas) : '';
  const townMissing = detailRequired && !String(addressDetail || '').trim();

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-semibold text-slate-700" htmlFor={`${idPrefix}-area`}>
        {label}
      </label>
      {areas.length > 0 ? (
        <p className="text-xs font-medium text-slate-500">組合の納入可能エリアから市町村を選択し、町名・地名まで入力してください。</p>
      ) : (
        <p className="text-xs font-bold text-amber-800">納入エリアが未設定です。管理画面でエリアを登録してください。</p>
      )}
      <label className="text-xs font-bold text-slate-600" htmlFor={`${idPrefix}-area`}>
        市町村 <span className="text-red-600">*</span>
      </label>
      <select
        id={`${idPrefix}-area`}
        value={deliveryArea || ''}
        disabled={disabled || areas.length === 0}
        required={detailRequired}
        aria-required={detailRequired}
        onChange={(e) => onDeliveryAreaChange?.(e.target.value)}
        className="min-h-[52px] w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-base font-medium text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300 disabled:bg-slate-100"
      >
        <option value="">エリアを選択</option>
        {areas.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <label className="text-xs font-bold text-slate-600" htmlFor={`${idPrefix}-detail`}>
        {detailLabel} <span className="text-red-600">*</span>
      </label>
      <input
        id={`${idPrefix}-detail`}
        type="text"
        value={addressDetail || ''}
        disabled={disabled}
        required={detailRequired}
        aria-required={detailRequired}
        placeholder={detailPlaceholder}
        onChange={(e) => onAddressDetailChange?.(e.target.value)}
        className={
          'min-h-[52px] w-full rounded-xl border-2 px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300 ' +
          (townMissing ? 'border-amber-400 bg-amber-50/40' : 'border-slate-200')
        }
      />
      {detailHint ? (
        <p className="text-xs font-medium leading-relaxed text-slate-600">{detailHint}</p>
      ) : null}
      {full ? (
        <p className="text-xs font-mono font-bold text-slate-600">
          登録住所プレビュー: {full}
        </p>
      ) : null}
      {warning ? (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900" role="alert">
          {warning}
        </p>
      ) : null}
    </div>
  );
}
