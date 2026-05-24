import React, { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { buildSiteOrderUrl, siteOrderUrlValidationMessage } from '../utils/siteOrderUrl.js';
import { isValidSiteOrderUrlToken } from '../utils/urlValidation.js';

function SiteOrderQrModal({ open, siteName, url, onClose }) {
  useEffect(() => {
    if (!open) return undefined;
    const style = document.createElement('style');
    style.id = 'site-order-qr-print-style';
    style.textContent = `
      @media print {
        body * { visibility: hidden !important; }
        #site-order-qr-print, #site-order-qr-print * { visibility: visible !important; }
        #site-order-qr-print {
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
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4 print:bg-white"
      role="presentation"
      onClick={onClose}
    >
      <div
        id="site-order-qr-print"
        role="dialog"
        aria-modal="true"
        className="w-full max-w-sm rounded-xl border border-slate-200 bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-center text-lg font-black text-slate-900">専用発注URL（QRコード）</h2>
        <p className="mt-2 text-center text-sm font-bold text-slate-700">{displayName}</p>
        <div className="mt-4 flex justify-center rounded-lg border border-slate-200 bg-white p-4">
          {url ? <QRCodeSVG value={url} size={256} level="M" includeMargin /> : null}
        </div>
        {url ? <p className="mt-3 break-all text-center font-mono text-[10px] text-slate-600">{url}</p> : null}
        <div className="mt-5 grid grid-cols-2 gap-2 print:hidden">
          <button type="button" onClick={onClose} className="min-h-[44px] rounded-lg border-2 border-slate-300 bg-white text-sm font-black">
            閉じる
          </button>
          <button type="button" onClick={() => window.print()} className="min-h-[44px] rounded-lg border-2 border-indigo-700 bg-indigo-600 text-sm font-black text-white">
            印刷
          </button>
        </div>
      </div>
    </div>
  );
}

const BTN =
  'inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-bold shadow-sm transition sm:text-sm disabled:cursor-not-allowed disabled:opacity-50';

/**
 * 物件専用発注URL（/order/:url_token）のコピー・QR・ブラウザで開く
 */
export function SiteOrderUrlActions({ urlToken, siteName, onCopied, compact = false }) {
  const [copied, setCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const token = String(urlToken || '').trim();
  const valid = isValidSiteOrderUrlToken(token);
  const url = useMemo(() => (valid ? buildSiteOrderUrl(token) : ''), [valid, token]);
  const guardMsg = siteOrderUrlValidationMessage(token);

  const requireValid = (e) => {
    e?.stopPropagation?.();
    if (valid) return true;
    window.alert(guardMsg);
    return false;
  };

  const handleCopy = async (e) => {
    if (!requireValid(e)) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      onCopied?.();
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('専用URLのコピーに失敗しました', err);
      window.prompt('以下のURLをコピーしてください', url);
    }
  };

  const openUrl = (e) => {
    if (!requireValid(e)) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <div className={'flex shrink-0 flex-wrap items-center justify-end gap-1.5 ' + (compact ? '' : 'flex-col sm:items-stretch')}>
        {!compact && guardMsg && !valid ? (
          <p className="w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-bold text-amber-900">{guardMsg}</p>
        ) : null}
        {!compact && valid && url ? (
          <p className="w-full break-all font-mono text-[10px] text-slate-500">{url}</p>
        ) : null}
        <button
          type="button"
          disabled={!valid}
          onClick={openUrl}
          className={BTN + ' border-emerald-500 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400'}
          title={valid ? url : guardMsg}
        >
          URLを開く
        </button>
        <button
          type="button"
          disabled={!valid}
          onClick={(e) => void handleCopy(e)}
          className={BTN + ' border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}
        >
          {copied ? 'コピー済み' : 'URLコピー'}
        </button>
        <button
          type="button"
          disabled={!valid}
          onClick={(e) => {
            if (!requireValid(e)) return;
            setQrOpen(true);
          }}
          className={BTN + ' border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}
        >
          QR表示
        </button>
      </div>
      <SiteOrderQrModal open={qrOpen} siteName={siteName} url={url} onClose={() => setQrOpen(false)} />
    </>
  );
}
