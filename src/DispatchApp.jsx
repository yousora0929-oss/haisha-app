import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  DISPATCH_DEFAULT_FACTORY_SITE_NAME,
  DISPATCH_DEFAULT_FACTORY_SITE_ID,
  TIME_SLOTS,
  SCHEDULE_BLOCKS,
  pad2,
  todayLocalISODate,
  normalizeDayBlockSchedule,
  computeScheduleAutoRejectReason,
  getScheduleBlockIdForMinutes,
  getOrderVehicleScheduleKey,
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
  DISPATCH_AUTH_SESSION_KEY,
  DISPATCH_CUSTOMER_SESSION_KEY,
  readAuthValue,
  writeAuthValue,
  removeAuthValue,
} from './supabaseClient.js';
import {
  clearAppBadge,
  registerOneSignalUser,
  unregisterOneSignalUser,
  buildCustomerOneSignalExternalId,
  setupNotificationClickRedirect,
} from './utils/notification.js';
import {
  clearPushRedirect,
  consumePushRedirectForApp,
  setupPushRedirectListener,
} from './utils/pushRedirect.js';
import concreteLinkLogo from './assets/concrete-link-logo.svg';
import { APP_BRAND_HOME_LABEL, APP_BRAND_NAME } from './constants/brand.js';
import { ThemeToggle } from './components/ThemeToggle.jsx';
import { setAutoReloadBlocked } from './hooks/useAppReleaseControl.js';
import { OrderCartPreview } from './components/OrderCartPreview.jsx';
import { OrderMapEditorUrlActions } from './components/OrderMapEditorUrlActions.jsx';
import { LocationPendingBadge } from './components/LocationPendingBadge.jsx';
import { PhoneOrderBadge } from './components/PhoneOrderBadge.jsx';
import { DeliveryAreaAddressField } from './components/DeliveryAreaAddressField.jsx';
import { MasterSuggestInput } from './components/MasterSuggestInput.jsx';
import { CompanyMemberContactList } from './components/CompanyMemberContactList.jsx';
import { OrderFullEditModal, isPreAcceptOrderEditable, isAcceptedOrderChangeRequestable } from './components/OrderFullEditModal.jsx';
import { AdminScheduleImportSection } from './components/AdminScheduleImportSection.jsx';
import { customerSuggestTexts, organizationSuggestTexts, projectSuggestTexts, sortCustomersByUsageFrequency } from './utils/masterSuggest.js';
import { dedupeCustomersByCompany } from './utils/dedupeCustomersByCompany.js';
import { resolveEffectiveContractorCustomerId } from './utils/resolveEffectiveContractorCustomerId.js';
import {
  buildDispatchOrderForDate,
  validateCartLineForm,
  extractOrderFormDefaultsFromHistory,
} from './utils/dispatchBulkOrder.js';
import { MixDesignRequestModal } from './components/MixDesignRequestModal.jsx';
import { MixDesignRequestHistorySection } from './components/MixDesignRequestHistorySection.jsx';
import {
  COOPERATIVE_OWN_ORG_TRADER_ERROR,
  isCooperativeOwnOrgTraderName,
} from './utils/cooperativeTraderName.js';
import { buildMapEditorUrl, openMapEditorWindow, rememberMapEditorReturnUrl } from './mapEditorConstants.js';
import { combineDeliveryAddress, extractProjectAddressFields, normalizeAllowedDeliveryAreas } from './utils/deliveryAreas.js';
import { resolveProjectTradingCompanyName } from './utils/projectTradingCompany.js';
import {
  contractorAccountsInSameCompany,
  formatProjectAccountLabel,
  projectMatchForCustomers,
} from './utils/projectCustomerMatch.js';
import {
  resolveContractorDisplayName,
  resolveProjectContractorLabels,
} from './utils/projectContractorLabel.js';
import {
  fetchTownLocationsForMunicipality,
  findTownLocation,
  resolveDeliveryPrefecture,
  townNamesFromLocationList,
} from './utils/heartrailsGeo.js';
import { isLocationPendingOrder, resolveInitialOrderStatus, resolveOrderDisplayStatus, sumOrderVolumesM3 } from './utils/orderWorkflow.js';
import {
  buildEscalationContext,
  needsPreferredCustomerChoice,
  isFullCompanyRejectionForCustomer,
} from './utils/escalationUtils.js';
import {
  CUSTOMER_ACTION_REQUIRED_LABEL,
  CUSTOMER_FACTORY_HOLD_LABEL,
  CUSTOMER_FULL_REJECTION_MESSAGE,
  CUSTOMER_ORDER_REJECTED_LABEL,
  customerFullRejectionDashboardNotice,
  isFactoryHoldPending,
  resolveCustomerDispatchWaitingLabel,
} from './utils/customerStatusLabels.js';
import { resolveOrderSiteDisplayName, sanitizeSiteNameValue } from './utils/siteNameDisplay.js';
import { orderPartyInfo as buildOrderPartyInfo } from './utils/orderPartyInfo.js';
import {
  groupOrdersBySiteForAssignedProjects,
  resolveOrderDateTimeSortValue,
  resolveInProgressGroupStorageId,
  resolveNearestUpcomingOrder,
  formatOrderDateTimeSummary,
} from './utils/orderGrouping.js';
import {
  formatProjectSiteContactsLabel,
  formatTradingAgentContactLabel,
  resolveOrderContactPersonName,
  resolveOrderLinkedProject,
  resolveSiteContactName,
} from './utils/orderContactInfo.js';
import { formatPhoneNumberJP } from './utils/phoneFormat.js';
import { resolveGuestPreferredFactoryId, resolveProjectMainFactoryId, getProjectDataGapWarnings } from './utils/projectFactory.js';
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
import {
  chatSoundKeyFromOrderMessages,
  chatSoundKeyFromRealtimePayload,
  shouldPlayChatSoundOnce,
} from './utils/chatNotificationDedup.js';
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

const SITE_ORDER_PENDING_SESSION_KEY = 'haisha_site_order_pending_v1';
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
  ['siteContacts', '現場担当者', '👤'],
];

const SCHEDULE_IMPORT_TAB = ['scheduleImport', '取込', '📄'];
const MIX_DESIGN_HISTORY_TAB = ['mixDesignHistory', '配合依頼', '📑'];

/** 進行中タブの物件グループ折りたたみ（true = 折りたたみ）。物件ID単位で保持。 */
const INPROGRESS_GROUP_COLLAPSED_STORAGE_PREFIX = 'haisha_dispatch_inprogress_group_collapsed_v1';

function inProgressGroupCollapsedStorageKey(customerId) {
  const cid = String(customerId || '').trim() || 'anon';
  return `${INPROGRESS_GROUP_COLLAPSED_STORAGE_PREFIX}_${cid}`;
}

