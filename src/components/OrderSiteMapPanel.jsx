import React from 'react';
import { MapPicker } from '../MapPicker.jsx';
import {
  resolveOrderMapCoords,
  resolveOrderMapImageUrl,
  resolveOrderMapPlaceholderHint,
} from '../utils/orderSiteMap.js';

/** MapPicker の地図本体と同じ高さ（レイアウト崩れ防止） */
export const ORDER_SITE_MAP_BODY_CLASS = 'min-h-[300px] w-full';

/**
 * 地図未送信・未設定時の誤認防止プレースホルダー
 */
export function OrderSiteMapPlaceholder({ hint, className = '' }) {
  return (
    <div
      className={
        'overflow-hidden rounded-lg border border-dashed border-gray-300 bg-gray-100 dark:border-slate-700 dark:bg-slate-800 ' +
        className
      }
      role="img"
      aria-label="地図未送信"
    >
      <div className={'flex ' + ORDER_SITE_MAP_BODY_CLASS + ' items-center justify-center px-4 py-8'}>
        <div className="text-center">
          <p className="text-lg font-bold text-gray-400 dark:text-slate-500 sm:text-xl">📍 地図未送信</p>
          <p className="mt-2 text-sm font-medium leading-relaxed text-gray-400 dark:text-slate-500">
            {hint || '（物件マスタに位置情報が設定されていません）'}
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * 注文カード内の現場地図エリア（座標あり→MapPicker、なし→プレースホルダー）
 */
export function OrderSiteMapPanel({
  order,
  project = null,
  className = '',
  mapPickerClassName = '',
  showTitle = true,
}) {
  const coords = resolveOrderMapCoords(order, project);
  const imageUrl = resolveOrderMapImageUrl(order);
  const hint = resolveOrderMapPlaceholderHint(order, project);

  return (
    <div className={className}>
      {showTitle ? (
        <p className="text-xs font-black uppercase tracking-wider text-slate-500 sm:text-sm dark:text-slate-400">
          現場地図
        </p>
      ) : null}
      {coords ? (
        <MapPicker
          lat={String(coords.lat)}
          lng={String(coords.lng)}
          interactive={false}
          className={(showTitle ? 'mt-2 ' : '') + mapPickerClassName}
        />
      ) : imageUrl ? (
        <div
          className={
            (showTitle ? 'mt-2 ' : '') +
            'overflow-hidden rounded-lg border-2 border-slate-300 bg-slate-100 dark:border-slate-600 dark:bg-slate-900 ' +
            mapPickerClassName
          }
        >
          <img
            src={imageUrl}
            alt="現場地図"
            className={ORDER_SITE_MAP_BODY_CLASS + ' object-contain'}
          />
        </div>
      ) : (
        <OrderSiteMapPlaceholder hint={hint} className={(showTitle ? 'mt-2 ' : '') + mapPickerClassName} />
      )}
    </div>
  );
}
