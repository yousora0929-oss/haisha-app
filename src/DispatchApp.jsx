import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  DISPATCH_DEFAULT_FACTORY_SITE_NAME,
  DISPATCH_DEFAULT_FACTORY_SITE_ID,
  TIME_SLOTS,
  pad2,
  todayLocalISODate,
} from './haishaConstants.js';
import * as db from './haishaDb.js';
import {
  supabase,
  setCustomerPanelSession,
  clearCustomerPanelSession,
  hasCustomerPanelSession,
  setGuestSiteOrderSession,
  clearGuestSiteOrderSession,
  hasGuestSiteOrderSession,
  ensurePanelRealtimeAuth,
  CUSTOMER_PANEL_PHONE_KEY,
} from './supabaseClient.js';
import {
  PUSH_CHAT_REDIRECT_SESSION_KEY,
  clearAppBadge,
  registerOneSignalUser,
  logoutOneSignalUser,
  setupNotificationClickRedirect,
} from './utils/notification.js';
import concreteLinkLogo from './assets/concrete-link-logo.svg';
import { APP_BRAND_HOME_LABEL, APP_BRAND_NAME } from './constants/brand.js';
import { ThemeToggle } from './components/ThemeToggle.jsx';
import { OrderCartPreview } from './components/OrderCartPreview.jsx';
import { OrderMapEditorUrlActions } from './components/OrderMapEditorUrlActions.jsx';
import { LocationPendingBadge } from './components/LocationPendingBadge.jsx';
import { DeliveryAreaAddressField } from './components/DeliveryAreaAddressField.jsx';
import { MasterSuggestInput } from './components/MasterSuggestInput.jsx';
import { customerSuggestTexts, projectSuggestTexts } from './utils/masterSuggest.js';
import {
  buildDispatchOrderForDate,
  validateCartLineForm,
  extractOrderFormDefaultsFromHistory,
} from './utils/dispatchBulkOrder.js';
import { buildMapEditorUrl, rememberMapEditorReturnUrl } from './mapEditorConstants.js';
import { combineDeliveryAddress, extractProjectAddressFields, normalizeAllowedDeliveryAreas } from './utils/deliveryAreas.js';
import {
  fetchTownLocationsForMunicipality,
  findTownLocation,
  resolveDeliveryPrefecture,
  townNamesFromLocationList,
} from './utils/heartrailsGeo.js';
import { isLocationPendingOrder, resolveInitialOrderStatus, sumOrderVolumesM3 } from './utils/orderWorkflow.js';
import { resolveOrderSiteDisplayName, sanitizeSiteNameValue } from './utils/siteNameDisplay.js';
import { ProjectExternalUrlActions } from './components/ProjectExternalUrlActions.jsx';
import { SiteOrderUrlActions } from './components/SiteOrderUrlActions.jsx';
import {
  formatSiteOrderVendorLabel,
  parseSiteOrderTokenFromPath,
  resolveGuestOrderLockedFields,
} from './utils/siteOrderUrl.js';
import {
  detectCustomerOrderNotifications,
  analyzeCustomerOrderRealtimePayload,
} from './utils/customerOrderRealtime.js';
import {
  detectCustomerChatNotifications,
  analyzeCustomerChatRealtimePayload,
} from './utils/customerChatRealtime.js';
import {
  customerChatDisplayName,
  isOutgoingSideForCustomerView,
  isSystemChatSender,
} from './utils/chatMessageSenders.js';
import {
  getOrderDeliveryDateISO,
  isOrderInHistoryView,
  isOrderInProgressView,
  sortOrdersForHistory,
} from './utils/orderDeliverySchedule.js';
import {
  primeNotificationAlarm,
  primeChatNotificationSound,
  playChatNotificationSound,
  playOrderConfirmedSound,
  startNotificationAlarm,
  stopNotificationAlarm,
} from './utils/notificationAlarm.js';
import { dispatchRealtimePayloadByKind } from './utils/realtimePayloadRouting.js';
import { createSplitRealtimeSyncScheduler } from './utils/realtimeSyncScheduler.js';
import {
  resolveOrderScheduleMatchDate,
  shouldShowMapPendingPlaceholder,
} from './utils/orderSiteMapDisplay.js';

function isOrderForGuestSite(order, ctx) {
  if (!order || !ctx?.customer?.id) return false;
  if (String(order.customer_id || order.customerId || '').trim() !== String(ctx.customer.id).trim()) {
    return false;
  }
  const projectId = ctx.project?.id;
  if (projectId && String(order.project_id || order.projectId || '').trim() !== String(projectId).trim()) {
    return false;
  }
  return true;
}

const DISPATCH_CUSTOMER_SESSION_KEY = 'haisha_dispatch_customer_id_v1';
const SITE_ORDER_PENDING_SESSION_KEY = 'haisha_site_order_pending_v1';
const DISPATCH_AUTH_SESSION_KEY = 'haisha_dispatch_auth_customer_id_v1';
const UNLOAD_DURATION_OPTIONS = [
  { value: '15', label: '15分' },
  { value: '30', label: '30分（標準）' },
  { value: '45', label: '45分' },
  { value: '60', label: '60分（手押し車など時間要）' },
  { value: '95_plus', label: '95分以上（要相談）' },
];

const CUSTOMER_ORDER_TABS = [
  ['new', '新規発注', '📝'],
  ['active', '進行中', '🚚'],
  ['history', '履歴', '📋'],
  ['calendar', 'カレンダー', '📅'],
];

const CUSTOMER_FIELD_CLASS =
  'min-h-[52px] w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-base font-medium text-slate-900 outline-none transition focus:border-slate-400 focus:ring-2 focus:ring-slate-300 lg:min-h-[48px] lg:py-2.5';

function unloadDurationLabel(value) {
  return UNLOAD_DURATION_OPTIONS.find((o) => o.value === String(value || ''))?.label || '30分（標準）';
}