function readInProgressGroupCollapsedMap(customerId) {
  try {
    const raw = window.localStorage.getItem(inProgressGroupCollapsedStorageKey(customerId));
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeInProgressGroupCollapsedMap(customerId, map) {
  try {
    window.localStorage.setItem(
      inProgressGroupCollapsedStorageKey(customerId),
      JSON.stringify(map && typeof map === 'object' ? map : {}),
    );
  } catch {
    /* ignore */
  }
}

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
      if (from !== 'factory' && from !== 'admin' && from !== 'system') return false;
      return chatMessageReadKey(latest) !== readKey;
    }

    // 業者表示は utils/orderPartyInfo（contractorName 優先。代理発注で業者名空なら発注者名へ落とさない）
    function orderPartyInfo(order) {
      return buildOrderPartyInfo(order, { preferSiteContact: true });
    }

    function orderContactPersonName(order, fallback = '担当者', customer = null) {
      return resolveOrderContactPersonName(order, { customer, fallback });
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

    function historyStatusMeta(order, escalationCtx = null) {
      const st = resolveOrderDisplayStatus(order);
      if (['customer_cancelled', 'cancelled', 'deleted'].includes(st)) {
        return { key: 'cancelled', label: 'キャンセル', className: 'bg-red-600 text-white border-red-700' };
      }
      if (['completed', 'complete', 'done', 'delivered'].includes(st)) {
        return { key: 'completed', label: '完了', className: 'bg-emerald-600 text-white border-emerald-700' };
      }
      if (st === 'accepted') {
        return { key: 'active', label: '受注', className: 'bg-blue-600 text-white border-blue-700' };
      }
      if (st === 'rejected') {
        return { key: 'cancelled', label: CUSTOMER_ORDER_REJECTED_LABEL, className: 'bg-red-600 text-white border-red-700' };
      }
      if (st === 'pending_association') {
        return { key: 'active', label: '組合承認待ち', className: 'cl-alert-association bg-violet-600 text-white border-violet-700' };
      }
      if (st === 'pending' && isFactoryHoldPending(order)) {
        return { key: 'active', label: CUSTOMER_FACTORY_HOLD_LABEL, className: 'bg-amber-500 text-amber-950 border-amber-600' };
      }
      return {
        key: 'active',
        label: resolveCustomerDispatchWaitingLabel(order, escalationCtx),
        className: 'bg-amber-500 text-amber-950 border-amber-500',
      };
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

    function OrderStatusBadges({ order, escalationCtx = null }) {
      const st = resolveOrderDisplayStatus(order);
      const displayName = getDefaultFactoryDisplayName(order);
      const needsChoice = needsPreferredCustomerChoice(order);
      const isFullReject = isFullCompanyRejectionForCustomer(order, escalationCtx || {});
      const dispatchLabel = needsChoice
        ? CUSTOMER_ACTION_REQUIRED_LABEL
        : isFullReject
          ? CUSTOMER_ORDER_REJECTED_LABEL
          : resolveCustomerDispatchWaitingLabel(order, escalationCtx);
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
      if (st === 'rejected' || (st === 'pending' && isFullReject)) {
        return (
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex rounded-full bg-red-600 px-3 py-1 text-xs font-black text-white shadow-sm">
              {CUSTOMER_ORDER_REJECTED_LABEL}
            </span>
            <span className="rounded-full border border-red-200 bg-white px-3 py-1 text-xs font-black text-red-900 shadow-sm dark:border-red-800 dark:bg-red-950/40 dark:text-red-100">
              {CUSTOMER_FULL_REJECTION_MESSAGE}
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
        if (needsChoice) {
          return (
            <span className="inline-flex rounded-full border-2 border-amber-500 bg-amber-100 px-3 py-1 text-xs font-black text-amber-950 shadow-sm dark:bg-amber-950/40 dark:text-amber-100">
              {CUSTOMER_ACTION_REQUIRED_LABEL}
            </span>
          );
        }
        if (isFactoryHoldPending(order)) {
          const who = order.factoryPendingByName?.trim() || displayName;
          return (
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex rounded-full bg-amber-500 px-3 py-1 text-xs font-black text-amber-950 shadow-sm">
                {CUSTOMER_FACTORY_HOLD_LABEL}
              </span>
              <span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-black text-amber-950 shadow-sm">
                {who}
              </span>
            </div>
          );
        }
        return (
          <span className="inline-flex rounded-full border-2 border-amber-400 bg-amber-100 px-3 py-1 text-xs font-black text-amber-900 shadow-sm dark:bg-amber-950/40 dark:text-amber-100">
            {dispatchLabel}
          </span>
        );
      }
      if (st === 'pending_association') {
        return (
          <span className="inline-flex rounded-full border-2 border-violet-600 bg-violet-100 px-3 py-1 text-xs font-black text-violet-900 shadow-sm">
            組合承認待ち
          </span>
        );
      }
      return (
        <span className="inline-flex rounded-full border-2 border-amber-400 bg-amber-100 px-3 py-1 text-xs font-black text-amber-900 shadow-sm dark:bg-amber-950/40 dark:text-amber-100">
          {dispatchLabel}
        </span>
      );
    }

    function CustomerChoicePanel({
      order,
      mode = 'preferred',
      submitting = false,
      onEscalate,
      onReschedule,
      onCancel,
    }) {
      if (!order) return null;
      const title =
        mode === 'full_reject'
          ? '対応可能な工場が見つかりませんでした。次の対応をお選びください。'
          : 'ご指定の工場では予約が取れませんでした。以下からお選びください。';
      return (
        <div className="mx-2 my-3 space-y-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4 dark:border-amber-600 dark:bg-amber-950/40">
          <p className="text-sm font-bold text-amber-900 dark:text-amber-100">{title}</p>
          <div className="flex flex-col gap-2">
            {mode === 'preferred' ? (
              <button
                type="button"
                disabled={submitting}
                onClick={() => onEscalate?.(order)}
                className="w-full rounded-xl bg-emerald-500 px-4 py-3 text-sm font-black text-white hover:bg-emerald-600 active:bg-emerald-700 disabled:opacity-60"
              >
                1️⃣ 他の工場に依頼を広げる
              </button>
            ) : null}
            <button
              type="button"
              disabled={submitting}
              onClick={() => onReschedule?.(order)}
              className="w-full rounded-xl bg-indigo-500 px-4 py-3 text-sm font-black text-white hover:bg-indigo-600 active:bg-indigo-700 disabled:opacity-60"
            >
              {mode === 'preferred' ? '2️⃣' : '1️⃣'} 日時を変えて再発注
            </button>
            <button
              type="button"
              disabled={submitting}
              onClick={() => onCancel?.(order)}
              className="w-full rounded-xl border-2 border-slate-300 bg-white px-4 py-3 text-sm font-black text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 disabled:opacity-60"
            >
              {mode === 'preferred' ? '3️⃣' : '2️⃣'} この注文を取り下げる
            </button>
          </div>
        </div>
      );
    }

    function ConfirmedDetailsBlock({ order }) {
      const qty = order.confirmedQuantityM3 ?? order.quantityM3 ?? order.quantityCube;
      const mix = order.confirmedMixText ?? order.mixText;
      const qtyDisp = qty !== undefined && qty !== null && String(qty).trim() !== '' ? String(qty).trim() : '—';
      const mixDisp = mix && String(mix).trim() ? String(mix).trim() : '—';
      const isSnapshot = order.status === 'accepted' || order.factoryResponseStatus === 'accepted';
      return (
        <div className="rounded-xl border border-slate-200 bg-slate-50/95 p-4 dark:border-slate-600 dark:bg-slate-900/50">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-400">合意・確定内容（工場確認）</p>
          <dl className="mt-3 space-y-2 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-xs font-bold text-slate-400 dark:text-slate-400">数量（m³）</dt>
              <dd className="font-mono text-sm font-black text-slate-900 dark:text-slate-100">{qtyDisp}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-xs font-bold text-slate-400 dark:text-slate-400">配合</dt>
              <dd className="text-right font-mono text-sm font-bold text-slate-900 dark:text-slate-100">{mixDisp}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-xs font-bold text-slate-400 dark:text-slate-400">車両</dt>
              <dd className="text-sm font-bold text-slate-900 dark:text-slate-100">{order.vehicleLabel || '—'}</dd>
            </div>
          </dl>
          {isSnapshot ? (
            <p className="mt-3 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">受注確定時点の内容を表示しています</p>
          ) : (
            <p className="mt-3 text-[10px] text-slate-400 dark:text-slate-400">※受注後は工場側で確定した値が優先表示されます（未確定時は発注内容）</p>
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
            <p className="mt-1 text-[10px] font-bold text-red-700">5分経過。工場の受注・回答をお待ちください。</p>
          ) : (
            <p className="mt-1 text-[10px] font-bold text-amber-900/85">工場画面と同じ5:00からのカウントダウンです</p>
          )}
        </div>
      );
    }

    function CustomerChatScreen({
      order,
      messages,
      onBack,
      onSendMessage,
      onMarkChatRead,
      onPreferredFactoryChoice,
      escalationCtx = null,
      orderCustomer = null,
    }) {
      const [draft, setDraft] = useState('');
      const [choiceSubmitting, setChoiceSubmitting] = useState(false);
      const [choiceHiddenLocally, setChoiceHiddenLocally] = useState(false);
      const messagesListRef = useRef(null);
      const messagesEndRef = useRef(null);
      const list = Array.isArray(messages) ? messages : [];
      const orderId = order?.id;
      // 業者マスタの代表担当者名。未登録時は「担当者」（発注担当者名へ落とさない）
      const senderName = orderContactPersonName(order, '担当者', orderCustomer);
      const factoryName = getDefaultFactoryDisplayName(order);
      const showPreferredChoice = needsPreferredCustomerChoice(order) && !choiceHiddenLocally;
      const showFullRejectChoice =
        isFullCompanyRejectionForCustomer(order, escalationCtx || {}) && !choiceHiddenLocally;
      const showChoice = showPreferredChoice || showFullRejectChoice;
      useEffect(() => {
        setChoiceHiddenLocally(false);
      }, [orderId]);
      useEffect(() => {
        const el = messagesListRef.current;
        if (!el) return;
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      }, [list.length, messages, showChoice]);
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
      const handlePreferredFactoryChoice = useCallback(
        async (choice) => {
          if (!order?.id || choiceSubmitting) return;
          setChoiceSubmitting(true);
          try {
            if (typeof onPreferredFactoryChoice === 'function') {
              await onPreferredFactoryChoice(order, choice);
            }
            setChoiceHiddenLocally(true);
          } catch (e) {
            console.error('customer choice failed', e);
            window.alert('処理に失敗しました。通信状態を確認してください。');
          } finally {
            setChoiceSubmitting(false);
          }
        },
        [choiceSubmitting, onPreferredFactoryChoice, order],
      );
      if (!order) return null;
      return (
        <div className="fixed inset-0 z-[420] flex h-[100dvh] flex-col overflow-hidden bg-[#e5ddd5] dark:bg-slate-800">
          <header className="shrink-0 border-b border-slate-200 bg-white px-4 py-[max(0.75rem,env(safe-area-inset-top))] shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="mx-auto flex max-w-md items-center gap-3">
              <button
                type="button"
                onClick={onBack}
                className="shrink-0 rounded-full border-2 border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-slate-700 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
              >
                ← 戻る
              </button>
              <div className="min-w-0">
                <h2 className="truncate text-base font-black text-slate-900 dark:text-slate-100">{factoryName} との質疑応答</h2>
                <p className="mt-0.5 truncate text-xs font-bold text-slate-500 dark:text-slate-400">{resolveOrderSiteDisplayName(order) || '注文チャット'}</p>
              </div>
            </div>
          </header>
          <ul
            ref={messagesListRef}
            className="mx-auto w-full max-w-md flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-4"
            aria-live="polite"
          >
            {list.length === 0 ? (
              <li className="px-2 py-12 text-center text-sm font-bold text-slate-500 dark:text-slate-400">まだメッセージはありません</li>
            ) : (
              list.map((m) => {
                if (isSystemChatSender(m.from)) {
                  return (
                    <li key={m.id} className="flex justify-center">
                      <div className="max-w-[95%] rounded-xl border border-slate-300/80 bg-slate-100/95 px-3 py-2 text-center text-xs font-bold text-slate-700 shadow-sm dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100">
                        <p className="whitespace-pre-wrap break-words leading-snug">{m.body}</p>
                        <p className="mt-1 text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-300">
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
                          ? 'rounded-br-md border border-sky-200 bg-sky-100 text-slate-900 dark:border-sky-500 dark:bg-sky-800 dark:text-sky-50'
                          : 'rounded-bl-md bg-white text-slate-900 dark:bg-slate-700 dark:text-slate-100')
                      }
                    >
                      <p className="whitespace-pre-wrap break-words leading-snug">{m.body}</p>
                      <p className={'mt-1 text-[10px] font-bold ' + (mine ? 'text-slate-500 dark:text-sky-200/80' : 'text-slate-500 dark:text-slate-300')}>
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
            {showChoice ? (
              <li>
                <CustomerChoicePanel
                  order={order}
                  mode={showPreferredChoice ? 'preferred' : 'full_reject'}
                  submitting={choiceSubmitting}
                  onEscalate={() => void handlePreferredFactoryChoice('escalate')}
                  onReschedule={() => void handlePreferredFactoryChoice('reschedule')}
                  onCancel={() => void handlePreferredFactoryChoice('cancel')}
                />
              </li>
            ) : null}
            <li ref={messagesEndRef} aria-hidden="true" className="h-px" />
          </ul>
          <div className="shrink-0 border-t border-slate-200 bg-white px-3 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))] shadow-[0_-8px_24px_rgba(15,23,42,0.08)] dark:border-slate-700 dark:bg-slate-900">
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
              className="min-h-[48px] min-w-0 flex-1 rounded-full border border-slate-300 bg-white px-4 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-indigo-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100"
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

    /**
     * 業者ログイン向けの表示範囲切替。「自分の担当分のみ」（既定）⇄「会社全体を表示」。
     * 会社全体は閲覧のみで、書き込み操作は自分の担当分に限られる。
     */
    function CompanyScopeToggle({ value, onChange, memberCount = 0, className = '' }) {
      const btnBase =
        'min-h-[36px] whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-black transition active:scale-[0.99]';
      const activeCls = 'bg-indigo-700 text-white shadow-sm';
      const idleCls =
        'bg-white text-slate-600 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700';
      return (
        <div className={'flex flex-wrap items-center gap-2 ' + className}>
          <div
            className="inline-flex items-center gap-1 rounded-xl border-2 border-slate-200 bg-slate-50 p-1 dark:border-slate-600 dark:bg-slate-900/40"
            role="group"
            aria-label="表示範囲の切り替え"
          >
            <button
              type="button"
              aria-pressed={!value}
              onClick={() => onChange(false)}
              className={btnBase + ' ' + (!value ? activeCls : idleCls)}
            >
              自分の担当分のみ
            </button>
            <button
              type="button"
              aria-pressed={value}
              onClick={() => onChange(true)}
              className={btnBase + ' ' + (value ? activeCls : idleCls)}
            >
              会社全体を表示
            </button>
          </div>
          {value ? (
            <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
              同じ会社の担当者{memberCount > 0 ? `${memberCount}名` : ''}分を表示中（閲覧のみ・操作は自分の担当分だけ）
            </span>
          ) : null}
        </div>
      );
    }

    function OrderMasterContactLines({ order, project, customerById, className = '' }) {
      const siteLabel = formatProjectSiteContactsLabel(project, {
        formatPhone: formatPhoneNumberJP,
      });
      const tradingAgentLabel = formatTradingAgentContactLabel(order, customerById, {
        formatPhone: formatPhoneNumberJP,
      });
      if (!siteLabel && !tradingAgentLabel) return null;
      return (
        <>
          {siteLabel ? (
            <p className={className} title={`現場担当者: ${siteLabel}`}>
              現場担当者: {siteLabel}
            </p>
          ) : null}
          {tradingAgentLabel ? (
            <p className={className} title={`経由商社: ${tradingAgentLabel}`}>
              経由商社: {tradingAgentLabel}
            </p>
          ) : null}
        </>
      );
    }

    function InProgressOrderCard({
      order,
      project,
      hasUnreadChat,
      onOpenChat,
      onAllowStatusReset,
      guestToken = '',
      escalationCtx = null,
      onEscalatePreferred,
      onReschedulePreferred,
      onCancelPreferred,
      choiceSubmitting = false,
      onEditOrder = null,
      onRequestChange = null,
      readOnly = false,
      accountLabel = '',
      customerById = {},
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
      // readOnly は「会社全体を表示」で見えている同僚の注文。閲覧のみ許可し操作系は出さない。
      const showPreferredChoice = !readOnly && needsPreferredCustomerChoice(order);
      const showFullRejectChoice =
        !readOnly && isFullCompanyRejectionForCustomer(order, escalationCtx || {});
      const canEditPending =
        !readOnly && isPreAcceptOrderEditable(order) && typeof onEditOrder === 'function';
      const canRequestChange =
        !readOnly &&
        !canEditPending &&
        isAcceptedOrderChangeRequestable(order) &&
        typeof onRequestChange === 'function';
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

      const orderedByDisp = resolveSiteContactName(order);
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
            openMapEditorWindow(mapUrl);
          } catch {
            /* ignore */
          }
        },
        [mapUrl],
      );

      const actionBtnBase =
        'min-h-[40px] min-w-0 flex-1 whitespace-nowrap rounded-lg px-2 py-1.5 text-sm font-black shadow-sm transition active:scale-[0.99] sm:flex-none sm:px-3';

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
              {/* 第一セグメント：日時とステータス（日時は省略しない） */}
              <div className="min-w-0 md:col-span-2 2xl:min-w-max 2xl:flex-none 2xl:pr-5 2xl:border-r 2xl:border-gray-200 dark:2xl:border-slate-600">
                <p
                  className="whitespace-nowrap text-lg font-black text-gray-900 dark:text-gray-100 md:text-lg 2xl:text-xl"
                  title={timeSummary}
                >
                  {timeSummary}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <OrderStatusBadges order={order} escalationCtx={escalationCtx} />
                  <LocationPendingBadge order={order} />
                  <PhoneOrderBadge order={order} />
                  {accountLabel ? (
                    <span className="inline-flex rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-black text-slate-600 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-300">
                      {accountLabel}
                    </span>
                  ) : null}
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
                  <OrderMasterContactLines
                    order={order}
                    project={project}
                    customerById={customerById}
                    className="min-w-0 break-words text-sm font-bold text-slate-600 dark:text-slate-300"
                  />
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
                {order.is_factory_modified ? (
                  <span className="inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-black text-amber-900">
                    工場変更
                  </span>
                ) : null}
              </div>

              <div className="flex w-full min-w-0 items-stretch gap-2 sm:w-auto sm:items-center">
                {canEditPending ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e?.stopPropagation?.();
                      onEditOrder(order);
                    }}
                    className={
                      actionBtnBase +
                      ' border-2 border-indigo-500 bg-indigo-50 text-indigo-900 hover:bg-indigo-100'
                    }
                    title="注文内容を編集"
                  >
                    編集
                  </button>
                ) : canRequestChange ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e?.stopPropagation?.();
                      onRequestChange(order);
                    }}
                    className={
                      actionBtnBase +
                      ' border-2 border-amber-500 bg-amber-50 text-amber-950 hover:bg-amber-100'
                    }
                    title="工場へ変更依頼を送る"
                  >
                    変更依頼
                  </button>
                ) : null}
                {mapUrl ? (
                  <button
                    type="button"
                    onClick={handleOpenMap}
                    className={
                      actionBtnBase + ' bg-emerald-600 text-white hover:bg-emerald-700'
                    }
                    title="現場地図を開く"
                  >
                    地図
                  </button>
                ) : null}
                <div
                  className={
                    'relative min-w-0 flex-1 sm:flex-none ' + (hasUnreadChat ? 'mt-0 sm:mt-3' : '')
                  }
                >
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
                      actionBtnBase +
                      ' relative w-full text-white ' +
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

          {String(order.factory_consult_status || '').trim() === 'consulting' &&
          !['accepted', 'rejected', 'customer_cancelled', 'cancelled', 'completed'].includes(
            resolveOrderDisplayStatus(order),
          ) ? (
            <div className="border-t-2 border-blue-300 bg-blue-50 px-4 py-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-black text-blue-900">
                    🔵 {order.factoryConsultByName ? `${order.factoryConsultByName}が相談中です` : '工場が相談中です'}
                  </p>
                  <p className="mt-0.5 text-xs font-bold text-blue-800/90">
                    対応できる時間帯・数量について工場が相談しています。チャットでご確認ください。
                  </p>
                </div>
                {typeof onOpenChat === 'function' ? (
                  <button
                    type="button"
                    onClick={() => onOpenChat(order.id)}
                    className="shrink-0 rounded-lg border-2 border-blue-700 bg-blue-600 px-4 py-2 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.99]"
                  >
                    チャットを開く
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

          {showPreferredChoice || showFullRejectChoice ? (
            <CustomerChoicePanel
              order={order}
              mode={showPreferredChoice ? 'preferred' : 'full_reject'}
              submitting={choiceSubmitting}
              onEscalate={onEscalatePreferred}
              onReschedule={onReschedulePreferred}
              onCancel={onCancelPreferred}
            />
          ) : null}

          {order.factoryUnlockRequested ? (
            <div className="border-t border-indigo-100 bg-indigo-50 px-4 py-3 dark:border-indigo-800 dark:bg-indigo-950/40">
              <p className="text-xs font-black text-indigo-900 dark:text-indigo-100">工場からステータス変更のロック解除が依頼されています。</p>
              {!readOnly && typeof onAllowStatusReset === 'function' ? (
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

    function CustomerOrderCalendar({
      orders,
      selectedDate,
      onSelectDate,
      currentMonth,
      onMonthChange,
      escalationCtx = null,
      projectById = {},
      customerById = {},
      onEditOrder = null,
      onRequestChange = null,
    }) {
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
      // 割当物件（main_factory_id が設定された物件）に紐づく注文は現場名でグルーピングし、
      // スポット等はそのまま個別カード。いずれも実際の時刻値（分）で早い順に並べる。
      const selectedOrderEntries = useMemo(
        () => groupOrdersBySiteForAssignedProjects(selectedOrders, projectById),
        [selectedOrders, projectById],
      );
      const statusClass = (order) => {
        const meta = historyStatusMeta(order, escalationCtx);
        if (meta.key === 'completed') return 'bg-slate-500 text-white';
        if (meta.key === 'cancelled') return 'bg-red-500 text-white';
        if (meta.label === '受注') return 'bg-emerald-600 text-white';
        return 'bg-amber-500 text-amber-950';
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
                {selectedOrderEntries.map((entry) => {
                  const renderOrderBody = (order, { showSite }) => {
                    const party = orderPartyInfo(order);
                    const meta = historyStatusMeta(order, escalationCtx);
                    const project = resolveOrderLinkedProject(order, projectById);
                    const canEditPending =
                      isPreAcceptOrderEditable(order) && typeof onEditOrder === 'function';
                    const canRequestChange =
                      !canEditPending &&
                      isAcceptedOrderChangeRequestable(order) &&
                      typeof onRequestChange === 'function';
                    return (
                      <div
                        onDoubleClick={() => toggleStatusCard(order.id)}
                        onTouchEnd={() => handleCardTouchEnd(order.id)}
                        className="cursor-pointer"
                        title="ダブルタップで現在のステータスを表示"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className={'inline-flex rounded-full px-3 py-1 text-xs font-black ' + statusClass(order)}>{meta.label}</span>
                          {canEditPending ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onEditOrder(order);
                              }}
                              className="rounded-lg border-2 border-indigo-500 bg-indigo-50 px-2.5 py-1 text-[11px] font-black text-indigo-900 hover:bg-indigo-100"
                            >
                              編集
                            </button>
                          ) : canRequestChange ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRequestChange(order);
                              }}
                              className="rounded-lg border-2 border-amber-500 bg-amber-50 px-2.5 py-1 text-[11px] font-black text-amber-950 hover:bg-amber-100"
                            >
                              変更依頼
                            </button>
                          ) : null}
                        </div>
                        {showSite ? (
                          <p className="mt-2 text-sm font-black text-slate-900">{party.site || '現場未設定'}</p>
                        ) : null}
                        <p className="mt-1 text-xs font-bold text-slate-500">{order.timePointLabel || order.timeSlotLabel || '時刻未設定'} / {order.confirmedQuantityM3 ?? order.quantityM3 ?? '—'}m³ / {order.confirmedMixText || order.mixText || '配合未入力'}</p>
                        <OrderMasterContactLines
                          order={order}
                          project={project}
                          customerById={customerById}
                          className="mt-1 text-xs font-bold text-slate-600"
                        />
                        <p className="mt-2 text-[10px] font-black text-indigo-600">ダブルタップで現在のステータス</p>
                        <div
                          className="grid transition-[grid-template-rows] duration-300 ease-out"
                          style={{ gridTemplateRows: expandedStatusOrderId === order.id ? '1fr' : '0fr' }}
                        >
                          <div className="min-h-0 overflow-hidden">
                            <div className="mt-3 rounded-xl border border-indigo-100 bg-indigo-50 p-3 dark:border-indigo-800 dark:bg-indigo-950/40">
                              <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-300">現在のステータス</p>
                              <div className="mt-2">
                                <OrderStatusBadges order={order} escalationCtx={escalationCtx} />
                              </div>
                              <div className="mt-3">
                                <ConfirmedDetailsBlock order={order} />
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  };
                  if (entry.type === 'group') {
                    return (
                      <li
                        key={entry.key}
                        className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <p className="text-sm font-black text-slate-900">{entry.site}</p>
                          <span className="rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-black text-white">{entry.orders.length}便</span>
                        </div>
                        <ul className="mt-2 space-y-2">
                          {entry.orders.map((order) => (
                            <li
                              key={order.id}
                              className="rounded-lg border border-slate-100 bg-slate-50/60 p-2.5 transition-colors hover:border-indigo-300"
                            >
                              {renderOrderBody(order, { showSite: false })}
                            </li>
                          ))}
                        </ul>
                      </li>
                    );
                  }
                  const order = entry.order;
                  return (
                    <li
                      key={entry.key}
                      className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm transition-all hover:-translate-y-0.5 hover:border-indigo-300 hover:shadow-md active:scale-[0.99]"
                    >
                      {renderOrderBody(order, { showSite: true })}
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
      const [contractorDisplayMode, setContractorDisplayMode] = useState('prime');
      const [contractorDisplayCustomText, setContractorDisplayCustomText] = useState('');
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
      const [siteContactName, setSiteContactName] = useState('');
      const [siteContactCandidates, setSiteContactCandidates] = useState([]);
      const [hasTest, setHasTest] = useState(false);
      const [submitNotice, setSubmitNotice] = useState(null);
      const [submitError, setSubmitError] = useState('');
      const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
      const [isLoggedIn, setIsLoggedIn] = useState(() => {
        try {
          return Boolean(readAuthValue(DISPATCH_AUTH_SESSION_KEY)) && hasCustomerPanelSession();
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
      const [customerEditOrder, setCustomerEditOrder] = useState(null);
      const [customerEditMode, setCustomerEditMode] = useState('edit');
      const [changeRequestNotice, setChangeRequestNotice] = useState('');
      const [chatThreads, setChatThreads] = useState({});
      const [readChatKeys, setReadChatKeys] = useState({});
      const [unreadChatsByOrder, setUnreadChatsByOrder] = useState({});
      const [activeChatOrderId, setActiveChatOrderId] = useState('');
      const [adminNotice, setAdminNotice] = useState('');
      const [customerOrderTab, setCustomerOrderTab] = useState('active');
      const [newOrderMode, setNewOrderMode] = useState('');
      const [mixDesignMode, setMixDesignMode] = useState(''); // 'selectProject' | 'newProject' | ''
      const [mixDesignProjectId, setMixDesignProjectId] = useState('');
      const [mixDesignProjectSearch, setMixDesignProjectSearch] = useState('');
      const [mixDesignNewSiteName, setMixDesignNewSiteName] = useState('');
      const [mixDesignNewSiteAddress, setMixDesignNewSiteAddress] = useState('');
      const [mixDesignNewContractor, setMixDesignNewContractor] = useState('');
      const [mixDesignNewTrader, setMixDesignNewTrader] = useState('');
      const [mixDesignNewFactory, setMixDesignNewFactory] = useState('');
      const [showMixDesignForm, setShowMixDesignForm] = useState(false);

      useEffect(() => {
        const blocking = newOrderMode === 'form' || cartItems.length > 0;
        setAutoReloadBlocked(blocking);
        return () => setAutoReloadBlocked(false);
      }, [newOrderMode, cartItems.length]);
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
      // 業者ログインの表示範囲。false = 自分の担当分のみ（従来動作）、true = 会社全体
      const [companyScopeEnabled, setCompanyScopeEnabled] = useState(false);
      const [companyScopeOrders, setCompanyScopeOrders] = useState([]);
      const [collapsedInProgressGroups, setCollapsedInProgressGroups] = useState({});
      const [historyStatusFilter, setHistoryStatusFilter] = useState('all');
      const [historyCustomerFilter, setHistoryCustomerFilter] = useState('all');
      const [factories, setFactories] = useState([]);
      const [projects, setProjects] = useState([]);
      /** fetchProjects/fetchCustomers 完了後に true（未取得中の「物件なし」誤表示防止） */
      const [projectCatalogReady, setProjectCatalogReady] = useState(false);
      const [holidays, setHolidays] = useState([]);
      const [systemSettings, setSystemSettings] = useState({ start_time: '08:00:00', end_time: '16:00:00' });
      const [escalationStepsByFactoryId, setEscalationStepsByFactoryId] = useState({});
      const [nearPoolSize, setNearPoolSize] = useState(5);
      const [factorySmallVehicleInfo, setFactorySmallVehicleInfo] = useState({});
      const [monthlyVolumeByFactory, setMonthlyVolumeByFactory] = useState({});
      const [escalationTick, setEscalationTick] = useState(0);
      const [customers, setCustomers] = useState([]);
      const [agentOrganizations, setAgentOrganizations] = useState([]);
      const [currentCustomerId, setCurrentCustomerId] = useState(() => {
        try {
          return readAuthValue(DISPATCH_AUTH_SESSION_KEY) || readAuthValue(DISPATCH_CUSTOMER_SESSION_KEY) || '';
        } catch {
          return '';
        }
      });
      const [orderKind, setOrderKind] = useState('spot');
      const [selectedProjectId, setSelectedProjectId] = useState('');
      const [customerSearchText, setCustomerSearchText] = useState('');
      const [contractorCustomerId, setContractorCustomerId] = useState('');
      const [contractorSearchText, setContractorSearchText] = useState('');
      const [tradingAgentCustomerId, setTradingAgentCustomerId] = useState('');
      const [tradingAgentSearchText, setTradingAgentSearchText] = useState('');
      const [linkedContractorIds, setLinkedContractorIds] = useState([]);
      const [contractorUsageCounts, setContractorUsageCounts] = useState({});
      const [tradingAgentUsageCounts, setTradingAgentUsageCounts] = useState({});
      const [spotSiteNameSuggestions, setSpotSiteNameSuggestions] = useState([]);
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
      const spotFieldDefaultsKeyRef = useRef('');

      const loadAgentOrganizations = useCallback(async () => {
        try {
          const rows = await db.fetchOrganizations();
          setAgentOrganizations((rows || []).filter((o) => o && o.type === 'agent'));
        } catch (err) {
          console.warn('[DispatchApp] 商社マスタ取得に失敗', err);
          setAgentOrganizations([]);
        }
      }, []);

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
      const selectedProjectSiteContacts = useMemo(
        () =>
          (Array.isArray(selectedProject?.site_contacts) ? selectedProject.site_contacts : [])
            .map((contact) => ({
              name: String(contact?.name ?? '').trim(),
              phone: String(contact?.phone ?? '').trim(),
            }))
            .filter((contact) => contact.name || contact.phone),
        [selectedProject],
      );
      // ゲスト現場URLのみ物件JSONの担当者を使う。通常の物件/スポット注文は
      // 会社メンバー候補（siteContactCandidates）を共有する。
      const usesProjectSiteContacts =
        isGuestSiteOrder && selectedProjectSiteContacts.length > 0;
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
          const trader = resolveProjectTradingCompanyName(project);
          if (trader) setTraderName(trader);
          if (project.name) setSiteName(sanitizeSiteNameValue(project.name));
          const mainFactoryId = resolveProjectMainFactoryId(project);
          if (mainFactoryId) setPreferredFactoryId(mainFactoryId);
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
        () =>
          (customers || []).find(
            (c) => c && String(c.id) === String(currentCustomerId || ''),
          ) || null,
        [customers, currentCustomerId],
      );
      const currentCustomerRole = useMemo(
        () => currentCustomer?.role ?? 'contractor',
        [currentCustomer],
      );
      const isAgentOrCooperative = useMemo(
        () => currentCustomerRole === 'agent' || currentCustomerRole === 'cooperative',
        [currentCustomerRole],
      );
      const canImportSchedule = Boolean(currentCustomer?.can_import_schedule);
      const canRequestMixDesign = Boolean(currentCustomer?.can_request_mix_design);
      const visibleCustomerOrderTabs = useMemo(() => {
        let tabs =
          isGuestSiteOrder || currentCustomerRole !== 'contractor'
            ? CUSTOMER_ORDER_TABS.filter(([id]) => id !== 'siteContacts')
            : CUSTOMER_ORDER_TABS;
        if (canImportSchedule && !isGuestSiteOrder) {
          tabs = [...tabs, SCHEDULE_IMPORT_TAB];
        }
        if (canRequestMixDesign && !isGuestSiteOrder) {
          tabs = [...tabs, MIX_DESIGN_HISTORY_TAB];
        }
        return tabs;
      }, [isGuestSiteOrder, currentCustomerRole, canImportSchedule, canRequestMixDesign]);

      // 現場名サジェスト / 現場担当者サジェスト共通の実質業者ID
      const effectiveContractorCustomerId = useMemo(
        () =>
          resolveEffectiveContractorCustomerId({
            isAgentOrCooperative,
            contractorCustomerId,
            currentCustomerId,
          }),
        [isAgentOrCooperative, contractorCustomerId, currentCustomerId],
      );

      const formatTradingAgentLabel = useCallback((customer) => {
        const company = String(customer?.company_name || customer?.name || '').trim();
        const manager = String(customer?.manager_name || '').trim();
        if (company && manager) return `${company}（${manager}）`;
        if (company) return `${company}（代表窓口）`;
        return manager || '';
      }, []);

      // 絞り込みキー: 組合ログイン時は選択した経由商社、商社ログイン時は自分自身
      const contractorLinkAgentId = useMemo(() => {
        if (currentCustomerRole === 'agent') return String(currentCustomer?.id || '').trim();
        if (currentCustomerRole === 'cooperative') return String(tradingAgentCustomerId || '').trim();
        return '';
      }, [currentCustomerRole, currentCustomer, tradingAgentCustomerId]);

      useEffect(() => {
        let cancelled = false;
        const agentId = contractorLinkAgentId;
        if (!agentId) {
          setLinkedContractorIds([]);
          return undefined;
        }
        void (async () => {
          try {
            const links = await db.fetchAgentContractorLinksByAgentIds([agentId]);
            if (cancelled) return;
            const ids = [
              ...new Set(
                (links || [])
                  .map((l) => String(l.contractor_customer_id || '').trim())
                  .filter(Boolean),
              ),
            ];
            setLinkedContractorIds(ids);
          } catch (err) {
            console.warn('[DispatchApp] agent_contractor_links fetch failed', err);
            if (!cancelled) setLinkedContractorIds([]);
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [contractorLinkAgentId]);

      // 代理発注サジェスト用: 自分が過去に選んだ相手の利用頻度（失敗時は従来の並び順にフォールバック）
      useEffect(() => {
        let cancelled = false;
        const cid = String(currentCustomerId || '').trim();
        if (!cid || isGuestSiteOrder || !isAgentOrCooperative) {
          setContractorUsageCounts({});
          setTradingAgentUsageCounts({});
          return undefined;
        }
        void (async () => {
          try {
            const [contractorCounts, tradingAgentCounts] = await Promise.all([
              db.fetchSelectionFrequency({ customerId: cid, column: 'contractor_customer_id' }),
              currentCustomerRole === 'cooperative'
                ? db.fetchSelectionFrequency({ customerId: cid, column: 'trading_agent_customer_id' })
                : Promise.resolve({}),
            ]);
            if (cancelled) return;
            setContractorUsageCounts(contractorCounts || {});
            setTradingAgentUsageCounts(tradingAgentCounts || {});
          } catch (err) {
            console.warn('[DispatchApp] selection frequency fetch failed', err);
            if (!cancelled) {
              setContractorUsageCounts({});
              setTradingAgentUsageCounts({});
            }
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [currentCustomerId, currentCustomerRole, isAgentOrCooperative, isGuestSiteOrder]);

      // リンクで絞り込み → 会社名単位で代表1件に集約 → 利用頻度順
      const proxyContractorItems = useMemo(() => {
        const all = (customers || []).filter((c) => (c.role ?? 'contractor') === 'contractor');
        let filtered = all;
        if (contractorLinkAgentId && linkedContractorIds.length > 0) {
          const allowed = new Set(linkedContractorIds.map(String));
          filtered = all.filter((c) => allowed.has(String(c.id)));
        }
        const deduped = dedupeCustomersByCompany(filtered);
        const sorted = sortCustomersByUsageFrequency(deduped, contractorUsageCounts);

        // 診断: 「発注先業者」UI は items={proxyContractorItems} を参照。重複の正体を特定する。
        if (typeof console !== 'undefined') {
          const groupByRawName = (rows) => {
            const map = new Map();
            for (const c of rows) {
              const raw = c?.company_name;
              const key = JSON.stringify(raw);
              if (!map.has(key)) map.set(key, []);
              map.get(key).push(c);
            }
            return map;
          };
          const rawDupes = [...groupByRawName(filtered).entries()].filter(([, rows]) => rows.length > 1);
          const afterDupes = [...groupByRawName(sorted).entries()].filter(([, rows]) => rows.length > 1);
          console.log('[proxyContractorItems] source=proxyContractorItems (発注先業者 MasterSuggestInput)', {
            filteredCount: filtered.length,
            dedupedCount: sorted.length,
            items: sorted.map((c) => ({
              id: c.id,
              company_name: c.company_name,
              name: c.name,
              manager_name: c.manager_name,
              created_at: c.created_at,
              company_name_json: JSON.stringify(c.company_name),
            })),
          });
          if (rawDupes.length > 0) {
            for (const [nameJson, rows] of rawDupes) {
              const a = rows[0];
              const b = rows[1];
              console.log('[proxyContractorItems] pre-dedupe duplicate company_name pair', {
                nameJson,
                stringifyEqual:
                  JSON.stringify(a?.company_name) === JSON.stringify(b?.company_name),
                a: { id: a.id, company_name: a.company_name, created_at: a.created_at },
                b: { id: b.id, company_name: b.company_name, created_at: b.created_at },
                charCodesA: [...String(a?.company_name ?? '')].map((ch) => ch.charCodeAt(0)),
                charCodesB: [...String(b?.company_name ?? '')].map((ch) => ch.charCodeAt(0)),
              });
            }
          }
          if (afterDupes.length > 0) {
            console.warn(
              '[proxyContractorItems] STILL duplicated after dedupe (trim key missed these)',
              afterDupes.map(([nameJson, rows]) => ({
                nameJson,
                ids: rows.map((r) => r.id),
                stringifyEqual:
                  rows.length >= 2 &&
                  JSON.stringify(rows[0]?.company_name) === JSON.stringify(rows[1]?.company_name),
              })),
            );
          }
        }

        return sorted;
      }, [customers, contractorLinkAgentId, linkedContractorIds, contractorUsageCounts]);

      // 業者ログイン時「業者（会社）」候補（会社単位で1件・contractor のみ）
      const companyCustomerItems = useMemo(
        () =>
          dedupeCustomersByCompany(
            (customers || []).filter((c) => (c.role ?? 'contractor') === 'contractor'),
          ),
        [customers],
      );
      const tradingAgentItems = useMemo(() => {
        const agents = (customers || []).filter((c) => (c.role ?? 'contractor') === 'agent');
        return sortCustomersByUsageFrequency(agents, tradingAgentUsageCounts);
      }, [customers, tradingAgentUsageCounts]);

      const tradingAgentFilterHint = useMemo(() => {
        if (!contractorLinkAgentId || linkedContractorIds.length === 0) return '';
        if (currentCustomerRole === 'agent') {
          return '（自社の取引業者に絞り込み中）';
        }
        const agent = (customers || []).find(
          (c) => String(c.id) === String(tradingAgentCustomerId || ''),
        );
        const name = formatTradingAgentLabel(agent) || '選択中の商社';
        return `（${name}の取引業者に絞り込み中）`;
      }, [
        currentCustomerRole,
        contractorLinkAgentId,
        linkedContractorIds,
        customers,
        tradingAgentCustomerId,
        formatTradingAgentLabel,
      ]);

      useEffect(() => {
        if (!contractorLinkAgentId) return;
        if (linkedContractorIds.length === 0) return;
        const cid = String(contractorCustomerId || '').trim();
        if (!cid) return;
        if (linkedContractorIds.includes(cid)) return;
        setContractorCustomerId('');
        setContractorSearchText('');
        setSelectedProjectId('');
        lastAutofillProjectIdRef.current = '';
        applyProjectSelection(null);
      }, [
        contractorLinkAgentId,
        linkedContractorIds,
        contractorCustomerId,
        applyProjectSelection,
      ]);

      const applySpotOrderFieldDefaults = useCallback(() => {
        if (isGuestSiteOrder) return;
        // currentCustomer 未解決時はデフォルト role='contractor' 扱いにしない（組合名が業者名に入る事故を防ぐ）
        if (!currentCustomer?.id) return;
        const role = String(currentCustomer.role || '').trim();
        const companyName = String(currentCustomer.company_name || currentCustomer.name || '').trim();
        if (role === 'contractor') {
          if (companyName) setContractorName(companyName);
          setTraderName('');
          return;
        }
        if (role === 'agent') {
          // 商社ログイン: 自社名を商社欄へ入れるのは通常運用
          if (companyName) setTraderName(companyName);
          setContractorName('');
          return;
        }
        if (role === 'cooperative') {
          // 組合名は商社ではない。商社欄は空（経由する場合のみ手入力）
          setTraderName('');
          setContractorName('');
          return;
        }
        // 未知ロール: 業者名は自動入力しない
        setTraderName('');
        setContractorName('');
      }, [isGuestSiteOrder, currentCustomer]);
      useEffect(() => {
        if (isGuestSiteOrder) return;
        if (orderKind !== 'spot') {
          // 物件へ切替えたらキーを捨て、再入場時にロール別初期値を入れ直す
          spotFieldDefaultsKeyRef.current = '';
          return;
        }
        if (!currentCustomerId || !currentCustomer?.id) return;
        const role = String(currentCustomer.role || '').trim() || 'unknown';
        const key = `${currentCustomerId}:${role}`;
        if (spotFieldDefaultsKeyRef.current === key) return;
        spotFieldDefaultsKeyRef.current = key;
        applySpotOrderFieldDefaults();
      }, [
        orderKind,
        currentCustomerId,
        currentCustomer?.id,
        currentCustomer?.role,
        isGuestSiteOrder,
        applySpotOrderFieldDefaults,
      ]);

      const contractorCustomer = useMemo(
        () =>
          isAgentOrCooperative && contractorCustomerId
            ? (customers || []).find((c) => String(c.id) === contractorCustomerId) ?? null
            : null,
        [isAgentOrCooperative, contractorCustomerId, customers],
      );
      const orderPlacerName = useMemo(
        () => String(currentCustomer?.manager_name ?? '').trim(),
        [currentCustomer],
      );

      const resetSpotContractorSiteContact = useCallback(() => {
        setSiteContactName('');
        setSitePhone('');
      }, []);
      const sessionCustomerPhone = useMemo(() => {
        if (!isLoggedIn) return '';
        try {
          return String(readAuthValue(CUSTOMER_PANEL_PHONE_KEY) || '').trim();
        } catch {
          return '';
        }
      }, [isLoggedIn]);
      const currentCustomerPhone = String(currentCustomer?.phone_number || sessionCustomerPhone || '').trim();
      const currentCustomerDisplayName = String(currentCustomer?.company_name || currentCustomer?.name || '').trim() || 'カスタマー';
      const handleTraderNameChange = useCallback(
        (next) => {
          const value = String(next ?? '');
          setTraderName(value);
          const ownOrg = isCooperativeOwnOrgTraderName(
            currentCustomerRole,
            value,
            currentCustomer?.company_name || currentCustomer?.name,
          );
          setSubmitError(ownOrg ? COOPERATIVE_OWN_ORG_TRADER_ERROR : '');
        },
        [currentCustomerRole, currentCustomer],
      );
      /** ログイン中アカウントの担当者表示（空欄＝代表窓口） */
      const currentLoginManagerLabel = String(currentCustomer?.manager_name ?? '').trim() || '代表';
      // 代理発注時の商社スナップショット（UI非表示でも order_data.traderName / 表示用に使う）
      const proxyTraderName = useMemo(() => {
        if (!isAgentOrCooperative) return '';
        return String(currentCustomer?.company_name || currentCustomer?.name || '').trim();
      }, [isAgentOrCooperative, currentCustomer]);
      const effectiveTraderName = useMemo(() => {
        const typed = String(traderName || '').trim();
        if (currentCustomerRole === 'agent') return typed || proxyTraderName;
        return typed;
      }, [currentCustomerRole, traderName, proxyTraderName]);

      // 商社ログイン時のみ、空の商社欄を自社名で埋める（組合名は商社欄に入れない）
      useEffect(() => {
        if (isGuestSiteOrder || currentCustomerRole !== 'agent') return;
        if (!proxyTraderName) return;
        setTraderName((cur) => (String(cur || '').trim() ? cur : proxyTraderName));
      }, [isGuestSiteOrder, currentCustomerRole, proxyTraderName]);
      const isOrderForCurrentCustomer = useCallback(
        (order) => {
          if (!order) return false;
          const cid = String(currentCustomerId || '').trim();
          if (cid) {
            if (String(order.customer_id || order.customerId || '').trim() === cid) return true;
            const orderContractorId = String(
              order.contractor_customer_id || order.contractorCustomerId || '',
            ).trim();
            // 代理発注は customer_id が組合・商社、contractor_customer_id が打設業者
            if (orderContractorId && orderContractorId === cid) return true;
            if (currentCustomerRole === 'contractor' && currentCustomer && orderContractorId) {
              const companyIds = new Set(
                contractorAccountsInSameCompany(customers, currentCustomer)
                  .map((c) => String(c?.id || '').trim())
                  .filter(Boolean),
              );
              if (companyIds.has(orderContractorId)) return true;
            }
          }
          const phoneDigits = currentCustomerPhone.replace(/\D/g, '');
          if (!phoneDigits) return false;
          const orderPhoneDigits = String(order.phone_number ?? order.customerPhone ?? order.sitePhone ?? order.phone ?? '').replace(/\D/g, '');
          return Boolean(orderPhoneDigits && orderPhoneDigits === phoneDigits);
        },
        [currentCustomerId, currentCustomerPhone, currentCustomerRole, currentCustomer, customers],
      );
      const isRelevantDashboardOrder = useCallback(
        (order) => {
          if (isGuestSiteOrder && guestSiteOrderCtx) return isOrderForGuestSite(order, guestSiteOrderCtx);
          return isOrderForCurrentCustomer(order);
        },
        [isGuestSiteOrder, guestSiteOrderCtx, isOrderForCurrentCustomer],
      );
      const projectContractorLabels = useMemo(() => {
        if (!selectedProject || isGuestSiteOrder) {
          return { primeContractorName: '', subContractorName: '' };
        }
        return resolveProjectContractorLabels(selectedProject, customers, {
          contractorCustomer: isAgentOrCooperative ? contractorCustomer : null,
        });
      }, [selectedProject, customers, isGuestSiteOrder, isAgentOrCooperative, contractorCustomer]);

      const effectiveContractorName = useMemo(() => {
        if (orderKind === 'project' && !isGuestSiteOrder && selectedProject) {
          return resolveContractorDisplayName(
            contractorDisplayMode,
            contractorDisplayCustomText,
            projectContractorLabels,
          );
        }
        return String(contractorName || '').trim();
      }, [
        orderKind,
        isGuestSiteOrder,
        selectedProject,
        contractorDisplayMode,
        contractorDisplayCustomText,
        projectContractorLabels,
        contractorName,
      ]);

      useEffect(() => {
        if (orderKind !== 'project' || isGuestSiteOrder) return;
        setContractorDisplayMode('prime');
        setContractorDisplayCustomText('');
      }, [selectedProjectId, orderKind, isGuestSiteOrder]);

      // ── 会社単位表示（業者ログインのみ） ─────────────────────────────
      // 同じ会社（organization_id / 会社名）の担当者アカウント。
      // 会社にアカウントが1件しかなければ切り替える意味がないので切替UIも出さない。
      const contractorCompanyAccounts = useMemo(() => {
        if (isGuestSiteOrder || isAgentOrCooperative) return [];
        if (currentCustomerRole !== 'contractor' || !currentCustomer?.id) return [];
        return contractorAccountsInSameCompany(customers, currentCustomer);
      }, [
        isGuestSiteOrder,
        isAgentOrCooperative,
        currentCustomerRole,
        currentCustomer,
        customers,
      ]);
      const canUseCompanyScope = contractorCompanyAccounts.length > 1;
      const companyScopeActive = canUseCompanyScope && companyScopeEnabled;
      const companyColleagueIdSet = useMemo(() => {
        const me = String(currentCustomerId || '').trim();
        return new Set(
          contractorCompanyAccounts
            .map((c) => String(c?.id || '').trim())
            .filter((id) => id && id !== me),
        );
      }, [contractorCompanyAccounts, currentCustomerId]);
      const companyColleagueIdSetRef = useRef(companyColleagueIdSet);
      companyColleagueIdSetRef.current = companyColleagueIdSet;
      // ログインし直したら必ず「自分の担当分のみ」に戻す
      useEffect(() => {
        setCompanyScopeEnabled(false);
      }, [currentCustomerId]);

      const targetProjectCustomer = isAgentOrCooperative
        ? contractorCustomer
        : currentCustomer;
      // 物件の customer_id は会社の代表アカウント側に付くことが多い。
      // 新規発注の物件候補は「会社全体を表示」トグルに依存せず、同社アカウント全体でマッチする
      // （トグルは進行中注文の閲覧範囲専用。個人アカウントだけだと初期表示が空になる）。
      const projectMatchCustomers = useMemo(() => {
        if (!targetProjectCustomer) return [];
        return contractorAccountsInSameCompany(customers, targetProjectCustomer);
      }, [targetProjectCustomer, customers]);
      const projectMatchByProjectId = useMemo(() => {
        const map = new Map();
        if (projectMatchCustomers.length === 0) return map;
        for (const project of projects || []) {
          const pid = String(project?.id || '').trim();
          if (!pid) continue;
          const match = projectMatchForCustomers(project, projectMatchCustomers);
          if (match) map.set(pid, match);
        }
        return map;
      }, [projects, projectMatchCustomers]);
      const getProjectMatch = useCallback(
        (project) => {
          const pid = String(project?.id || '').trim();
          return (pid ? projectMatchByProjectId.get(pid) : null) ?? null;
        },
        [projectMatchByProjectId],
      );
      const filteredProjects = useMemo(() => {
        const roleOrder = { main: 0, sub: 1 };
        return (projects || [])
          .filter((project) => projectMatchByProjectId.has(String(project?.id || '').trim()))
          .sort(
            (a, b) =>
              roleOrder[projectMatchByProjectId.get(String(a.id).trim()).role] -
              roleOrder[projectMatchByProjectId.get(String(b.id).trim()).role],
          );
      }, [projects, projectMatchByProjectId]);
      /** マスタ未取得時は「物件なし」と誤表示しない */
      const projectMastersReady = Boolean(
        projectCatalogReady &&
          String(currentCustomerId || '').trim() &&
          (customers || []).some((c) => c?.id),
      );
      const projectSelectionWarnings = useMemo(
        () => (selectedProject ? getProjectDataGapWarnings(selectedProject) : []),
        [selectedProject],
      );
      const hasCurrentCustomer = Boolean(String(currentCustomerId || '').trim());

      useEffect(() => {
        if (isGuestSiteOrder) {
          setSiteContactCandidates([]);
          return;
        }
        if (orderKind !== 'project' && orderKind !== 'spot') {
          setSiteContactCandidates([]);
          return;
        }
        const cid = effectiveContractorCustomerId;
        if (!cid) {
          setSiteContactCandidates([]);
          return;
        }
        let cancelled = false;
        void db
          .fetchCompanyMemberSuggestions(cid)
          .then((rows) => {
            if (cancelled) return;
            setSiteContactCandidates(Array.isArray(rows) ? rows : []);
          })
          .catch((err) => {
            console.warn('【SiteContactSuggest】現場担当者候補の取得に失敗 → 自由入力のみで続行', err);
            if (!cancelled) setSiteContactCandidates([]);
          });
        return () => {
          cancelled = true;
        };
      }, [orderKind, effectiveContractorCustomerId, isGuestSiteOrder]);

      // スポット現場名サジェスト: 実質業者ID単位
      const spotSiteHistoryContractorId = useMemo(() => {
        if (orderKind !== 'spot' || isGuestSiteOrder) return '';
        return effectiveContractorCustomerId;
      }, [orderKind, isGuestSiteOrder, effectiveContractorCustomerId]);

      useEffect(() => {
        let cancelled = false;
        const cid = spotSiteHistoryContractorId;
        if (!cid || orderKind !== 'spot' || isGuestSiteOrder) {
          setSpotSiteNameSuggestions([]);
          return undefined;
        }
        void (async () => {
          try {
            const rows = await db.fetchSpotSiteNameSuggestions({
              contractorRefCustomerId: cid,
              limit: 8,
            });
            if (!cancelled) setSpotSiteNameSuggestions(Array.isArray(rows) ? rows : []);
          } catch (err) {
            console.warn('【SpotSiteSuggest】現場名候補の取得に失敗 → 自由入力のみで続行', err);
            if (!cancelled) setSpotSiteNameSuggestions([]);
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [spotSiteHistoryContractorId, orderKind, isGuestSiteOrder]);

      useEffect(() => {
        if (!isAgentOrCooperative) return;
        if (orderKind !== 'project' && orderKind !== 'spot') return;
        setSiteContactName('');
        setSitePhone('');
      }, [contractorCustomerId, isAgentOrCooperative, orderKind]);

      useEffect(() => {
        if (typeof console === 'undefined' || typeof console.log !== 'function') return;
        console.log('[ProjectDropdown] all projects:', (projects || []).length);
        console.log('[ProjectDropdown] targetCustomerId:', String(targetProjectCustomer?.id || '').trim());
        console.log('[ProjectDropdown] filtered:', filteredProjects.length);
        console.log(
          '[ProjectDropdown] filter reasons:',
          (projects || []).map((p) => ({
            id: p?.id,
            name: p?.name,
            match_role: getProjectMatch(p)?.role ?? null,
            matched_account_id: getProjectMatch(p)?.customer?.id ?? null,
            has_main: Boolean(resolveProjectMainFactoryId(p)),
            has_coords: Number.isFinite(Number(p?.lat)) && Number.isFinite(Number(p?.lng)),
          })),
        );
      }, [projects, targetProjectCustomer, getProjectMatch, filteredProjects]);

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
            const idSet = new Set();
            for (const o of newOrders || []) {
              const fid = db.resolveScheduleCheckFactoryId(o);
              if (fid) idSet.add(fid);
            }
            const schedulesByFactoryId = idSet.size
              ? await db.fetchSchedulesForFactories([...idSet])
              : {};
            const persisted = await db.persistScheduleAutoRejections({
              schedulesByFactoryId,
              orders: newOrders,
              chatThreads: newThreads,
              factoryNameById,
              defaultFactorySiteName: DISPATCH_DEFAULT_FACTORY_SITE_NAME,
              defaultFactorySiteId: DISPATCH_DEFAULT_FACTORY_SITE_ID,
            });
            if (persisted.changed) {
              newOrders = Array.isArray(persisted.orders) ? persisted.orders : newOrders;
              newThreads =
                persisted.chatThreads && typeof persisted.chatThreads === 'object'
                  ? persisted.chatThreads
                  : newThreads;
            }
            newOrders = newOrders.filter((o) => o && o.status !== 'deleted');
            let displayOrders =
              isGuestSiteOrder || String(currentCustomerId || '').trim()
                ? newOrders.filter((o) => o && isRelevantDashboardOrder(o))
                : newOrders;

            const prevOrders = prevOrdersRef.current;
            if (prevOrders) {
              const prevOrderMapForAdmin = new Map(
                (Array.isArray(prevOrders) ? prevOrders : []).filter(Boolean).map((o) => [o.id, o]),
              );
              if (displayOrders.some((o) => o?.is_admin_modified && !prevOrderMapForAdmin.get(o.id)?.is_admin_modified)) {
                showDashboardNotice('⚠️ 管理者によって注文内容が変更されました。内容を確認してください。', { playSound });
                const modifiedOrders = displayOrders.filter(
                  (o) => o?.is_admin_modified && !prevOrderMapForAdmin.get(o.id)?.is_admin_modified,
                );
                const modifiedIds = new Set(modifiedOrders.map((o) => o.id).filter(Boolean));
                void Promise.all(modifiedOrders.map((o) => db.clearOrderAdminModifiedFlag(o.id))).catch((e) =>
                  console.warn('[DispatchApp] is_admin_modified クリア失敗', e),
                );
                const clearAdminFlag = (o) =>
                  o?.id && modifiedIds.has(o.id) ? { ...o, is_admin_modified: false } : o;
                newOrders = newOrders.map(clearAdminFlag);
                displayOrders = displayOrders.map(clearAdminFlag);
              } else if (
                displayOrders.some((o) => o?.is_factory_modified && !prevOrderMapForAdmin.get(o.id)?.is_factory_modified)
              ) {
                showDashboardNotice('⚠️ 工場により注文内容が変更されました。内容を確認してください。', { playSound });
              } else {
                const detected = detectCustomerOrderNotifications(prevOrders, displayOrders, isRelevantDashboardOrder);
                if (!Array.isArray(detected.acceptedSiteLabels)) detected.acceptedSiteLabels = [];
                if (!Array.isArray(detected.rejectedSiteLabels)) detected.rejectedSiteLabels = [];
                if (realtimePayload) {
                  const fromPayload = analyzeCustomerOrderRealtimePayload(
                    realtimePayload,
                    isRelevantDashboardOrder,
                    db.normalizeOrderRow,
                  );
                  if (fromPayload.factoryAccepted) detected.factoryAccepted = true;
                  if (fromPayload.factoryRejected) detected.factoryRejected = true;
                  if (fromPayload.factoryReassigned) detected.factoryReassigned = true;
                  if (Array.isArray(fromPayload.acceptedSiteLabels)) {
                    detected.acceptedSiteLabels.push(...fromPayload.acceptedSiteLabels.filter(Boolean));
                  }
                  if (Array.isArray(fromPayload.rejectedSiteLabels)) {
                    detected.rejectedSiteLabels.push(...fromPayload.rejectedSiteLabels.filter(Boolean));
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
                } else if (detected.factoryRejected) {
                  const sites = Array.isArray(detected.rejectedSiteLabels)
                    ? detected.rejectedSiteLabels.filter(Boolean)
                    : [];
                  const site = sites[0] || '';
                  showDashboardNotice(customerFullRejectionDashboardNotice(site), { playSound });
                } else if (detected.factoryReassigned) {
                  showDashboardNotice('手配先工場が変更・調整されました', { playSound });
                }
              }
            }

            const prevThreads = prevChatThreadsRef.current;
            if (prevThreads && !realtimePayload && !options?.skipChatSound) {
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
                  const soundKey = chatSoundKeyFromOrderMessages(audibleIds[0], newThreads[audibleIds[0]]);
                  if (shouldPlayChatSoundOnce(soundKey)) {
                    playChatNotificationSound();
                  }
                }
              }
            }

            const mergedReadKeys = { ...readChatKeysRef.current };
            for (const order of displayOrders) {
              if (!order?.id) continue;
              const persisted = String(order.customer_chat_read_key ?? order.customerChatReadKey ?? '').trim();
              if (persisted && !mergedReadKeys[order.id]) {
                mergedReadKeys[order.id] = persisted;
              }
            }
            if (Object.keys(mergedReadKeys).length !== Object.keys(readChatKeysRef.current).length ||
              Object.entries(mergedReadKeys).some(([id, key]) => readChatKeysRef.current[id] !== key)) {
              readChatKeysRef.current = mergedReadKeys;
              setReadChatKeys(mergedReadKeys);
            }

            const viewingChatOrderId = String(activeChatOrderIdRef.current || '');
            const unreadMap = {};
            for (const order of displayOrders) {
              if (!order?.id || !isOrderInProgressView(order, today)) continue;
              if (viewingChatOrderId && String(order.id) === viewingChatOrderId) continue;
              if (isUnreadForDispatch(newThreads[order.id], readChatKeysRef.current[order.id])) {
                unreadMap[order.id] = true;
              }
            }
            setUnreadChatsByOrder(unreadMap);

            prevOrdersRef.current = displayOrders;
            prevChatThreadsRef.current = newThreads;
            // 「会社全体を表示」用の同僚分。通知判定（displayOrders）には混ぜない。
            const colleagueIds = companyColleagueIdSetRef.current;
            setCompanyScopeOrders(
              colleagueIds && colleagueIds.size > 0
                ? newOrders.filter(
                    (o) =>
                      o && colleagueIds.has(String(o.customer_id ?? o.customerId ?? '').trim()),
                  )
                : [],
            );
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

      // 会社全体に切り替えた直後は同僚分（companyScopeOrders）が未取得のため、その場で再取得する
      useEffect(() => {
        if (!companyScopeActive) return;
        if (typeof refreshDashboardRef.current !== 'function') return;
        void refreshDashboardRef.current({ skipChatSound: true });
      }, [companyScopeActive]);

      useEffect(() => {
        if (isGuestSiteOrder) return undefined;
        let cancelled = false;
        (async () => {
          try {
            if (!isLoggedIn || !hasCustomerPanelSession()) {
              const adminSettingRows = await db.fetchDispatchOperationalSettings();
              if (cancelled) return;
              setAdminSettings(adminSettingRows || { admin_name: '', phone_number: '' });
              setProjectCatalogReady(false);
              return;
            }
            setProjectCatalogReady(false);
            const [rows, projs, customerRows, adminSettingRows, holidayRows, opSettings, escalationSteps, orgRows, poolSize, smallVehicleInfo, monthlyVolumes] = await Promise.all([
              db.fetchFactories(),
              db.fetchProjects(),
              db.fetchCustomers(),
              db.fetchDispatchOperationalSettings(),
              db.fetchHolidays().catch(() => []),
              db.fetchSystemSettings().catch(() => ({ start_time: '08:00:00', end_time: '16:00:00' })),
              db.fetchEscalationSteps().catch(() => ({})),
              db.fetchOrganizations().catch(() => []),
              db.fetchNearPoolSize().catch((e) => {
                console.warn('【Escalation Debug】near_pool_size 取得失敗 → デフォルト5で続行', e);
                return 5;
              }),
              db.fetchFactorySmallVehicleInfo().catch((e) => {
                console.warn('【Escalation Debug】小型車情報取得失敗 → 空マップで続行', e);
                return {};
              }),
              db.fetchMonthlyVolumeByFactory().catch((e) => {
                console.warn('【Escalation Debug】出荷量取得失敗 → 空マップで続行（中立扱いになります）', e);
                return {};
              }),
            ]);
            if (cancelled) return;
            setFactories(rows);
            setProjects(projs);
            setCustomers(customerRows);
            setAgentOrganizations((orgRows || []).filter((o) => o && o.type === 'agent'));
            setAdminSettings(adminSettingRows || { admin_name: '', phone_number: '' });
            setHolidays(Array.isArray(holidayRows) ? holidayRows : []);
            setSystemSettings(opSettings || { start_time: '08:00:00', end_time: '16:00:00' });
            setEscalationStepsByFactoryId(escalationSteps && typeof escalationSteps === 'object' ? escalationSteps : {});
            setNearPoolSize(poolSize);
            setFactorySmallVehicleInfo(smallVehicleInfo || {});
            setMonthlyVolumeByFactory(monthlyVolumes || {});
            setCurrentCustomerId((cur) => {
              const curId = String(cur || '').trim();
              if (curId && customerRows.some((c) => c && String(c.id) === curId)) return cur;
              return '';
            });
            if (isLoggedIn) {
              const authId = (() => {
                try {
                  return String(readAuthValue(DISPATCH_AUTH_SESSION_KEY) || '').trim();
                } catch {
                  return '';
                }
              })();
              if (
                !authId ||
                !hasCustomerPanelSession() ||
                !customerRows.some((c) => c && String(c.id) === authId)
              ) {
                setIsLoggedIn(false);
                setCurrentCustomerId('');
                clearCustomerPanelSession();
                try {
                  removeAuthValue(DISPATCH_AUTH_SESSION_KEY);
                  removeAuthValue(DISPATCH_CUSTOMER_SESSION_KEY);
                } catch {
                  /* ignore */
                }
              }
            }
            setPreferredFactoryId((cur) => {
              if (cur && rows.some((r) => r && r.id === cur)) return cur;
              return '';
            });
            setProjectCatalogReady(true);
          } catch (e) {
            console.error('物件取得エラー', e);
            if (!cancelled) setProjectCatalogReady(true);
            window.alert(formatSupabaseError(e, '物件一覧の取得に失敗しました'));
          }
        })();
        return () => {
          cancelled = true;
        };
      }, [isGuestSiteOrder, isLoggedIn]);

      useEffect(() => {
        try {
          writeAuthValue(DISPATCH_CUSTOMER_SESSION_KEY, currentCustomerId || '');
        } catch {
          /* ignore */
        }
        setSelectedProjectId((cur) => {
          if (!cur) return cur;
          const p = (projects || []).find((x) => x && x.id === cur);
          const valid = Boolean(getProjectMatch(p));
          if (!valid) {
            lastAutofillProjectIdRef.current = '';
          }
          return valid ? cur : '';
        });
      }, [currentCustomerId, getProjectMatch, projects]);

      useEffect(() => {
        consumePushRedirectForApp('customer');
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
                setPreferredFactoryId(resolveGuestPreferredFactoryId(primaryProject));
                lastAutofillProjectIdRef.current = String(primaryProject.id);
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
        if (!getProjectMatch(p)) return;
        applyProjectSelection(p);
      }, [orderKind, selectedProjectId, projects, getProjectMatch, applyProjectSelection]);

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
            void registerOneSignalUser(buildCustomerOneSignalExternalId(guestCustomerId), {
              role: 'customer',
              customer_id: String(guestCustomerId),
            }).catch(() => {});
            return;
          }
          if (!isLoggedIn || !currentCustomerId || cancelled) return;
          void registerOneSignalUser(buildCustomerOneSignalExternalId(currentCustomerId), {
            role: 'customer',
            customer_id: String(currentCustomerId),
          }).catch(() => {});
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

      const markChatRead = useCallback((orderId, messages) => {
        const id = String(orderId || '').trim();
        if (!id) return;

        clearAppBadge();
        setUnreadChatsByOrder((prev) => {
          if (!prev[id]) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });

        const latest = latestChatMessage(messages);
        const from = String(latest?.from || '');
        if (!latest || (from !== 'factory' && from !== 'admin' && from !== 'system')) return;

        const key = chatMessageReadKey(latest);
        if (!key) return;

        const nextKeys = { ...(readChatKeysRef.current || {}), [id]: key };
        readChatKeysRef.current = nextKeys;
        setReadChatKeys(nextKeys);

        void db.markCustomerChatRead(id, key).catch((err) => {
          logDispatchError('[DispatchApp] チャット既読の保存に失敗', err, { orderId: id });
        });
      }, []);

      const handleOpenChat = useCallback(
        (orderId) => {
          const id = String(orderId || '').trim();
          if (!id) return;
          activeChatOrderIdRef.current = id;
          setActiveChatOrderId(id);
          markChatRead(id, chatThreads[id]);
        },
        [chatThreads, markChatRead],
      );

      const applyCustomerPushRedirect = useCallback(
        (payload) => {
          const redirectOrderId = String(payload?.orderId || '').trim();
          if (!redirectOrderId) return;
          const targetOrder = (dashboardOrders || []).find(
            (order) => String(order?.id || '') === redirectOrderId,
          );
          if (!targetOrder) return;
          const inActive = isOrderInProgressView(targetOrder, today);
          setCustomerOrderTab(inActive ? 'active' : 'history');
          if (payload.view === 'chat') {
            handleOpenChat(redirectOrderId);
          }
          clearPushRedirect();
        },
        [dashboardOrders, handleOpenChat, today],
      );

      useEffect(() => {
        return setupPushRedirectListener('customer', (payload) => {
          if (!isLoggedIn) return;
          applyCustomerPushRedirect(payload);
        });
      }, [applyCustomerPushRedirect, isLoggedIn]);

      useEffect(() => {
        if (!isLoggedIn) return;
        const payload = consumePushRedirectForApp('customer');
        if (!payload) return;
        applyCustomerPushRedirect(payload);
      }, [applyCustomerPushRedirect, dashboardOrders, isLoggedIn]);

      const projectById = useMemo(() => {
        const map = Object.fromEntries(
          (projects || []).filter((p) => p?.id).map((p) => [String(p.id), p]),
        );
        for (const order of [...(dashboardOrders || []), ...(companyScopeOrders || [])]) {
          const linked = order?.linkedProject;
          const pid = String(linked?.id || '').trim();
          if (pid && !map[pid] && linked) map[pid] = linked;
        }
        return map;
      }, [projects, dashboardOrders, companyScopeOrders]);
      const customerById = useMemo(() => {
        const map = Object.fromEntries(
          (customers || []).filter((c) => c?.id).map((c) => [String(c.id), c]),
        );
        for (const order of [...(dashboardOrders || []), ...(companyScopeOrders || [])]) {
          const agent = order?.tradingAgentCustomer;
          const aid = String(agent?.id || '').trim();
          if (aid && !map[aid] && agent) map[aid] = agent;
        }
        return map;
      }, [customers, dashboardOrders, companyScopeOrders]);

      const handleOpenCustomerOrderEdit = useCallback((order) => {
        if (!isPreAcceptOrderEditable(order)) return;
        setCustomerEditMode('edit');
        setCustomerEditOrder(order);
      }, []);

      const handleOpenCustomerChangeRequest = useCallback((order) => {
        if (!isAcceptedOrderChangeRequestable(order)) return;
        setCustomerEditMode('request');
        setCustomerEditOrder(order);
      }, []);

      const handleCustomerOrderFullSave = useCallback(
        async (orderId, patch, meta) => {
          if (meta?.mode === 'request') {
            const message = String(meta?.message || '').trim();
            const structuredPatch =
              meta?.structuredPatch && typeof meta.structuredPatch === 'object'
                ? meta.structuredPatch
                : {};
            if (!message || Object.keys(structuredPatch).length === 0) return false;
            const updated = await db.submitOrderChangeRequest(orderId, message, structuredPatch);
            setDashboardOrders((prev) =>
              (Array.isArray(prev) ? prev : []).map((o) =>
                o?.id === orderId
                  ? {
                      ...o,
                      ...(updated || {}),
                      has_pending_change_request: true,
                      pending_change_request_patch:
                        updated?.pending_change_request_patch ?? structuredPatch,
                    }
                  : o,
              ),
            );
            setCustomerEditOrder(null);
            setCustomerEditMode('edit');
            setChangeRequestNotice('変更依頼を送信しました。工場からの返信をお待ちください');
            window.setTimeout(() => setChangeRequestNotice(''), 5000);
            await refreshDashboard({ skipChatSound: true });
            return true;
          }
          const updated = await db.customerUpdateOrder(orderId, patch);
          setDashboardOrders((prev) =>
            (Array.isArray(prev) ? prev : []).map((o) =>
              o?.id === orderId ? { ...o, ...updated } : o,
            ),
          );
          setCustomerEditOrder(null);
          setCustomerEditMode('edit');
          await refreshDashboard({ skipChatSound: true });
          return true;
        },
        [refreshDashboard],
      );
      // 進行中一覧の対象。会社全体表示のときだけ同僚分を足す（重複IDは除外）。
      const inProgressSourceOrders = useMemo(() => {
        const base = Array.isArray(dashboardOrders) ? dashboardOrders : [];
        if (!companyScopeActive) return base;
        const seen = new Set(base.map((o) => String(o?.id || '')));
        const extra = (Array.isArray(companyScopeOrders) ? companyScopeOrders : []).filter(
          (o) => o?.id && !seen.has(String(o.id)),
        );
        return extra.length > 0 ? [...base, ...extra] : base;
      }, [dashboardOrders, companyScopeOrders, companyScopeActive]);
      const scopedInProgressOrders = useMemo(
        () => (inProgressSourceOrders || []).filter((o) => o && isOrderInProgressView(o, today)),
        [inProgressSourceOrders, today],
      );
      const filteredInProgressOrders = useMemo(
        () =>
          (scopedInProgressOrders || [])
            .filter((o) => orderMatchesMasterSearch(o, inProgressSearchQuery))
            .slice(0, companyScopeActive ? 45 : 15),
        [scopedInProgressOrders, inProgressSearchQuery, companyScopeActive],
      );
      // 進行中一覧も割当物件は現場名でグルーピング（検索フィルタ適用後の一覧をグループ化する）
      const inProgressOrderEntries = useMemo(
        () =>
          groupOrdersBySiteForAssignedProjects(filteredInProgressOrders, projectById, {
            sortValue: resolveOrderDateTimeSortValue,
          }),
        [filteredInProgressOrders, projectById],
      );

      useEffect(() => {
        setCollapsedInProgressGroups(readInProgressGroupCollapsedMap(currentCustomerId));
      }, [currentCustomerId]);

      const toggleInProgressGroupCollapsed = useCallback(
        (groupStorageId) => {
          const id = String(groupStorageId || '').trim();
          if (!id) return;
          setCollapsedInProgressGroups((prev) => {
            const next = { ...(prev && typeof prev === 'object' ? prev : {}) };
            if (next[id]) delete next[id];
            else next[id] = true;
            writeInProgressGroupCollapsedMap(currentCustomerId, next);
            return next;
          });
        },
        [currentCustomerId],
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

      const customerEscalationCtx = useMemo(
        () =>
          buildEscalationContext(
            dashboardOrders,
            factories,
            projects,
            {
              ...(adminSettings || {}),
              start_time: systemSettings?.start_time,
              end_time: systemSettings?.end_time,
              near_pool_size: nearPoolSize,
            },
            holidays,
            new Date(),
            escalationStepsByFactoryId,
            customers,
            factorySmallVehicleInfo,
            monthlyVolumeByFactory,
          ),
        [
          dashboardOrders,
          factories,
          projects,
          adminSettings,
          systemSettings,
          holidays,
          escalationStepsByFactoryId,
          escalationTick,
          customers,
          nearPoolSize,
          factorySmallVehicleInfo,
          monthlyVolumeByFactory,
        ],
      );

      useEffect(() => {
        const id = window.setInterval(() => setEscalationTick((t) => t + 1), 60_000);
        return () => window.clearInterval(id);
      }, []);

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
            statusMeta: historyStatusMeta(o, customerEscalationCtx),
            deliveryDate: getOrderDeliveryDateISO(o),
            createdAt: o.createdAt || '',
          };
        });
      }, [dashboardOrders, today, customerEscalationCtx]);
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
              if (audible) {
                const soundKey = chatSoundKeyFromRealtimePayload(payload);
                if (shouldPlayChatSoundOnce(soundKey)) {
                  playChatNotificationSound();
                }
              }
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
            await refreshDashboardRef.current({ playSound: false, skipChatSound: true }, null);
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
              '【マスター】ステータス再設定を許可しました。工場は再度 受注／回答／保留 を選択できます。',
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
            // 以降の fetch がパネル用 RLS を使えるよう、先にセッションヘッダーを確立する
            setCustomerPanelSession(phone, password);
            setCurrentCustomerId(customer.id);
            const role = customer.role ?? 'contractor';
            if (role === 'agent' || role === 'cooperative') {
              try {
                const allCustomers = await db.fetchCustomers();
                const contractors = allCustomers.filter(
                  (c) => (c.role ?? 'contractor') === 'contractor',
                );
                setCustomers([customer, ...contractors]);
              } catch (fetchErr) {
                console.warn('業者一覧の取得に失敗しました', fetchErr);
                setCustomers([customer]);
              }
            } else {
              setCustomers([customer]);
            }
            setIsLoggedIn(true);

            void loadAgentOrganizations();

            const loginRole = customer?.role;
            const companyName = String(customer?.company_name || '').trim();
            if (loginRole === 'agent' && companyName) {
              setTraderName(companyName);
              setContractorName('');
            } else if (loginRole === 'cooperative') {
              setTraderName('');
              setContractorName('');
            } else if (loginRole === 'contractor' && companyName) {
              setContractorName(companyName);
            }

            setLoginPhone('');
            setLoginPassword('');
            setLoginError('');
            try {
              writeAuthValue(DISPATCH_AUTH_SESSION_KEY, customer.id);
              writeAuthValue(DISPATCH_CUSTOMER_SESSION_KEY, customer.id);
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

            void registerOneSignalUser(buildCustomerOneSignalExternalId(customer.id), {
              role: 'customer',
              customer_id: String(customer.id || ''),
            }).catch(() => {});
          } catch (postLoginErr) {
            logDispatchError('[DispatchApp] ログイン後の画面初期化に失敗', postLoginErr, {
              customerId: customer.id,
            });
            setLoginError('ログイン後のデータ読み込みに失敗しました。再読み込みしてください。');
          } finally {
            setLoginLoading(false);
          }
        },
        [loginPhone, loginPassword, loadAgentOrganizations],
      );

      const handleCustomerLogout = useCallback(() => {
        void unregisterOneSignalUser().catch(() => {});
        setIsLoggedIn(false);
        setCurrentCustomerId('');
        setContractorCustomerId('');
        setContractorSearchText('');
        setTradingAgentCustomerId('');
        setTradingAgentSearchText('');
        setLinkedContractorIds([]);
        setCustomers([]);
        setSelectedProjectId('');
        setPreferredFactoryId('');
        setLoginPassword('');
        setLoginError('');
        setTraderName('');
        setContractorName('');
        clearCustomerPanelSession();
        try {
          removeAuthValue(DISPATCH_AUTH_SESSION_KEY);
          removeAuthValue(DISPATCH_CUSTOMER_SESSION_KEY);
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
          setSiteContactName(defaults.siteContactName || defaults.orderedBy || '');
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
            const mainId = resolveProjectMainFactoryId(proj);
            if (mainId) setPreferredFactoryId(mainId);
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
        [applyProjectSelection, currentCustomer, orderPlacerName, projects, today],
      );

      const handlePreferredFactoryChoice = useCallback(
        async (order, choice) => {
          if (!order?.id) return;

          if (choice === 'escalate') {
            if (!window.confirm('他の工場に依頼を広げますか？')) return;
            await db.approveOrderEscalation(order.id);
            await appendOrderChatMessage(order.id, 'system', '【他工場への依頼を開始しました】');
            const approvedAt = new Date().toISOString();
            setDashboardOrders((prev) =>
              (Array.isArray(prev) ? prev : []).map((o) =>
                o?.id === order.id
                  ? { ...o, escalation_approved_at: approvedAt, escalationApprovedAt: approvedAt }
                  : o,
              ),
            );
            await refreshDashboard({ skipChatSound: true });
            return;
          }

          if (choice === 'reschedule') {
            if (!window.confirm('日時を変えて再発注しますか？元の注文は取り下げられます。')) return;
            await db.markOrderCustomerCancelled(order.id);
            await appendOrderChatMessage(order.id, 'customer', '【日時変更再発注】元の注文を取り下げ、別日時で再発注します。');
            setDashboardOrders((prev) =>
              (Array.isArray(prev) ? prev : []).map((o) =>
                o?.id === order.id ? { ...o, status: 'customer_cancelled' } : o,
              ),
            );
            activeChatOrderIdRef.current = '';
            setActiveChatOrderId('');
            applyHistoryOrderToNewForm(order);
            return;
          }

          if (choice === 'cancel') {
            if (!window.confirm('この注文を取り下げますか？')) return;
            await db.markOrderCustomerCancelled(order.id);
            await appendOrderChatMessage(order.id, 'customer', '【取り下げ】注文を取り下げました。');
            setDashboardOrders((prev) =>
              (Array.isArray(prev) ? prev : []).map((o) =>
                o?.id === order.id ? { ...o, status: 'customer_cancelled' } : o,
              ),
            );
            await refreshDashboard({ skipChatSound: true });
          }
        },
        [applyHistoryOrderToNewForm, refreshDashboard],
      );

      const [choiceSubmitting, setChoiceSubmitting] = useState(false);
      const runCustomerChoice = useCallback(
        async (order, choice) => {
          if (choiceSubmitting) return;
          setChoiceSubmitting(true);
          try {
            await handlePreferredFactoryChoice(order, choice);
          } catch (e) {
            console.error('customer choice failed', e);
            window.alert('処理に失敗しました。通信状態を確認してください。');
          } finally {
            setChoiceSubmitting(false);
          }
        },
        [choiceSubmitting, handlePreferredFactoryChoice],
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
            ordered_by: orderPlacerName || defaults.orderPlacerName || '',
            orderedBy: defaults.siteContactName || defaults.orderedBy || '',
            order_placer_name: orderPlacerName || defaults.orderPlacerName || '',
            orderPlacerName: orderPlacerName || defaults.orderPlacerName || '',
            site_contact_name: defaults.siteContactName || defaults.orderedBy || '',
            siteContactName: defaults.siteContactName || defaults.orderedBy || '',
            has_test: defaults.hasTest,
            delivery_lat: defaults.isSpot ? item.delivery_lat ?? item.deliveryLat ?? null : null,
            delivery_lng: defaults.isSpot ? item.delivery_lng ?? item.deliveryLng ?? null : null,
          };
          setIsSubmittingOrder(true);
          setSubmitError('');
          try {
            // 第一希望工場がある場合、選択日時がその工場の満車枠でないか事前チェックする。
            // 満車のまま作成するとサーバー側自動拒否で行き止まりになるため、ここで止める。
            if (prefFid) {
              try {
                const { data: scheduleRow, error: scheduleErr } = await supabase
                  .from('schedules')
                  .select('blocks')
                  .eq('factory_site_id', prefFid)
                  .eq('date', repeatPreferredDate)
                  .maybeSingle();
                if (scheduleErr) throw scheduleErr;
                // 行が無い＝未設定＝全枠 available。存在する場合のみ満車判定する。
                if (scheduleRow) {
                  const dayBlocks = normalizeDayBlockSchedule(scheduleRow.blocks);
                  const rejectReason = computeScheduleAutoRejectReason(repeatOrder, dayBlocks);
                  if (rejectReason) {
                    const factoryName =
                      (Array.isArray(factories) ? factories : []).find(
                        (f) => String(f?.id) === String(prefFid),
                      )?.name || '選択した工場';
                    const bid = getScheduleBlockIdForMinutes(
                      Number.isFinite(timeMinutes) ? timeMinutes : NaN,
                    );
                    const windowLabel =
                      SCHEDULE_BLOCKS.find((b) => b.id === bid)?.label || slotLabel || '選択した時間帯';
                    const vj = getOrderVehicleScheduleKey(repeatOrder) === 'small' ? '小型' : '大型';
                    const message = `選択した工場（${factoryName}）はこの日時（${windowLabel}・${vj}）は満車です。日時を変更するか、フォームから別の工場を選んで発注してください。`;
                    setSubmitError(message);
                    window.alert(message);
                    return;
                  }
                }
              } catch (scheduleCheckErr) {
                // 取得失敗時は誤って正常発注を止めない（サーバー側自動拒否が保険になる）
                console.warn(
                  '[confirmRepeatOrder] schedule pre-check failed; allowing submit',
                  scheduleCheckErr,
                );
              }
            }

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
        [
          currentCustomer,
          currentCustomerId,
          factories,
          orderPlacerName,
          repeatPreferredDate,
          repeatTimeSlot,
          refreshDashboard,
        ],
      );

      const orderFormContext = useMemo(
        () => ({
          isGuestSiteOrder,
          isAgentOrCooperative,
          orderKind,
          currentCustomerId,
          currentCustomerRole,
          contractorCustomerId: isAgentOrCooperative ? contractorCustomerId : currentCustomerId,
          agentOrganizationId: isAgentOrCooperative ? (currentCustomer?.organization_id ?? null) : null,
          tradingAgentCustomerId: currentCustomerRole === 'cooperative' ? tradingAgentCustomerId : null,
          tradingAgentSearchText: currentCustomerRole === 'cooperative' ? tradingAgentSearchText : '',
          currentCustomer,
          selectedProject,
          selectedProjectId,
          filteredProjects,
          projects,
          preferredFactoryId,
          factories,
          traderName: effectiveTraderName,
          contractorName: effectiveContractorName,
          siteName,
          siteAddress,
          deliveryArea,
          siteAddressDetail,
          allowedDeliveryAreas,
          sitePhone,
          orderPlacerName,
          siteContactName,
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
          isAgentOrCooperative,
          orderKind,
          currentCustomerId,
          currentCustomerRole,
          contractorCustomerId,
          tradingAgentCustomerId,
          tradingAgentSearchText,
          currentCustomer,
          selectedProject,
          selectedProjectId,
          filteredProjects,
          projects,
          preferredFactoryId,
          factories,
          effectiveTraderName,
          effectiveContractorName,
          siteName,
          siteAddress,
          deliveryArea,
          siteAddressDetail,
          allowedDeliveryAreas,
          sitePhone,
          orderPlacerName,
          siteContactName,
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
        spotFieldDefaultsKeyRef.current = '';
        setTraderName('');
        setContractorName('');
        setContractorDisplayMode('prime');
        setContractorDisplayCustomText('');
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
        setSiteContactName('');
        setHasTest(false);
        setVehicleType('large');
        setTradingAgentCustomerId('');
        setTradingAgentSearchText('');
        setLinkedContractorIds([]);
        if (isAgentOrCooperative) {
          // agent/cooperativeは業者選択を保持する（発注ごとにリセットしない）
          // 必要ならコメントアウトを外す:
          // setContractorCustomerId('');
          // setContractorSearchText('');
        }
        if (orderKind === 'spot') {
          applySpotOrderFieldDefaults();
        }
      }, [today, isAgentOrCooperative, orderKind, applySpotOrderFieldDefaults]);

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
            const coopTraderError = missing.find((m) => m === COOPERATIVE_OWN_ORG_TRADER_ERROR);
            const message = coopTraderError || `次の項目を入力してください: ${missing.join('、')}`;
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

      /** カート行の order から validateCartLineForm 用のコンテキストを組み立てる（一括確定時と同一ロジック） */
      const buildCartLineContext = useCallback(
        (order) => ({
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
          traderName: String(order.traderName ?? order.trading_company_name ?? '').trim(),
          isLocationPending: Boolean(order.is_location_pending ?? order.isLocationPending),
        }),
        [orderFormContext],
      );

      const validateCartItemOrder = useCallback(
        (order) => {
          if (!order) return ['注文データ'];
          const date = String(order.preferredDate ?? order.scheduleMatchDate ?? '').trim();
          return validateCartLineForm(buildCartLineContext(order), date, {
            today,
            isPastPreferredDateTime,
            isGuestSiteOrder,
          });
        },
        [buildCartLineContext, today, isGuestSiteOrder],
      );

      const handleEditCartItem = useCallback((cartId, patch) => {
        if (!cartId || !patch) return;
        setCartItems((prev) =>
          prev.map((item) =>
            item.cartId === cartId ? { ...item, order: { ...(item.order || {}), ...patch } } : item,
          ),
        );
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
          const missing = validateCartLineForm(buildCartLineContext(order), date, {
            today,
            isPastPreferredDateTime,
            isGuestSiteOrder,
          });
          if (missing.length) {
            const coopTraderError = missing.find((m) => m === COOPERATIVE_OWN_ORG_TRADER_ERROR);
            const message =
              coopTraderError || `発注できません。次の項目を確認してください: ${missing.join('、')}`;
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
        buildCartLineContext,
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
          traderName: resolveProjectTradingCompanyName(p),
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
                      <p className="mt-0.5 break-words text-xs font-bold leading-snug text-slate-500">
                        担当: {currentLoginManagerLabel}
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
                    {visibleCustomerOrderTabs.map(([id, label, icon]) => {
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

            <main id="dispatch-dashboard" className="flex-1 min-w-0 flex flex-col p-4 md:p-6 lg:p-8 pb-[calc(6rem+env(safe-area-inset-bottom,0px))] lg:pb-8">
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
                        <div className="mt-2 min-w-0">
                          <p className="break-words text-sm font-black leading-snug text-slate-900">
                            {currentCustomer?.company_name || currentCustomer?.name || '認証済み業者'}
                          </p>
                          <p className="mt-0.5 break-words text-xs font-bold leading-snug text-slate-500">
                            担当: {currentLoginManagerLabel}
                          </p>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col md:items-end gap-2">
                    {!isGuestSiteOrder && customerOrderTab === 'active' && canUseCompanyScope ? (
                      <CompanyScopeToggle
                        value={companyScopeEnabled}
                        onChange={setCompanyScopeEnabled}
                        memberCount={contractorCompanyAccounts.length}
                        className="md:justify-end"
                      />
                    ) : null}
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
                <div className={`mt-6 flex flex-col gap-4 lg:grid lg:gap-6 ${canRequestMixDesign ? 'lg:grid-cols-2' : 'lg:grid-cols-3'}`}>
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
                        applySpotOrderFieldDefaults();
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
                    ...(canRequestMixDesign
                      ? [
                          {
                            title: '📋 配合計画書の作成依頼',
                            body: '工場へ配合計画書の作成を依頼します。物件を選択するか、新規に現場情報を入力して依頼できます。',
                            onClick: () => {
                              setMixDesignMode('');
                              setMixDesignProjectId('');
                              setMixDesignProjectSearch('');
                              setMixDesignNewSiteName('');
                              setMixDesignNewSiteAddress('');
                              setMixDesignNewContractor('');
                              setMixDesignNewTrader('');
                              setMixDesignNewFactory('');
                              setShowMixDesignForm(false);
                              setNewOrderMode('mixDesign');
                            },
                          },
                        ]
                      : []),
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
              {customerOrderTab === 'new' && newOrderMode === 'mixDesign' ? (
              <section className="w-full rounded-2xl border border-slate-200 bg-white p-5 shadow-md sm:p-6 lg:p-8">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-black uppercase tracking-wider text-indigo-700">配合計画書</p>
                    <h2 className="mt-1 text-2xl font-black text-slate-900">作成依頼</h2>
                    <p className="mt-2 text-sm font-bold leading-relaxed text-slate-500">
                      物件を選ぶか、新規に現場情報を入力して配合計画書の作成を依頼します。
                    </p>
                  </div>
                  <button type="button" onClick={() => setNewOrderMode('')} className="rounded-xl border-2 border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">
                    メニューへ戻る
                  </button>
                </div>

                {!showMixDesignForm ? (
                  <>
                    <div className="mt-4 flex gap-2">
                      {[
                        { id: 'selectProject', label: '登録物件を選ぶ' },
                        { id: 'newProject', label: '新規に入力する' },
                      ].map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => {
                            setMixDesignMode(opt.id);
                            if (opt.id === 'newProject') setShowMixDesignForm(true);
                          }}
                          className={
                            'min-h-[44px] flex-1 rounded-xl border-2 px-3 py-2 text-sm font-black transition ' +
                            (mixDesignMode === opt.id
                              ? 'border-indigo-600 bg-indigo-600 text-white'
                              : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300')
                          }
                        >
                          {opt.label}
                        </button>
                      ))}
                    </div>

                    {mixDesignMode === 'selectProject' ? (
                      <div className="mt-4 flex flex-col gap-3">
                        <label className="text-xs font-black text-slate-600">
                          物件を検索
                          <input
                            type="text"
                            value={mixDesignProjectSearch}
                            onChange={(e) => setMixDesignProjectSearch(e.target.value)}
                            placeholder="物件名で検索…"
                            className="mt-1 min-h-[48px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300"
                          />
                        </label>
                        <div className="max-h-[300px] overflow-y-auto rounded-xl border border-slate-200">
                          {(projects || [])
                            .filter((p) => {
                              if (!p?.id) return false;
                              if (!mixDesignProjectSearch.trim()) return true;
                              const q = mixDesignProjectSearch.trim().toLowerCase();
                              return (
                                String(p.name || '').toLowerCase().includes(q) ||
                                String(p.site_address || '').toLowerCase().includes(q) ||
                                String(p.contractor || '').toLowerCase().includes(q)
                              );
                            })
                            .slice(0, 50)
                            .map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => setMixDesignProjectId(String(p.id))}
                                className={
                                  'flex w-full items-start gap-2 border-b border-slate-100 px-3 py-2.5 text-left text-sm transition last:border-b-0 ' +
                                  (String(mixDesignProjectId) === String(p.id)
                                    ? 'bg-indigo-50 font-black text-indigo-900'
                                    : 'bg-white font-bold text-slate-700 hover:bg-slate-50')
                                }
                              >
                                <span className="min-w-0 flex-1">
                                  <span className="block break-words">{p.name || '（名称なし）'}</span>
                                  {p.site_address ? (
                                    <span className="mt-0.5 block text-xs font-medium text-slate-500">{p.site_address}</span>
                                  ) : null}
                                </span>
                                {String(mixDesignProjectId) === String(p.id) ? (
                                  <span className="shrink-0 text-indigo-600">✓</span>
                                ) : null}
                              </button>
                            ))}
                          {!(projects || []).filter((p) => p?.id).length ? (
                            <p className="px-3 py-4 text-center text-xs font-bold text-slate-400">登録物件がありません</p>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          disabled={!mixDesignProjectId}
                          onClick={() => setShowMixDesignForm(true)}
                          className="mt-2 min-h-[48px] rounded-xl border-2 border-indigo-600 bg-indigo-600 px-4 text-sm font-black text-white disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300"
                        >
                          この物件で依頼フォームへ進む
                        </button>
                      </div>
                    ) : null}

                    {mixDesignMode === 'newProject' && !showMixDesignForm ? (
                      <p className="mt-4 text-center text-xs font-bold text-slate-400">読み込み中…</p>
                    ) : null}
                  </>
                ) : null}

                {showMixDesignForm ? (
                  <MixDesignRequestModal
                    open
                    order={
                      mixDesignMode === 'selectProject'
                        ? {
                            project_id: mixDesignProjectId,
                            customer_id: currentCustomerId,
                            vehicleType: 'large',
                          }
                        : {
                            project_id: null,
                            customer_id: currentCustomerId,
                            vehicleType: 'large',
                          }
                    }
                    project={
                      mixDesignMode === 'selectProject'
                        ? (projects || []).find((p) => String(p?.id) === String(mixDesignProjectId)) || null
                        : null
                    }
                    factories={factories}
                    agentOrganizations={agentOrganizations}
                    requestedByDefault={currentLoginManagerLabel}
                    onClose={() => {
                      setShowMixDesignForm(false);
                    }}
                    onSubmitted={() => {
                      window.alert('配合計画書の作成依頼を送信しました');
                      setShowMixDesignForm(false);
                      setNewOrderMode('');
                    }}
                  />
                ) : null}
              </section>
              ) : null}
              {customerOrderTab === 'new' && newOrderMode === 'form' ? (
              <div ref={orderFormRef} className="mx-auto w-full max-w-4xl min-w-0 overflow-x-hidden overflow-y-visible rounded-2xl border border-slate-200 bg-white p-5 shadow-md sm:p-6 lg:max-w-4xl lg:p-8">
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
                  className="mt-6 flex min-w-0 flex-col gap-6 overflow-x-hidden overflow-y-visible"
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
                      applySpotOrderFieldDefaults();
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

              {isAgentOrCooperative && !isGuestSiteOrder && (orderKind === 'project' || orderKind === 'spot') ? (
                <div className="rounded-xl border-2 border-amber-200 bg-amber-50 p-3">
                  <p className="text-xs font-black text-amber-900">代理発注モード</p>
                  <p className="text-xs text-amber-700 mt-0.5">
                    {currentCustomerRole === 'agent' ? '商社' : '組合'}として発注しています。
                    発注先の業者を選択してください。
                    {currentCustomerRole === 'cooperative'
                      ? '必要に応じて経由商社の担当者を選択できます。'
                      : ''}
                    {orderKind === 'spot'
                      ? ' スポット注文では未選択でも送信できます（現場名候補は選択した業者の履歴を使います）。'
                      : ''}
                  </p>
                  <div className="mt-3 space-y-3">
                    {currentCustomerRole === 'cooperative' ? (
                      <MasterSuggestInput
                        label="経由商社担当者（任意）"
                        htmlFor="trading-agent-customer-select"
                        name="trading_agent_customer"
                        value={tradingAgentSearchText}
                        placeholder="商社担当者名を入力して候補から選択"
                        items={tradingAgentItems}
                        getItemKey={(c) => String(c.id)}
                        getItemLabel={formatTradingAgentLabel}
                        getSearchTexts={(c) => [
                          c.company_name || c.name || '',
                          c.furigana || '',
                          c.manager_name || '',
                          '代表窓口',
                        ]}
                        onValueChange={(text) => {
                          setTradingAgentSearchText(text);
                          const hit = tradingAgentItems.find(
                            (c) =>
                              formatTradingAgentLabel(c).toLowerCase() === text.trim().toLowerCase(),
                          );
                          if (hit) setTradingAgentCustomerId(String(hit.id));
                          else setTradingAgentCustomerId('');
                          setSubmitError('');
                        }}
                        onSelect={(c) => {
                          setTradingAgentCustomerId(String(c.id));
                          setTradingAgentSearchText(formatTradingAgentLabel(c));
                          setSubmitError('');
                        }}
                        emptyHint="該当する商社担当者がありません"
                      />
                    ) : null}
                    <div>
                      <MasterSuggestInput
                        label="発注先業者"
                        htmlFor="contractor-customer-select"
                        name="contractor_customer"
                        value={contractorSearchText}
                        placeholder="業者名を入力して候補から選択"
                        items={proxyContractorItems}
                        getItemKey={(c) => String(c.id)}
                        getItemLabel={(c) => String(c.company_name || c.name || '').trim()}
                        getSearchTexts={(c) => [
                          c.company_name || c.name || '',
                          c.furigana || '',
                          c.manager_name || '',
                        ]}
                        onValueChange={(text) => {
                          setContractorSearchText(text);
                          const pool = proxyContractorItems;
                          const hit = pool.find(
                            (c) =>
                              String(c.company_name || c.name || '')
                                .trim()
                                .toLowerCase() === text.trim().toLowerCase(),
                          );
                          if (hit) setContractorCustomerId(String(hit.id));
                          else setContractorCustomerId('');
                          if (orderKind === 'spot') {
                            setContractorName(text);
                            if (!hit || !String(text || '').trim()) {
                              resetSpotContractorSiteContact();
                            }
                          } else {
                            setSelectedProjectId('');
                            lastAutofillProjectIdRef.current = '';
                            applyProjectSelection(null);
                          }
                          setSubmitError('');
                        }}
                        onSelect={(c) => {
                          const name = String(c.company_name || c.name || '').trim();
                          setContractorCustomerId(String(c.id));
                          setContractorSearchText(name);
                          if (orderKind === 'spot') {
                            setContractorName(name);
                            resetSpotContractorSiteContact();
                          } else {
                            setSelectedProjectId('');
                            lastAutofillProjectIdRef.current = '';
                            applyProjectSelection(null);
                          }
                          setSubmitError('');
                        }}
                        emptyHint="該当する業者がありません"
                      />
                      {tradingAgentFilterHint ? (
                        <p className="mt-1 text-[11px] font-bold text-amber-800">
                          {tradingAgentFilterHint}
                        </p>
                      ) : null}
                    </div>
                    {!contractorCustomerId ? (
                      <p className="mt-2 text-xs font-bold text-amber-800">
                        {orderKind === 'spot'
                          ? '発注先業者を選ぶと、その業者の過去の現場名候補を表示します（未選択でも送信可）。'
                          : '発注先の業者を選択してください。'}
                      </p>
                    ) : null}
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
                  {!isAgentOrCooperative ? (
                  <MasterSuggestInput
                    label="業者（会社）"
                    htmlFor={orderFieldId('dispatch-customer')}
                    name={orderFieldName('customer_company')}
                    value={customerSearchText}
                    disabled={companyCustomerItems.length === 0}
                    placeholder="業者名を入力して候補から選択"
                    items={companyCustomerItems}
                    getItemKey={(c) => String(c.id)}
                    getItemLabel={(c) => String(c.company_name || c.name || c.id || '').trim()}
                    getSearchTexts={customerSuggestTexts}
                    onValueChange={(text) => {
                      setCustomerSearchText(text);
                      setSubmitError('');
                      const hit = companyCustomerItems.find(
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
                  ) : null}
                  <MasterSuggestInput
                    label="物件を選択"
                    htmlFor={orderFieldId('dispatch-project')}
                    name="regular_project_search"
                    value={projectSearchText}
                    disabled={isAgentOrCooperative ? !contractorCustomerId : !hasCurrentCustomer}
                    placeholder={
                      isAgentOrCooperative
                        ? contractorCustomerId
                          ? '物件名・住所で検索'
                          : '先に発注先業者を選択してください'
                        : hasCurrentCustomer
                          ? '物件名・住所で検索'
                          : '先に業者を選択してください'
                    }
                    items={filteredProjects}
                    getItemKey={(p) => String(p.id)}
                    getItemLabel={(p) => {
                      const name = String(p.name || p.id || '').trim();
                      return getProjectMatch(p)?.role === 'sub' ? `${name}（下請）` : name;
                    }}
                    getSearchTexts={projectSuggestTexts}
                    onValueChange={(text) => {
                      setProjectSearchText(text);
                      setSubmitError('');
                      const projectNameText = String(text)
                        .trim()
                        .replace(/（下請）$/, '')
                        .trim();
                      const hit = (filteredProjects || []).find(
                        (p) =>
                          String(p.name || '').trim().toLowerCase() ===
                          projectNameText.toLowerCase(),
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
                      const factoryId = resolveProjectMainFactoryId(p);
                      if (factoryId) setPreferredFactoryId(factoryId);
                      setSubmitError('');
                    }}
                    emptyHint="該当する物件がありません"
                  />
                  {!hasCurrentCustomer ? (
                    <p className="text-xs font-bold text-amber-800 dark:text-amber-200">
                      ログイン中の業者情報を確認できません。再ログインするか、上の欄で業者を選択してください。
                    </p>
                  ) : isAgentOrCooperative && !contractorCustomerId ? (
                    <p className="text-xs font-bold text-amber-800 dark:text-amber-200">
                      発注先の業者を選択すると、その会社の物件が一覧表示されます。
                    </p>
                  ) : !projectMastersReady || !targetProjectCustomer ? (
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400">
                      物件を読み込み中…
                    </p>
                  ) : filteredProjects.length === 0 ? (
                    <p className="text-xs font-bold text-amber-800 dark:text-amber-200">
                      この業者に紐づく物件がありません。管理画面で物件に業者（会社）を設定するか、スポット注文を選んでください。
                    </p>
                  ) : null}
                  {projectSelectionWarnings.length > 0 ? (
                    <div
                      className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold leading-relaxed text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
                      role="status"
                    >
                      <p className="font-black">⚠️ この物件は発注前に確認が必要です</p>
                      <ul className="mt-1 list-inside list-disc space-y-0.5">
                        {projectSelectionWarnings.map((msg) => (
                          <li key={msg}>{msg}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  {selectedProject ? (
                    <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-600 dark:bg-slate-900/40">
                      <p className="text-xs font-black text-slate-600 dark:text-slate-300">業者（帳票・表示用）</p>
                      <fieldset className="mt-2 space-y-2">
                        <legend className="sr-only">業者名の表示</legend>
                        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 dark:border-slate-600 dark:has-[:checked]:bg-indigo-950/40">
                          <input
                            type="radio"
                            name={orderFieldName('contractor_display_mode')}
                            value="prime"
                            checked={contractorDisplayMode === 'prime'}
                            onChange={() => {
                              setContractorDisplayMode('prime');
                              setSubmitError('');
                            }}
                            className="mt-0.5"
                          />
                          <span>
                            元請
                            {projectContractorLabels.primeContractorName
                              ? `（${projectContractorLabels.primeContractorName}）`
                              : '（未設定）'}
                          </span>
                        </label>
                        {projectContractorLabels.subContractorName ? (
                          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 dark:border-slate-600 dark:has-[:checked]:bg-indigo-950/40">
                            <input
                              type="radio"
                              name={orderFieldName('contractor_display_mode')}
                              value="sub"
                              checked={contractorDisplayMode === 'sub'}
                              onChange={() => {
                                setContractorDisplayMode('sub');
                                setSubmitError('');
                              }}
                              className="mt-0.5"
                            />
                            <span>下請（{projectContractorLabels.subContractorName}）</span>
                          </label>
                        ) : null}
                        <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm has-[:checked]:border-indigo-500 has-[:checked]:bg-indigo-50 dark:border-slate-600 dark:has-[:checked]:bg-indigo-950/40">
                          <input
                            type="radio"
                            name={orderFieldName('contractor_display_mode')}
                            value="custom"
                            checked={contractorDisplayMode === 'custom'}
                            onChange={() => {
                              setContractorDisplayMode('custom');
                              setSubmitError('');
                            }}
                            className="mt-0.5"
                          />
                          <span>自由入力</span>
                        </label>
                        {contractorDisplayMode === 'custom' ? (
                          <input
                            type="text"
                            name={orderFieldName('contractor_display_custom')}
                            value={contractorDisplayCustomText}
                            onChange={(e) => {
                              setContractorDisplayCustomText(e.target.value);
                              setSubmitError('');
                            }}
                            placeholder="表示する業者名を入力"
                            className="min-h-[44px] w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-900"
                          />
                        ) : null}
                      </fieldset>
                      <p className="mt-2 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                        請求・ログイン紐付けは変わりません。帳票や工場画面に表示する業者名のみ切り替えます。
                      </p>
                    </div>
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
                          traderName={resolveProjectTradingCompanyName(selectedProject)}
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
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-3">
                    <MasterSuggestInput
                      label="現場名"
                      htmlFor={orderFieldId('site-name')}
                      name="spot_site_name"
                      value={siteName}
                      placeholder="例：〇〇ビル新築工事（候補から選択、または自由入力）"
                      items={spotSiteNameSuggestions}
                      getItemKey={(item) => String(item.site_name || '')}
                      getItemLabel={(item) => String(item.site_name || '').trim()}
                      getSearchTexts={(item) => [item.site_name || '']}
                      onValueChange={(text) => {
                        setSiteName(text);
                        setSubmitError('');
                      }}
                      onSelect={(item) => {
                        setSiteName(String(item?.site_name || '').trim());
                        setSubmitError('');
                      }}
                      emptyHint="該当する過去の現場名がありません（自由入力もできます）"
                      emptyQueryShowsPinnedOnly
                      pinnedItems={spotSiteNameSuggestions.slice(0, 5)}
                      pinnedSectionLabel="⏱ 最近使った現場名"
                      searchResultLimit={20}
                    />
                    <p className="text-xs leading-relaxed text-slate-500">
                      現場の通称など。空欄のまま送信した場合は、下の「現場住所」の内容が現場名として保存されます。
                      候補は発注先業者の過去スポット注文から表示します（自由入力も可）。
                    </p>
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
                      <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-amber-200 bg-amber-50 p-4 dark:bg-amber-950/40">
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
                        <span className="text-sm font-bold leading-relaxed text-amber-900 dark:text-amber-100">
                          あとから地図を送る
                          <span className="mt-1 block text-xs font-medium text-amber-900 dark:text-amber-100">
                            発注確定後は「進行中」タブの現場地図URLから送付できます（自動で開きません）。
                          </span>
                        </span>
                      </label>

                      <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-indigo-200 bg-indigo-50 p-4 dark:bg-indigo-950/40">
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
                        <span className="text-sm font-bold leading-relaxed text-indigo-900 dark:text-indigo-100">
                          現場地図を作成する
                          <span className="mt-1 block text-xs font-medium text-indigo-900 dark:text-indigo-100">
                            確定直後に地図エディタ（別タブ）が開き、すぐにスタンプ作成できます。
                          </span>
                        </span>
                      </label>
                    </div>
                  </div>

                  {!isGuestSiteOrder ? (
                    <>
                      {isAgentOrCooperative ? (
                        <>
                          <GuestLockedField
                            label={currentCustomerRole === 'cooperative' ? '発注組織' : '商社名'}
                            value={
                              currentCustomerRole === 'cooperative'
                                ? currentCustomerDisplayName
                                : effectiveTraderName || currentCustomerDisplayName
                            }
                          />
                          {currentCustomerRole === 'cooperative' ? (
                            <MasterSuggestInput
                              label="商社名（任意）"
                              name={orderFieldName('trader_name')}
                              value={traderName}
                              onValueChange={handleTraderNameChange}
                              items={agentOrganizations}
                              getItemKey={(o) => String(o.id)}
                              getItemLabel={(o) => String(o.name || '').trim()}
                              getSearchTexts={organizationSuggestTexts}
                              onSelect={(org) => {
                                handleTraderNameChange(String(org?.name || '').trim());
                              }}
                              placeholder="商社を経由しない場合は空欄"
                              emptyHint="該当する商社がありません（自由入力もできます）"
                              autoComplete="organization"
                            />
                          ) : null}
                          {currentCustomerRole === 'cooperative' &&
                          submitError === COOPERATIVE_OWN_ORG_TRADER_ERROR ? (
                            <p className="text-sm font-bold text-red-700" role="alert">
                              {COOPERATIVE_OWN_ORG_TRADER_ERROR}
                            </p>
                          ) : null}
                        </>
                      ) : (
                        <MasterSuggestInput
                          label="商社名（任意）"
                          name={orderFieldName('trader_name')}
                          value={traderName}
                          onValueChange={handleTraderNameChange}
                          items={agentOrganizations}
                          getItemKey={(o) => String(o.id)}
                          getItemLabel={(o) => String(o.name || '').trim()}
                          getSearchTexts={organizationSuggestTexts}
                          onSelect={(org) => {
                            handleTraderNameChange(String(org?.name || '').trim());
                          }}
                          placeholder="商社名を入力（登録商社から選択、または自由入力）"
                          emptyHint="該当する商社がありません（自由入力もできます）"
                          autoComplete="organization"
                        />
                      )}

                      {isAgentOrCooperative ? (
                        <p className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs font-bold text-amber-900">
                          発注先業者は上の「代理発注モード」で選択・入力してください
                          {contractorName ? `（現在: ${contractorName}）` : ''}
                        </p>
                      ) : (
                        <div className="flex flex-col gap-3">
                          <Label htmlFor={orderFieldId('contractor-name')}>業者名</Label>
                          <input
                            id={orderFieldId('contractor-name')}
                            name={orderFieldName('contractor_name')}
                            type="text"
                            autoComplete="organization"
                            placeholder="発注している業者名"
                            value={contractorName}
                            onChange={(e) => {
                              setContractorName(e.target.value);
                              setSubmitError('');
                            }}
                            className={CUSTOMER_FIELD_CLASS}
                          />
                        </div>
                      )}
                    </>
                  ) : null}
                </div>
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

              {!isGuestSiteOrder && orderKind === 'project' && currentCustomerRole !== 'agent' ? (
                <MasterSuggestInput
                  label="商社（任意）"
                  name={orderFieldName('trader_name')}
                  value={traderName}
                  onValueChange={handleTraderNameChange}
                  items={currentCustomerRole === 'cooperative' ? agentOrganizations : MASTER_TRADER_SUGGESTIONS}
                  getItemKey={(item) =>
                    currentCustomerRole === 'cooperative' ? String(item?.id || '') : String(item || '')
                  }
                  getItemLabel={(item) =>
                    currentCustomerRole === 'cooperative'
                      ? String(item?.name || '').trim()
                      : String(item || '')
                  }
                  getSearchTexts={
                    currentCustomerRole === 'cooperative' ? organizationSuggestTexts : undefined
                  }
                  onSelect={(item) => {
                    const next =
                      currentCustomerRole === 'cooperative'
                        ? String(item?.name || '').trim()
                        : String(item || '');
                    handleTraderNameChange(next);
                  }}
                  placeholder={
                    currentCustomerRole === 'cooperative'
                      ? '商社を経由しない場合は空欄'
                      : '例：梅田建材（入力すると候補が表示されます）'
                  }
                  emptyHint="該当する商社がありません（自由入力もできます）"
                  autoComplete="organization"
                />
              ) : null}
              {!isGuestSiteOrder &&
              orderKind === 'project' &&
              currentCustomerRole === 'cooperative' &&
              submitError === COOPERATIVE_OWN_ORG_TRADER_ERROR ? (
                <p className="-mt-4 text-sm font-bold text-red-700" role="alert">
                  {COOPERATIVE_OWN_ORG_TRADER_ERROR}
                </p>
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

              {((orderKind === 'project' || orderKind === 'spot') && !isGuestSiteOrder) ||
              (isGuestSiteOrder && usesProjectSiteContacts) ? (
                <div className="flex flex-col gap-3">
                  <MasterSuggestInput
                    label="現場担当者"
                    htmlFor={orderFieldId('site-contact')}
                    name={orderFieldName('site_contact_name')}
                    value={siteContactName}
                    onValueChange={(next) => {
                      setSiteContactName(next);
                      setSubmitError('');
                    }}
                    items={usesProjectSiteContacts ? selectedProjectSiteContacts : siteContactCandidates}
                    getItemKey={(c) =>
                      usesProjectSiteContacts
                        ? `${String(c?.name || '')}::${String(c?.phone || '')}`
                        : String(c?.id || `${c?.name}::${c?.phone_number}`)
                    }
                    getItemLabel={(c) => {
                      if (usesProjectSiteContacts) {
                        const contactName = String(c?.name || '').trim();
                        const contactPhone = formatPhoneNumberJP(String(c?.phone || '').trim());
                        return contactPhone
                          ? `${contactName || '—'}（${contactPhone}）`
                          : contactName;
                      }
                      const contactName = String(c?.name || '').trim();
                      const contactPhone = formatPhoneNumberJP(String(c?.phone_number || '').trim());
                      return contactPhone
                        ? `${contactName || '—'}（${contactPhone}）`
                        : contactName;
                    }}
                    getSearchTexts={(c) =>
                      usesProjectSiteContacts
                        ? [c?.name || '', c?.phone || '']
                        : [c?.name || '', c?.phone_number || '']
                    }
                    onSelect={(c) => {
                      setSiteContactName(
                        String(
                          usesProjectSiteContacts ? c?.name || '' : c?.name || '',
                        ).trim(),
                      );
                      const selectedPhone = String(
                        usesProjectSiteContacts ? c?.phone || '' : c?.phone_number || '',
                      ).trim();
                      // 候補選択時は現場電話を上書き（自由入力の上書きでOK）
                      if (selectedPhone) setSitePhone(selectedPhone);
                      setSubmitError('');
                    }}
                    placeholder="現場担当者名を入力（候補から選択可）"
                    emptyHint={
                      !effectiveContractorCustomerId
                        ? '発注先業者を選ぶと担当者候補が表示されます（自由入力もできます）'
                        : '登録された担当者がいません（自由入力もできます）'
                    }
                    inputClassName="min-h-[56px] rounded-xl border-2 border-slate-200 px-4 py-3 text-base"
                  />
                  {usesProjectSiteContacts ? (
                    <p className="text-xs leading-relaxed text-slate-500">
                      物件に登録された現場担当者から選ぶと、電話番号が自動入力されます。
                    </p>
                  ) : (
                    <p className="text-xs leading-relaxed text-slate-500">
                      業者の担当者マスタから選ぶと、電話番号が自動入力されます（物件注文・スポット注文共通。未登録名の自由入力も可）。
                    </p>
                  )}
                </div>
              ) : null}

              <div className="flex flex-col gap-3">
                <Label htmlFor={orderFieldId('site-phone')}>
                  {orderKind === 'project' || orderKind === 'spot' ? '現場電話番号' : '電話番号'}
                </Label>
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
                  onEditItem={handleEditCartItem}
                  validateItem={validateCartItemOrder}
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
                      工場画面の対応状況（受注・回答・保留）がここに反映されます。
                    </p>
                  </div>
                </div>
                  <div className="mt-4 grid grid-cols-1 gap-4">
                    {scopedInProgressOrders.length === 0 ? (
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
                          {inProgressOrderEntries.map((entry) => {
                            const renderCard = (ord) => {
                              // 会社全体表示で見えている同僚の注文は閲覧のみ（操作ボタンを出さない）
                              const ownerId = String(ord?.customer_id ?? ord?.customerId ?? '').trim();
                              const isColleagueOrder =
                                companyScopeActive && companyColleagueIdSet.has(ownerId);
                              return (
                              <InProgressOrderCard
                                key={ord.id}
                                order={ord}
                                project={resolveOrderLinkedProject(ord, projectById)}
                                customerById={customerById}
                                hasUnreadChat={Boolean(
                                  unreadChatsByOrder[ord.id] ||
                                    isUnreadForDispatch(chatThreads[ord.id], readChatKeys[ord.id]),
                                )}
                                onOpenChat={isColleagueOrder ? null : handleOpenChat}
                                onAllowStatusReset={isColleagueOrder ? null : handleAllowStatusReset}
                                guestToken={isGuestSiteOrder ? guestOrderToken : ''}
                                escalationCtx={customerEscalationCtx}
                                choiceSubmitting={choiceSubmitting}
                                onEscalatePreferred={(o) => void runCustomerChoice(o, 'escalate')}
                                onReschedulePreferred={(o) => void runCustomerChoice(o, 'reschedule')}
                                onCancelPreferred={(o) => void runCustomerChoice(o, 'cancel')}
                                onEditOrder={isColleagueOrder ? null : handleOpenCustomerOrderEdit}
                                onRequestChange={isColleagueOrder ? null : handleOpenCustomerChangeRequest}
                                readOnly={isColleagueOrder}
                                accountLabel={
                                  companyScopeActive
                                    ? formatProjectAccountLabel(customerById[ownerId])
                                    : ''
                                }
                              />
                              );
                            };
                            if (entry.type === 'group') {
                              const groupStorageId = resolveInProgressGroupStorageId(entry);
                              const collapsed = Boolean(
                                groupStorageId && collapsedInProgressGroups?.[groupStorageId],
                              );
                              const nextOrder = resolveNearestUpcomingOrder(entry.orders);
                              const nextLabel = nextOrder ? formatOrderDateTimeSummary(nextOrder) : '';
                              return (
                                <section
                                  key={entry.key}
                                  className="rounded-2xl border border-indigo-200 bg-indigo-50/40 p-3 dark:border-indigo-800 dark:bg-indigo-950/20"
                                  aria-label={`現場「${entry.site}」の注文`}
                                >
                                  <button
                                    type="button"
                                    className="flex w-full flex-col gap-1 rounded-xl px-1 py-1 text-left transition hover:bg-indigo-100/60 sm:flex-row sm:items-center sm:gap-2 dark:hover:bg-indigo-900/30"
                                    onClick={() => toggleInProgressGroupCollapsed(groupStorageId)}
                                    aria-expanded={!collapsed}
                                  >
                                    <div className="flex min-w-0 w-full items-center gap-2 sm:flex-1">
                                      <span
                                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center text-sm font-black text-indigo-700 dark:text-indigo-300"
                                        aria-hidden="true"
                                      >
                                        {collapsed ? '▶' : '▼'}
                                      </span>
                                      <p
                                        className="min-w-0 flex-1 truncate text-sm font-black text-slate-900 dark:text-gray-100"
                                        title={entry.site}
                                      >
                                        📍 {entry.site}
                                      </p>
                                    </div>
                                    <div className="flex shrink-0 items-center gap-2 pl-8 sm:ml-auto sm:pl-0">
                                      {collapsed && nextLabel ? (
                                        <span
                                          className="whitespace-nowrap rounded-lg bg-white/80 px-2 py-0.5 text-xs font-black tabular-nums text-indigo-800 dark:bg-slate-900/60 dark:text-indigo-200"
                                          title={`次回：${nextLabel}`}
                                        >
                                          次回：{nextLabel}
                                        </span>
                                      ) : null}
                                      <span className="whitespace-nowrap rounded-full bg-indigo-600 px-2 py-0.5 text-[10px] font-black text-white">
                                        {entry.orders.length}便
                                      </span>
                                    </div>
                                  </button>
                                  <div
                                    className="grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none"
                                    style={{ gridTemplateRows: collapsed ? '0fr' : '1fr' }}
                                  >
                                    <div className="min-h-0 overflow-hidden">
                                      <div className="mt-2 grid grid-cols-1 gap-4">
                                        {entry.orders.map((ord) => renderCard(ord))}
                                      </div>
                                    </div>
                                  </div>
                                </section>
                              );
                            }
                            return <React.Fragment key={entry.key}>{renderCard(entry.order)}</React.Fragment>;
                          })}
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
                            <dt className="w-20 shrink-0 text-slate-400">現場担当</dt>
                            <dd className="min-w-0 flex-1 break-words">{row.orderedBy || '—'}</dd>
                          </div>
                          <div className="flex gap-2">
                            <dt className="w-20 shrink-0 text-slate-400">連絡先</dt>
                            <dd className="min-w-0 flex-1 break-words font-mono">{row.phone || '—'}</dd>
                          </div>
                        </dl>

                        <div className="mx-4 mt-4 flex flex-wrap gap-2">
                          <span className="break-all rounded-xl border-2 border-indigo-200 bg-indigo-50 px-3 py-2 text-lg font-black text-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-100">
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
                escalationCtx={customerEscalationCtx}
                projectById={projectById}
                customerById={customerById}
                onEditOrder={handleOpenCustomerOrderEdit}
                onRequestChange={handleOpenCustomerChangeRequest}
                onMonthChange={(nextMonth) => {
                  const next = nextMonth instanceof Date && !Number.isNaN(nextMonth.getTime()) ? nextMonth : new Date();
                  const normalized = new Date(next.getFullYear(), next.getMonth(), 1);
                  setCustomerCalendarMonth(normalized);
                  setCustomerCalendarSelectedDate(`${normalized.getFullYear()}-${pad2(normalized.getMonth() + 1)}-01`);
                }}
              />
            ) : null}
            {customerOrderTab === 'siteContacts' && currentCustomerRole === 'contractor' ? (
              <section className="rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm dark:border-slate-600 dark:bg-slate-900 sm:p-6">
                <h2 className="text-lg font-black text-slate-900 dark:text-white">現場担当者の登録</h2>
                <p className="mt-1 text-xs font-medium text-slate-500">
                  自社の現場担当者を登録すると、新規発注フォームで名前サジェストと電話番号の自動入力が使えます。
                </p>
                <div className="mt-4">
                  <CompanyMemberContactList customerId={currentCustomerId} />
                </div>
              </section>
            ) : null}
            {customerOrderTab === 'scheduleImport' && canImportSchedule ? (
              <AdminScheduleImportSection
                factories={factories}
                mode="customer"
                uploadedBy={currentCustomerId}
                lockedOrderPlacerName={String(currentCustomer?.manager_name || '').trim()}
              />
            ) : null}
            {customerOrderTab === 'mixDesignHistory' && canRequestMixDesign ? (
              <MixDesignRequestHistorySection
                factories={factories}
                active={customerOrderTab === 'mixDesignHistory'}
              />
            ) : null}
              </PullToRefresh>
            </main>

            <OrderFullEditModal
              order={customerEditOrder}
              open={Boolean(customerEditOrder)}
              onClose={() => {
                setCustomerEditOrder(null);
                setCustomerEditMode('edit');
              }}
              editorRole="customer"
              mode={customerEditMode === 'request' ? 'request' : 'edit'}
              projectById={projectById}
              customerById={customerById}
              onSave={handleCustomerOrderFullSave}
            />

            {changeRequestNotice ? (
              <div
                className="fixed bottom-24 left-1/2 z-[520] w-[min(92vw,28rem)] -translate-x-1/2 rounded-2xl border-2 border-emerald-600 bg-white px-4 py-3 text-center text-sm font-black text-emerald-900 shadow-2xl sm:bottom-8 sm:text-base lg:bottom-8"
                role="status"
              >
                {changeRequestNotice}
              </div>
            ) : null}

            {!isGuestSiteOrder ? (
              <nav className="block lg:hidden fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200" aria-label="カスタマー画面ナビゲーション">
                <div className="px-2 pb-[calc(1rem+env(safe-area-inset-bottom,0px))] pt-2">
                  <div
                    className={
                      'mx-auto grid max-w-lg gap-1 ' +
                      (visibleCustomerOrderTabs.length >= 6
                        ? 'grid-cols-6'
                        : visibleCustomerOrderTabs.length >= 5
                          ? 'grid-cols-5'
                          : 'grid-cols-4')
                    }
                  >
                    {visibleCustomerOrderTabs.map(([id, label, icon]) => {
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
              onBack={() => {
                activeChatOrderIdRef.current = '';
                setActiveChatOrderId('');
              }}
              onSendMessage={handleSendMasterChat}
              onMarkChatRead={markChatRead}
              onPreferredFactoryChoice={handlePreferredFactoryChoice}
              escalationCtx={customerEscalationCtx}
              orderCustomer={currentCustomer}
            />
          ) : null}
        </div>
      );
    }
