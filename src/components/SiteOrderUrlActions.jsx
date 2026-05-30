import React, { useEffect, useMemo, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import '../siteOrderPrint.css';
import {
  buildSiteOrderShareMessage,
  buildSiteOrderUrl,
  formatSiteOrderVendorLabel,
  resolveSiteOrderPartiesFromProject,
  siteOrderUrlValidationMessage,
} from '../utils/siteOrderUrl.js';
import { APP_BRAND_NAME } from '../constants/brand.js';
import { isValidSiteOrderUrlToken } from '../utils/urlValidation.js';

function SiteOrderQrModal({ open, parties, url, onClose }) {
  const [shareCopied, setShareCopied] = useState(false);

  const siteName = String(parties?.siteName || '').trim() || '現場';
  const vendorLabel = formatSiteOrderVendorLabel(parties) || '—';
  const shareMessage = useMemo(() => buildSiteOrderShareMessage(url, parties), [url, parties]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) setShareCopied(false);
  }, [open]);

  if (!open) return null;

  const copyShareMessage = async () => {
    if (!shareMessage) return;
    try {
      await navigator.clipboard.writeText(shareMessage);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
    } catch (err) {
      console.error('共有文のコピーに失敗しました', err);
      window.prompt('以下の文面をコピーしてください', shareMessage);
    }
  };

  return (
    <div
      className="site-order-qr-overlay fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        id="site-order-qr-print"
        role="dialog"
        aria-modal="true"
        aria-labelledby="site-order-qr-title"
        className="site-order-qr-sheet w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="site-order-qr-print-brand site-order-qr-no-print text-center text-[10px] font-black uppercase tracking-widest text-indigo-700">
          {APP_BRAND_NAME}
        </p>
        <h2 id="site-order-qr-title" className="site-order-qr-no-print text-center text-lg font-black text-slate-900">
          専用発注URL（QRコード）
        </h2>

        <div className="site-order-qr-print-body mt-3 text-center">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">業者・商社</p>
          <p className="site-order-qr-vendor mt-1 text-xl font-bold leading-snug text-slate-900">{vendorLabel}</p>
          <p className="mt-4 text-xs font-bold uppercase tracking-wide text-slate-500">現場名</p>
          <p className="site-order-qr-site mt-1 text-2xl font-black leading-tight text-slate-900">{siteName}</p>

          <div className="site-order-qr-code-wrap mx-auto mt-5 inline-flex justify-center rounded-xl border-2 border-slate-200 bg-white p-4">
            {url ? <QRCodeSVG value={url} size={256} level="M" includeMargin className="site-order-qr-svg" /> : null}
          </div>

          {url ? (
            <p className="site-order-qr-url-print mt-4 hidden break-all font-mono text-[10px] text-slate-600 sm:block">
              {url}
            </p>
          ) : null}
          <p className="site-order-qr-hint-print hidden text-xs font-bold text-slate-500">
            スマートフォンでQRを読み取り、専用フォームから発注してください
          </p>
        </div>

        <div className="site-order-qr-no-print mt-5 space-y-3">
          <div>
            <p className="text-xs font-bold text-slate-600">共有用テキスト（LINE・メール向け）</p>
            <textarea
              readOnly
              rows={4}
              value={shareMessage}
              className="mt-1.5 w-full resize-none rounded-lg border-2 border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium leading-relaxed text-slate-800"
              aria-label="共有用テキスト"
              onFocus={(e) => e.target.select()}
            />
            <button
              type="button"
              onClick={() => void copyShareMessage()}
              className="mt-2 min-h-[44px] w-full rounded-lg border-2 border-sky-600 bg-sky-50 text-sm font-black text-sky-900 hover:bg-sky-100"
            >
              {shareCopied ? '共有文をコピーしました' : '共有文をコピー'}
            </button>
          </div>
          {url ? (
            <p className="break-all text-center font-mono text-[10px] text-slate-500">{url}</p>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded-lg border-2 border-slate-300 bg-white text-sm font-black text-slate-800"
            >
              閉じる
            </button>
            <button
              type="button"
              onClick={() => window.print()}
              className="min-h-[44px] rounded-lg border-2 border-indigo-700 bg-indigo-600 text-sm font-black text-white"
            >
              印刷
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const BTN_BASE =
  'inline-flex w-auto max-w-none shrink-0 items-center justify-center whitespace-nowrap rounded border font-bold shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50';

function actionBtnClass(compact) {
  return compact
    ? BTN_BASE + ' px-1.5 py-0.5 text-[10px] leading-tight sm:px-2 sm:py-1 sm:text-[11px]'
    : BTN_BASE + ' px-2 py-1 text-xs sm:px-2.5 sm:py-1 sm:text-sm';
}

/**
 * 物件専用発注URL（/order/:url_token）のコピー・QR・ブラウザで開く
 * @param {string} [customerName] 業者名（customers.company_name 等）
 * @param {string} [traderName] 商社名（任意）
 * @param {string} [siteName] 現場名（projects.name）
 * @param {object} [project] 物件レコード（customer と併用可）
 * @param {object} [customer] 業者レコード
 */
export function SiteOrderUrlActions({
  urlToken,
  siteName,
  customerName,
  traderName,
  project,
  customer,
  onCopied,
  compact = false,
}) {
  const [copied, setCopied] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const token = String(urlToken || '').trim();
  const valid = isValidSiteOrderUrlToken(token);
  const url = useMemo(() => (valid ? buildSiteOrderUrl(token) : ''), [valid, token]);
  const guardMsg = siteOrderUrlValidationMessage(token);
  const btnClass = actionBtnClass(compact);

  const parties = useMemo(() => {
    if (project || customer) {
      const fromRecords = resolveSiteOrderPartiesFromProject(project, customer);
      return {
        siteName: String(siteName || fromRecords.siteName || '').trim(),
        customerName: String(customerName || fromRecords.customerName || '').trim(),
        traderName: String(traderName || fromRecords.traderName || '').trim(),
      };
    }
    return {
      siteName: String(siteName || '').trim(),
      customerName: String(customerName || '').trim(),
      traderName: String(traderName || '').trim(),
    };
  }, [project, customer, siteName, customerName, traderName]);

  const shareMessage = useMemo(() => buildSiteOrderShareMessage(url, parties), [url, parties]);

  const openLabel = compact ? '開く' : 'URLを開く';
  const copyLabel = copied ? (compact ? '済' : 'コピー済み') : compact ? 'コピー' : 'URLコピー';
  const shareCopyLabel = shareCopied ? (compact ? '文面済' : '文面コピー済') : compact ? '文面' : '共有文コピー';
  const qrLabel = compact ? 'QR' : 'QR表示';

  const requireValid = (e) => {
    e?.stopPropagation?.();
    if (valid) return true;
    window.alert(guardMsg);
    return false;
  };

  const handleCopyUrl = async (e) => {
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

  const handleCopyShare = async (e) => {
    if (!requireValid(e)) return;
    try {
      await navigator.clipboard.writeText(shareMessage);
      setShareCopied(true);
      onCopied?.();
      window.setTimeout(() => setShareCopied(false), 2000);
    } catch (err) {
      console.error('共有文のコピーに失敗しました', err);
      window.prompt('以下の文面をコピーしてください', shareMessage);
    }
  };

  const openUrl = (e) => {
    if (!requireValid(e)) return;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <>
      <div
        className={
          'flex min-w-0 max-w-full shrink-0 flex-wrap items-center gap-1 ' +
          (compact ? 'justify-start' : 'justify-end gap-1.5')
        }
        onClick={(e) => e.stopPropagation()}
      >
        {!compact && guardMsg && !valid ? (
          <p className="w-full rounded-lg border border-amber-300 bg-amber-50 px-2 py-1.5 text-xs font-bold text-amber-900">
            {guardMsg}
          </p>
        ) : null}
        {!compact && valid && parties.siteName ? (
          <p className="w-full text-sm font-bold text-slate-800">
            <span className="text-slate-500">業者:</span> {formatSiteOrderVendorLabel(parties) || '—'}
            <span className="mx-1 text-slate-300">|</span>
            <span className="text-slate-500">現場:</span> {parties.siteName}
          </p>
        ) : null}
        {!compact && valid && url ? (
          <p className="w-full break-all font-mono text-[10px] text-slate-500">{url}</p>
        ) : null}
        <button
          type="button"
          disabled={!valid}
          onClick={openUrl}
          className={
            btnClass +
            ' border-emerald-500 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400'
          }
          title={valid ? url : guardMsg}
          aria-label={compact ? '専用発注URLを開く' : undefined}
        >
          {openLabel}
        </button>
        <button
          type="button"
          disabled={!valid}
          onClick={(e) => void handleCopyUrl(e)}
          className={btnClass + ' border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}
          title={valid ? 'URLのみコピー' : guardMsg}
          aria-label={compact ? '専用発注URLをコピー' : undefined}
        >
          {copyLabel}
        </button>
        <button
          type="button"
          disabled={!valid}
          onClick={(e) => void handleCopyShare(e)}
          className={btnClass + ' border-sky-400 bg-sky-50 text-sky-900 hover:bg-sky-100'}
          title={valid ? shareMessage : guardMsg}
          aria-label={compact ? '共有文をコピー' : undefined}
        >
          {shareCopyLabel}
        </button>
        <button
          type="button"
          disabled={!valid}
          onClick={(e) => {
            if (!requireValid(e)) return;
            setQrOpen(true);
          }}
          className={btnClass + ' border-slate-300 bg-white text-slate-700 hover:bg-slate-50'}
          title={valid ? 'QRコードを表示' : guardMsg}
          aria-label={compact ? '専用発注URLのQRを表示' : undefined}
        >
          {qrLabel}
        </button>
      </div>
      <SiteOrderQrModal open={qrOpen} parties={parties} url={url} onClose={() => setQrOpen(false)} />
    </>
  );
}