/** ゲスト専用発注: 確定済み情報の読み取り専用表示 */
function GuestLockedField({ label, value, emptyLabel = '—' }) {
  const text = String(value || '').trim();
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">{label}</span>
      <div
        className="min-h-[52px] rounded-xl border-2 border-slate-200 bg-slate-100 px-4 py-3 text-base font-semibold leading-snug text-slate-800 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
        aria-readonly="true"
      >
        {text || emptyLabel}
      </div>
    </div>
  );
}

    function getDefaultFactoryDisplayName(order) {
      const site = order && order.factorySiteName ? String(order.factorySiteName).trim() : '';
      if (site) return site;
      const label = order && order.acceptedFactoryLabel ? String(order.acceptedFactoryLabel).trim() : '';
      if (label) return label.replace(/^受注工場[：:]\s*/, '') || label;
      return '工場（未設定）';
    }

    function masterOrderSearchHaystack(order) {
      if (!order) return '';
      const parts = [
        order.siteName,
        order.siteAddress,
        order.traderName,
        order.contractorName,
        order.factorySiteName,
        order.acceptedFactoryLabel,
        order.factoryPendingByName,
        order.customerName,
        order.projectName,
        order.ordered_by,
        order.orderedBy,
        getDefaultFactoryDisplayName(order),
        DISPATCH_DEFAULT_FACTORY_SITE_NAME,
      ];
      return parts.map((p) => (p == null ? '' : String(p))).join(' ').toLowerCase();
    }

    function orderMatchesMasterSearch(order, raw) {
      const q = String(raw || '').trim().toLowerCase();
      if (!q) return true;
      return masterOrderSearchHaystack(order).includes(q);
    }

    function formatSupabaseError(err, fallback = '処理に失敗しました') {
      const message = err?.message ? String(err.message) : fallback;
      const code = err?.code ? ` (Code: ${err.code})` : '';
      const details = err?.details ? `\nDetails: ${err.details}` : '';
      const hint = err?.hint ? `\nHint: ${err.hint}` : '';
      return `${fallback}: ${message}${code}${details}${hint}`;
    }

    function logDispatchError(label, err, extra = undefined) {
      const payload =
        err != null && typeof err === 'object'
          ? { message: err.message, code: err.code, details: err.details, hint: err.hint, ...extra }
          : { value: err, ...extra };
      console.error(label, payload);
    }

    function latestChatMessage(messages) {
      const list = Array.isArray(messages) ? messages.filter(Boolean) : [];
      return list.length ? list[list.length - 1] : null;
    }

    function chatMessageReadKey(message) {
      if (!message) return '';
      return [message.id, message.createdAt, message.from].map((x) => (x == null ? '' : String(x))).join('|');
    }

    function isUnreadForDispatch(messages, readKey) {
      const latest = latestChatMessage(messages);
      if (!latest) return false;
      const from = String(latest.from || '');
      if (from !== 'factory' && from !== 'admin') return false;
      return chatMessageReadKey(latest) !== readKey;
    }

    function orderPartyInfo(order) {
      const tradingCompany = String(order?.trading_company_name ?? order?.projectTradingCompanyName ?? order?.projectTradingCompany ?? order?.tradingCompanyName ?? order?.traderName ?? '').trim();
      const contractor = String(order?.customerName ?? order?.customer_name ?? order?.contractorName ?? order?.contractor_name ?? order?.displayContractorName ?? order?.contractorName ?? '').trim();
      const contractorBase = contractor || String(order?.contractorName ?? '').trim();
      const site = resolveOrderSiteDisplayName(order);
      const orderedBy = String(order?.ordered_by ?? order?.orderedBy ?? '').trim();
      const phone = String(order?.sitePhone ?? order?.phone ?? '').trim();
      return {
        contractor: tradingCompany && contractorBase ? `${contractorBase} (商社: ${tradingCompany})` : contractorBase || '—',
        site: site || '—',
        orderedBy: orderedBy || '—',
        phone: phone || '—',
      };
    }

    function orderContactPersonName(order, fallback = '担当者') {
      return String(
        order?.manager_name ??
          order?.contact_person ??
          order?.contactPerson ??
          order?.ordered_by ??
          order?.orderedBy ??
          fallback ??
          '',
      ).trim() || '担当者';
    }

    function OrderListSearchInput({ id, value, onChange }) {
      return (
        <div className="relative w-full max-w-md">
          <span className="pointer-events-none absolute left-3 top-1/2 z-[1] -translate-y-1/2 text-slate-400" aria-hidden="true">
            <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" strokeLinecap="round" />
            </svg>
          </span>
          <input
            id={id}
            type="search"
            enterKeyHint="search"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="キーワードで検索…"
            className="min-h-[44px] w-full rounded-xl border border-slate-200/90 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-800 shadow-inner outline-none ring-0 transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-2 focus:ring-slate-200/80"
            autoComplete="off"
          />
        </div>
      );
    }

    async function appendOrderChatMessage(orderId, from, body) {
      return db.appendChatMessage(orderId, from, body);
    }

    const MIX_SHORTCUTS = ['18-8-20BB', '18-12-20BB', '18-15-20N', '21-15-20N'];

    const MASTER_TRADER_SUGGESTIONS = ['梅田建材', '大分商事', '九州生コン販売', '共栄商事'];
    const MASTER_CONTRACTOR_SUGGESTIONS = ['佐藤建設', '田中組', '大分土木', '九州コンクリート工業'];

    function preferredDateTime(dateStr, timeSlotValue) {
      const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!m) return null;
      const minutes = Number(timeSlotValue);
      if (!Number.isFinite(minutes)) return null;
      return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Math.floor(minutes / 60), minutes % 60, 0, 0);
    }

    function isPastPreferredDateTime(dateStr, timeSlotValue, now = new Date()) {
      const dt = preferredDateTime(dateStr, timeSlotValue);
      return Boolean(dt && dt.getTime() < now.getTime());
    }

    function addLocalDaysISO(dateStr, days) {
      const m = String(dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      const base = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
      base.setDate(base.getDate() + Number(days || 0));
      return `${base.getFullYear()}-${pad2(base.getMonth() + 1)}-${pad2(base.getDate())}`;
    }

    function firstAvailableTimeSlotForDate(dateStr, now = new Date()) {
      return TIME_SLOTS.find((slot) => !isPastPreferredDateTime(dateStr, slot.value, now)) || null;
    }

    function nextAvailableOrderDateTime(baseDate = todayLocalISODate(), now = new Date()) {
      const firstToday = firstAvailableTimeSlotForDate(baseDate, now);
      if (firstToday) return { date: baseDate, slot: firstToday.value };
      const nextDate = addLocalDaysISO(baseDate, 1);
      return { date: nextDate, slot: TIME_SLOTS[0]?.value ?? '480' };
    }

    function parseMixDetails(mixText) {
      const m = String(mixText || '').trim().match(/^(\d+)-(\d+)-(\d+)([A-Za-z]+)$/);
      if (!m) return null;
      return {
        strength: m[1],
        slump: m[2],
        aggregate: m[3],
        cement: m[4].toUpperCase(),
      };
    }

    function historyStatusMeta(order) {
      const st = String(order?.status || order?.factoryResponseStatus || '').trim();
      if (['customer_cancelled', 'cancelled', 'deleted'].includes(st)) {
        return { key: 'cancelled', label: 'キャンセル', className: 'bg-red-600 text-white border-red-700' };
      }
      if (['completed', 'complete', 'done', 'delivered'].includes(st)) {
        return { key: 'completed', label: '完了', className: 'bg-emerald-600 text-white border-emerald-700' };
      }
      if (st === 'accepted' || order?.factoryResponseStatus === 'accepted') {
        return { key: 'active', label: '受注', className: 'bg-blue-600 text-white border-blue-700' };
      }
      if (st === 'pending_association') {
        return { key: 'active', label: '組合承認待ち', className: 'cl-alert-association bg-violet-600 text-white border-violet-700' };
      }
      return { key: 'active', label: '配車待ち', className: 'bg-amber-400 text-amber-950 border-amber-500' };
    }

    /** 将来のAPI連携用（画面には表示しない） */
    function inferAggregateFromMix(text) {
      if (!text || typeof text !== 'string') return null;
      if (text.includes('-20')) return '20';
      if (text.includes('-40')) return '40';
      return null;
    }

    function Label({ children, htmlFor }) {
      return (
        <label htmlFor={htmlFor} className="block text-sm font-semibold text-slate-700">
          {children}
        </label>
      );
    }

    function formatOrderDate(order) {
      const iso = order.preferredDate;
      if (!iso || typeof iso !== 'string') return '—';
      const p = iso.split('-');
      if (p.length === 3) return `${p[0]}/${Number(p[1])}/${Number(p[2])}`;
      return iso;
    }

    function OrderStatusBadges({ order }) {
      const st = order.status === 'customer_cancelled' ? 'customer_cancelled' : order.status || order.factoryResponseStatus;
      const displayName = getDefaultFactoryDisplayName(order);
      if (st === 'customer_cancelled') {
        return (
          <span className="inline-flex rounded-full border-2 border-red-600 bg-red-50 px-3 py-1 text-xs font-black text-red-700 shadow-sm">
            お客様都合キャンセル
          </span>
        );
      }
      if (st === 'accepted') {
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-emerald-600 px-3 py-1 text-xs font-black text-white shadow-sm">
              工場受注
            </span>
            <span className="rounded-full bg-slate-700 px-3 py-1 text-xs font-bold text-white">{displayName}</span>
          </div>
        );
      }
      if (st === 'rejected') {
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-red-600 px-3 py-1 text-xs font-black text-white shadow-sm">
              工場より拒否
            </span>
            <span className="rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-black text-red-900 shadow-sm">
              {displayName}
            </span>
            {order.factoryRejectSource === 'schedule_auto' ? (
              <span className="rounded-full bg-slate-600 px-2 py-0.5 text-[10px] font-black uppercase tracking-wide text-white">
                自動
              </span>
            ) : null}
          </div>
        );
      }
      if (st === 'pending') {
        const who = order.factoryPendingByName?.trim() || displayName;
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-amber-500 px-3 py-1 text-xs font-black text-amber-950 shadow-sm">
              保留対応中
            </span>
            <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-black text-amber-950 shadow-sm">
              {who}
            </span>
          </div>
        );
      }
      return (
        <span className="inline-flex rounded-full border-2 border-slate-300 bg-slate-100 px-3 py-1 text-xs font-black text-slate-700">
          工場の回答待ち
        </span>
      );
    }

    function ConfirmedDetailsBlock({ order }) {
      const qty = order.confirmedQuantityM3 ?? order.quantityM3 ?? order.quantityCube;
      const mix = order.confirmedMixText ?? order.mixText;
      const qtyDisp = qty !== undefined && qty !== null && String(qty).trim() !== '' ? String(qty).trim() : '—';
      const mixDisp = mix && String(mix).trim() ? String(mix).trim() : '—';
      const isSnapshot = order.status === 'accepted' || order.factoryResponseStatus === 'accepted';
      return (
        <div className="rounded-xl border border-slate-200 bg-slate-50/95 p-4">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">合意・確定内容（工場確認）</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-xs font-bold text-slate-400">数量（m³）</dt>
              <dd className="font-mono text-sm font-black text-slate-900">{qtyDisp}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-xs font-bold text-slate-400">配合</dt>
              <dd className="text-right font-mono text-sm font-bold text-slate-900">{mixDisp}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-xs font-bold text-slate-400">車両</dt>
              <dd className="text-sm font-bold text-slate-900">{order.vehicleLabel || '—'}</dd>
            </div>
          </dl>
          {isSnapshot ? (
            <p className="mt-3 text-[10px] font-bold text-emerald-700">受注確定時点の内容を表示しています</p>
          ) : (
            <p className="mt-3 text-[10px] text-slate-400">※受注後は工場側で確定した値が優先表示されます（未確定時は発注内容）</p>
          )}
        </div>
      );
    }

    function MasterPendingBanner({ order }) {
      const [tick, setTick] = useState(0);
      useEffect(() => {
        if (order.factoryResponseStatus !== 'pending') return undefined;
        const id = window.setInterval(() => setTick((t) => t + 1), 1000);
        return () => window.clearInterval(id);
      }, [order.factoryResponseStatus, order.factoryPendingStartedAt, order.id]);
      if (order.factoryResponseStatus !== 'pending') return null;
      const iso = order.factoryPendingStartedAt;
      const parsed = iso && Date.parse(iso);
      const startMs = Number.isFinite(parsed) ? parsed : null;
      const elapsed = startMs != null ? Math.floor((Date.now() - startMs) / 1000) + tick * 0 : 0;
      const remainingSec = Math.max(0, 300 - elapsed);
      const mm = Math.floor(remainingSec / 60);
      const ss = remainingSec % 60;
      const label = `${pad2(mm)}:${pad2(ss)}`;
      const expired = remainingSec <= 0;
      const who = order.factoryPendingByName?.trim() || getDefaultFactoryDisplayName(order);
      return (
        <div
          className={
            'mt-3 rounded-xl border-2 px-3 py-2.5 ' +
            (expired ? 'border-red-500 bg-red-50' : 'border-amber-400 bg-amber-50/95')
          }
          role="status"
        >
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">保留（工場から · 同期）</p>
          <p className="mt-0.5 text-xs font-bold text-slate-800">
            保留にした工場：<span className="font-black text-slate-900">{who}</span>
          </p>
          <p
            className={
              'mt-1 font-mono text-2xl font-black tabular-nums tracking-tight ' +
              (expired ? 'text-red-600 animate-pulse' : 'text-amber-950')
            }
          >
            {expired ? '時間切れ' : label}
          </p>
          {expired ? (
            <p className="mt-1 text-[10px] font-bold text-red-700">5分経過。工場の受注・拒否をお待ちください。</p>
          ) : (
            <p className="mt-1 text-[10px] font-bold text-amber-900/85">工場画面と同じ5:00からのカウントダウンです</p>
          )}
        </div>
      );
    }

    function CustomerChatScreen({ order, messages, onBack, onSendMessage, onMarkChatRead }) {
      const [draft, setDraft] = useState('');
      const messagesListRef = useRef(null);
      const messagesEndRef = useRef(null);
      const list = Array.isArray(messages) ? messages : [];
      const orderId = order?.id;
      const senderName = orderContactPersonName(order);
      const factoryName = getDefaultFactoryDisplayName(order);
      useEffect(() => {
        const el = messagesListRef.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }, [list.length, messages]);
      useEffect(() => {
        clearAppBadge();
      }, [orderId]);
      useEffect(() => {
        if (orderId && typeof onMarkChatRead === 'function') {
          onMarkChatRead(orderId, messages);
        }
      }, [orderId, messages, onMarkChatRead]);
      const send = useCallback(async () => {
        const t = draft.trim();
        if (!t || !orderId) return;
        const ok = await onSendMessage(orderId, t);
        if (ok !== false) setDraft('');
      }, [draft, onSendMessage, orderId]);
      if (!order) return null;
      return (
        <div className="fixed inset-0 z-[420] flex h-[100dvh] flex-col overflow-hidden bg-[#e5ddd5]">
          <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-[max(0.75rem,env(safe-area-inset-top))] shadow-sm">
            <div className="mx-auto flex max-w-md items-center gap-3">
              <button
                type="button"
                onClick={onBack}
                className="shrink-0 rounded-full border-2 border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-slate-700 shadow-sm"
              >
                ← 戻る
              </button>
              <div className="min-w-0">
                <h2 className="truncate text-base font-black text-slate-900">{factoryName} との質疑応答</h2>
                <p className="mt-0.5 truncate text-xs font-bold text-slate-500">{resolveOrderSiteDisplayName(order) || '注文チャット'}</p>
              </div>
            </div>
          </header>
          <ul
            ref={messagesListRef}
            className="mx-auto w-full max-w-md flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-4"
            aria-live="polite"
          >
            {list.length === 0 ? (
              <li className="px-2 py-12 text-center text-sm font-bold text-slate-500">まだメッセージはありません</li>
            ) : (
              list.map((m) => {
                if (isSystemChatSender(m.from)) {
                  return (
                    <li key={m.id} className="flex justify-center">
                      <div className="max-w-[95%] rounded-xl border border-slate-300/80 bg-slate-100/95 px-3 py-2 text-center text-xs font-bold text-slate-700 shadow-sm">
                        <p className="whitespace-pre-wrap break-words leading-snug">{m.body}</p>
                        <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-slate-500">
                          システム ·{' '}
                          {new Date(m.createdAt).toLocaleTimeString('ja-JP', {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </p>
                      </div>
                    </li>
                  );
                }
                const mine = isOutgoingSideForCustomerView(m.from);
                const displaySenderName = customerChatDisplayName(m.from, senderName);
                return (
                  <li key={m.id} className={'flex ' + (mine ? 'justify-end' : 'justify-start')}>
                    <div
                      className={
                        'max-w-[88%] rounded-2xl px-3 py-2 text-sm shadow-sm ' +
                        (mine
                          ? 'rounded-br-md border border-sky-200 bg-sky-100 text-slate-900'
                          : 'rounded-bl-md bg-white text-slate-900')
                      }
                    >
                      <p className="whitespace-pre-wrap break-words leading-snug">{m.body}</p>
                      <p className="mt-1 text-[10px] font-bold text-slate-500">
                        {displaySenderName} ·{' '}
                        {new Date(m.createdAt).toLocaleTimeString('ja-JP', {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </p>
                    </div>
                  </li>
                );
              })
            )}
            <li ref={messagesEndRef} aria-hidden="true" className="h-px" />
          </ul>
          <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgba(15,23,42,0.08)]">
            <div className="mx-auto flex w-full max-w-md items-center gap-2">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              placeholder="メッセージを入力…"
              className="min-h-[48px] min-w-0 flex-1 rounded-full border border-slate-300 bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
            />
            <button
              type="button"
              onClick={send}
              className="shrink-0 rounded-full bg-indigo-600 px-5 py-2 text-sm font-black text-white shadow hover:bg-indigo-700"
            >
              送信
            </button>
            </div>
          </div>
        </div>
      );
    }

    function PullToRefresh({ children, onRefresh, className = '' }) {
      const [pullDistance, setPullDistance] = useState(0);
      const [refreshing, setRefreshing] = useState(false);
      const startYRef = useRef(null);
      const pullingRef = useRef(false);
      const threshold = 70;

      const runRefresh = useCallback(async () => {
        if (refreshing || typeof onRefresh !== 'function') return;
        setRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
          setPullDistance(0);
          pullingRef.current = false;
          startYRef.current = null;
        }
      }, [onRefresh, refreshing]);

      return (
        <div
          className={'relative overscroll-y-contain ' + className}
          onTouchStart={(e) => {
            if (window.scrollY > 0 || refreshing) return;
            startYRef.current = e.touches[0]?.clientY ?? null;
            pullingRef.current = true;
          }}
          onTouchMove={(e) => {
            if (!pullingRef.current || startYRef.current == null) return;
            const next = Math.max(0, (e.touches[0]?.clientY ?? 0) - startYRef.current);
            if (next > 0 && window.scrollY <= 0) setPullDistance(Math.min(96, next * 0.55));
          }}
          onTouchEnd={() => {
            if (pullDistance >= threshold) {
              void runRefresh();
            } else {
              setPullDistance(0);
              pullingRef.current = false;
              startYRef.current = null;
            }
          }}
          style={{ transform: pullDistance > 0 && !refreshing ? `translateY(${pullDistance}px)` : undefined }}
        >
          <div
            className={
              'pointer-events-none fixed left-1/2 top-2 z-[500] -translate-x-1/2 rounded-full border border-indigo-200 bg-white px-4 py-2 text-sm font-black text-indigo-700 shadow-lg transition-all ' +
              (refreshing || pullDistance > 12 ? 'translate-y-0 opacity-100' : '-translate-y-8 opacity-0')
            }
          >
            <span className="mr-2 inline-block animate-spin">🔄</span>
            更新中...
          </div>
          {children}
        </div>
      );
    }

    function InProgressOrderCard({
      order,
      project,
      hasUnreadChat,
      onOpenChat,
      onAllowStatusReset,
      guestToken = '',
    }) {
      const addr = order.siteAddress?.trim() || '';
      const party = orderPartyInfo(order);
      const trader = order.traderName?.trim() || '—';
      const vehicle = order.vehicleLabel || (order.vehicleType === 'small' ? '小型' : '大型');
      const qtyRaw = order.confirmedQuantityM3 ?? order.quantityM3 ?? order.quantityCube;
      const qtyDisp =
        qtyRaw !== undefined && qtyRaw !== null && String(qtyRaw).trim() !== '' ? String(qtyRaw).trim() + ' m³' : '—';
      const mixDisp = order.confirmedMixText ?? order.mixText;
      const mixStr = mixDisp && String(mixDisp).trim() ? String(mixDisp).trim() : '—';
      const addrDisp = addr || '—';

      const timeSummary = `${formatOrderDate(order)} · ${order.timePointLabel || order.timeSlotLabel || '—'}`;
      const isCustomerCancelled = order.status === 'customer_cancelled';
      const showMapPlaceholder = useMemo(
        () => shouldShowMapPendingPlaceholder(order, project),
        [order, project],
      );
      const scheduleDateLabel = useMemo(() => resolveOrderScheduleMatchDate(order), [order]);
      const mapUrl = useMemo(() => {
        if (!order?.id) return '';
        const token = String(guestToken || '').trim();
        return buildMapEditorUrl(order.id, undefined, token ? { guestToken: token } : {});
      }, [guestToken, order?.id]);

      const orderedByDisp = String(order.ordered_by ?? order.orderedBy ?? '').trim();
      const compactMeta = [
        vehicle ? `車種:${vehicle}` : '',
        trader && trader !== '—' ? `商社:${trader}` : '',
        orderedByDisp ? `担当:${orderedByDisp}` : '',
      ]
        .filter(Boolean)
        .join(' / ');

      const handleOpenMap = useCallback(
        (e) => {
          e?.stopPropagation?.();
          if (!mapUrl) return;
          try {
            rememberMapEditorReturnUrl();
          } catch {
            /* ignore */
          }
          window.open(mapUrl, '_blank', 'noopener,noreferrer');
        },
        [mapUrl],
      );

      const handleCopyMapUrl = useCallback(
        async (e) => {
          e?.stopPropagation?.();
          if (!mapUrl) return;
          try {
            await navigator.clipboard.writeText(mapUrl);
          } catch (err) {
            console.error('地図URLコピーに失敗', err);
            window.prompt('以下のURLをコピーしてください', mapUrl);
          }
        },
        [mapUrl],
      );

      return (
        <article
          className={
            'relative rounded-xl border bg-white shadow-sm transition dark:bg-slate-800 ' +
            (hasUnreadChat ? 'border-l-4 border-l-amber-500 dark:border-l-amber-500 ' : '') +
            (isCustomerCancelled ? 'border-red-200 dark:border-red-800' : 'border-gray-100 dark:border-slate-700')
          }
        >
          {showMapPlaceholder ? (
            <div
              className="mx-4 mt-3 rounded-lg border border-dashed border-slate-300 bg-slate-100 px-3 py-2 text-xs font-bold text-slate-500 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-300"
              role="status"
            >
              <span aria-hidden>📍</span> 地図未送信
              {scheduleDateLabel ? (
                <span className="ml-2 font-semibold text-slate-400 dark:text-slate-400">（予定: {scheduleDateLabel}）</span>
              ) : null}
            </div>
          ) : null}
          <div className="flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between md:gap-4 md:py-2">
            {/* 左〜中央：情報セグメント */}
            <div className="min-w-0 flex-1 md:grid md:grid-cols-2 md:gap-4 2xl:flex 2xl:items-stretch 2xl:gap-0">
              {/* 第一セグメント：日時とステータス */}
              <div className="min-w-0 md:col-span-2 2xl:col-span-1 2xl:flex-[0.95] 2xl:pr-5 2xl:border-r 2xl:border-gray-200 dark:2xl:border-slate-600">
                <p
                  className="truncate text-lg font-black text-gray-900 dark:text-gray-100 md:text-lg 2xl:text-xl"
                  title={timeSummary}
                >
                  {timeSummary}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <OrderStatusBadges order={order} />
                  <LocationPendingBadge order={order} />
                </div>
              </div>

              {/* 第二セグメント：配合と数量 */}
              <div className="mt-2 min-w-0 md:mt-0 2xl:flex-[1.05] 2xl:px-5 2xl:border-r 2xl:border-gray-200 dark:2xl:border-slate-600">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">
                  数量 / 配合
                </p>
                <div className="mt-0.5 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-base font-black text-gray-900 dark:text-gray-100">{qtyDisp.replace('m³', '㎥')}</span>
                  <span className="min-w-0 truncate font-mono text-sm font-black text-gray-900 dark:text-gray-100">
                    {mixStr}
                  </span>
                  {compactMeta ? (
                    <span className="min-w-0 truncate text-sm font-bold text-gray-500 dark:text-gray-300">{compactMeta}</span>
                  ) : null}
                </div>
              </div>

              {/* 第三セグメント：現場名と連絡先 */}
              <div className="mt-2 min-w-0 md:mt-0 2xl:flex-[1.1] 2xl:pl-5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-gray-400 dark:text-gray-500">現場 / 連絡先</p>
                <div className="mt-0.5 grid min-w-0 gap-1">
                  <p
                    className="min-w-0 truncate text-base font-black text-gray-900 dark:text-gray-100"
                    title={party.site || ''}
                  >
                    <span className="mr-1 text-gray-400 dark:text-gray-500" aria-hidden>
                      📍
                    </span>
                    {party.site || '—'}
                  </p>
                  <p className="min-w-0 truncate text-sm font-bold text-gray-600 dark:text-gray-300">
                    <span className="mr-1 text-gray-400 dark:text-gray-500" aria-hidden>
                      ☎
                    </span>
                    <span className="font-mono">{party.phone || '—'}</span>
                    {orderedByDisp ? (
                      <span className="ml-2 text-gray-400 dark:text-gray-500">（{orderedByDisp}）</span>
                    ) : null}
                  </p>
                </div>
              </div>
            </div>

            {/* 右：ステータス + アクション */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 md:flex-nowrap md:justify-end">
              <div className="flex flex-wrap items-center gap-2">
                {order.is_admin_modified ? (
                  <span className="inline-flex rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-black text-violet-800">
                    管理者変更
                  </span>
                ) : null}
              </div>

              <div className="flex items-center gap-2">
                {mapUrl ? (
                  <>
                    <button
                      type="button"
                      onClick={handleOpenMap}
                      className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-black text-white shadow-sm hover:bg-emerald-700 active:scale-[0.99]"
                      title="現場地図を開く"
                    >
                      地図
                    </button>
                    <button
                      type="button"
                      onClick={(e) => void handleCopyMapUrl(e)}
                      className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-black text-slate-700 shadow-sm hover:bg-slate-50 active:scale-[0.99]"
                      title="現場地図URLをコピー"
                    >
                      URL
                    </button>
                  </>
                ) : null}
                <div className={'relative shrink-0 ' + (hasUnreadChat ? 'mt-3' : '')}>
                  {hasUnreadChat ? (
                    <span
                      className="pointer-events-none absolute -top-9 left-1/2 z-20 -translate-x-1/2 animate-bounce whitespace-nowrap rounded-lg border-2 border-red-400 bg-red-500 px-2.5 py-1 text-[11px] font-black text-white shadow-lg"
                      role="status"
                      aria-label="新着メッセージあり"
                    >
                      新着メッセージ
                      <span
                        className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-b-2 border-r-2 border-red-400 bg-red-500"
                        aria-hidden="true"
                      />
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => {
                      if (typeof onOpenChat === 'function') onOpenChat(order.id);
                    }}
                    className={
                      'relative rounded-lg px-3 py-1.5 text-sm font-black text-white shadow-sm transition active:scale-[0.99] ' +
                      (hasUnreadChat
                        ? 'bg-indigo-600 ring-2 ring-red-400 ring-offset-1 hover:bg-indigo-700 dark:ring-offset-slate-800'
                        : 'bg-indigo-600 hover:bg-indigo-700')
                    }
                    title={hasUnreadChat ? '工場から新着メッセージがあります' : '工場とチャット'}
                    aria-label={hasUnreadChat ? 'チャット（新着メッセージあり）' : '工場とチャット'}
                  >
                    チャット
                    {hasUnreadChat ? (
                      <span
                        className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center"
                        aria-hidden="true"
                      >
                        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-400 opacity-75" />
                        <span className="relative inline-flex h-3 w-3 rounded-full bg-red-500 ring-2 ring-white dark:ring-slate-800" />
                      </span>
                    ) : null}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* モバイルのみ：補足情報（縦に読めるように） */}
          <div className="border-t border-slate-100 px-4 py-2 text-xs font-bold text-slate-600 dark:border-slate-700 dark:text-slate-300 md:hidden">
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              <span className="font-semibold text-slate-500 dark:text-slate-400">車種</span>
              <span className="text-slate-900 dark:text-gray-100">{vehicle}</span>
              <span className="text-slate-300 dark:text-slate-600">|</span>
              <span className="font-semibold text-slate-500 dark:text-slate-400">業者</span>
              <span className="text-slate-900 dark:text-gray-100">{party.contractor || '—'}</span>
              <span className="text-slate-300 dark:text-slate-600">|</span>
              <span className="font-semibold text-slate-500 dark:text-slate-400">住所</span>
              <span className="truncate text-slate-900 dark:text-gray-100">{addrDisp}</span>
            </div>
            <MasterPendingBanner order={order} />
          </div>

          {order.factoryUnlockRequested ? (
            <div className="border-t border-indigo-100 bg-indigo-50 px-4 py-3">
              <p className="text-xs font-black text-indigo-950">工場からステータス変更のロック解除が依頼されています。</p>
              {typeof onAllowStatusReset === 'function' ? (
                <button
                  type="button"
                  onClick={() => onAllowStatusReset(order.id)}
                  className="mt-2 rounded-lg bg-indigo-700 px-3 py-1.5 text-sm font-black text-white shadow-sm hover:bg-indigo-800 active:scale-[0.99]"
                >
                  ステータス再設定許可
                </button>
              ) : null}
            </div>
          ) : null}

          {isCustomerCancelled ? (
            <div className="border-t border-red-200 bg-red-50 px-4 py-2 text-center text-xs font-black text-red-700">
              ⚠️お客様都合キャンセル
            </div>
          ) : null}
        </article>
      );
    }

    function CustomerOrderCalendar({ orders, selectedDate, onSelectDate, currentMonth, onMonthChange }) {
      const [expandedStatusOrderId, setExpandedStatusOrderId] = useState('');
      const lastTapRef = useRef({ orderId: null, at: 0 });
      const days = useMemo(() => {
        const base = currentMonth instanceof Date && !Number.isNaN(currentMonth.getTime()) ? currentMonth : new Date();
        const first = new Date(base.getFullYear(), base.getMonth(), 1);
        const gridStart = new Date(first);
        gridStart.setDate(first.getDate() - first.getDay());
        return Array.from({ length: 42 }, (_, i) => {
          const d = new Date(gridStart);
          d.setDate(gridStart.getDate() + i);
          return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
        });
      }, [currentMonth]);
      const monthLabel = useMemo(() => {
        const base = currentMonth instanceof Date && !Number.isNaN(currentMonth.getTime()) ? currentMonth : new Date();
        return `${base.getFullYear()}年${base.getMonth() + 1}月`;
      }, [currentMonth]);
      const monthKey = useMemo(() => {
        const base = currentMonth instanceof Date && !Number.isNaN(currentMonth.getTime()) ? currentMonth : new Date();
        return `${base.getFullYear()}-${pad2(base.getMonth() + 1)}`;
      }, [currentMonth]);
      const ordersByDate = useMemo(() => {
        const map = {};
        for (const order of orders || []) {
          const day = String(order?.preferredDate || order?.preferred_date || order?.delivery_date || '').slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
          if (!map[day]) map[day] = [];
          map[day].push(order);
        }
        return map;
      }, [orders]);
      const selectedOrders = ordersByDate[selectedDate] || [];
      const statusClass = (order) => {
        const meta = historyStatusMeta(order);
        if (meta.key === 'completed') return 'bg-slate-500 text-white';
        if (meta.key === 'cancelled') return 'bg-red-500 text-white';
        if (meta.label === '受注') return 'bg-emerald-600 text-white';
        return 'bg-amber-400 text-amber-950';
      };
      const toggleStatusCard = (orderId) => {
        const id = String(orderId || '').trim();
        if (!id) return;
        setExpandedStatusOrderId((cur) => (String(cur) === id ? '' : id));
      };
      const handleCardTouchEnd = (orderId) => {
        const id = String(orderId || '').trim();
        if (!id) return;
        const now = Date.now();
        const last = lastTapRef.current;
        if (last.orderId === id && now - last.at <= 360) {
          lastTapRef.current = { orderId: null, at: 0 };
          toggleStatusCard(id);
          return;
        }
        lastTapRef.current = { orderId: id, at: now };
      };
      return (
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md sm:p-5 lg:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-slate-900">注文カレンダー</h2>
              <p className="mt-1 text-xs font-bold text-slate-500">自分が発注した注文を月間表示します。</p>
            </div>
            <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-black text-white">{selectedOrders.length}件</span>
          </div>
          <div className="mt-4 flex flex-col gap-6 lg:grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] lg:items-start">
          <div className="min-w-0">
          <div className="flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
            <button type="button" onClick={() => { const next = new Date(currentMonth); next.setMonth(next.getMonth() - 1); onMonthChange(next); }} className="min-h-[44px] rounded-xl border-2 border-slate-300 bg-white px-3 text-sm font-black text-slate-700 lg:min-h-[40px]">◀ 前月</button>
            <p className="text-lg font-black text-slate-900">{monthLabel}</p>
            <button type="button" onClick={() => { const next = new Date(currentMonth); next.setMonth(next.getMonth() + 1); onMonthChange(next); }} className="min-h-[44px] rounded-xl border-2 border-slate-300 bg-white px-3 text-sm font-black text-slate-700 lg:min-h-[40px]">次月 ▶</button>
          </div>
          <div className="mt-3 grid grid-cols-7 gap-1 text-center text-xs font-black text-slate-500">
            {['日', '月', '火', '水', '木', '金', '土'].map((d) => <div key={d} className="rounded-lg bg-slate-100 py-1">{d}</div>)}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1">
            {days.map((day) => {
              const list = ordersByDate[day] || [];
              const active = day === selectedDate;
              const inMonth = day.startsWith(monthKey);
              const d = new Date(`${day}T12:00:00`);
              return (
                <button key={day} type="button" onClick={() => onSelectDate(day)} className={'min-h-[5.5rem] rounded-xl border-2 p-1.5 text-left transition active:scale-[0.99] lg:min-h-[6rem] sm:p-2 ' + (active ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-200' : inMonth ? 'border-slate-200 bg-white hover:bg-slate-50' : 'border-slate-100 bg-slate-50 opacity-45')}>
                  <p className="text-xs font-black text-slate-500">{d.getDate()}</p>
                  <div className="mt-1 space-y-0.5">
                    {list.slice(0, 3).map((order) => {
                      const party = orderPartyInfo(order);
                      return <span key={order.id} className={'block truncate rounded-md px-1.5 py-0.5 text-[10px] font-black ' + statusClass(order)}>{party.site || '現場未設定'}</span>;
                    })}
                    {list.length > 3 ? <span className="block text-[10px] font-black text-indigo-700">+{list.length - 3}件</span> : null}
                  </div>
                </button>
              );
            })}
          </div>
          </div>
          <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50 p-4 lg:sticky lg:top-24">
            <h3 className="text-sm font-black text-slate-900">{selectedDate.replace(/-/g, '/')} の注文</h3>
            {selectedOrders.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-slate-300 bg-white px-4 py-6 text-center text-sm font-bold text-slate-500">この日の注文はありません。</p>
            ) : (
              <ul className="mt-3 grid gap-3 lg:grid-cols-2">
                {selectedOrders.map((order) => {
                  const party = orderPartyInfo(order);
                  const meta = historyStatusMeta(order);
                  return (
                    <li
                      key={order.id}
                      onDoubleClick={() => toggleStatusCard(order.id)}
                      onTouchEnd={() => handleCardTouchEnd(order.id)}
                      className="cursor-pointer rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md active:scale-[0.99]"
                      title="ダブルタップで現在のステータスを表示"
                    >
                      <span className={'inline-flex rounded-full px-3 py-1 text-xs font-black ' + statusClass(order)}>{meta.label}</span>
                      <p className="mt-2 text-sm font-black text-slate-900">{party.site || '現場未設定'}</p>
                      <p className="mt-1 text-xs font-bold text-slate-500">{order.timePointLabel || order.timeSlotLabel || '時刻未設定'} / {order.confirmedQuantityM3 ?? order.quantityM3 ?? '—'}m³ / {order.confirmedMixText || order.mixText || '配合未入力'}</p>
                      <p className="mt-2 text-[10px] font-black text-indigo-600">ダブルタップで現在のステータス</p>
                      <div
                        className="grid transition-[grid-template-rows] duration-300 ease-out"
                        style={{ gridTemplateRows: expandedStatusOrderId === order.id ? '1fr' : '0fr' }}
                      >
                        <div className="min-h-0 overflow-hidden">
                          <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50 p-3">
                            <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600">現在のステータス</p>
                            <div className="mt-2">
                              <OrderStatusBadges order={order} />
                            </div>
                            <div className="mt-3">
                              <ConfirmedDetailsBlock order={order} />
                            </div>
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          </div>
        </section>
      );
    }

    export function DispatchApp() {
      const today = todayLocalISODate();
      const initialOrderDateTime = useMemo(() => nextAvailableOrderDateTime(today), [today]);

      const [preferredDate, setPreferredDate] = useState(initialOrderDateTime.date);
      const [timeSlot, setTimeSlot] = useState(initialOrderDateTime.slot);
      const [cartItems, setCartItems] = useState([]);

      useEffect(() => {
        if (!TIME_SLOTS.some((s) => s.value === timeSlot)) {
          setTimeSlot(TIME_SLOTS[0]?.value ?? '480');
        }
      }, [timeSlot]);
      useEffect(() => {
        if (!preferredDate) return;
        if (preferredDate < today) {
          setPreferredDate(initialOrderDateTime.date);
          setTimeSlot(initialOrderDateTime.slot);
          return;
        }
        if (isPastPreferredDateTime(preferredDate, timeSlot)) {
          const nextSlot = firstAvailableTimeSlotForDate(preferredDate);
          if (nextSlot) {
            setTimeSlot(nextSlot.value);
          } else {
            const next = nextAvailableOrderDateTime(preferredDate);
            setPreferredDate(next.date);
            setTimeSlot(next.slot);
          }
        }
      }, [preferredDate, timeSlot, today, initialOrderDateTime.date, initialOrderDateTime.slot]);
      const [vehicleType, setVehicleType] = useState('large');
      const [mixText, setMixText] = useState('');
      const [quantityM3, setQuantityM3] = useState('');
      const [unloadDuration, setUnloadDuration] = useState('30');
      const [traderName, setTraderName] = useState('');
      const [contractorName, setContractorName] = useState('');
      const [siteName, setSiteName] = useState('');
      const [deliveryArea, setDeliveryArea] = useState('');
      const [siteAddressDetail, setSiteAddressDetail] = useState('');
      const [isLocationPending, setIsLocationPending] = useState(false);
      const [spotMapFlowMode, setSpotMapFlowMode] = useState('later'); // later | create
      const [townList, setTownList] = useState([]);
      const [townOptionsLoading, setTownOptionsLoading] = useState(false);
      const [townOptionsError, setTownOptionsError] = useState('');
      const [representativeLat, setRepresentativeLat] = useState('');
      const [representativeLng, setRepresentativeLng] = useState('');
      const [sitePhone, setSitePhone] = useState('');
      const [orderedBy, setOrderedBy] = useState('');
      const [hasTest, setHasTest] = useState(false);
      const [submitNotice, setSubmitNotice] = useState(null);
      const [submitError, setSubmitError] = useState('');
      const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
      const [isLoggedIn, setIsLoggedIn] = useState(() => {
        try {
          return Boolean(sessionStorage.getItem(DISPATCH_AUTH_SESSION_KEY)) && hasCustomerPanelSession();
        } catch {
          return false;
        }
      });
      const [loginPhone, setLoginPhone] = useState('');
      const [loginPassword, setLoginPassword] = useState('');
      const [loginError, setLoginError] = useState('');
      const [loginLoading, setLoginLoading] = useState(false);
      const [adminSettings, setAdminSettings] = useState({ admin_name: '', phone_number: '' });
      const [dashboardOrders, setDashboardOrders] = useState([]);
      const [chatThreads, setChatThreads] = useState({});
      const [readChatKeys, setReadChatKeys] = useState({});
      const [unreadChatsByOrder, setUnreadChatsByOrder] = useState({});
      const [activeChatOrderId, setActiveChatOrderId] = useState('');
      const [adminNotice, setAdminNotice] = useState('');
      const [customerOrderTab, setCustomerOrderTab] = useState('active');
      const [newOrderMode, setNewOrderMode] = useState('');
      const [customerCalendarSelectedDate, setCustomerCalendarSelectedDate] = useState(today);
      const [customerCalendarMonth, setCustomerCalendarMonth] = useState(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
      });
      const [expandedHistoryOrderId, setExpandedHistoryOrderId] = useState('');
      const [repeatPreferredDate, setRepeatPreferredDate] = useState(initialOrderDateTime.date);
      const [repeatTimeSlot, setRepeatTimeSlot] = useState(() => {
        return initialOrderDateTime.slot;
      });
      const [inProgressSearchQuery, setInProgressSearchQuery] = useState('');
      const [historyStatusFilter, setHistoryStatusFilter] = useState('all');
      const [historyCustomerFilter, setHistoryCustomerFilter] = useState('all');
      const [factories, setFactories] = useState([]);
      const [projects, setProjects] = useState([]);
      const [customers, setCustomers] = useState([]);
      const [currentCustomerId, setCurrentCustomerId] = useState(() => {
        try {
          return sessionStorage.getItem(DISPATCH_AUTH_SESSION_KEY) || sessionStorage.getItem(DISPATCH_CUSTOMER_SESSION_KEY) || '';
        } catch {
          return '';
        }
      });
      const [orderKind, setOrderKind] = useState('spot');
      const [selectedProjectId, setSelectedProjectId] = useState('');
      const [customerSearchText, setCustomerSearchText] = useState('');
      const [projectSearchText, setProjectSearchText] = useState('');
      const [deliveryLat, setDeliveryLat] = useState('');
      const [deliveryLng, setDeliveryLng] = useState('');
      const [preferredFactoryId, setPreferredFactoryId] = useState('');
      const [siteOrderLinkNotice, setSiteOrderLinkNotice] = useState('');
      const [guestOrderToken] = useState(() => parseSiteOrderTokenFromPath());
      const isGuestSiteOrder = Boolean(guestOrderToken);
      const [guestSiteOrderCtx, setGuestSiteOrderCtx] = useState(null);
      const [guestSiteOrderLoading, setGuestSiteOrderLoading] = useState(isGuestSiteOrder);
      const [guestSiteOrderError, setGuestSiteOrderError] = useState('');
      const [guestSiteOrderErrorDetail, setGuestSiteOrderErrorDetail] = useState('');
      const orderFormRef = useRef(null);
      const lastAutofillProjectIdRef = useRef('');
      const guestInitCompletedTokenRef = useRef('');

      const orderFormFieldPrefix = useMemo(() => {
        if (isGuestSiteOrder) return 'guest-order';
        return orderKind === 'spot' ? 'spot-order' : 'project-order';
      }, [isGuestSiteOrder, orderKind]);

      const orderFieldId = useCallback(
        (name) => `${orderFormFieldPrefix}-${name}`,
        [orderFormFieldPrefix],
      );

      const orderFormNamePrefix = useMemo(() => {
        if (isGuestSiteOrder) return 'guest';
        return orderKind === 'spot' ? 'spot' : 'regular';
      }, [isGuestSiteOrder, orderKind]);

      const orderFieldName = useCallback(
        (name) => `${orderFormNamePrefix}_${name}`,
        [orderFormNamePrefix],
      );

      const selectedProject = useMemo(
        () => (projects || []).find((p) => p && String(p.id) === String(selectedProjectId)) || null,
        [projects, selectedProjectId],
      );
      const allowedDeliveryAreas = useMemo(
        () => normalizeAllowedDeliveryAreas(adminSettings?.allowed_delivery_areas),
        [adminSettings],
      );
      const siteAddress = useMemo(
        () => combineDeliveryAddress(deliveryArea, siteAddressDetail),
        [deliveryArea, siteAddressDetail],
      );
      const guestLockedFields = useMemo(() => {
        if (!isGuestSiteOrder || !guestSiteOrderCtx) return null;
        return resolveGuestOrderLockedFields(guestSiteOrderCtx, allowedDeliveryAreas);
      }, [isGuestSiteOrder, guestSiteOrderCtx, allowedDeliveryAreas]);

      /** 物件選択時: 住所・関連フィールドをオートフィル（未選択時はクリア） */
      const applyProjectSelection = useCallback(
        (project) => {
          if (!project) {
            setDeliveryArea('');
            setSiteAddressDetail('');
            setPreferredFactoryId('');
            lastAutofillProjectIdRef.current = '';
            return;
          }
          const { deliveryArea: area, siteAddressDetail: detail } = extractProjectAddressFields(
            project,
            allowedDeliveryAreas,
          );
          setDeliveryArea(area);
          setSiteAddressDetail(detail);
          if (project.trading_company_name || project.trading_company) {
            setTraderName(String(project.trading_company_name || project.trading_company));
          }
          const subName = String(project.sub_contractor_name || project.contractor || '').trim();
          if (subName) setContractorName(subName);
          if (project.name) setSiteName(sanitizeSiteNameValue(project.name));
          if (project.main_factory_id) setPreferredFactoryId(String(project.main_factory_id));
          lastAutofillProjectIdRef.current = String(project.id || '');
        },
        [allowedDeliveryAreas],
      );

      /** 市町村選択に応じて HeartRails から町名候補（代表地点付き）を取得 */
      useEffect(() => {
        const municipality = String(deliveryArea || '').trim();
        if (!municipality) {
          setTownList([]);
          setTownOptionsLoading(false);
          setTownOptionsError('');
          setRepresentativeLat('');
          setRepresentativeLng('');
          return undefined;
        }

        let cancelled = false;
        setTownOptionsLoading(true);
        setTownOptionsError('');

        fetchTownLocationsForMunicipality(municipality, resolveDeliveryPrefecture(adminSettings))
          .then((rows) => {
            if (cancelled) return;
            setTownList(Array.isArray(rows) ? rows : []);
            if (!rows?.length) {
              setTownOptionsError('この市町村の町名候補は取得できませんでした');
            }
          })
          .catch((err) => {
            if (cancelled) return;
            setTownList([]);
            setTownOptionsError(err?.message || '町名リストの取得に失敗しました');
            console.warn('[DispatchApp] 町名サジェスト取得失敗', err);
          })
          .finally(() => {
            if (!cancelled) setTownOptionsLoading(false);
          });

        return () => {
          cancelled = true;
        };
      }, [deliveryArea, adminSettings]);

      /** 町名入力が HeartRails 候補と一致したら代表地点座標をセット */
      useEffect(() => {
        const town = String(siteAddressDetail || '').trim();
        if (!town || !townList.length) {
          setRepresentativeLat('');
          setRepresentativeLng('');
          return;
        }
        const hit = findTownLocation(townList, town);
        if (hit?.lat != null && hit?.lng != null) {
          setRepresentativeLat(String(hit.lat));
          setRepresentativeLng(String(hit.lng));
        } else {
          setRepresentativeLat('');
          setRepresentativeLng('');
        }
      }, [siteAddressDetail, townList]);

      const townSuggestionNames = useMemo(() => {
        return (Array.isArray(townList) ? townList : []).map((row) => ({
          town: row?.town ?? '',
          town_kana: row?.town_kana ?? row?.kana ?? '',
        }));
      }, [townList]);

      const currentCustomer = useMemo(
        () => (customers || []).find((c) => c && c.id === currentCustomerId) || null,
        [customers, currentCustomerId],
      );
      const sessionCustomerPhone = useMemo(() => {
        if (!isLoggedIn) return '';
        try {
          return String(sessionStorage.getItem(CUSTOMER_PANEL_PHONE_KEY) || '').trim();
        } catch {
          return '';
        }
      }, [isLoggedIn]);
      const currentCustomerPhone = String(currentCustomer?.phone_number || sessionCustomerPhone || '').trim();
      const currentCustomerDisplayName = String(currentCustomer?.company_name || currentCustomer?.name || '').trim() || 'カスタマー';
      const isOrderForCurrentCustomer = useCallback(
        (order) => {
          if (!order) return false;
          const cid = String(currentCustomerId || '').trim();
          if (cid && String(order.customer_id || order.customerId || '').trim() === cid) return true;
          const phoneDigits = currentCustomerPhone.replace(/\D/g, '');
          if (!phoneDigits) return false;
          const orderPhoneDigits = String(order.phone_number ?? order.customerPhone ?? order.sitePhone ?? order.phone ?? '').replace(/\D/g, '');
          return Boolean(orderPhoneDigits && orderPhoneDigits === phoneDigits);
        },
        [currentCustomerId, currentCustomerPhone],
      );
      const isRelevantDashboardOrder = useCallback(
        (order) => {
          if (isGuestSiteOrder && guestSiteOrderCtx) return isOrderForGuestSite(order, guestSiteOrderCtx);
          return isOrderForCurrentCustomer(order);
        },
        [isGuestSiteOrder, guestSiteOrderCtx, isOrderForCurrentCustomer],
      );
      const filteredProjects = useMemo(
        () => (projects || []).filter((p) => p && String(p.customer_id || '') === String(currentCustomerId || '')),
        [projects, currentCustomerId],
      );
      const hasCurrentCustomer = Boolean(String(currentCustomerId || '').trim());

      useEffect(() => {
        setCustomerSearchText(currentCustomerDisplayName);
      }, [currentCustomerDisplayName, currentCustomerId]);

      useEffect(() => {
        setProjectSearchText(selectedProject?.name ? String(selectedProject.name) : '');
      }, [selectedProject, selectedProjectId]);
      const selectCustomerTab = useCallback((tabId) => {
        setCustomerOrderTab(tabId);
        if (tabId === 'new') setNewOrderMode('');
      }, []);

      const prevOrdersRef = useRef(null);
      const prevChatThreadsRef = useRef(null);
      const readChatKeysRef = useRef(readChatKeys);
      readChatKeysRef.current = readChatKeys;
      const activeChatOrderIdRef = useRef(activeChatOrderId);
      activeChatOrderIdRef.current = activeChatOrderId;
      const refreshDashboardRef = useRef(() => Promise.resolve());
      const isRelevantDashboardOrderRef = useRef(() => true);
      const dashboardNoticeTimerRef = useRef(null);

      const showDashboardNotice = useCallback((message, { playSound = false } = {}) => {
        if (!message) return;
        setAdminNotice(message);
        if (playSound) {
          startNotificationAlarm();
        }
        if (dashboardNoticeTimerRef.current != null) {
          window.clearTimeout(dashboardNoticeTimerRef.current);
        }
        dashboardNoticeTimerRef.current = window.setTimeout(() => {
          setAdminNotice('');
          if (playSound) stopNotificationAlarm();
          dashboardNoticeTimerRef.current = null;
        }, 6000);
      }, []);

      const refreshDashboard = useCallback(
        async (options, realtimePayload) => {
          const playSound = Boolean(options?.playSound);
          try {
            const factoryNameById = Object.fromEntries(
              (Array.isArray(factories) ? factories : []).map((f) => [f.id, f.name]),
            );
            let fetched = await db.fetchOrdersWithChat();
            let newOrders = Array.isArray(fetched?.orders) ? fetched.orders : [];
            let newThreads = fetched?.chatThreads && typeof fetched.chatThreads === 'object' ? fetched.chatThreads : {};
            const idSet = new Set(
              newOrders
                .map((o) => (o && o.factory_site_id ? String(o.factory_site_id).trim() : ''))
                .filter(Boolean),
            );
            for (const o of newOrders || []) {
              const pf = o?.preferred_factory_id ?? o?.preferredFactoryId;
              if (pf) idSet.add(String(pf).trim());
            }
            if (preferredFactoryId) idSet.add(String(preferredFactoryId));
            if (idSet.size === 0) idSet.add(DISPATCH_DEFAULT_FACTORY_SITE_ID);
            const schedulesByFactoryId = await db.fetchSchedulesForFactories([...idSet]);
            await db.persistScheduleAutoRejections({
              schedulesByFactoryId,
              orders: newOrders,
              chatThreads: newThreads,
              factoryNameById,
              defaultFactorySiteName: DISPATCH_DEFAULT_FACTORY_SITE_NAME,
              defaultFactorySiteId: DISPATCH_DEFAULT_FACTORY_SITE_ID,
            });
            const final = await db.fetchOrdersWithChat();
            newOrders = (Array.isArray(final?.orders) ? final.orders : []).filter(
              (o) => o && o.status !== 'deleted',
            );
            const displayOrders =
              isGuestSiteOrder || String(currentCustomerId || '').trim()
                ? newOrders.filter((o) => o && isRelevantDashboardOrder(o))
                : newOrders;
            newThreads =
              final?.chatThreads && typeof final.chatThreads === 'object' ? final.chatThreads : {};

            const prevOrders = prevOrdersRef.current;
            if (prevOrders) {
              const prevOrderMapForAdmin = new Map(
                (Array.isArray(prevOrders) ? prevOrders : []).filter(Boolean).map((o) => [o.id, o]),
              );
              if (displayOrders.some((o) => o?.is_admin_modified && !prevOrderMapForAdmin.get(o.id)?.is_admin_modified)) {
                showDashboardNotice('⚠️ 管理者によって注文内容が変更されました。内容を確認してください。', { playSound });
              } else {
                const detected = detectCustomerOrderNotifications(prevOrders, displayOrders, isRelevantDashboardOrder);
                if (!Array.isArray(detected.acceptedSiteLabels)) detected.acceptedSiteLabels = [];
                if (realtimePayload) {
                  const fromPayload = analyzeCustomerOrderRealtimePayload(
                    realtimePayload,
                    isRelevantDashboardOrder,
                    db.normalizeOrderRow,
                  );
                  if (fromPayload.factoryAccepted) detected.factoryAccepted = true;
                  if (fromPayload.factoryReassigned) detected.factoryReassigned = true;
                  if (Array.isArray(fromPayload.acceptedSiteLabels)) {
                    detected.acceptedSiteLabels.push(...fromPayload.acceptedSiteLabels.filter(Boolean));
                  }
                }
                if (detected.factoryAccepted) {
                  const sites = Array.isArray(detected.acceptedSiteLabels)
                    ? detected.acceptedSiteLabels.filter(Boolean)
                    : [];
                  const siteMsg =
                    sites.length > 0
                      ? `現場「${sites[0]}」の配車が決定しました${sites.length > 1 ? `（他${sites.length - 1}件）` : ''}`
                      : '注文が工場に受注されました';
                  showDashboardNotice(siteMsg, { playSound: false });
                  playOrderConfirmedSound();
                } else if (detected.factoryReassigned) {
                  showDashboardNotice('手配先工場が変更・調整されました', { playSound });
                }
              }
            }

            const prevThreads = prevChatThreadsRef.current;
            if (prevThreads && !realtimePayload) {
              const chatDetected = detectCustomerChatNotifications(
                prevThreads,
                newThreads,
                displayOrders.map((o) => o?.id).filter(Boolean),
                readChatKeysRef.current,
              );
              if (chatDetected.notifyOrderIds.length > 0) {
                const viewingId = String(activeChatOrderIdRef.current || '');
                const audibleIds = chatDetected.notifyOrderIds.filter((id) => String(id) !== viewingId);
                if (audibleIds.length > 0) {
                  playChatNotificationSound();
                }
              }
            }

            const unreadMap = {};
            for (const order of displayOrders) {
              if (!order?.id || !isOrderInProgressView(order, today)) continue;
              if (isUnreadForDispatch(newThreads[order.id], readChatKeysRef.current[order.id])) {
                unreadMap[order.id] = true;
              }
            }
            setUnreadChatsByOrder(unreadMap);

            prevOrdersRef.current = displayOrders;
            prevChatThreadsRef.current = newThreads;
            setDashboardOrders(Array.isArray(displayOrders) ? displayOrders : []);
            setChatThreads(newThreads);
          } catch (loadErr) {
            logDispatchError('[DispatchApp] ダッシュボード注文の取得・更新に失敗', loadErr);
            window.alert(formatSupabaseError(loadErr, '注文一覧の更新に失敗しました'));
          }
        },
        [factories, preferredFactoryId, currentCustomerId, isGuestSiteOrder, isRelevantDashboardOrder, showDashboardNotice],
      );

      useEffect(() => {
        refreshDashboardRef.current = refreshDashboard;
        isRelevantDashboardOrderRef.current = isRelevantDashboardOrder;
      }, [refreshDashboard, isRelevantDashboardOrder]);

      useEffect(() => {
        if (isGuestSiteOrder) return undefined;
        let cancelled = false;
        (async () => {
          try {
            if (!isLoggedIn || !hasCustomerPanelSession()) {
              const adminSettingRows = await db.fetchDispatchOperationalSettings();
              if (cancelled) return;
              setAdminSettings(adminSettingRows || { admin_name: '', phone_number: '' });
              return;
            }
            const [rows, projs, customerRows, adminSettingRows] = await Promise.all([
              db.fetchFactories(),
              db.fetchProjects(),
              db.fetchCustomers(),
              db.fetchDispatchOperationalSettings(),
            ]);
            if (cancelled) return;
            setFactories(rows);
            setProjects(projs);
            setCustomers(customerRows);
            setAdminSettings(adminSettingRows || { admin_name: '', phone_number: '' });
            setCurrentCustomerId((cur) => {
              if (cur && customerRows.some((c) => c && c.id === cur)) return cur;
              return '';
            });
            if (isLoggedIn) {
              const authId = (() => {
                try {
                  return sessionStorage.getItem(DISPATCH_AUTH_SESSION_KEY) || '';
                } catch {
                  return '';
                }
              })();
              if (!authId || !hasCustomerPanelSession() || !customerRows.some((c) => c && c.id === authId)) {
                setIsLoggedIn(false);
                setCurrentCustomerId('');
                clearCustomerPanelSession();
                try {
                  sessionStorage.removeItem(DISPATCH_AUTH_SESSION_KEY);
                  sessionStorage.removeItem(DISPATCH_CUSTOMER_SESSION_KEY);
                } catch {
                  /* ignore */
                }
              }
            }
            setPreferredFactoryId((cur) => {
              if (cur && rows.some((r) => r && r.id === cur)) return cur;
              return '';
            });
          } catch (e) {
            console.error('物件取得エラー', e);
            window.alert(formatSupabaseError(e, '物件一覧の取得に失敗しました'));
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [isGuestSiteOrder, isLoggedIn]);

      useEffect(() => {
        try {
          sessionStorage.setItem(DISPATCH_CUSTOMER_SESSION_KEY, currentCustomerId || '');
        } catch {
          /* ignore */
        }
        setSelectedProjectId((cur) => {
          if (!cur) return cur;
          const p = (projects || []).find((x) => x && x.id === cur);
          const valid = p && String(p.customer_id || '') === String(currentCustomerId || '');
          if (!valid) {
            lastAutofillProjectIdRef.current = '';
          }
          return valid ? cur : '';
        });
      }, [currentCustomerId, projects]);

      useEffect(() => {
        const params = new URLSearchParams(window.location.search || '');
        const action = params.get('action');
        const orderId = params.get('orderId');
        if (action === 'chat' && orderId) {
          try {
            sessionStorage.setItem(PUSH_CHAT_REDIRECT_SESSION_KEY, orderId);
          } catch {
            /* ignore */
          }
          const cleanUrl = `${window.location.pathname}${window.location.hash || ''}`;
          window.history.replaceState({}, '', cleanUrl);
        }
        void setupNotificationClickRedirect();
        clearAppBadge();
      }, []);

      useEffect(() => {
        if (!isGuestSiteOrder || !guestOrderToken) return undefined;
        // 二重実行防止は「そのトークンで初期化完了済み」の場合のみ
        if (guestInitCompletedTokenRef.current === guestOrderToken && guestSiteOrderCtx) return undefined;
        let cancelled = false;
        (async () => {
          // フェッチ開始直前で Loading を立てる
          setGuestSiteOrderLoading(true);
          setGuestSiteOrderError('');
          setGuestSiteOrderErrorDetail('');
          try {
            const [ctx, settings, factoryRows] = await Promise.all([
              db.fetchSiteOrderContextByUrlToken(guestOrderToken),
              db.fetchDispatchOperationalSettings(),
              db.fetchGuestFactoriesForToken(guestOrderToken),
            ]);
            if (cancelled) return;

            if (!ctx) {
              setGuestSiteOrderError('専用発注URLが無効です。リンクを確認してください。');
              setGuestSiteOrderErrorDetail('サーバーからコンテキストを取得できませんでした（応答が空です）。');
              return;
            }

            try {
              const hasCustomer = Boolean(ctx?.customer?.id);
              const hasProject = Boolean(ctx?.project?.id);
              const projectList = Array.isArray(ctx?.projects) && ctx.projects.length > 0 ? ctx.projects : [];
              const hasProjectsList = projectList.length > 0;
              if (!hasCustomer && !hasProject && !hasProjectsList) {
                setGuestSiteOrderError('専用発注データが不完全です。');
                setGuestSiteOrderErrorDetail('業者または物件の情報が応答に含まれていません。');
                return;
              }

              setGuestSiteOrderCtx(ctx);
              const nextSettings =
                settings && typeof settings === 'object' ? settings : { admin_name: '', phone_number: '' };
              setAdminSettings(nextSettings);
              setFactories(Array.isArray(factoryRows) ? factoryRows : []);

              const customer = ctx.customer || null;
              const mergedProjectList =
                projectList.length > 0 ? projectList : ctx.project ? [ctx.project] : [];
              if (customer?.id) {
                setCurrentCustomerId(String(customer.id));
                setCustomers([customer]);
              }
              setProjects(mergedProjectList);

              const primaryProject = ctx.project || (mergedProjectList.length === 1 ? mergedProjectList[0] : null);
              setOrderKind('project');
              setNewOrderMode('form');
              setCustomerOrderTab('new');
              const allowedAreas = normalizeAllowedDeliveryAreas(nextSettings?.allowed_delivery_areas);
              if (primaryProject?.id) {
                setSelectedProjectId(String(primaryProject.id));
                // ゲスト初期化は adminSettings → allowedDeliveryAreas → applyProjectSelection の依存ループを避け、
                // 取得した settings を元にここで直接フォームへ反映する（token 以外の依存を持たせない）。
                const locked = resolveGuestOrderLockedFields(
                  { project: primaryProject, customer },
                  allowedAreas,
                );
                setDeliveryArea(locked.deliveryArea);
                setSiteAddressDetail(locked.siteAddressDetail);
                setTraderName(locked.traderNameRaw);
                setContractorName(locked.contractorName);
                if (locked.projectName) setSiteName(sanitizeSiteNameValue(locked.projectName));
                setPreferredFactoryId(String(primaryProject.main_factory_id || '').trim());
                if (customer?.phone_number) setSitePhone(String(customer.phone_number));
              } else {
                setSelectedProjectId('');
                setDeliveryArea('');
                setSiteAddressDetail('');
                setPreferredFactoryId('');
              }
              const lockedNotice = primaryProject
                ? resolveGuestOrderLockedFields({ project: primaryProject, customer }, allowedAreas)
                : null;
              const label = lockedNotice?.projectName || customer?.company_name || customer?.name || '';
              setSiteOrderLinkNotice(
                label ? `「${label}」の物件専用発注フォームです。` : '物件専用発注フォームです。',
              );
              // ここまで来たら「初期化完了」とみなす
              guestInitCompletedTokenRef.current = guestOrderToken;
              setGuestSiteOrderSession(guestOrderToken);
              await ensurePanelRealtimeAuth();
              primeNotificationAlarm();
            } catch (procErr) {
              console.error('専用発注フォームの初期化に失敗しました', procErr);
              if (!cancelled) {
                setGuestSiteOrderCtx(null);
                setGuestSiteOrderError('専用発注フォームの初期化に失敗しました。');
                setGuestSiteOrderErrorDetail(String(procErr?.message ?? procErr ?? '不明なエラー'));
              }
            }
          } catch (e) {
            console.error('専用発注URLの解決に失敗しました', e);
            if (!cancelled) {
              setGuestSiteOrderCtx(null);
              setGuestSiteOrderError(formatSupabaseError(e, '専用発注URLの読み込みに失敗しました。'));
              setGuestSiteOrderErrorDetail(String(e?.message ?? e ?? '不明なエラー'));
            }
          } finally {
            setGuestSiteOrderLoading(false);
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [isGuestSiteOrder, guestOrderToken, guestSiteOrderCtx]);

      useEffect(() => {
        if (isGuestSiteOrder || !isLoggedIn) return;
        let pending = null;
        try {
          const raw = sessionStorage.getItem(SITE_ORDER_PENDING_SESSION_KEY);
          if (raw) pending = JSON.parse(raw);
        } catch {
          pending = null;
        }
        if (!pending || typeof pending !== 'object') return;
        const cid = String(pending.customerId || '').trim();
        const pid = String(pending.projectId || '').trim();
        if (cid && (customers || []).some((c) => c && String(c.id) === cid)) {
          setCurrentCustomerId(cid);
        }
        if (pid && (projects || []).some((p) => p && String(p.id) === pid)) {
          setOrderKind('project');
          setSelectedProjectId(pid);
          const p = (projects || []).find((x) => x && String(x.id) === pid);
          if (p) applyProjectSelection(p);
        }
        try {
          sessionStorage.removeItem(SITE_ORDER_PENDING_SESSION_KEY);
        } catch {
          /* ignore */
        }
        if (pending.label) {
          setSiteOrderLinkNotice(`「${pending.label}」を選択しました。`);
        }
      }, [isGuestSiteOrder, isLoggedIn, customers, projects, applyProjectSelection]);

      useEffect(() => {
        if (orderKind !== 'project' || !selectedProjectId) return;
        if (lastAutofillProjectIdRef.current === selectedProjectId) return;
        const p = (projects || []).find((x) => x && String(x.id) === String(selectedProjectId));
        if (!p) return;
        if (String(p.customer_id || '') !== String(currentCustomerId || '')) return;
        applyProjectSelection(p);
      }, [orderKind, selectedProjectId, projects, currentCustomerId, applyProjectSelection]);

      useEffect(() => {
        if (orderKind !== 'project' || selectedProjectId) return;
        if (lastAutofillProjectIdRef.current) applyProjectSelection(null);
      }, [orderKind, selectedProjectId, applyProjectSelection]);

      useEffect(() => {
        let cancelled = false;
        (async () => {
          if (isGuestSiteOrder) {
            const guestCustomerId = String(guestSiteOrderCtx?.customer?.id ?? currentCustomerId ?? '').trim();
            if (!guestCustomerId || cancelled) return;
            await registerOneSignalUser(String(guestCustomerId), {
              role: 'customer',
              customer_id: String(guestCustomerId),
            });
            return;
          }
          if (!isLoggedIn || !currentCustomerId || cancelled) return;
          await registerOneSignalUser(String(currentCustomerId), {
            role: 'customer',
            customer_id: String(currentCustomerId),
          });
        })();
        return () => {
          cancelled = true;
        };
      }, [
        isGuestSiteOrder,
        isLoggedIn,
        currentCustomerId,
        guestSiteOrderCtx,
      ]);

      useEffect(() => {
        if (!isLoggedIn || activeChatOrderId) return;
        let redirectOrderId = '';
        try {
          redirectOrderId = String(sessionStorage.getItem(PUSH_CHAT_REDIRECT_SESSION_KEY) || '').trim();
        } catch {
          redirectOrderId = '';
        }
        if (!redirectOrderId) return;
        const targetOrder = (dashboardOrders || []).find((order) => String(order?.id || '') === redirectOrderId);
        if (!targetOrder) return;
        setCustomerOrderTab('active');
        setActiveChatOrderId(redirectOrderId);
        try {
          sessionStorage.removeItem(PUSH_CHAT_REDIRECT_SESSION_KEY);
        } catch {
          /* ignore */
        }
      }, [activeChatOrderId, dashboardOrders, isLoggedIn]);

      const projectById = useMemo(
        () =>
          Object.fromEntries(
            (projects || []).filter((p) => p?.id).map((p) => [String(p.id), p]),
          ),
        [projects],
      );
      const filteredInProgressOrders = useMemo(
        () =>
          (dashboardOrders || [])
            .filter(
              (o) =>
                o &&
                isOrderInProgressView(o, today) &&
                orderMatchesMasterSearch(o, inProgressSearchQuery),
            )
            .slice(0, 15),
        [dashboardOrders, inProgressSearchQuery, today],
      );
      const activeOrders = useMemo(
        () => (dashboardOrders || []).filter((o) => o && isOrderInProgressView(o, today)),
        [dashboardOrders, today],
      );
      const unreadChatCount = useMemo(
        () =>
          (activeOrders || []).filter((order) =>
            order?.id &&
            (unreadChatsByOrder[order.id] ||
              isUnreadForDispatch(chatThreads[order.id], readChatKeys[order.id])),
          ).length,
        [activeOrders, chatThreads, readChatKeys, unreadChatsByOrder],
      );
      const activeChatOrder = useMemo(
        () => (dashboardOrders || []).find((order) => String(order?.id || '') === String(activeChatOrderId || '')) || null,
        [dashboardOrders, activeChatOrderId],
      );
      useEffect(() => {
        if (activeChatOrderId && !activeChatOrder) setActiveChatOrderId('');
      }, [activeChatOrderId, activeChatOrder]);
      const historyRows = useMemo(() => {
        const sorted = sortOrdersForHistory(
          (dashboardOrders || []).filter((o) => o && isOrderInHistoryView(o, today)),
        );
        return sorted.map((o) => {
          const party = orderPartyInfo(o);
          return {
            id: o.id,
            source: o,
            customer_id: o.customer_id || '',
            project_id: o.project_id || '',
            contractor: party.contractor,
            site: party.site,
            orderedBy: party.orderedBy,
            phone: party.phone,
            dateLabel: `${formatOrderDate(o)} ${o.timePointLabel || o.timeSlotLabel || ''}`.trim(),
            mix: String(o.confirmedMixText ?? o.mixText ?? '').trim(),
            quantityM3: o.confirmedQuantityM3 ?? o.quantityM3 ?? '',
            siteAddress: o.siteAddress ?? '',
            statusMeta: historyStatusMeta(o),
            deliveryDate: getOrderDeliveryDateISO(o),
            createdAt: o.createdAt || '',
          };
        });
      }, [dashboardOrders, today]);
      const filteredHistoryRows = useMemo(
        () =>
          historyRows.filter((row) => {
            if (historyStatusFilter !== 'all' && row.statusMeta.key !== historyStatusFilter) return false;
            if (historyCustomerFilter !== 'all' && String(row.customer_id || '') !== String(historyCustomerFilter)) return false;
            return true;
          }),
        [historyRows, historyStatusFilter, historyCustomerFilter],
      );

      /** チャット・注文の常時 Realtime 購読（チャット画面の開閉と無関係に稼働） */
      useEffect(() => {
        const canSubscribe = isGuestSiteOrder
          ? Boolean(guestSiteOrderCtx && hasGuestSiteOrderSession())
          : Boolean(isLoggedIn && hasCustomerPanelSession());
        if (!canSubscribe) return undefined;

        let disposed = false;
        const handleChatRealtimePayload = (payload) => {
          try {
            const chatHint = analyzeCustomerChatRealtimePayload(
              payload,
              isRelevantDashboardOrderRef.current,
              prevChatThreadsRef.current || {},
              readChatKeysRef.current,
            );
            if (chatHint.shouldPlayChatSound) {
              const viewingId = String(activeChatOrderIdRef.current || '');
              const audible = chatHint.notifyOrderIds.some((id) => String(id) !== viewingId);
              if (audible) playChatNotificationSound();
            }
          } catch (chatErr) {
            logDispatchError('[DispatchApp] チャット Realtime 処理に失敗（続行）', chatErr);
          }
        };
        const realtimeSync = createSplitRealtimeSyncScheduler({
          debounceMs: 500,
          onOrderSync: async (payload) => {
            if (disposed) return;
            await refreshDashboardRef.current({ playSound: true }, payload);
          },
          onChatSync: async () => {
            if (disposed) return;
            await refreshDashboardRef.current({ playSound: false }, null);
          },
        });
        void refreshDashboardRef.current({ playSound: false }).catch((loadErr) => {
          logDispatchError('[DispatchApp] 初回ダッシュボード読み込みに失敗', loadErr);
        });
        const channelKey = isGuestSiteOrder
          ? `dispatch-guest-orders-${String(guestOrderToken || 'guest').replace(/[^a-zA-Z0-9_-]/g, '')}`
          : `dispatch-customer-orders-${String(currentCustomerId || 'customer').replace(/[^a-zA-Z0-9_-]/g, '')}`;
        let channel = null;
        void (async () => {
          try {
            await ensurePanelRealtimeAuth?.();
            if (disposed || !supabase?.channel) return;
            channel = supabase
              .channel(channelKey)
              .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, (payload) => {
                dispatchRealtimePayloadByKind({ ...payload, table: payload?.table || 'orders' }, {
                  onOrder: (p) => realtimeSync.scheduleOrder(p),
                  onChat: (p) => {
                    handleChatRealtimePayload(p);
                    realtimeSync.scheduleChat(p);
                  },
                });
              })
              .subscribe();
          } catch (realtimeErr) {
            logDispatchError('[DispatchApp] orders realtime 購読の開始に失敗', realtimeErr);
          }
        })();
        return () => {
          disposed = true;
          realtimeSync.dispose();
          try {
            if (channel) void supabase?.removeChannel?.(channel);
          } catch {
            /* ignore */
          }
        };
      }, [isGuestSiteOrder, guestSiteOrderCtx, guestOrderToken, isLoggedIn, currentCustomerId]);

      useEffect(() => {
        if (!isLoggedIn || isGuestSiteOrder) return undefined;
        void ensurePanelRealtimeAuth?.().catch((realtimeErr) => {
          logDispatchError('[DispatchApp] Realtime 認証の同期に失敗（続行）', realtimeErr);
        });
        return undefined;
      }, [isLoggedIn, isGuestSiteOrder]);

      useEffect(() => {
        if (!isLoggedIn && !isGuestSiteOrder) return undefined;
        const onGesture = () => {
          primeNotificationAlarm();
          primeChatNotificationSound();
        };
        window.addEventListener('pointerdown', onGesture, { once: true, passive: true });
        return () => window.removeEventListener('pointerdown', onGesture);
      }, [isLoggedIn, isGuestSiteOrder]);

      const refreshChatThreadsOnly = useCallback(async (orderId, mergedMessages) => {
        if (orderId && mergedMessages) {
          setChatThreads((prev) => ({ ...prev, [orderId]: mergedMessages }));
          return;
        }
        try {
          const { chatThreads: threads } = await db.fetchOrdersWithChat();
          if (threads && typeof threads === 'object') {
            setChatThreads(threads);
          }
        } catch (err) {
          logDispatchError('[DispatchApp] チャットスレッド更新に失敗', err);
        }
      }, []);

      const handleSendMasterChat = useCallback(
        async (orderId, text) => {
          try {
            const messages = await appendOrderChatMessage(orderId, 'customer', text);
            await refreshChatThreadsOnly(orderId, messages);
            return true;
          } catch (err) {
            db.logChatSendError(err, { orderId, surface: 'DispatchApp' });
            window.alert(db.formatChatAppendError(err));
            return false;
          }
        },
        [refreshChatThreadsOnly],
      );

      const markChatRead = useCallback((orderId, messages) => {
        const key = chatMessageReadKey(latestChatMessage(messages));
        if (!orderId || !key) return;
        clearAppBadge();
        setReadChatKeys((prev) => (prev?.[orderId] === key ? prev : { ...prev, [orderId]: key }));
        setUnreadChatsByOrder((prev) => {
          if (!prev[orderId]) return prev;
          const next = { ...prev };
          delete next[orderId];
          return next;
        });
      }, []);

      const handleAllowStatusReset = useCallback(
        async (orderId) => {
          if (!orderId) return;
          try {
            const { orders: cur, chatThreads: threads } = await db.fetchOrdersWithChat();
            const next = cur.map((o) =>
              o.id !== orderId
                ? o
                : {
                    ...o,
                    factoryResponseLocked: false,
                    factoryUnlockRequested: false,
                    factoryResponseStatus: undefined,
                    factoryPendingStartedAt: undefined,
                    factoryPendingByName: undefined,
                    factoryRejectSource: undefined,
                    scheduleAutoChecked: false,
                    acceptedFactoryLabel: undefined,
                    confirmedQuantityM3: undefined,
                    confirmedMixText: undefined,
                  },
            );
            await db.upsertOrdersBatch(next, threads);
            await appendOrderChatMessage(
              orderId,
              'system',
              '【マスター】ステータス再設定を許可しました。工場は再度 受注／拒否／保留 を選択できます。',
            );
            await refreshDashboard();
          } catch (err) {
            console.error(err);
            window.alert(formatSupabaseError(err, '更新に失敗しました'));
          }
        },
        [refreshDashboard],
      );

      const handleCustomerLogin = useCallback(
        async (e) => {
          e.preventDefault();
          setLoginError('');
          const phone = loginPhone.trim();
          const password = loginPassword.trim();
          if (!phone || !password) {
            setLoginError('電話番号とパスワードを入力してください。');
            return;
          }
          setLoginLoading(true);
          let customer = null;
          try {
            customer = await db.loginCustomer(phone, password);
          } catch (authErr) {
            logDispatchError('カスタマーログイン認証エラー', authErr, { phone });
            setLoginError('電話番号またはパスワードが間違っています。');
            setLoginLoading(false);
            return;
          }

          if (!customer?.id) {
            setLoginError('電話番号またはパスワードが間違っています。');
            setLoginLoading(false);
            return;
          }

          try {
            setCurrentCustomerId(customer.id);
            setCustomers([customer]);
            setIsLoggedIn(true);
            setCustomerPanelSession(phone, password);
            setLoginPhone('');
            setLoginPassword('');
            setLoginError('');
            try {
              sessionStorage.setItem(DISPATCH_AUTH_SESSION_KEY, customer.id);
              sessionStorage.setItem(DISPATCH_CUSTOMER_SESSION_KEY, customer.id);
            } catch {
              /* ignore */
            }

            try {
              await ensurePanelRealtimeAuth?.(customer?.realtime_token);
            } catch (realtimeErr) {
              logDispatchError('[DispatchApp] ログイン後の Realtime 認証に失敗（続行）', realtimeErr, {
                customerId: customer.id,
              });
            }

            try {
              primeNotificationAlarm?.();
            } catch (alarmErr) {
              logDispatchError('[DispatchApp] 通知アラーム初期化に失敗（続行）', alarmErr);
            }

            await registerOneSignalUser(String(customer.id || ''), {
              role: 'customer',
              customer_id: String(customer.id || ''),
            });
          } catch (postLoginErr) {
            logDispatchError('[DispatchApp] ログイン後の画面初期化に失敗', postLoginErr, {
              customerId: customer.id,
            });
            setLoginError('ログイン後のデータ読み込みに失敗しました。再読み込みしてください。');
          } finally {
            setLoginLoading(false);
          }
        },
        [loginPhone, loginPassword],
      );

      const handleCustomerLogout = useCallback(() => {
        void logoutOneSignalUser();
        setIsLoggedIn(false);
        setCurrentCustomerId('');
        setCustomers([]);
        setSelectedProjectId('');
        setPreferredFactoryId('');
        setLoginPassword('');
        setLoginError('');
        clearCustomerPanelSession();
        try {
          sessionStorage.removeItem(DISPATCH_AUTH_SESSION_KEY);
          sessionStorage.removeItem(DISPATCH_CUSTOMER_SESSION_KEY);
        } catch {
          /* ignore */
        }
      }, []);

      const applyHistoryOrderToNewForm = useCallback(
        (row) => {
          if (!row?.id) {
            setSubmitError('再発注対象の注文が見つかりません。');
            return;
          }
          const defaults = extractOrderFormDefaultsFromHistory(row);
          const next = nextAvailableOrderDateTime(today);
          setOrderKind(defaults.isSpot ? 'spot' : 'project');
          setSelectedProjectId(defaults.projectId || '');
          if (defaults.projectId) {
            const proj = (projects || []).find((p) => p && String(p.id) === String(defaults.projectId));
            if (proj) applyProjectSelection(proj);
            else setPreferredFactoryId(defaults.preferredFactoryId || '');
          } else {
            setPreferredFactoryId('');
          }
          setQuantityM3(defaults.quantityM3 || '');
          setMixText(defaults.mixText || '');
          setTraderName(defaults.traderName || '');
          setContractorName(defaults.contractorName || '');
          setSiteName(defaults.siteName || '');
          setDeliveryArea(defaults.deliveryArea || '');
          setSiteAddressDetail(defaults.siteAddressDetail || '');
          setSitePhone(defaults.sitePhone || currentCustomer?.phone_number || '');
          setOrderedBy(defaults.orderedBy || '');
          setVehicleType(defaults.vehicleType || 'large');
          setUnloadDuration(defaults.unloadDuration || '30');
          setHasTest(defaults.hasTest);
          setIsLocationPending(defaults.isLocationPending);
          setDeliveryLat(defaults.deliveryLat != null ? String(defaults.deliveryLat) : '');
          setDeliveryLng(defaults.deliveryLng != null ? String(defaults.deliveryLng) : '');
          setPreferredDate(next.date);
          setTimeSlot(next.slot);
          if (!defaults.preferredFactoryId && defaults.projectId) {
            const proj = (projects || []).find((p) => p && String(p.id) === String(defaults.projectId));
            if (proj?.main_factory_id) setPreferredFactoryId(String(proj.main_factory_id));
          } else if (defaults.preferredFactoryId) {
            setPreferredFactoryId(defaults.preferredFactoryId);
          }
          setSubmitError('');
          setSubmitNotice('履歴の内容を新規発注フォームに反映しました。数量・配合を変更して発注できます。');
          setCustomerOrderTab('new');
          setNewOrderMode('form');
          window.setTimeout(() => setSubmitNotice(null), 4000);
          window.setTimeout(() => {
            orderFormRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
          }, 120);
        },
        [applyProjectSelection, currentCustomer, projects, today],
      );

      const confirmRepeatOrder = useCallback(
        async (row) => {
          const item = row?.source || row || {};
          if (!row?.id) {
            setSubmitError('再発注対象の注文が見つかりません。');
            window.alert('再発注対象の注文が見つかりません。');
            return;
          }
          if (isPastPreferredDateTime(repeatPreferredDate, repeatTimeSlot)) {
            const message = '現在より過去の日時は指定できません。正しい希望日時を入力してください。';
            setSubmitError(message);
            window.alert(message);
            return;
          }
          const defaults = extractOrderFormDefaultsFromHistory(row);
          if (!defaults.quantityM3) {
            const message = '数量（m³）が履歴から取得できません。フォームから再発注してください。';
            setSubmitError(message);
            window.alert(message);
            return;
          }
          if (!defaults.isSpot && !defaults.projectId) {
            const message = '物件情報が履歴から取得できません。フォームから再発注してください。';
            setSubmitError(message);
            window.alert(message);
            return;
          }
          const slotMeta = TIME_SLOTS.find((s) => s.value === repeatTimeSlot);
          const slotLabel = slotMeta?.label ?? '';
          const timeMinutes = parseInt(repeatTimeSlot, 10);
          const prefFid = defaults.preferredFactoryId;
          if (!defaults.isSpot && !prefFid) {
            const message =
              '工場情報が不足しています。物件をサジェストから選び直すか、第一希望工場を指定してください。';
            setSubmitError(message);
            window.alert(message);
            return;
          }
          const repeatOrder = {
            ...item,
            id: undefined,
            createdAt: new Date().toISOString(),
            status: 'pending',
            factoryResponseStatus: undefined,
            factoryResponseLocked: false,
            factoryUnlockRequested: false,
            factoryPendingStartedAt: undefined,
            factoryPendingByName: undefined,
            acceptedFactoryLabel: undefined,
            factorySiteName: '',
            factorySiteId: null,
            factory_site_id: null,
            rejected_factory_ids: [],
            customer_id: currentCustomerId || item.customer_id || row.customer_id || null,
            customerName: currentCustomer?.company_name || currentCustomer?.name || item.customerName || item.customer_name || '',
            phone_number: currentCustomer?.phone_number || item.phone_number || item.customerPhone || '',
            customerPhone: currentCustomer?.phone_number || item.customerPhone || item.phone_number || '',
            is_spot: defaults.isSpot,
            project_id: !defaults.isSpot ? defaults.projectId || null : null,
            projectName: item.projectName || item.project_name || row.site || '',
            preferred_factory_id: prefFid || null,
            preferredFactoryId: prefFid || null,
            preferredDate: repeatPreferredDate,
            timeSlot: repeatTimeSlot,
            timeSlotMinutes: Number.isFinite(timeMinutes) ? timeMinutes : null,
            timeSlotLabel: slotLabel,
            timePointLabel: slotLabel,
            scheduleMatchDate: repeatPreferredDate,
            scheduleMatchMinutes: Number.isFinite(timeMinutes) ? timeMinutes : null,
            vehicleType: defaults.vehicleType,
            vehicleLabel: defaults.vehicleType === 'small' ? '小型' : '大型',
            quantityM3: defaults.quantityM3,
            confirmedQuantityM3: undefined,
            unloadDuration: defaults.unloadDuration,
            unloadDurationMinutes: defaults.unloadDuration,
            mixText: defaults.mixText,
            confirmedMixText: undefined,
            traderName: defaults.traderName,
            trading_company_name: defaults.traderName,
            projectTradingCompanyName: defaults.traderName,
            contractorName: defaults.contractorName,
            siteName: defaults.siteName,
            siteAddress: defaults.siteAddress || item.siteAddress || row.siteAddress || '',
            sitePhone: defaults.sitePhone || currentCustomer?.phone_number || '',
            ordered_by: defaults.orderedBy,
            orderedBy: defaults.orderedBy,
            has_test: defaults.hasTest,
            delivery_lat: defaults.isSpot ? item.delivery_lat ?? item.deliveryLat ?? null : null,
            delivery_lng: defaults.isSpot ? item.delivery_lng ?? item.deliveryLng ?? null : null,
          };
          setIsSubmittingOrder(true);
          setSubmitError('');
          try {
            await db.insertOrdersBulk([repeatOrder], { factories, projects });
            await refreshDashboard();
            setCustomerOrderTab('active');
            setExpandedHistoryOrderId('');
            const siteLabel = row.site || defaults.siteName || '現場';
            const message = `「${siteLabel}」の再発注を確定しました。`;
            setSubmitNotice(message);
            window.alert(message);
            window.setTimeout(() => setSubmitNotice(null), 5000);
          } catch (err) {
            console.error('再発注の確定に失敗', err);
            const message = formatSupabaseError(err, '再発注の確定に失敗しました');
            setSubmitError(message);
            window.alert(message);
          } finally {
            setIsSubmittingOrder(false);
          }
        },
        [currentCustomer, currentCustomerId, repeatPreferredDate, repeatTimeSlot, refreshDashboard],
      );

      const orderFormContext = useMemo(
        () => ({
          isGuestSiteOrder,
          orderKind,
          currentCustomerId,
          currentCustomer,
          selectedProject,
          selectedProjectId,
          filteredProjects,
          projects,
          preferredFactoryId,
          factories,
          traderName,
          contractorName,
          siteName,
          siteAddress,
          deliveryArea,
          siteAddressDetail,
          allowedDeliveryAreas,
          sitePhone,
          orderedBy,
          vehicleType,
          unloadDuration,
          hasTest,
          deliveryLat,
          deliveryLng,
          isLocationPending,
          representativeLat,
          representativeLng,
          timeSlot,
          quantityM3,
          mixText,
        }),
        [
          isGuestSiteOrder,
          orderKind,
          currentCustomerId,
          currentCustomer,
          selectedProject,
          selectedProjectId,
          filteredProjects,
          projects,
          preferredFactoryId,
          factories,
          traderName,
          contractorName,
          siteName,
          siteAddress,
          deliveryArea,
          siteAddressDetail,
          allowedDeliveryAreas,
          sitePhone,
          orderedBy,
          vehicleType,
          unloadDuration,
          hasTest,
          deliveryLat,
          deliveryLng,
          isLocationPending,
          representativeLat,
          representativeLng,
          timeSlot,
          quantityM3,
          mixText,
        ],
      );

      const factoriesForPreferredSelection = useMemo(
        () => (Array.isArray(factories) ? factories.filter((f) => f?.id) : []),
        [factories],
      );

      const resetOrderForm = useCallback(() => {
        const next = nextAvailableOrderDateTime(today);
        setPreferredDate(next.date);
        setTimeSlot(next.slot);
        setSelectedProjectId('');
        setPreferredFactoryId('');
        setDeliveryLat('');
        setDeliveryLng('');
        setQuantityM3('');
        setUnloadDuration('30');
        setTraderName('');
        setContractorName('');
        setMixText('');
        setSiteName('');
        setDeliveryArea('');
        setSiteAddressDetail('');
        setIsLocationPending(false);
        setSpotMapFlowMode('later');
        setTownList([]);
        setTownOptionsError('');
        setRepresentativeLat('');
        setRepresentativeLng('');
        lastAutofillProjectIdRef.current = '';
        setSitePhone('');
        setOrderedBy('');
        setHasTest(false);
        setVehicleType('large');
      }, [today]);

      const handleAddToCart = useCallback(
        (e) => {
          e?.preventDefault?.();
          const date = String(preferredDate || '').trim();
          const missing = validateCartLineForm(orderFormContext, date, {
            today,
            isPastPreferredDateTime,
            isGuestSiteOrder,
          });
          if (missing.length) {
            const message = `次の項目を入力してください: ${missing.join('、')}`;
            setSubmitError(message);
            window.alert(message);
            return;
          }
          setSubmitError('');
          const order = buildDispatchOrderForDate(date, orderFormContext);
          const cartId = `cart_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          const addedAt = Date.now();
          setCartItems((prev) => [
            ...prev,
            { cartId, order, addedAt, mapEditorFlowMode: spotMapFlowMode },
          ]);
          setSubmitNotice('リストに追加しました。日付や配合を変えて続けて追加できます。');
          window.setTimeout(() => setSubmitNotice(null), 2500);
        },
        [preferredDate, orderFormContext, today, isGuestSiteOrder, spotMapFlowMode],
      );

      const handleRemoveFromCart = useCallback((cartId) => {
        setCartItems((prev) => prev.filter((item) => item.cartId !== cartId));
      }, []);

      const handleCartBulkConfirm = useCallback(async () => {
        if (isSubmittingOrder) return;
        if (!cartItems.length) {
          const message = '発注リストが空です。日付・配合を入力して「リストに追加」してください。';
          setSubmitError(message);
          window.alert(message);
          return;
        }
        for (const item of cartItems) {
          const order = item?.order;
          if (!order) {
            const message = '発注リストに不正な行があります。削除して再度追加してください。';
            setSubmitError(message);
            window.alert(message);
            return;
          }
          const date = String(order.preferredDate ?? order.scheduleMatchDate ?? '').trim();
          const lineContext = {
            ...orderFormContext,
            orderKind: order.is_spot ? 'spot' : 'project',
            selectedProjectId: String(order.project_id ?? order.projectId ?? '').trim(),
            preferredFactoryId: String(order.preferred_factory_id ?? order.preferredFactoryId ?? '').trim(),
            quantityM3: String(order.quantityM3 ?? '').trim(),
            mixText: String(order.mixText ?? '').trim(),
            timeSlot: String(order.timeSlot ?? '').trim(),
            deliveryArea: String(order.deliveryArea ?? order.delivery_area ?? '').trim(),
            siteAddressDetail: String(order.siteAddressDetail ?? order.site_address_detail ?? '').trim(),
            siteAddress: String(order.siteAddress ?? '').trim(),
            sitePhone: String(order.sitePhone ?? '').trim(),
            contractorName: String(order.contractorName ?? '').trim(),
            isLocationPending: Boolean(order.is_location_pending ?? order.isLocationPending),
          };
          const missing = validateCartLineForm(lineContext, date, {
            today,
            isPastPreferredDateTime,
            isGuestSiteOrder,
          });
          if (missing.length) {
            const message = `発注できません。次の項目を確認してください: ${missing.join('、')}`;
            setSubmitError(message);
            window.alert(message);
            return;
          }
        }
        for (const item of cartItems) {
          const order = item?.order;
          if (!order || order.is_spot) continue;
          const projectId = String(order.project_id || order.projectId || '').trim();
          if (!projectId) continue;
          const factoryId = String(
            order.preferred_factory_id ?? order.preferredFactoryId ?? order.main_factory_id ?? order.mainFactoryId ?? '',
          ).trim();
          if (!factoryId) {
            const message =
              '工場情報が不足している注文があります。物件をサジェストから選び直すか、第一希望工場を指定してください。';
            setSubmitError(message);
            window.alert(message);
            return;
          }
        }
        setIsSubmittingOrder(true);
        setSubmitError('');
        try {
          const isSpot = orderKind === 'spot';
          const totalVol = sumOrderVolumesM3(cartItems.map((item) => item.order));
          const bulkStatus = resolveInitialOrderStatus({
            isSpot,
            totalVolumeM3: totalVol,
            spotThresholdVolume: adminSettings?.spot_threshold_volume,
          });
          const orders = cartItems.map((item) => ({
            ...item.order,
            status: bulkStatus,
          }));
          const count = orders.length;
          const mapCreateCount = cartItems.filter((it) => it?.mapEditorFlowMode === 'create').length;
          if (isGuestSiteOrder && guestOrderToken) {
            const insertedGuestOrders = await db.submitGuestOrders(guestOrderToken, orders, {
              factories,
              projects,
            });
            if (mapCreateCount > 0 && Array.isArray(insertedGuestOrders) && insertedGuestOrders.length) {
              try {
                rememberMapEditorReturnUrl();
              } catch {
                /* ignore */
              }
              for (let i = 0; i < insertedGuestOrders.length; i++) {
                const cartItem = cartItems[i];
                if (cartItem?.mapEditorFlowMode !== 'create') continue;
                const id = insertedGuestOrders[i]?.id;
                const url = buildMapEditorUrl(id, undefined, { guestToken: guestOrderToken });
                if (!url) continue;
                window.open(url, '_blank', 'noopener,noreferrer');
              }
            }
          } else {
            const insertedOrders = await db.insertOrdersBulk(orders, { factories, projects });
            if (mapCreateCount > 0 && Array.isArray(insertedOrders) && insertedOrders.length) {
              // popup blocker を避けるため refresh より先に開く
              try {
                rememberMapEditorReturnUrl();
              } catch {
                /* ignore */
              }
              for (let i = 0; i < insertedOrders.length; i++) {
                const cartItem = cartItems[i];
                if (cartItem?.mapEditorFlowMode !== 'create') continue;
                const id = insertedOrders[i]?.id;
                const url = buildMapEditorUrl(id);
                if (!url) continue;
                window.open(url, '_blank', 'noopener,noreferrer');
              }
            }
            await refreshDashboard();
            setCustomerOrderTab(count > 1 ? 'calendar' : 'active');
            setExpandedHistoryOrderId('');
          }
          setCartItems([]);
          resetOrderForm();
          const hasMapPending = orders.some((o) => isLocationPendingOrder(o));
          const message =
            bulkStatus === 'pending_association'
              ? `${count}件を登録しました（スポット数量が上限を超えるため、組合承認後に工場へ配車されます）`
              : `${count}件の注文を確定しました`;
          const mapHint = hasMapPending
            ? !isGuestSiteOrder && mapCreateCount > 0
              ? '\n\n地図作成フローの注文があります。開いた地図エディタでスタンプを配置して保存してください（未開封の注文は「進行中」タブから開けます）。'
              : '\n\n⚠️ 地図待ちの注文があります。「進行中」タブの「現場地図URL」から図面を送付してください。'
            : '';
          setSubmitNotice(message + mapHint);
          window.alert(message + mapHint);
          window.setTimeout(() => setSubmitNotice(null), 6000);
        } catch (err) {
          console.error('カート一括登録に失敗しました', err);
          const message = formatSupabaseError(err, '一括登録に失敗しました');
          setSubmitError(message);
          window.alert(message);
        } finally {
          setIsSubmittingOrder(false);
        }
      }, [
        cartItems,
        isSubmittingOrder,
        refreshDashboard,
        currentCustomer,
        resetOrderForm,
        orderKind,
        orderFormContext,
        today,
        isGuestSiteOrder,
        guestOrderToken,
        adminSettings,
        factories,
        projects,
      ]);

      const btnBase =
        'min-h-[52px] flex-1 rounded-xl border-2 px-4 py-3 text-base font-bold transition-colors lg:min-h-[48px] lg:py-2.5';
      const adminPhoneNumber = String(adminSettings?.phone_number || '').trim();
      const adminTelHref = adminPhoneNumber ? `tel:${adminPhoneNumber.replace(/[^\d+]/g, '')}` : '';
      const guestVendorLabel = useMemo(() => {
        if (!isGuestSiteOrder || !guestSiteOrderCtx) return '';
        const p = guestSiteOrderCtx.project;
        const c = guestSiteOrderCtx.customer;
        return formatSiteOrderVendorLabel({
          primeContractorName: c?.company_name || c?.name,
          traderName: p?.trading_company_name || p?.trading_company,
        });
      }, [isGuestSiteOrder, guestSiteOrderCtx]);
      const guestSiteLabel = useMemo(() => {
        if (!isGuestSiteOrder || !guestSiteOrderCtx) return '';
        return (
          guestSiteOrderCtx.project?.name ||
          selectedProject?.name ||
          guestSiteOrderCtx.customer?.company_name ||
          ''
        );
      }, [isGuestSiteOrder, guestSiteOrderCtx, selectedProject]);

      const canAccessDispatch = isLoggedIn || (isGuestSiteOrder && guestSiteOrderCtx);

      if (isGuestSiteOrder && guestSiteOrderLoading) {
        return (
          <div className="flex min-h-[100dvh] w-full items-center justify-center bg-slate-100 px-4 dark:bg-gray-900">
            <p className="text-center text-sm font-bold text-slate-600 dark:text-slate-300">物件専用発注フォームを読み込み中…</p>
          </div>
        );
      }

      if (isGuestSiteOrder && guestSiteOrderError) {
        return (
          <div className="flex min-h-[100dvh] w-full items-center justify-center bg-slate-100 px-4 dark:bg-gray-900">
            <div className="max-w-lg rounded-2xl border-2 border-red-200 bg-white p-6 text-center shadow-lg dark:border-red-800 dark:bg-slate-800">
              <p className="text-sm font-black text-red-700 dark:text-red-300" role="alert">
                {guestSiteOrderError}
              </p>
              {guestSiteOrderErrorDetail ? (
                <pre className="mt-3 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-red-100 bg-red-50/80 p-3 text-left text-xs font-bold text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
                  {guestSiteOrderErrorDetail}
                </pre>
              ) : null}
              <p className="mt-3 text-xs font-medium text-slate-500">URLを確認するか、管理者へお問い合わせください。</p>
            </div>
          </div>
        );
      }

      if (!canAccessDispatch) {
        return (
          <div className="flex min-h-[100dvh] w-full items-center justify-center overflow-x-hidden bg-gradient-to-br from-slate-100 via-indigo-50 to-slate-100 px-4 py-[max(2rem,env(safe-area-inset-top))]">
            <form onSubmit={handleCustomerLogin} className="w-full max-w-md rounded-3xl border-2 border-slate-200 bg-white p-6 shadow-2xl sm:max-w-lg sm:p-8">
              <p className="text-xs font-black uppercase tracking-widest text-indigo-600">現場注文ログイン</p>
              <h1 className="mt-2 break-words text-2xl font-black text-slate-900">カスタマーログイン</h1>
              <p className="mt-2 break-words text-sm font-bold leading-relaxed text-slate-500">
                管理画面で登録された電話番号とパスワードを入力してください。
              </p>

              {siteOrderLinkNotice ? (
                <p className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-900" role="status">
                  {siteOrderLinkNotice}
                </p>
              ) : null}

              <label className="mt-6 block text-sm font-black text-slate-700" htmlFor="dispatch-login-phone">
                電話番号
              </label>
              <input
                id="dispatch-login-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={loginPhone}
                onChange={(e) => {
                  setLoginPhone(e.target.value);
                  setLoginError('');
                }}
                className="mt-2 min-h-[52px] w-full rounded-xl border-2 border-slate-300 bg-white px-4 text-base font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                placeholder="例: 090-1234-5678"
              />

              <label className="mt-4 block text-sm font-black text-slate-700" htmlFor="dispatch-login-password">
                パスワード
              </label>
              <input
                id="dispatch-login-password"
                type="password"
                autoComplete="current-password"
                value={loginPassword}
                onChange={(e) => {
                  setLoginPassword(e.target.value);
                  setLoginError('');
                }}
                className="mt-2 min-h-[52px] w-full rounded-xl border-2 border-slate-300 bg-white px-4 text-base font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                placeholder="パスワードを入力"
              />

              {loginError ? (
                <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-black text-red-700" role="alert">
                  {loginError}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={loginLoading}
                className="mt-6 min-h-[52px] w-full rounded-xl border-2 border-indigo-700 bg-indigo-600 px-4 text-base font-black text-white shadow-lg transition hover:bg-indigo-700 disabled:cursor-wait disabled:border-slate-400 disabled:bg-slate-400"
              >
                {loginLoading ? 'ログイン中…' : 'ログイン'}
              </button>
              <p className="mt-5 break-words rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-center text-xs font-bold leading-relaxed text-slate-600">
                パスワードをお忘れの場合は、管理者へご連絡ください。
                {adminTelHref ? (
                  <a href={adminTelHref} className="ml-1 inline-flex rounded-lg border border-indigo-200 bg-white px-2 py-1 font-black text-indigo-700 hover:bg-indigo-50">
                    【管理者へ電話する】
                  </a>
                ) : (
                  <span className="ml-1 font-black text-slate-500">管理者電話番号未設定</span>
                )}
              </p>
            </form>
          </div>
        );
      }

      return (
        <div className="min-h-screen bg-gray-50 text-gray-900 antialiased dark:bg-gray-900 dark:text-gray-100">
          <div className="mx-auto min-h-screen max-w-[1440px] shadow-sm flex flex-col lg:flex-row">
            {!isGuestSiteOrder ? (
              <aside className="hidden lg:block w-[260px] shrink-0 bg-white border-r border-gray-200 min-h-screen sticky top-0">
                <div className="p-5 space-y-4">
                  <a
                    href="/"
                    className="inline-flex w-fit items-center rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
                    aria-label={APP_BRAND_HOME_LABEL}
                  >
                    <img src={concreteLinkLogo} alt={APP_BRAND_NAME} className="h-10 w-auto" />
                  </a>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">ログイン中</p>
                      <p className="mt-1 break-words text-sm font-black leading-snug text-slate-900">
                        {currentCustomer?.company_name || currentCustomer?.name || '認証済み業者'}
                      </p>
                    </div>
                    <div className="shrink-0">
                      <ThemeToggle compact />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCustomerLogout}
                    className="w-full rounded-xl border-2 border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                  >
                    ログアウト
                  </button>
                </div>
                <div className="px-4 pb-6">
                  <p className="px-2 text-[10px] font-black uppercase tracking-wider text-slate-400">メニュー</p>
                  <nav className="mt-2 flex flex-col gap-1" aria-label="メインメニュー">
                    {CUSTOMER_ORDER_TABS.map(([id, label, icon]) => {
                      const active = customerOrderTab === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => selectCustomerTab(id)}
                          className={
                            'flex min-h-[48px] items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-black transition ' +
                            (active ? 'bg-indigo-600 text-white shadow-md' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')
                          }
                          aria-pressed={active}
                        >
                          <span aria-hidden>{icon}</span>
                          <span className="flex-1">{label}</span>
                          {id === 'active' && unreadChatCount > 0 ? (
                            <span
                              className="ml-1 inline-flex min-h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-black leading-none text-white"
                              aria-label={`未読チャット ${unreadChatCount}件`}
                            >
                              {unreadChatCount > 9 ? '9+' : unreadChatCount}
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </nav>
                </div>
              </aside>
            ) : null}

            <main id="dispatch-dashboard" className="flex-1 min-w-0 flex flex-col p-4 md:p-6 lg:p-8 pb-24 lg:pb-8">
              <header className="mb-6 flex flex-col gap-4 border-b border-gray-200 pb-4">
                <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-4">
                  <div className="min-w-0">
                    {isGuestSiteOrder ? (
                      <>
                        <img src={concreteLinkLogo} alt={APP_BRAND_NAME} className="h-10 w-auto" />
                        <div className="mt-3 space-y-1">
                          <p className="text-xs font-black uppercase tracking-wider text-indigo-600">物件専用発注フォーム</p>
                          {guestVendorLabel ? (
                            <p className="text-base font-bold leading-snug text-slate-900">
                              <span className="text-slate-500 text-xs font-bold">元請・商社</span>
                              <br />
                              {guestVendorLabel}
                            </p>
                          ) : null}
                          {guestSiteLabel ? (
                            <p className="text-xl font-black leading-tight text-slate-900">
                              <span className="text-slate-500 text-xs font-bold">物件名</span>
                              <br />
                              {guestSiteLabel}
                            </p>
                          ) : null}
                        </div>
                      </>
                    ) : (
                      <div className="lg:hidden">
                        <div className="flex items-start justify-between gap-4">
                          <a
                            href="/"
                            className="inline-flex w-fit items-center rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
                            aria-label={APP_BRAND_HOME_LABEL}
                          >
                            <img src={concreteLinkLogo} alt={APP_BRAND_NAME} className="h-10 w-auto" />
                          </a>
                          <div className="flex items-start gap-2">
                            <ThemeToggle compact />
                            <button
                              type="button"
                              onClick={handleCustomerLogout}
                              className="rounded-xl border-2 border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-700"
                            >
                              ログアウト
                            </button>
                          </div>
                        </div>
                        <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{APP_BRAND_NAME}</p>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col md:items-end gap-2">
                    {!isGuestSiteOrder && customerOrderTab === 'active' ? (
                      <div className="w-full md:w-auto max-w-md">
                        <OrderListSearchInput
                          id="master-in-progress-search"
                          value={inProgressSearchQuery}
                          onChange={setInProgressSearchQuery}
                        />
                      </div>
                    ) : null}
                  </div>
                </div>

                {isGuestSiteOrder && siteOrderLinkNotice ? (
                  <p className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-bold text-indigo-900" role="status">
                    {siteOrderLinkNotice}
                  </p>
                ) : null}
              </header>

              <PullToRefresh
                onRefresh={
                  isGuestSiteOrder
                    ? hasGuestSiteOrderSession()
                      ? () => refreshDashboard({ playSound: false })
                      : async () => {}
                    : refreshDashboard
                }
                className="grid min-w-0 gap-6"
              >
              {customerOrderTab === 'new' && !newOrderMode && !isGuestSiteOrder ? (
              <section className="w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-md sm:p-6 lg:p-8">
                <p className="text-xs font-black uppercase tracking-wider text-indigo-700">新規発注</p>
                <h2 className="mt-1 text-2xl font-black text-slate-900">発注スタイルを選択</h2>
                <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">現場に合わせて、最短の発注方法を選んでください。</p>
                <div className="mt-6 flex flex-col gap-4 lg:grid lg:grid-cols-3 lg:gap-6">
                  {[
                    {
                      title: '🏢 登録物件から発注',
                      body: '管理画面で登録済みの物件から、住所・工場情報を使って発注します。',
                      onClick: () => {
                        setOrderKind('project');
                        setDeliveryLat('');
                        setDeliveryLng('');
                        setDeliveryArea('');
                        setSiteAddressDetail('');
                        setIsLocationPending(false);
                        setNewOrderMode('form');
                      },
                    },
                    {
                      title: '📍 新規スポット注文',
                      body: '地図で納入場所を指定して、単発のスポット注文を作成します。',
                      onClick: () => {
                        setOrderKind('spot');
                        setSelectedProjectId('');
                        setPreferredFactoryId('');
                        setIsLocationPending(true);
                        setSpotMapFlowMode('later');
                        setDeliveryLat('');
                        setDeliveryLng('');
                        setDeliveryArea('');
                        setSiteAddressDetail('');
                        setNewOrderMode('form');
                      },
                    },
                    {
                      title: '🕒 履歴から選んで注文',
                      body: '過去の注文を開き、日付と時間だけ変更して再発注します。',
                      onClick: () => {
                        setCustomerOrderTab('history');
                        setNewOrderMode('');
                      },
                    },
                  ].map((card) => (
                    <button
                      key={card.title}
                      type="button"
                      onClick={card.onClick}
                      className="min-h-[150px] rounded-2xl border-2 border-slate-200 bg-slate-50 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:bg-white hover:shadow-lg active:scale-[0.99] lg:min-h-[140px]"
                    >
                      <span className="text-xl font-black text-slate-900">{card.title}</span>
                      <span className="mt-3 block text-sm font-bold leading-relaxed text-slate-600">{card.body}</span>
                    </button>
                  ))}
                </div>
              </section>
              ) : null}
              {customerOrderTab === 'new' && newOrderMode ? (
              <div ref={orderFormRef} className="mx-auto w-full max-w-4xl min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-md sm:p-6 lg:max-w-4xl lg:p-8">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-wider text-indigo-700">新規発注</h2>
                <p className="mt-1 text-xs text-slate-500">
                  数量・業者・電話番号は必須です。商社は任意です。現場名は未入力のとき、現場住所と同じ内容として扱われます。
                </p>
                  </div>
                  {!isGuestSiteOrder ? (
                    <button type="button" onClick={() => setNewOrderMode('')} className="rounded-xl border-2 border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100">
                      発注スタイル選択へ戻る
                    </button>
                  ) : null}
                </div>
                <form
                  className="mt-6 flex min-w-0 flex-col gap-6 overflow-hidden"
                  onSubmit={(e) => e.preventDefault()}
                >
              <div className="flex min-w-0 flex-col gap-6">
              {!isGuestSiteOrder ? (
              <div className="flex flex-col gap-3">
                <span className="text-sm font-semibold text-slate-700">注文種別</span>
                <p className="text-xs leading-relaxed text-slate-500">
                  スポット注文の現場地図は、確定後にURLで送付するか、確定直後に地図エディタを開いて作成します。
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setOrderKind('project');
                      setDeliveryLat('');
                      setDeliveryLng('');
                      setDeliveryArea('');
                      setSiteAddressDetail('');
                      setIsLocationPending(false);
                      setSubmitError('');
                    }}
                    aria-pressed={orderKind === 'project'}
                    className={
                      btnBase +
                      (orderKind === 'project'
                        ? ' border-indigo-600 bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-300'
                        : ' border-slate-200 bg-white text-slate-700 hover:bg-slate-50')
                    }
                  >
                    物件
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOrderKind('spot');
                      setSelectedProjectId('');
                      setPreferredFactoryId('');
                      setIsLocationPending(true);
                      setSpotMapFlowMode('later');
                      setDeliveryLat('');
                      setDeliveryLng('');
                      setDeliveryArea('');
                      setSiteAddressDetail('');
                      lastAutofillProjectIdRef.current = '';
                      setSubmitError('');
                    }}
                    aria-pressed={orderKind === 'spot'}
                    className={
                      btnBase +
                      (orderKind === 'spot'
                        ? ' border-indigo-600 bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-300'
                        : ' border-slate-200 bg-white text-slate-700 hover:bg-slate-50')
                    }
                  >
                    スポット
                  </button>
                </div>
              </div>
              ) : null}

              {isGuestSiteOrder && orderKind === 'project' ? (
                <div className="flex flex-col gap-4 rounded-2xl border-2 border-slate-200 bg-slate-50/90 p-4 dark:border-slate-600 dark:bg-slate-800/80 lg:col-span-2">
                  <p className="text-xs font-bold leading-relaxed text-slate-500 dark:text-slate-400">
                    この物件で確定している情報です（変更できません）
                  </p>
                  <GuestLockedField label="物件住所" value={guestLockedFields?.address} />
                  <GuestLockedField
                    label="業者（元請）"
                    value={guestLockedFields?.primeContractorDisplay}
                  />
                  <GuestLockedField
                    label="業者（下請）"
                    value={guestLockedFields?.subContractorDisplay}
                  />
                  <GuestLockedField label="商社名" value={guestLockedFields?.traderNameDisplay} />
                </div>
              ) : null}

              {isGuestSiteOrder ? (
                <div className="lg:col-span-2">
                  <h3 className="text-base font-black text-slate-900 dark:text-slate-100">発注内容</h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    納入希望日時・配合・数量などを入力し、リストに追加してから一括確定してください。
                  </p>
                </div>
              ) : null}

              {orderKind === 'project' && !isGuestSiteOrder ? (
                <div className="flex flex-col gap-4">
                  <MasterSuggestInput
                    label="業者（会社）"
                    htmlFor={orderFieldId('dispatch-customer')}
                    name={orderFieldName('customer_company')}
                    value={customerSearchText}
                    disabled={customers.length === 0}
                    placeholder="業者名を入力して候補から選択"
                    items={customers}
                    getItemKey={(c) => String(c.id)}
                    getItemLabel={(c) => String(c.company_name || c.name || c.id || '').trim()}
                    getSearchTexts={customerSuggestTexts}
                    onValueChange={(text) => {
                      setCustomerSearchText(text);
                      setSubmitError('');
                      const hit = (customers || []).find(
                        (c) =>
                          String(c.company_name || c.name || '')
                            .trim()
                            .toLowerCase() === String(text).trim().toLowerCase(),
                      );
                      if (hit) {
                        setCurrentCustomerId(String(hit.id));
                      }
                    }}
                    onSelect={(c) => {
                      setCurrentCustomerId(String(c.id));
                      setCustomerSearchText(String(c.company_name || c.name || '').trim());
                      setSelectedProjectId('');
                      lastAutofillProjectIdRef.current = '';
                      applyProjectSelection(null);
                      setSubmitError('');
                    }}
                    emptyHint="該当する業者がありません"
                  />
                  <MasterSuggestInput
                    label="物件を選択"
                    htmlFor={orderFieldId('dispatch-project')}
                    name="regular_project_search"
                    value={projectSearchText}
                    disabled={!hasCurrentCustomer}
                    placeholder={hasCurrentCustomer ? '物件名を入力して候補から選択' : '先に業者を選択してください'}
                    items={filteredProjects}
                    getItemKey={(p) => String(p.id)}
                    getItemLabel={(p) => String(p.name || p.id || '').trim()}
                    getSearchTexts={projectSuggestTexts}
                    onValueChange={(text) => {
                      setProjectSearchText(text);
                      setSubmitError('');
                      const hit = (filteredProjects || []).find(
                        (p) => String(p.name || '').trim().toLowerCase() === String(text).trim().toLowerCase(),
                      );
                      if (hit) {
                        setSelectedProjectId(String(hit.id));
                        applyProjectSelection(hit);
                      } else {
                        setSelectedProjectId('');
                        if (lastAutofillProjectIdRef.current) {
                          lastAutofillProjectIdRef.current = '';
                          applyProjectSelection(null);
                        }
                      }
                    }}
                    onSelect={(p) => {
                      const pid = String(p.id);
                      setSelectedProjectId(pid);
                      setProjectSearchText(String(p.name || '').trim());
                      applyProjectSelection(p);
                      const factoryId = String(p.main_factory_id ?? p.mainFactoryId ?? '').trim();
                      if (factoryId) setPreferredFactoryId(factoryId);
                      setSubmitError('');
                    }}
                    emptyHint="該当する物件がありません"
                  />
                  {!hasCurrentCustomer ? (
                    <p className="text-xs font-bold text-amber-800 dark:text-amber-200">
                      ログイン中の業者情報を確認できません。再ログインするか、上の欄で業者を選択してください。
                    </p>
                  ) : filteredProjects.length === 0 ? (
                    <p className="text-xs font-bold text-amber-800 dark:text-amber-200">
                      この業者に紐づく物件がありません。管理画面で物件に業者（会社）を設定するか、スポット注文を選んでください。
                    </p>
                  ) : null}
                  {selectedProject ? (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <p className="text-xs font-black text-slate-600">物件リンク</p>
                      <div className="mt-2 grid gap-2">
                        <ProjectExternalUrlActions
                          folderUrl={selectedProject.folder_url}
                          sheetUrl={selectedProject.sheet_url}
                          variant="inline"
                        />
                        <SiteOrderUrlActions
                          urlToken={selectedProject.url_token}
                          siteName={selectedProject.name}
                          customerName={currentCustomerDisplayName}
                          traderName={
                            selectedProject.trading_company_name || selectedProject.trading_company || ''
                          }
                          project={selectedProject}
                          customer={currentCustomer}
                          compact
                        />
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}

              {orderKind === 'spot' ? (
                <>
                  <div className="flex flex-col gap-3">
                    <Label htmlFor={orderFieldId('site-name')}>現場名</Label>
                    <p className="text-xs leading-relaxed text-slate-500">
                      現場の通称など。空欄のまま送信した場合は、下の「現場住所」の内容が現場名として保存されます。
                    </p>
                    <input
                      id={orderFieldId('site-name')}
                      name="spot_site_name"
                      type="text"
                      autoComplete="off"
                      placeholder="例：〇〇ビル新築工事"
                      value={siteName}
                      onChange={(e) => {
                        setSiteName(e.target.value);
                        setSubmitError('');
                      }}
                      className={CUSTOMER_FIELD_CLASS + ' font-semibold'}
                    />
                  </div>
                  <DeliveryAreaAddressField
                    idPrefix="dispatch-spot"
                    allowedAreas={allowedDeliveryAreas}
                    deliveryArea={deliveryArea}
                    onDeliveryAreaChange={(v) => {
                      setDeliveryArea(v);
                      setSiteAddressDetail('');
                      setSubmitError('');
                    }}
                    addressDetail={siteAddressDetail}
                    onAddressDetailChange={(v) => {
                      setSiteAddressDetail(v);
                    }}
                    showTownSuggestions
                    townSuggestions={townSuggestionNames}
                    townSuggestionsLoading={townOptionsLoading}
                    townSuggestionsError={townOptionsError}
                  />
                  <div className="flex flex-col gap-2">
                    <span className="text-sm font-semibold text-slate-700">現場地図の扱い</span>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-amber-200 bg-amber-50/80 p-4">
                        <input
                          type="radio"
                          name="spot-map-flow"
                          value="later"
                          checked={spotMapFlowMode === 'later'}
                          onChange={() => {
                            setSpotMapFlowMode('later');
                            setIsLocationPending(true);
                            setDeliveryLat('');
                            setDeliveryLng('');
                            setSubmitError('');
                          }}
                          className="mt-1 h-5 w-5 shrink-0 rounded border-amber-400 text-amber-600"
                        />
                        <span className="text-sm font-bold leading-relaxed text-amber-950">
                          あとから地図を送る
                          <span className="mt-1 block text-xs font-medium text-amber-900/90">
                            発注確定後は「進行中」タブの現場地図URLから送付できます（自動で開きません）。
                          </span>
                        </span>
                      </label>

                      <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-indigo-200 bg-indigo-50/80 p-4">
                        <input
                          type="radio"
                          name="spot-map-flow"
                          value="create"
                          checked={spotMapFlowMode === 'create'}
                          onChange={() => {
                            setSpotMapFlowMode('create');
                            setIsLocationPending(true);
                            setDeliveryLat('');
                            setDeliveryLng('');
                            setSubmitError('');
                          }}
                          className="mt-1 h-5 w-5 shrink-0 rounded border-indigo-400 text-indigo-600"
                        />
                        <span className="text-sm font-bold leading-relaxed text-indigo-950">
                          現場地図を作成する
                          <span className="mt-1 block text-xs font-medium text-indigo-900/90">
                            確定直後に地図エディタ（別タブ）が開き、すぐにスタンプ作成できます。
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>
                </>
              ) : null}

              {orderKind === 'project' && !isGuestSiteOrder ? (
                <DeliveryAreaAddressField
                  idPrefix="dispatch-project"
                  label="現場住所（納入エリア）"
                  allowedAreas={allowedDeliveryAreas}
                  deliveryArea={deliveryArea}
                  onDeliveryAreaChange={(v) => {
                    setDeliveryArea(v);
                    setSiteAddressDetail('');
                    setSubmitError('');
                  }}
                  addressDetail={siteAddressDetail}
                  onAddressDetailChange={(v) => {
                    setSiteAddressDetail(v);
                    setSubmitError('');
                  }}
                  showTownSuggestions
                  townSuggestions={townSuggestionNames}
                  townSuggestionsLoading={townOptionsLoading}
                  townSuggestionsError={townOptionsError}
                />
              ) : null}

              <div className="flex min-w-0 max-w-full flex-col gap-3 overflow-hidden">
                <Label htmlFor={orderFieldId('preferred-date')}>希望日（納入日）</Label>
                <p className={'text-xs leading-relaxed text-slate-500' + (isGuestSiteOrder ? ' hidden' : '')}>
                  日付や試験の有無などを変えながら「リストに追加」でカートへ溜め、最後に一括確定できます。
                </p>
                <div className="w-full min-w-0 max-w-full overflow-hidden">
                  <input
                    id={orderFieldId('preferred-date')}
                    name={orderKind === 'spot' ? 'spot_delivery_date' : 'delivery_date'}
                    type="date"
                    min={today}
                    value={preferredDate}
                    onChange={(e) => {
                      const nextDate = e.target.value;
                      const nextSlot = firstAvailableTimeSlotForDate(nextDate);
                      if (nextSlot) {
                        setPreferredDate(nextDate);
                        if (isPastPreferredDateTime(nextDate, timeSlot)) setTimeSlot(nextSlot.value);
                      } else {
                        const next = nextAvailableOrderDateTime(nextDate);
                        setPreferredDate(next.date);
                        setTimeSlot(next.slot);
                      }
                      setSubmitError('');
                    }}
                    className="block box-border min-h-[56px] min-w-0 w-full max-w-full appearance-none rounded-xl border-2 border-slate-200 bg-white px-3 py-3 text-base text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300"
                    style={{ WebkitAppearance: 'none', appearance: 'none' }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <Label htmlFor={orderFieldId('time-slot')}>希望時刻（8:00〜15:30・30分刻み）</Label>
                <p className={'text-xs leading-relaxed text-slate-500' + (isGuestSiteOrder ? ' hidden' : '')}>
                  到着・打設の目安時刻を、30分単位で指定します（最遅 15:30）。
                </p>
                <select
                  id={orderFieldId('time-slot')}
                  name={orderFieldName('time_slot')}
                  autoComplete="off"
                  value={timeSlot}
                  onChange={(e) => {
                    setTimeSlot(e.target.value);
                    setSubmitError('');
                  }}
                  className="min-h-[56px] w-full appearance-none rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-base font-medium text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300"
                  style={{
                    backgroundImage:
                      'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke=\'%2364748b\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M19 9l-7 7-7-7\'/%3E%3C/svg%3E")',
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.75rem center',
                    backgroundSize: '1.25rem',
                  }}
                >
                  {TIME_SLOTS.map((s) => (
                    <option
                      key={s.value}
                      value={s.value}
                      disabled={isPastPreferredDateTime(preferredDate || today, s.value)}
                    >
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-3">
                <Label htmlFor={orderFieldId('dispatch-factory')}>第一希望工場（任意）</Label>
                <p className="text-xs leading-relaxed text-slate-500">
                  {isGuestSiteOrder
                    ? '指定した工場に最初に配車依頼が届きます。メイン工場が自動入力されています（変更可）。未指定の場合はエスカレーションルールに従います。'
                    : '指定した工場に最初に配車依頼が届きます。物件を選ぶとメイン工場が自動入力されます（変更可）。未指定の場合はエスカレーションルールに従います。'}
                </p>
                <select
                  id={orderFieldId('dispatch-factory')}
                  name={orderFieldName('preferred_factory_id')}
                  autoComplete="off"
                  value={preferredFactoryId}
                  onChange={(e) => {
                    setPreferredFactoryId(e.target.value);
                    setSubmitError('');
                  }}
                  className="min-h-[56px] w-full appearance-none rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-base font-medium text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300"
                  style={{
                    backgroundImage:
                      'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' fill=\'none\' viewBox=\'0 0 24 24\' stroke=\'%2364748b\'%3E%3Cpath stroke-linecap=\'round\' stroke-linejoin=\'round\' stroke-width=\'2\' d=\'M19 9l-7 7-7-7\'/%3E%3C/svg%3E")',
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0.75rem center',
                    backgroundSize: '1.25rem',
                  }}
                >
                  <option value="">（指定しない）</option>
                  {factoriesForPreferredSelection.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-3">
                <span className="text-sm font-semibold text-slate-700">車両タイプ</span>
                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setVehicleType('large')}
                    aria-pressed={vehicleType === 'large'}
                    className={
                      btnBase +
                      (vehicleType === 'large'
                        ? ' border-indigo-600 bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-300'
                        : ' border-slate-200 bg-white text-slate-700 hover:bg-slate-50')
                    }
                  >
                    大型
                  </button>
                  <button
                    type="button"
                    onClick={() => setVehicleType('small')}
                    aria-pressed={vehicleType === 'small'}
                    className={
                      btnBase +
                      (vehicleType === 'small'
                        ? ' border-indigo-600 bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-300'
                        : ' border-slate-200 bg-white text-slate-700 hover:bg-slate-50')
                    }
                  >
                    小型
                  </button>
                </div>
              </div>

              {!isGuestSiteOrder ? (
                <>
                  <MasterSuggestInput
                    label="商社（任意）"
                    name={orderFieldName('trader_name')}
                    value={traderName}
                    onValueChange={(v) => {
                      setTraderName(v);
                      setSubmitError('');
                    }}
                    items={MASTER_TRADER_SUGGESTIONS}
                    getItemKey={(s) => s}
                    getItemLabel={(s) => s}
                    onSelect={(s) => {
                      setTraderName(s);
                      setSubmitError('');
                    }}
                    placeholder="例：梅田建材（入力すると候補が表示されます）"
                    autoComplete="organization"
                  />

                  <MasterSuggestInput
                    label="業者（下請・現場名義など）"
                    name={orderFieldName('contractor_name')}
                    value={contractorName}
                    onValueChange={(v) => {
                      setContractorName(v);
                      setSubmitError('');
                    }}
                    items={MASTER_CONTRACTOR_SUGGESTIONS}
                    getItemKey={(s) => s}
                    getItemLabel={(s) => s}
                    onSelect={(s) => {
                      setContractorName(s);
                      setSubmitError('');
                    }}
                    placeholder="例：佐藤建設（入力すると候補が表示されます）"
                    autoComplete="off"
                  />
                </>
              ) : null}

              <div className="flex flex-col gap-3">
                <Label htmlFor={orderFieldId('mix-spec')}>配合（JIS規格など）</Label>
                <p className={'text-xs leading-relaxed text-slate-500' + (isGuestSiteOrder ? ' hidden' : '')}>
                  自由入力のほか、下のショートカットから選べます。
                </p>
                <input
                  id={orderFieldId('mix-spec')}
                  name={orderFieldName('mix_spec')}
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  placeholder="例：21-15-20N"
                  value={mixText}
                  onChange={(e) => setMixText(e.target.value)}
                  className="min-h-[56px] w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-base placeholder:text-slate-400 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300"
                />
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
                  {MIX_SHORTCUTS.map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMixText(m)}
                      className={
                        'min-h-[56px] rounded-xl border-2 px-3 py-3 text-sm font-bold transition-colors ' +
                        (mixText === m
                          ? 'border-slate-800 bg-slate-800 text-white'
                          : 'border-slate-200 bg-slate-50 text-slate-800 hover:border-slate-300 hover:bg-slate-100')
                      }
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <Label htmlFor={orderFieldId('quantity-m3')}>数量（m³）</Label>
                <p className={'text-xs leading-relaxed text-slate-500' + (isGuestSiteOrder ? ' hidden' : '')}>
                  発注時は空欄にできません。
                </p>
                <input
                  id={orderFieldId('quantity-m3')}
                  name={orderKind === 'spot' ? 'spot_quantity' : 'quantity'}
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder=""
                  value={quantityM3}
                  onChange={(e) => {
                    setQuantityM3(e.target.value);
                    setSubmitError('');
                  }}
                  className="min-h-[56px] w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-base text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300"
                />
              </div>

              <div className="flex flex-col gap-3">
                <Label htmlFor={orderFieldId('unload-duration')}>1台あたりの荷卸し（車返却）予定時間</Label>
                <p className="text-xs leading-relaxed text-slate-500">
                  {isGuestSiteOrder
                    ? '物件での滞在想定時間です。工場側の帰着・次便計画に使用します。'
                    : '現場での滞在想定時間です。工場側の帰着・次便計画に使用します。'}
                </p>
                <select
                  id={orderFieldId('unload-duration')}
                  name={orderFieldName('unload_duration')}
                  autoComplete="off"
                  value={unloadDuration}
                  onChange={(e) => {
                    setUnloadDuration(e.target.value);
                    setSubmitError('');
                  }}
                  className="min-h-[56px] w-full appearance-none rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-base font-medium text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300"
                >
                  {UNLOAD_DURATION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={'flex flex-col gap-2' + (isGuestSiteOrder ? ' lg:col-span-2' : '')}>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-slate-200 bg-slate-50/90 px-4 py-3 transition hover:border-slate-300 hover:bg-white">
                  <input
                    type="checkbox"
                    name={orderFieldName('has_test')}
                    autoComplete="off"
                    checked={hasTest}
                    onChange={(e) => {
                      setHasTest(e.target.checked);
                      setSubmitError('');
                    }}
                    className="mt-1 h-5 w-5 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <span className="min-w-0 flex-1 text-sm leading-snug text-slate-800">
                    <span className="font-black text-slate-900">試験の有無</span>
                    <span className="mt-1 block text-xs font-medium text-slate-500">
                      チェックを入れると「試験あり」として工場に伝わります。未チェックのときは試験なしです。
                    </span>
                  </span>
                </label>
              </div>

              <div className="flex flex-col gap-3">
                <Label htmlFor={orderFieldId('ordered-by')}>発注担当者名</Label>
                <p className="text-xs leading-relaxed text-slate-500">当日連絡が取れる担当者名を自由入力してください（例：山田、佐藤）。</p>
                <input
                  id={orderFieldId('ordered-by')}
                  name={orderFieldName('ordered_by')}
                  type="text"
                  autoComplete="name"
                  placeholder="例：山田"
                  value={orderedBy}
                  onChange={(e) => {
                    setOrderedBy(e.target.value);
                    setSubmitError('');
                  }}
                  className="min-h-[56px] w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-base font-semibold text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300"
                />
              </div>

              <div className="flex flex-col gap-3">
                <Label htmlFor={orderFieldId('site-phone')}>電話番号</Label>
                <input
                  id={orderFieldId('site-phone')}
                  name={orderKind === 'spot' ? 'spot_phone' : 'phone'}
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="例：03-1234-5678"
                  value={sitePhone}
                  onChange={(e) => {
                    setSitePhone(e.target.value);
                    setSubmitError('');
                  }}
                  className={CUSTOMER_FIELD_CLASS}
                />
              </div>

              <div className="flex flex-col gap-3 border-t-2 border-slate-200 pt-6 dark:border-slate-600">
                <button
                  type="button"
                  onClick={handleAddToCart}
                  disabled={isSubmittingOrder || !hasCurrentCustomer}
                  className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-gradient-to-r from-orange-500 to-amber-500 px-5 py-4 text-lg font-black text-white shadow-lg shadow-orange-500/30 transition hover:from-orange-600 hover:to-amber-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {hasCurrentCustomer
                    ? isGuestSiteOrder
                      ? '➕ リストに追加'
                      : '➕ この内容でリスト（カート）に追加'
                    : '先に業者を選択してください'}
                </button>

                {submitError ? (
                  <p
                    className="rounded-xl border-2 border-red-400 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 shadow-sm"
                    role="alert"
                  >
                    {submitError}
                  </p>
                ) : null}

                <OrderCartPreview
                  items={cartItems}
                  onRemove={handleRemoveFromCart}
                  onConfirmBulk={() => void handleCartBulkConfirm()}
                  bulkLoading={isSubmittingOrder}
                  siteAddressLabel={isGuestSiteOrder ? '物件住所' : '現場住所'}
                />

                {submitNotice ? (
                  <p
                    className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900"
                    role="status"
                  >
                    {submitNotice}
                  </p>
                ) : null}

                {adminNotice ? (
                  <div
                    className="rounded-xl border-2 border-indigo-300 bg-indigo-50 px-4 py-3 text-sm font-black text-indigo-900"
                    role="alert"
                  >
                    {adminNotice}
                  </div>
                ) : null}
              </div>
              </div>
            </form>
              </div>
              ) : null}

              {customerOrderTab === 'active' ? (
              <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md dark:border-slate-700 dark:bg-slate-800 sm:p-5">
                {adminNotice ? (
                  <div className="mb-3 rounded-xl border-2 border-violet-300 bg-violet-50 px-3 py-2 text-sm font-black text-violet-800" role="status">
                    {adminNotice}
                  </div>
                ) : null}
                <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div className="min-w-0">
                    <h2 className="text-base font-black text-slate-900 dark:text-gray-100">進行中の注文ステータス</h2>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-400 dark:text-gray-300">
                      工場画面の受注／拒否／保留がここに反映されます。
                    </p>
                  </div>
                </div>
                  <div className="mt-4 grid grid-cols-1 gap-4">
                    {activeOrders.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500 dark:border-slate-600 dark:bg-slate-900/50 dark:text-gray-300">
                        進行中の注文はありません。「新規発注」タブから発注してください。
                      </p>
                    ) : (
                      <>
                        {filteredInProgressOrders.length === 0 ? (
                          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-500 dark:border-slate-600 dark:bg-slate-900/50 dark:text-gray-300">
                            該当する注文がありません
                          </p>
                        ) : (
                          <div className="grid grid-cols-1 gap-6">
                          {filteredInProgressOrders.map((ord, i) => (
                            <InProgressOrderCard
                              key={ord.id || `ord-${i}`}
                              order={ord}
                              project={projectById[String(ord?.project_id ?? ord?.projectId ?? '')] ?? null}
                              hasUnreadChat={Boolean(
                                unreadChatsByOrder[ord.id] ||
                                  isUnreadForDispatch(chatThreads[ord.id], readChatKeys[ord.id]),
                              )}
                              onOpenChat={setActiveChatOrderId}
                              onAllowStatusReset={handleAllowStatusReset}
                              guestToken={isGuestSiteOrder ? guestOrderToken : ''}
                            />
                          ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
              </aside>
              ) : null}

            {customerOrderTab === 'history' ? (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-md sm:p-6 lg:p-8">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-base font-black text-slate-900">注文履歴</h2>
                  <p className="mt-2 text-xs leading-relaxed text-slate-500">
                    完了・キャンセル済みの注文です。「この内容で再発注」でフォームへ反映するか、カードを展開して日時だけ変えて即時再発注できます。
                  </p>
                </div>
                <div className="grid gap-2">
                  <label className="text-xs font-black text-slate-600">
                    ステータス
                    <select
                      value={historyStatusFilter}
                      onChange={(e) => setHistoryStatusFilter(e.target.value)}
                      className="mt-1 min-h-[40px] w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-800"
                    >
                      <option value="all">すべて</option>
                      <option value="completed">完了</option>
                      <option value="cancelled">キャンセル</option>
                    </select>
                  </label>
                </div>
              </div>

              {filteredHistoryRows.length === 0 ? (
                <p className="mt-5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-500">
                  条件に一致する注文履歴はありません。
                </p>
              ) : (
                <ul className="mt-5 grid grid-cols-1 gap-6">
                  {filteredHistoryRows.map((row) => (
                    <li key={row.id}>
                      <article className="h-full overflow-hidden rounded-2xl border-2 border-slate-200 bg-slate-50 shadow-sm">
                        <div className="flex items-start justify-between gap-3 p-4">
                          <div className="min-w-0">
                            <span className={'inline-flex rounded-full border-2 px-3 py-1 text-xs font-black shadow-sm ' + row.statusMeta.className}>
                              {row.statusMeta.label}
                            </span>
                            <p className="mt-2 break-words text-base font-black text-slate-900">{row.site || '現場未設定'}</p>
                            <p className="mt-1 text-xs font-bold text-slate-500">{row.dateLabel || '日時未設定'}</p>
                          </div>
                          <div className="flex shrink-0 flex-col gap-2">
                            <button
                              type="button"
                              onClick={() => applyHistoryOrderToNewForm(row)}
                              className="rounded-xl border-2 border-indigo-600 bg-indigo-600 px-3 py-2 text-xs font-black text-white shadow-sm transition hover:bg-indigo-700 active:scale-[0.99]"
                            >
                              この内容で再発注
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                setExpandedHistoryOrderId((cur) => (cur === row.id ? '' : row.id || ''))
                              }
                              className="rounded-xl border-2 border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-[0.99]"
                            >
                              {expandedHistoryOrderId === row.id ? '日時指定を閉じる' : '日時だけ変えて再発注'}
                            </button>
                          </div>
                        </div>

                        <dl className="mx-4 grid gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-3 text-xs font-bold text-slate-600">
                          <div className="flex gap-2">
                            <dt className="w-20 shrink-0 text-slate-400">業者</dt>
                            <dd className="min-w-0 flex-1 break-words text-slate-900">{row.contractor || '—'}</dd>
                          </div>
                          <div className="flex gap-2">
                            <dt className="w-20 shrink-0 text-slate-400">現場</dt>
                            <dd className="min-w-0 flex-1 break-words text-slate-900">{row.site || '—'}</dd>
                          </div>
                          <div className="flex gap-2">
                            <dt className="w-20 shrink-0 text-slate-400">担当者</dt>
                            <dd className="min-w-0 flex-1 break-words">{row.orderedBy || '—'}</dd>
                          </div>
                          <div className="flex gap-2">
                            <dt className="w-20 shrink-0 text-slate-400">連絡先</dt>
                            <dd className="min-w-0 flex-1 break-words font-mono">{row.phone || '—'}</dd>
                          </div>
                        </dl>

                        <div className="mx-4 mt-4 flex flex-wrap gap-2">
                          <span className="break-all rounded-xl border-2 border-indigo-200 bg-indigo-50 px-3 py-2 text-lg font-black text-indigo-950">
                            {row.mix || '配合未入力'}
                          </span>
                          <span className="break-words rounded-xl border-2 border-orange-200 bg-orange-50 px-3 py-2 text-lg font-black text-orange-950">
                            {row.quantityM3 !== '' && row.quantityM3 != null ? `${row.quantityM3} ㎥` : '数量未入力'}
                          </span>
                        </div>

                        <div
                          className="grid transition-[grid-template-rows] duration-300 ease-out"
                          style={{ gridTemplateRows: expandedHistoryOrderId === row.id ? '1fr' : '0fr' }}
                        >
                          <div className="min-h-0 overflow-hidden">
                            <div className="mt-4 border-t border-slate-200 bg-white p-4">
                              <p className="text-sm font-black text-slate-900">再発注の希望日時</p>
                              <div className="mt-3 grid gap-3">
                                <label className="text-xs font-black text-slate-600">
                                  希望日
                                  <input
                                    type="date"
                                    min={today}
                                    value={repeatPreferredDate}
                                    onChange={(e) => {
                                      const nextDate = e.target.value;
                                      const nextSlot = firstAvailableTimeSlotForDate(nextDate);
                                      if (nextSlot) {
                                        setRepeatPreferredDate(nextDate);
                                        if (isPastPreferredDateTime(nextDate, repeatTimeSlot)) setRepeatTimeSlot(nextSlot.value);
                                      } else {
                                        const next = nextAvailableOrderDateTime(nextDate);
                                        setRepeatPreferredDate(next.date);
                                        setRepeatTimeSlot(next.slot);
                                      }
                                    }}
                                    className="mt-1 block min-h-[48px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-base font-bold text-slate-900"
                                  />
                                </label>
                                <label className="text-xs font-black text-slate-600">
                                  希望時刻
                                  <select
                                    value={repeatTimeSlot}
                                    onChange={(e) => setRepeatTimeSlot(e.target.value)}
                                    className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 text-base font-bold text-slate-900"
                                  >
                                    {TIME_SLOTS.map((s) => (
                                      <option key={s.value} value={s.value} disabled={isPastPreferredDateTime(repeatPreferredDate, s.value)}>
                                        {s.label}
                                      </option>
                                    ))}
                                  </select>
                                </label>
                                <button
                                  type="button"
                                  onClick={() => void confirmRepeatOrder(row)}
                                  disabled={isSubmittingOrder}
                                  className="min-h-[52px] rounded-xl border-2 border-orange-500 bg-orange-500 px-4 text-base font-black text-white shadow-sm transition hover:bg-orange-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300"
                                >
                                  {isSubmittingOrder ? '登録中…' : 'この日時で確定'}
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </article>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            ) : null}
            {customerOrderTab === 'calendar' ? (
              <CustomerOrderCalendar
                orders={dashboardOrders}
                selectedDate={customerCalendarSelectedDate}
                onSelectDate={setCustomerCalendarSelectedDate}
                currentMonth={customerCalendarMonth}
                onMonthChange={(nextMonth) => {
                  const next = nextMonth instanceof Date && !Number.isNaN(nextMonth.getTime()) ? nextMonth : new Date();
                  const normalized = new Date(next.getFullYear(), next.getMonth(), 1);
                  setCustomerCalendarMonth(normalized);
                  setCustomerCalendarSelectedDate(`${normalized.getFullYear()}-${pad2(normalized.getMonth() + 1)}-01`);
                }}
              />
            ) : null}
              </PullToRefresh>
            </main>

            {!isGuestSiteOrder ? (
              <nav className="block lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200" aria-label="カスタマー画面ナビゲーション">
                <div className="px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2">
                  <div className="mx-auto grid max-w-lg grid-cols-4 gap-1">
                    {CUSTOMER_ORDER_TABS.map(([id, label, icon]) => {
                      const active = customerOrderTab === id;
                      return (
                        <button
                          key={id}
                          type="button"
                          onClick={() => selectCustomerTab(id)}
                          className={
                            'flex min-h-[58px] flex-col items-center justify-center rounded-2xl px-1 text-[11px] font-black transition active:scale-[0.98] ' +
                            (active ? 'bg-indigo-600 text-white shadow-md ring-2 ring-indigo-200' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900')
                          }
                          aria-pressed={active}
                        >
                          <span className="text-lg leading-none" aria-hidden="true">{icon}</span>
                          <span className="mt-1 inline-flex items-center justify-center leading-none">
                            {label}
                            {id === 'active' && unreadChatCount > 0 ? (
                              <span
                                className="ml-0.5 inline-flex min-h-[16px] min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-black leading-none text-white"
                                aria-label={`未読チャット ${unreadChatCount}件`}
                              >
                                {unreadChatCount > 9 ? '9+' : unreadChatCount}
                              </span>
                            ) : null}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </nav>
            ) : null}
          </div>

          {activeChatOrder ? (
            <CustomerChatScreen
              order={activeChatOrder}
              messages={chatThreads[activeChatOrder.id]}
              onBack={() => setActiveChatOrderId('')}
              onSendMessage={handleSendMasterChat}
              onMarkChatRead={markChatRead}
            />
          ) : null}
        </div>
      );
    }
