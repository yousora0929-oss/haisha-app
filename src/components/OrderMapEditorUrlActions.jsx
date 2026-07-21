import React, { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { buildMapEditorUrl, rememberMapEditorReturnUrl } from '../mapEditorConstants.js';
import { resolveGuestSiteOrderToken } from '../supabaseClient.js';
import { isLocationPendingOrder } from '../utils/orderWorkflow.js';

function MapEditorQrModal({ open, siteName, url, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const style = document.createElement('style');
    style.id = 'map-editor-qr-print-style';
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        #map-editor-qr-print, #map-editor-qr-print * { visibility: visible !important; }
        #map-editor-qr-print {
          position: fixed !important;
          inset: 0 !important;
          display: flex !important;
          align-items: center !important;
          justify-content: center !important;
          background: white !important;
          padding: 24px !important;
        }
      }
    `;
    document.head.appendChild(style);
    return () => style.remove();
  }, [open]);

  if (!open) return null;
  const displayName = String(siteName || '').trim() || '現場';

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50 p-4 print:bg-white"
      role="presentation"
      onClick={onClose}
    >
      <div
        id="map-editor-qr-print"
        role="dialog"
        aria-modal="true"
        aria-labelledby="map-editor-qr-title"
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl print:max-w-none print:border-0 print:shadow-none"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="map-editor-qr-title" className="text-center text-lg font-black text-slate-900">
          地図送付URL（QRコード）
        </h2>
        <p className="mt-2 text-center text-sm font-bold text-slate-700">{displayName}</p>
        <div className="mt-4 flex justify-center rounded-lg border border-slate-200 bg-white p-4">
          {url ? <QRCodeSVG value={url} size={256} level="M" includeMargin /> : null}
        </div>
        {url ? (
          <p className="mt-3 break-all text-center font-mono text-[10px] leading-snug text-slate-600 sm:text-xs">{url}</p>
        ) : null}
        <p className="mt-2 text-center text-xs text-slate-500">スマホで読み取り、現場図にスタンプを配置できます</p>
        <div className="mt-5 grid grid-cols-2 gap-2 print:hidden">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg border-2 border-slate-300 bg-white text-sm font-black text-slate-800 hover:bg-slate-50"
          >
            閉じる
          </button>
          <button
            type="button"
            onClick={() => window.print()}
            className="min-h-[44px] rounded-lg border-2 border-emerald-700 bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700"
          >
            印刷
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 注文ごとの地図スタンプエディタ URL（コピー・QR・新規タブ）
 */
export function OrderMapEditorUrlActions({
  orderId,
  siteName,
  order,
  project,
  variant = 'default',
  onCopied,
  guestToken,
}) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrUrl, setQrUrl] = useState('');
  const id = String(orderId || order?.id || '').trim();

  const resolveMapEditorUrl = useCallback(() => {
    const token = String(guestToken || resolveGuestSiteOrderToken() || '').trim();
    return buildMapEditorUrl(id, undefined, token ? { guestToken: token } : {});
  }, [guestToken, id]);

  const mapPending = order ? isLocationPendingOrder(order) : false;
  const overrideMapUrl = String(
    order?.override_map_image_url || order?.overrideMapImageUrl || order?.map_image_url || '',
  ).trim();
  // 注文専用の上書きが無ければ物件の基本マップへフォールバック
  const projectDefaultMapUrl = String(
    project?.default_map_image_url || project?.map_base_image_url || project?.mapBaseImageUrl || '',
  ).trim();
  const mapImageUrl = overrideMapUrl || projectDefaultMapUrl;
  const hasOverride = Boolean(overrideMapUrl);
  const usesProjectDefault = !hasOverride && Boolean(projectDefaultMapUrl);
  const hasAnyMap = Boolean(mapImageUrl);

  if (!id) return null;

  const handleCopy = async (e) => {
    e?.stopPropagation?.();
    const url = resolveMapEditorUrl();
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      onCopied?.();
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('地図URLのコピーに失敗', err);
      window.prompt('以下のURLをコピーしてください', url);
    }
  };

  const openEditor = (e) => {
    e?.stopPropagation?.();
    const url = resolveMapEditorUrl();
    if (!url) return;
    rememberMapEditorReturnUrl();
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  const openQrModal = (e) => {
    e?.stopPropagation?.();
    setQrUrl(resolveMapEditorUrl());
    setQrOpen(true);
  };

  const previewUrl = resolveMapEditorUrl();

  const btn =
    'min-h-[40px] rounded-lg border-2 px-3 text-xs font-black transition sm:text-sm ' +
    (variant === 'compact' ? 'min-h-[36px] px-2' : '');

  const wrapClass =
    mapPending
      ? 'rounded-xl border-2 border-amber-400 bg-amber-50/90 p-3'
      : variant === 'inline'
        ? ''
        : 'rounded-xl border border-slate-200 bg-slate-50/90 p-3';

  return (
    <div className={wrapClass}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-black uppercase tracking-wider text-slate-600">🗺️ 現場地図URL</p>
          {mapPending ? (
            <p className="mt-0.5 text-xs font-bold text-amber-900">⚠️ 地図待ち — このURLから図面を送付してください</p>
          ) : hasOverride ? (
            <p className="mt-0.5 text-xs font-medium text-emerald-800">打設用マップ登録済み（再編集可）</p>
          ) : usesProjectDefault ? (
            <p className="mt-0.5 text-xs font-medium text-emerald-800">登録済み（物件の基本マップを使用中）</p>
          ) : (
            <p className="mt-0.5 text-xs font-medium text-slate-600">スタンプ配置用ページを開けます</p>
          )}
        </div>
      </div>

      {hasAnyMap ? (
        <button
          type="button"
          onClick={openEditor}
          className="mt-3 block w-full overflow-hidden rounded-lg border-2 border-emerald-200 bg-white text-left shadow-sm transition hover:border-emerald-400 hover:ring-2 hover:ring-emerald-200/70"
          title="クリックで地図エディタを開く"
        >
          <img
            src={mapImageUrl}
            alt={usesProjectDefault ? '物件の基本現場地図' : '登録済みの現場地図'}
            className="mx-auto h-28 w-full max-w-xs object-contain bg-slate-100 sm:h-32"
          />
          <span className="block border-t border-emerald-100 bg-emerald-50/80 px-2 py-1 text-center text-[10px] font-bold text-emerald-900">
            {usesProjectDefault
              ? '物件の基本マップ — タップして地図を開く'
              : 'サムネイルをタップして地図を開く'}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={openEditor}
          className="mt-3 flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-300 bg-white/80 px-3 py-6 text-center transition hover:border-slate-400 hover:bg-slate-50"
          title="地図エディタを開く"
        >
          <span className="text-3xl" aria-hidden>
            🗺️
          </span>
          <span className="text-sm font-black text-slate-700">まだ地図が作成されていません</span>
          <span className="text-xs font-medium text-slate-500">タップして地図エディタを開く</span>
        </button>
      )}

      {variant !== 'compact' && previewUrl ? (
        <p className="mt-2 break-all font-mono text-[10px] leading-snug text-slate-600 sm:text-xs">{previewUrl}</p>
      ) : null}
      <div className={'mt-2 flex flex-wrap gap-2 ' + (variant === 'inline' ? '' : '')}>
        <button type="button" onClick={openEditor} className={btn + ' border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'}>
          地図を開く
        </button>
        <button type="button" onClick={(e) => void handleCopy(e)} className={btn + ' border-slate-300 bg-white text-slate-800 hover:bg-slate-100'}>
          {copied ? 'コピー済み' : 'URLコピー'}
        </button>
        <button type="button" onClick={openQrModal} className={btn + ' border-indigo-400 bg-indigo-50 text-indigo-900 hover:bg-indigo-100'}>
          QR表示
        </button>
      </div>
      <MapEditorQrModal open={qrOpen} siteName={siteName} url={qrUrl || previewUrl} onClose={() => setQrOpen(false)} />
    </div>
  );
}
