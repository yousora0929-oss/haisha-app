import React from 'react';
import { combineDeliveryAddress, getDeliveryAreaValidationMessage } from '../utils/deliveryAreas.js';

/**
 * 組合設定の納入エリアをプルダウンで選び、番地等を追記する住所入力
 */
export function DeliveryAreaAddressField({
  idPrefix = 'delivery',
  label = '現場住所',
  allowedAreas = [],
  deliveryArea,
  onDeliveryAreaChange,
  addressDetail,
  onAddressDetailChange,
  detailPlaceholder = '番地・丁目・現場名など（任意）',
  showWarning = true,
  disabled = false,
}) {
  const areas = Array.isArray(allowedAreas) ? allowedAreas.filter(Boolean) : [];
  const full = combineDeliveryAddress(deliveryArea, addressDetail);
  const warning = showWarning ? getDeliveryAreaValidationMessage(full, areas) : '';

  return (
    <div className="flex flex-col gap-2">
      <label className="text-sm font-semibold text-slate-700" htmlFor={`${idPrefix}-area`}>
        {label}
      </label>
      {areas.length > 0 ? (
        <p className="text-xs font-medium text-slate-500">組合の納入可能エリアから選択してください。</p>
      ) : (
        <p className="text-xs font-bold text-amber-800">納入エリアが未設定です。管理画面でエリアを登録してください。</p>
      )}
      <select
        id={`${idPrefix}-area`}
        value={deliveryArea || ''}
        disabled={disabled || areas.length === 0}
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
      <input
        id={`${idPrefix}-detail`}
        type="text"
        value={addressDetail || ''}
        disabled={disabled}
        placeholder={detailPlaceholder}
        onChange={(e) => onAddressDetailChange?.(e.target.value)}
        className="min-h-[52px] w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300"
      />
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
