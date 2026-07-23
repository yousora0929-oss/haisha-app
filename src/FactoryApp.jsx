import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import * as db from './haishaDb.js';
import {
  setFactoryPanelSession,
  clearFactoryPanelSession,
  hasFactoryPanelSession,
  ensurePanelRealtimeAuth,
  issuePanelRealtimeAuth,
  FACTORY_PANEL_PASSWORD_KEY,
  FACTORY_SESSION_STORAGE_KEY,
  FACTORY_AUTH_STORAGE_KEY,
  readAuthValue,
  writeAuthValue,
  removeAuthValue,
} from './supabaseClient.js';
import { buildEscalationContext, filterOrdersForFactory, getOrderEscalationStepInfo } from './utils/escalationUtils.js';
import { isAssignedProject } from './utils/assignedProjectEscalation.js';
import {
  resolveOrderPartyDisplay,
  resolveProjectPartyDisplay,
} from './utils/projectPartyDisplay.js';
import BillingMark from './components/BillingMark.jsx';
import {
  FACTORY_SITE_ID,
  FACTORY_SITE_NAME,
  SCHEDULE_BLOCK_IDS,
  SCHEDULE_BLOCKS,
  TIME_SLOTS,
  pad2,
  todayLocalISODate,
  getScheduleDateBoundsISO,
  defaultEmptyDayBlocks,
  normalizeDayBlockSchedule,
  normalizeFullSchedule,
  getScheduleBlockIdForMinutes,
  getOrderVehicleScheduleKey,
  getOrderMinutesForScheduleScan,
  computeScheduleAutoRejectReason,
} from './haishaConstants.js';
import { registerOneSignalUser, unregisterOneSignalUser, buildFactoryOneSignalExternalId, setAppBadge } from './utils/notification.js';
import {
  clearPushRedirect,
  consumePushRedirectForApp,
  readPushRedirectFromSession,
  setupPushRedirectListener,
} from './utils/pushRedirect.js';
import {
  primeNotificationAlarm,
  playFactoryChatNotificationSound,
  startNotificationAlarm,
  stopNotificationAlarm,
} from './utils/notificationAlarm.js';
import { analyzeFactoryChatRealtimePayload } from './utils/factoryChatRealtime.js';
import {
  factoryChatDisplayName,
  isIncomingSideForFactoryView,
  isSystemChatSender,
} from './utils/chatMessageSenders.js';
import { LocationPendingBadge } from './components/LocationPendingBadge.jsx';
import { OrderMapEditorUrlActions } from './components/OrderMapEditorUrlActions.jsx';
import { ProjectExternalUrlActions } from './components/ProjectExternalUrlActions.jsx';
import { SiteOrderUrlActions } from './components/SiteOrderUrlActions.jsx';
import { isValidSiteOrderUrlToken } from './utils/urlValidation.js';
import { isLocationPendingOrder } from './utils/orderWorkflow.js';
import { resolveOrderSiteDisplayName, sanitizeSiteNameValue } from './utils/siteNameDisplay.js';
import { orderPartyInfo } from './utils/orderPartyInfo.js';
import {
  resolveOrdererName,
  resolveSiteContactName,
  resolveSitePhone,
} from './utils/orderContactInfo.js';
import { formatPhoneNumberJP } from './utils/phoneFormat.js';
import { MAP_EDITOR_ORDER_SAVED_DOM_EVENT, MAP_EDITOR_ORDER_SAVED_EVENT_KEY } from './mapEditorConstants.js';
import concreteLinkLogo from './assets/concrete-link-logo.svg';
import { APP_BRAND_HOME_LABEL, APP_BRAND_NAME } from './constants/brand.js';
import { FactorySettingsPanel } from './components/FactorySettingsPanel.jsx';
import { CharterRequestsPanel } from './components/CharterRequestsPanel.jsx';
import { CharterOpenRequestsPanel } from './components/CharterOpenRequestsPanel.jsx';
import { FactoryCharterRequestCalendar } from './components/FactoryCharterRequestCalendar.jsx';
import { FactoryNewsPanel } from './components/FactoryNewsPanel.jsx';
import { countUnreadNewsForFactory } from './utils/factoryNews.js';
import { countPendingCharterResponses } from './utils/charterBadges.js';
import { OrderAcceptModal } from './components/OrderAcceptModal.jsx';
import {
  detectFactoryNotifyOrderIds,
  analyzeFactoryOrderRealtimePayload,
} from './utils/factoryOrderRealtime.js';
import {
  formatAcceptedAtDateTimeJp,
  formatAcceptedAtTimeJp,
  getOrderDeliveryDateISO,
  isOrderAcceptedByOtherFactory,
  isOrderInHistoryView,
  isOrderInProgressView,
  isOrderManuallyCompleted,
  sortOrdersForHistory,
} from './utils/orderDeliverySchedule.js';
import { resolveFactoryIdFromProject } from './utils/dispatchBulkOrder.js';
import { dispatchRealtimePayloadByKind } from './utils/realtimePayloadRouting.js';
import { createSplitRealtimeSyncScheduler } from './utils/realtimeSyncScheduler.js';
import {
  chatSoundKeyFromRealtimePayload,
  shouldPlayChatSoundOnce,
} from './utils/chatNotificationDedup.js';
import { normalizeFactoryRefId } from './utils/escalationUtils.js';

const FACTORY_SPLIT_STORAGE_KEY = 'haisha_factory_split_left_pct_v1';

/** 依頼一覧 1 行目：希望日 | 希望時刻 | 荷卸し | 車種 | 数量 | 試験（最小幅を確保し、狭いときは横スクロール） */
const ORDER_GRID_TOP =
  'grid w-full min-w-[760px] grid-cols-6 grid-rows-1 items-end gap-x-2 gap-y-0 sm:gap-x-3';
/** 依頼カード要約：上段＝商社・業者、下段＝現場名(1/2)＋住所・配合(1/2) */
const ORDER_GRID_META_2X2 = 'grid w-full min-w-0 grid-cols-2 gap-x-2 gap-y-0';

const SPLIT_MIN_LEFT_PX = 260;
const SPLIT_MIN_RIGHT_PX = 300;
const SPLIT_GRIP_PX = 12;

function resolveSiteUrlToken(order, projectById, customerById) {
  const pid = String(order?.project_id ?? order?.projectId ?? '').trim();
  const cid = String(order?.customer_id ?? order?.customerId ?? '').trim();
  const project = pid ? projectById?.[pid] : null;
  const customer = cid ? customerById?.[cid] : null;
  const fromProject = String(project?.url_token ?? '').trim();
  if (isValidSiteOrderUrlToken(fromProject)) return fromProject;
  const fromCustomer = String(customer?.url_token ?? '').trim();
  if (isValidSiteOrderUrlToken(fromCustomer)) return fromCustomer;
  const fromOrder = String(order?.url_token ?? order?.urlToken ?? '').trim();
  return isValidSiteOrderUrlToken(fromOrder) ? fromOrder : '';
}

function csvCell(value) {
  const s = String(value ?? '').replace(/\r?\n/g, ' ');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function factoryOrderDate(order) {
  return String(order?.delivery_date ?? order?.preferredDate ?? order?.preferred_date ?? '').slice(0, 10);
}

function factoryOrderQuantity(order) {
  const raw = order?.confirmedQuantityM3 ?? order?.quantityM3 ?? order?.quantityCube;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function factoryUnloadDurationLabel(order) {
  const raw = order?.unloadDurationLabel || order?.unloadDurationMinutes || order?.unloadDuration || order?.unloadingTime;
  const value = String(raw || '30');
  if (value === '15') return '15分';
  if (value === '30') return '30分（標準）';
  if (value === '45') return '45分';
  if (value === '60') return '60分（手押し車など時間要）';
  if (value === '95_plus') return '95分以上（要相談）';
  return String(raw || '30分（標準）');
}

function orderContactPersonName(order, fallback = '担当者') {
  return String(
    order?.manager_name ??
      order?.contact_person ??
      order?.contactPerson ??
      resolveSiteContactName(order) ??
      fallback ??
      '',
  ).trim() || '担当者';
}

function FactoryResizablePanels({ defaultLeftPercent = 48, children }) {
  const parts = React.Children.toArray(children);
  const leftEl = parts[0];
  const rightEl = parts[1];
  const containerRef = useRef(null);
  const [leftPct, setLeftPct] = useState(() => {
    try {
      const v = Number(sessionStorage.getItem(FACTORY_SPLIT_STORAGE_KEY));
      if (Number.isFinite(v) && v >= 20 && v <= 80) return v;
    } catch {
      /* ignore */
    }
    return defaultLeftPercent;
  });

  useEffect(() => {
    try {
      sessionStorage.setItem(FACTORY_SPLIT_STORAGE_KEY, String(Math.round(leftPct * 10) / 10));
    } catch {
      /* ignore */
    }
  }, [leftPct]);

  return (
    <div ref={containerRef} className="flex h-full min-h-0 w-full flex-1 items-stretch">
      <div
        className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
        style={{ flex: `0 0 ${leftPct}%`, minWidth: `${SPLIT_MIN_LEFT_PX}px`, maxWidth: '100%' }}
      >
        {leftEl}
      </div>
      <button
        type="button"
        aria-label="スケジュールと依頼一覧の幅を変更（ドラッグ）"
        aria-orientation="vertical"
        aria-valuemin={20}
        aria-valuemax={80}
        aria-valuenow={Math.round(leftPct)}
        className="group relative z-[5] w-2.5 shrink-0 cursor-col-resize touch-none border-x border-slate-300/90 bg-slate-200/90 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.35)] hover:bg-indigo-200/70 active:bg-indigo-300/80 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1"
        onPointerDown={(e) => {
          e.preventDefault();
          try {
            e.currentTarget.setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
        }}
        onPointerMove={(e) => {
          if (!containerRef.current) return;
          if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
          const r = containerRef.current.getBoundingClientRect();
          const total = Math.max(r.width, SPLIT_GRIP_PX + SPLIT_MIN_LEFT_PX + SPLIT_MIN_RIGHT_PX + 1);
          const x = e.clientX - r.left;
          const maxLeftPx = total - SPLIT_GRIP_PX - SPLIT_MIN_RIGHT_PX;
          const leftPx = Math.min(maxLeftPx, Math.max(SPLIT_MIN_LEFT_PX, x));
          const next = (leftPx / total) * 100;
          setLeftPct(next);
        }}
        onPointerUp={(e) => {
          try {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          } catch {
            /* ignore */
          }
        }}
        onPointerCancel={(e) => {
          try {
            if (e.currentTarget.hasPointerCapture(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          } catch {
            /* ignore */
          }
        }}
      >
        <span
          className="pointer-events-none absolute left-1/2 top-1/2 h-12 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-slate-600/50 shadow-sm group-hover:bg-indigo-700/80"
          aria-hidden="true"
        />
      </button>
      <div
        className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
        style={{ minWidth: `${SPLIT_MIN_RIGHT_PX}px`, minHeight: 0 }}
      >
        {rightEl}
      </div>
    </div>
  );
}

function getFactoryIdFromUrl() {
  try {
    const candidates = [window.location.search || ''];
    const hash = window.location.hash || '';
    const hashQueryIndex = hash.indexOf('?');
    if (hashQueryIndex >= 0) {
      candidates.push(hash.slice(hashQueryIndex));
    }
    for (const raw of candidates) {
      const sp = new URLSearchParams(raw.startsWith('?') ? raw : `?${raw}`);
      const id = (sp.get('factory_id') || sp.get('factory') || '').trim();
      if (id) return id;
    }
    return '';
  } catch {
    return '';
  }
}

function readStoredFactoryId() {
  try {
    return String(readAuthValue(FACTORY_SESSION_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

function readAuthenticatedFactoryId() {
  try {
    return String(readAuthValue(FACTORY_AUTH_STORAGE_KEY) || '').trim();
  } catch {
    return '';
  }
}

function sortOrdersByCreatedDesc(list) {
  return [...(Array.isArray(list) ? list : [])].sort((a, b) => {
    const ta = new Date(a?.createdAt || 0).getTime();
    const tb = new Date(b?.createdAt || 0).getTime();
    return tb - ta;
  });
}

function filterAndSortFactoryOrders(list, activeFactoryId, escalationCtx) {
  if (!escalationCtx || !activeFactoryId) return [];
  const filtered = filterOrdersForFactory(list, activeFactoryId, escalationCtx).map((o) => {
    const stepInfo = getOrderEscalationStepInfo(o, escalationCtx);
    return {
      ...o,
      escalationElapsedMinutes: stepInfo.effectiveMinutes,
      escalationNextThresholdMinutes: stepInfo.nextThreshold,
    };
  });
  return sortOrdersByCreatedDesc(filtered);
}

function collectScheduleFactoryIds(orders, activeFactoryId) {
  const ids = new Set();
  for (const o of Array.isArray(orders) ? orders : []) {
    const fid = db.resolveScheduleCheckFactoryId(o);
    if (fid) ids.add(fid);
  }
  if (activeFactoryId) ids.add(String(activeFactoryId));
  return [...ids];
}

function isRejectedByFactory(order, factoryId) {
  const fid = String(factoryId || '').trim();
  if (!fid || !order) return false;
  const ids = Array.isArray(order.rejected_factory_ids)
    ? order.rejected_factory_ids
    : [];
  return ids.map((x) => String(x).trim()).includes(fid);
}

function normalizeFactoryIdForCompare(value) {
  if (value == null) return '';
  const s = String(value).trim();
  if (!s || s === 'undefined' || s === 'null') return '';
  return s;
}

function getAssignedFactoryId(order) {
  return normalizeFactoryIdForCompare(order?.factory_site_id ?? order?.factorySiteId);
}

function isSameFactoryId(a, b) {
  const aa = normalizeFactoryIdForCompare(a);
  const bb = normalizeFactoryIdForCompare(b);
  return Boolean(aa && bb && aa === bb);
}

function isOrderAcceptedByFactory(order, factoryId) {
  const status = order?.status != null ? String(order.status) : '';
  const responseStatus = normalizeFactoryResponse(order?.factoryResponseStatus || status);
  return Boolean((status === 'accepted' || responseStatus === FACTORY_RESPONSE.ACCEPTED) && isSameFactoryId(getAssignedFactoryId(order), factoryId));
}

/**
 * 変更前の注文オブジェクト（target）と保存後のpatchを比較し、
 * 変更されたフィールドのみ「表示名：旧値 → 新値」形式の配列を返す
 */
function factoryVehicleTypeLabel(value) {
  const s = String(value || '').trim();
  if (s === 'large') return '大型';
  if (s === 'small') return '小型';
  return s;
}

/** 変更前・変更後を比較し、日本語ラベル付きの変更点配列を返す（カンマ区切り用） */
function buildOrderChangeDiffLines(before, after) {
  const b = before && typeof before === 'object' ? before : {};
  const a = after && typeof after === 'object' ? after : {};
  const fields = [
    {
      label: '日付',
      before: String(b.preferredDate ?? b.preferred_date ?? '').trim(),
      after: String(a.preferredDate ?? a.preferred_date ?? '').trim(),
    },
    {
      label: '時間',
      before: String(b.timeSlotLabel ?? '').trim(),
      after: String(a.timeSlotLabel ?? '').trim(),
    },
    {
      label: '車種',
      before: factoryVehicleTypeLabel(b.vehicleType ?? b.vehicle_type),
      after: factoryVehicleTypeLabel(a.vehicleType ?? a.vehicle_type),
    },
    {
      label: '数量',
      before: String(b.confirmedQuantityM3 ?? b.quantityM3 ?? '').trim(),
      after: String(a.confirmedQuantityM3 ?? a.quantityM3 ?? '').trim(),
      suffix: 'm³',
    },
    {
      label: '配合',
      before: String(b.confirmedMixText ?? b.mixText ?? '').trim(),
      after: String(a.confirmedMixText ?? a.mixText ?? '').trim(),
    },
    {
      label: '現場名',
      before: String(b.siteName ?? '').trim(),
      after: String(a.siteName ?? '').trim(),
    },
    {
      label: '現場住所',
      before: String(b.siteAddress ?? '').trim(),
      after: String(a.siteAddress ?? '').trim(),
    },
    {
      label: '電話番号',
      before: String(b.sitePhone ?? '').trim(),
      after: String(a.sitePhone ?? '').trim(),
    },
  ];

  const parts = [];
  for (const f of fields) {
    if (f.before === f.after || (!f.before && !f.after)) continue;
    const suffix = f.suffix ?? '';
    parts.push(`${f.label} ${f.before || '（未設定）'}→${f.after || '（未設定）'}${suffix}`);
  }
  return parts;
}

function latestChatMessage(messages) {
  const list = Array.isArray(messages) ? messages.filter(Boolean) : [];
  return list.length ? list[list.length - 1] : null;
}

function chatMessageReadKey(message) {
  if (!message) return '';
  return [message.id, message.createdAt, message.from].map((x) => (x == null ? '' : String(x))).join('|');
}

function isUnreadForFactory(messages, readKey) {
  const latest = latestChatMessage(messages);
  if (!latest) return false;
  const from = String(latest.from || '');
  if (from !== 'master' && from !== 'customer' && from !== 'admin') return false;
  return chatMessageReadKey(latest) !== readKey;
}

    async function appendOrderChatMessage(orderId, from, body) {
      return db.appendChatMessage(orderId, from, body);
    }

    function FactoryOrderChatPanel({ order, orderId, messages, factoryName, onAfterSend }) {
      const [txt, setTxt] = useState('');
      const list = Array.isArray(messages) ? messages : [];
      // 顧客側メッセージの表示名は発注者（customer_id）。業者名や現場担当者と混同しない。
      const partyForChat = orderPartyInfo(order);
      const customerSenderName =
        partyForChat.orderer && partyForChat.orderer !== '—'
          ? partyForChat.orderer
          : orderContactPersonName(order);
      // 注意: ここで scrollIntoView 等の自動スクロールを行わないこと。
      // チャットパネルは折りたたみ中のカードにもマウントされており、
      // ポーリング/Realtime 更新のたびに一覧全体が末尾へスクロールする不具合の原因になった。
      // 新着はカード側の「💬 未読」バッジで通知する。
      if (!orderId) return null;
      const send = async () => {
        const t = txt.trim();
        if (!t) return;
        try {
          await appendOrderChatMessage(orderId, 'factory', t);
          setTxt('');
          if (typeof onAfterSend === 'function') onAfterSend();
        } catch (err) {
          db.logChatSendError(err, { orderId, surface: 'FactoryOrderChatPanel' });
          window.alert(db.formatChatAppendError(err));
        }
      };
      return (
        <div className="rounded-lg border-2 border-slate-300 bg-[#e5ddd5] p-3 shadow-inner">
          <p className="text-xs font-black uppercase tracking-wider text-slate-700 sm:text-sm">質疑応答（チャット）</p>
          <ul
            className="mt-2 space-y-2 rounded-md bg-[#e5ddd5]/90 px-1.5 py-2"
            aria-live="polite"
          >
            {list.length === 0 ? (
              <li className="px-2 text-center text-sm text-slate-500 sm:text-base">まだメッセージはありません</li>
            ) : (
              list.map((m) => {
                if (isSystemChatSender(m.from)) {
                  return (
                    <li key={m.id} className="flex justify-center">
                      <div className="max-w-[95%] rounded-xl border border-slate-300/80 bg-slate-100/95 px-3 py-2.5 text-center text-sm font-bold text-slate-700 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 sm:text-base">
                        <p className="whitespace-pre-wrap break-words leading-snug">{m.body}</p>
                        <p className="mt-1 text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-300 sm:text-sm">
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
                const isCustomerSide = isIncomingSideForFactoryView(m.from);
                const displaySenderName = factoryChatDisplayName(m.from, customerSenderName);
                return (
                  <li key={m.id} className={'flex ' + (isCustomerSide ? 'justify-start' : 'justify-end')}>
                    <div
                      className={
                        'max-w-[90%] rounded-2xl px-3 py-2.5 text-base shadow-sm sm:text-lg ' +
                        (isCustomerSide
                          ? 'rounded-bl-md border border-slate-200 bg-white text-slate-900'
                          : 'rounded-br-md border border-sky-200 bg-sky-100 text-slate-900')
                      }
                    >
                      <p className="whitespace-pre-wrap break-words leading-snug">{m.body}</p>
                      <p className="mt-1 text-xs font-bold text-slate-500 sm:text-sm">
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
          </ul>
          <div className="mt-2 border-t border-slate-400/30 pt-2">
            <div className="flex gap-2">
              <input
                type="text"
                value={txt}
                onChange={(e) => setTxt(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="返信を入力…"
                className="min-h-[52px] min-w-0 flex-1 rounded-full border-2 border-slate-300 bg-white px-4 text-base outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200 sm:text-lg"
              />
              <button
                type="button"
                onClick={send}
                className="shrink-0 rounded-full bg-emerald-600 px-6 py-2.5 text-base font-black text-white shadow hover:bg-emerald-700 sm:text-lg"
              >
                返信
              </button>
            </div>
          </div>
        </div>
      );
    }

    function minuteKeyToLabel(key) {
      const m = parseInt(key, 10);
      if (!Number.isFinite(m)) return key;
      const h = Math.floor(m / 60);
      const mm = m % 60;
      return `${h}:${pad2(mm)}`;
    }

    function formatScheduleScanHint(order) {
      const m = getOrderMinutesForScheduleScan(order);
      if (!Number.isFinite(m)) return '時刻未取得';
      const bid = getScheduleBlockIdForMinutes(m);
      if (!bid) return `${minuteKeyToLabel(String(m))}（枠外 · 自動判定なし）`;
      const meta = SCHEDULE_BLOCKS.find((b) => b.id === bid);
      const vj = getOrderVehicleScheduleKey(order) === 'small' ? '小型' : '大型';
      return `${meta ? meta.label : bid} · ${vj}`;
    }

    function getOrderTimeDisplay(order) {
      if (order.timePointLabel) return order.timePointLabel;
      if (order.timeSlotLabel && !String(order.timeSlotLabel).includes('〜')) return order.timeSlotLabel;
      const tm =
        order.scheduleMatchMinutes ??
        order.timeSlotMinutes ??
        (order.timeSlot != null ? parseInt(String(order.timeSlot), 10) : NaN);
      if (Number.isFinite(tm)) return minuteKeyToLabel(String(tm));
      if (order.timeSlotLabel && String(order.timeSlotLabel).includes('〜')) {
        return String(order.timeSlotLabel).split('〜')[0].trim();
      }
      return '—';
    }

    function formatPreferredDateJp(iso) {
      if (!iso || typeof iso !== 'string') return '—';
      const p = iso.split('-');
      if (p.length === 3) return `${p[0]}/${Number(p[1])}/${Number(p[2])}`;
      return iso;
    }

    function formatQtyForBadge(order) {
      const raw = order.quantityM3 ?? order.quantityCube;
      if (raw === undefined || raw === null) return { text: '—', valid: false };
      const s = String(raw).trim();
      if (s === '') return { text: '—', valid: false };
      return { text: `${s} m³`, valid: true };
    }

    const FACTORY_RESPONSE = {
      ACCEPTED: 'accepted',
      REJECTED: 'rejected',
      PENDING: 'pending',
    };

    function normalizeFactoryResponse(v) {
      if (v === FACTORY_RESPONSE.ACCEPTED || v === FACTORY_RESPONSE.REJECTED || v === FACTORY_RESPONSE.PENDING) {
        return v;
      }
      return null;
    }

    function factorySearchHaystack(order, factoryLabel) {
      if (!order) return '';
      const fl = factoryLabel != null ? String(factoryLabel) : '';
      const parts = [
        order.siteName,
        order.siteAddress,
        order.traderName,
        order.contractorName,
        order.factorySiteName,
        order.acceptedFactoryLabel,
        order.factoryPendingByName,
        orderContactPersonName(order, ''),
        fl,
      ];
      return parts.map((p) => (p == null ? '' : String(p))).join(' ').toLowerCase();
    }

    function orderMatchesFactorySearch(order, raw, factoryLabel) {
      const q = String(raw || '').trim().toLowerCase();
      if (!q) return true;
      return factorySearchHaystack(order, factoryLabel).includes(q);
    }

    function OrderListSearchInput({ id, value, onChange }) {
      return (
        <div className="relative">
          <span className="pointer-events-none absolute left-2 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true">
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
            className="min-h-[44px] w-full rounded-lg border border-slate-200/90 bg-white py-2.5 pl-9 pr-2 text-sm text-slate-800 shadow-inner outline-none ring-0 transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-2 focus:ring-slate-200/80 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500 dark:focus:border-slate-500 dark:focus:ring-slate-700 sm:min-h-[48px] sm:text-base"
            autoComplete="off"
          />
        </div>
      );
    }

    function formatProjectLocation(project) {
      const lat = project?.lat;
      const lng = project?.lng;
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        return `緯度 ${lat} / 経度 ${lng}`;
      }
      return '—';
    }

    function enrichProjectForFactoryList(project, customers) {
      const customer = (customers || []).find((c) => c && String(c.id) === String(project?.customer_id || ''));
      const party = resolveProjectPartyDisplay(project, customer);
      const pt = String(project?.url_token || '').trim();
      const ct = String(customer?.url_token || '').trim();
      const urlToken = isValidSiteOrderUrlToken(pt) ? pt : isValidSiteOrderUrlToken(ct) ? ct : '';
      return {
        ...project,
        url_token: urlToken,
        displayContractor: party.prime,
        displaySubContractor: party.sub,
        displayTrader: party.trader,
        displayBillOnPrime: party.billOnPrime,
        displayBillOnSub: party.billOnSub,
        displaySiteContacts: Array.isArray(project?.site_contacts) ? project.site_contacts : [],
        displayTradingContactName: String(project?.trading_contact_name || '').trim(),
        displayTradingContactPhone: String(project?.trading_contact_phone || '').trim(),
        displayLocation: formatProjectLocation(project),
      };
    }

    function formatTelHref(phone) {
      const digits = String(phone || '').replace(/[^\d+]/g, '');
      return digits ? `tel:${digits}` : '';
    }

    function FactoryAssignedProjectCard({ project, roleLabel, onUrlCopied }) {
      const siteContacts = Array.isArray(project.displaySiteContacts)
        ? project.displaySiteContacts.filter((c) => c && (c.name || c.phone))
        : [];
      const tradingContactName = project.displayTradingContactName || '';
      const tradingContactPhone = project.displayTradingContactPhone || '';
      const showTradingContact = Boolean(tradingContactName || tradingContactPhone);
      return (
        <li className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    'inline-flex rounded-full px-2 py-0.5 text-[10px] font-black uppercase tracking-wide ' +
                    (roleLabel === 'main'
                      ? 'bg-indigo-100 text-indigo-800 ring-1 ring-indigo-200'
                      : 'bg-sky-100 text-sky-800 ring-1 ring-sky-200')
                  }
                >
                  {roleLabel === 'main' ? 'メイン' : 'サブ'}
                </span>
                <h4 className="break-words text-base font-black text-slate-900">{project.name || '—'}</h4>
              </div>
              <dl className="mt-2 grid gap-1.5 text-xs sm:grid-cols-2 sm:text-sm">
                <div>
                  <dt className="font-bold text-slate-500">業者（元請）</dt>
                  <dd className="font-bold text-slate-800">
                    {project.displayContractor}
                    {project.displayBillOnPrime ? <BillingMark /> : null}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold text-slate-500">下請</dt>
                  <dd className="font-bold text-slate-800">
                    {project.displaySubContractor}
                    {project.displayBillOnSub ? <BillingMark /> : null}
                  </dd>
                </div>
                <div>
                  <dt className="font-bold text-slate-500">商社</dt>
                  <dd className="font-bold text-slate-800">{project.displayTrader}</dd>
                </div>
                <div>
                  <dt className="font-bold text-slate-500">現場担当者</dt>
                  <dd className="font-bold text-slate-800">
                    {siteContacts.length === 0 ? (
                      '—'
                    ) : (
                      <ul className="space-y-0.5">
                        {siteContacts.map((c, i) => {
                          const tel = formatTelHref(c.phone);
                          const phoneDisp = formatPhoneNumberJP(c.phone);
                          return (
                            <li key={`site-contact-${i}`}>
                              {c.name || '—'}
                              {phoneDisp ? (
                                <>
                                  {' '}
                                  {tel ? (
                                    <a href={tel} className="font-mono text-indigo-700 underline-offset-2 hover:underline">
                                      {phoneDisp}
                                    </a>
                                  ) : (
                                    <span className="font-mono">{phoneDisp}</span>
                                  )}
                                </>
                              ) : null}
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </dd>
                </div>
                {showTradingContact ? (
                  <div>
                    <dt className="font-bold text-slate-500">商社担当者</dt>
                    <dd className="font-bold text-slate-800">
                      {tradingContactName || '—'}
                      {tradingContactPhone ? (
                        <>
                          {' '}
                          {formatTelHref(tradingContactPhone) ? (
                            <a
                              href={formatTelHref(tradingContactPhone)}
                              className="font-mono text-indigo-700 underline-offset-2 hover:underline"
                            >
                              {formatPhoneNumberJP(tradingContactPhone)}
                            </a>
                          ) : (
                            <span className="font-mono">{formatPhoneNumberJP(tradingContactPhone)}</span>
                          )}
                        </>
                      ) : null}
                    </dd>
                  </div>
                ) : null}
                <div className="sm:col-span-2">
                  <dt className="font-bold text-slate-500">所在地（座標）</dt>
                  <dd className="font-mono text-slate-700">{project.displayLocation}</dd>
                </div>
              </dl>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              <SiteOrderUrlActions
                urlToken={project?.url_token ?? ''}
                siteName={project?.name ?? ''}
                customerName={project.displayContractor !== '—' ? project.displayContractor : ''}
                traderName={project.displayTrader !== '—' ? project.displayTrader : ''}
                onCopied={onUrlCopied}
                compact
              />
              <ProjectExternalUrlActions
                folderUrl={project?.folder_url}
                sheetUrl={project?.sheet_url}
                variant="compact"
              />
            </div>
          </div>
        </li>
      );
    }

    function FactoryAssignedProjectsSection({ title, description, projects, roleLabel, onUrlCopied, emptyMessage }) {
      return (
        <section className="rounded-xl border border-slate-200 bg-slate-50/80 p-3 shadow-sm sm:p-4">
          <div className="border-b border-slate-200 pb-2">
            <h3 className="text-base font-black text-slate-900 sm:text-lg">{title}</h3>
            <p className="mt-0.5 text-xs font-medium text-slate-600 sm:text-sm">{description}</p>
          </div>
          {projects.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-5 text-center text-sm font-bold text-slate-500">
              {emptyMessage}
            </p>
          ) : (
            <ul className="mt-3 grid gap-2">
              {projects.map((p) => (
                <FactoryAssignedProjectCard key={p.id} project={p} roleLabel={roleLabel} onUrlCopied={onUrlCopied} />
              ))}
            </ul>
          )}
        </section>
      );
    }

    function FactoryAssignedProjectsTab({ projects, customers, currentFactoryId, onUrlCopied }) {
      const { mainProjects, subProjects } = useMemo(() => {
        const fid = String(currentFactoryId || '').trim();
        const main = [];
        const sub = [];
        if (!fid) return { mainProjects: main, subProjects: sub };
        for (const raw of projects || []) {
          if (!raw?.id) continue;
          const p = enrichProjectForFactoryList(raw, customers);
          if (String(p.main_factory_id) === fid) {
            main.push(p);
            continue;
          }
          if (Array.isArray(p.sub_factory_ids) && p.sub_factory_ids.some((x) => String(x) === fid)) {
            sub.push(p);
          }
        }
        const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja');
        main.sort(byName);
        sub.sort(byName);
        return { mainProjects: main, subProjects: sub };
      }, [projects, customers, currentFactoryId]);

      const totalCount = mainProjects.length + subProjects.length;

      return (
        <div className="grid gap-3">
          <div className="rounded-xl border border-indigo-200 bg-indigo-50 px-3 py-2.5 dark:bg-indigo-950/40 sm:px-4">
            <p className="text-sm font-black text-indigo-900 dark:text-indigo-100 sm:text-base">割当物件一覧</p>
            <p className="mt-0.5 text-xs font-medium text-indigo-900 dark:text-indigo-100 sm:text-sm">
              ログイン中の工場がメイン（主担当）またはサブ（応援）として登録されている現場です。専用URLを現場担当者へ共有できます。
            </p>
            <p className="mt-1 text-xs font-bold text-indigo-800 dark:text-indigo-100">全 {totalCount} 件（メイン {mainProjects.length} / サブ {subProjects.length}）</p>
          </div>
          <FactoryAssignedProjectsSection
            title="メイン割当物件"
            description="自社が主担当（メイン工場）として割り当てられている現場です。"
            projects={mainProjects}
            roleLabel="main"
            onUrlCopied={onUrlCopied}
            emptyMessage="メイン割当の現場はありません。"
          />
          <FactoryAssignedProjectsSection
            title="サブ割当物件"
            description="自社が応援・副担当（サブ工場）として割り当てられている現場です。"
            projects={subProjects}
            roleLabel="sub"
            onUrlCopied={onUrlCopied}
            emptyMessage="サブ割当の現場はありません。"
          />
        </div>
      );
    }

    function FactoryStatusMini({ status }) {
      const st = normalizeFactoryResponse(status);
      if (st === FACTORY_RESPONSE.ACCEPTED) {
        return (
          <span className="inline-flex rounded-full bg-emerald-600 px-2.5 py-1 text-xs font-black text-white shadow-sm sm:text-sm">
            受注
          </span>
        );
      }
      if (st === FACTORY_RESPONSE.REJECTED) {
        return (
          <span className="inline-flex rounded-full bg-red-600 px-2.5 py-1 text-xs font-black text-white shadow-sm sm:text-sm">
            拒否
          </span>
        );
      }
      if (st === FACTORY_RESPONSE.PENDING) {
        return (
          <span className="inline-flex rounded-full bg-amber-500 px-2.5 py-1 text-xs font-black text-amber-950 shadow-sm sm:text-sm">
            保留
          </span>
        );
      }
      return (
        <span className="inline-flex rounded-full border border-slate-300 bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600 sm:text-sm">
          回答待ち
        </span>
      );
    }

    function OrderFullEditModal({ order, open, onClose, onSave, projectById, customerById, onSiteUrlCopied }) {
      const [editData, setEditData] = useState({
        preferredDate: '',
        timeSlot: String(TIME_SLOTS[0]?.value ?? '480'),
        vehicleType: 'large',
        quantityM3: '',
        unloadDuration: '30',
        traderName: '',
        contractorName: '',
        siteName: '',
        siteAddress: '',
        sitePhone: '',
        mixText: '',
        hasTest: false,
      });

      useEffect(() => {
        if (!order || !open) return;
        const ts = order.timeSlot != null ? String(order.timeSlot) : '';
        const ok = TIME_SLOTS.some((s) => s.value === ts);
        const q = order.quantityM3 ?? order.quantityCube;
        const projectId = String(order?.project_id ?? order?.projectId ?? '').trim();
        const linkedProject = projectId ? projectById?.[projectId] : null;
        const linkedCustomerId = String(
          linkedProject?.customer_id ?? order?.customer_id ?? order?.customerId ?? '',
        ).trim();
        const linkedCustomer =
          (linkedCustomerId ? customerById?.[linkedCustomerId] : null) ?? null;
        const contractorCustomerId = String(
          order?.contractor_customer_id ?? order?.contractorCustomerId ?? '',
        ).trim();
        const contractorCustomer =
          (contractorCustomerId ? customerById?.[contractorCustomerId] : null) ?? null;
        const partyDisplay = resolveOrderPartyDisplay(order, {
          project: linkedProject,
          customer: linkedCustomer,
          contractorCustomer,
        });
        const explicitTrader = order.traderName != null ? String(order.traderName).trim() : '';
        const explicitContractor =
          order.contractorName != null ? String(order.contractorName).trim() : '';
        setEditData({
          preferredDate: order.preferredDate && typeof order.preferredDate === 'string' ? order.preferredDate : '',
          timeSlot: ok ? ts : String(TIME_SLOTS[0]?.value ?? '480'),
          vehicleType: order.vehicleType === 'small' ? 'small' : 'large',
          quantityM3: q != null && String(q).trim() !== '' && String(q) !== 'null' ? String(q) : '',
          unloadDuration: String(order.unloadDurationMinutes || order.unloadDuration || order.unloadingTime || '30'),
          traderName:
            explicitTrader || (partyDisplay.trader !== '—' ? partyDisplay.trader : ''),
          contractorName:
            explicitContractor || (partyDisplay.prime !== '—' ? partyDisplay.prime : ''),
          siteName:
            sanitizeSiteNameValue(order.siteName) ||
            sanitizeSiteNameValue(order.projectName) ||
            '',
          siteAddress: order.siteAddress != null ? String(order.siteAddress) : '',
          sitePhone: order.sitePhone != null ? String(order.sitePhone) : '',
          mixText: order.mixText != null ? String(order.mixText) : '',
          hasTest: Boolean(order.has_test),
        });
      }, [order?.id, open, projectById, customerById]);

      if (!open || !order) return null;

      const projectId = String(order?.project_id ?? order?.projectId ?? '').trim();
      const linkedProject = projectId ? projectById?.[projectId] : null;
      const linkedCustomerId = String(
        linkedProject?.customer_id ?? order?.customer_id ?? order?.customerId ?? '',
      ).trim();
      const linkedCustomer =
        (linkedCustomerId ? customerById?.[linkedCustomerId] : null) ?? null;
      const projectPartyDisplay = linkedProject
        ? resolveProjectPartyDisplay(linkedProject, linkedCustomer)
        : null;
      const fieldLabel = 'mb-1 block text-sm font-bold text-slate-600 dark:text-slate-300 sm:text-base';
      const fieldInput =
        'mt-1 min-h-[48px] w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-base text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 sm:text-lg';
      const handleInputChange = (e) => {
        const { name, value, type, checked } = e.target;
        setEditData((prev) => ({
          ...prev,
          [name]: type === 'checkbox' ? checked : value,
        }));
      };
      const setEditField = (name, value) => {
        setEditData((prev) => ({ ...prev, [name]: value }));
      };

      const handleSubmit = (e) => {
        e.preventDefault();
        const slotMeta = TIME_SLOTS.find((s) => s.value === editData.timeSlot);
        const timeMinutes = parseInt(editData.timeSlot, 10);
        const slotLabel = slotMeta?.label ?? '';
        const patch = {
          preferredDate: editData.preferredDate,
          timeSlot: editData.timeSlot,
          timeSlotMinutes: Number.isFinite(timeMinutes) ? timeMinutes : null,
          timeSlotLabel: slotLabel,
          timePointLabel: slotLabel,
          scheduleMatchDate: editData.preferredDate,
          scheduleMatchMinutes: Number.isFinite(timeMinutes) ? timeMinutes : null,
          vehicleType: editData.vehicleType,
          vehicleLabel: editData.vehicleType === 'large' ? '大型' : '小型',
          quantityM3: editData.quantityM3.trim(),
          unloadDuration: editData.unloadDuration,
          unloadDurationMinutes: editData.unloadDuration,
          unloadDurationLabel: factoryUnloadDurationLabel({ unloadDuration: editData.unloadDuration }),
          traderName: editData.traderName.trim(),
          contractorName: editData.contractorName.trim(),
          siteName: sanitizeSiteNameValue(editData.siteName),
          siteAddress: editData.siteAddress.trim(),
          sitePhone: editData.sitePhone.trim(),
          mixText: editData.mixText.trim(),
          has_test: editData.hasTest,
        };
        onSave(order.id, patch);
      };

      return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div
            className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] flex flex-col overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby="factory-order-edit-title"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h2 id="factory-order-edit-title" className="text-lg font-black text-slate-900 sm:text-xl">
                注文内容の編集
              </h2>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-black text-slate-700 hover:bg-slate-100 sm:text-base"
              >
                閉じる
              </button>
            </div>
            <form className="flex min-h-0 flex-1 flex-col" onSubmit={handleSubmit}>
              <div className="min-h-0 flex-1 overflow-y-auto pr-2 px-4 py-4">
                <section className="space-y-4 rounded-xl border-2 border-indigo-300 bg-indigo-50 p-3 shadow-inner dark:bg-indigo-950/40">
                  <div>
                    <label className={fieldLabel} htmlFor="foe-date">日付（納入日）</label>
                    <input id="foe-date" name="preferredDate" type="date" value={editData.preferredDate} onChange={handleInputChange} className={fieldInput} required />
                  </div>
                  <div>
                    <label className={fieldLabel} htmlFor="foe-slot">時間（出荷時間）</label>
                    <select id="foe-slot" name="timeSlot" value={editData.timeSlot} onChange={handleInputChange} className={fieldInput}>
                      {TIME_SLOTS.map((s) => (
                        <option key={s.value} value={s.value}>{s.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={fieldLabel} htmlFor="foe-unload-duration">1台あたりの荷卸し（車返却）予定時間</label>
                    <select id="foe-unload-duration" name="unloadDuration" value={editData.unloadDuration} onChange={handleInputChange} className={fieldInput}>
                      <option value="15">15分</option>
                      <option value="30">30分（標準）</option>
                      <option value="45">45分</option>
                      <option value="60">60分（手押し車など時間要）</option>
                      <option value="95_plus">95分以上（要相談）</option>
                    </select>
                  </div>
                  <div>
                    <span className={fieldLabel}>車両（車種）</span>
                    <div className="mt-2 flex gap-3">
                      <button type="button" onClick={() => setEditField('vehicleType', 'large')} className={'min-h-[48px] flex-1 rounded-lg border-2 text-base font-black sm:text-lg ' + (editData.vehicleType === 'large' ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50')}>大型</button>
                      <button type="button" onClick={() => setEditField('vehicleType', 'small')} className={'min-h-[48px] flex-1 rounded-lg border-2 text-base font-black sm:text-lg ' + (editData.vehicleType === 'small' ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50')}>小型</button>
                    </div>
                  </div>
                  <div>
                    <label className={fieldLabel} htmlFor="foe-qty">数量（m³）</label>
                    <input id="foe-qty" name="quantityM3" type="text" inputMode="decimal" value={editData.quantityM3} onChange={handleInputChange} className={fieldInput} />
                  </div>
                  <div className="rounded-lg border-2 border-indigo-200 bg-white px-3 py-3">
                    <label className="flex cursor-pointer items-start gap-3" htmlFor="foe-has-test">
                      <input id="foe-has-test" name="hasTest" type="checkbox" checked={editData.hasTest} onChange={handleInputChange} className="mt-1 h-5 w-5 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                      <span className="min-w-0 text-sm font-bold text-slate-800 sm:text-base">
                        試験の有無（試験あり）
                        <span className="mt-1 block text-xs font-medium text-slate-500">未チェックは試験なしとして保存されます。</span>
                      </span>
                    </label>
                  </div>
                </section>

                <section className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-white p-3">
                  <p className="text-xs font-black uppercase tracking-wider text-slate-500">物件基本情報</p>
                  {projectPartyDisplay ? (
                    <dl className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
                      <div>
                        <dt className="font-bold text-slate-500">業者（元請）</dt>
                        <dd className="font-black text-slate-900">
                          {projectPartyDisplay.prime}
                          {projectPartyDisplay.billOnPrime ? <BillingMark /> : null}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-bold text-slate-500">下請</dt>
                        <dd className="font-black text-slate-900">
                          {projectPartyDisplay.sub}
                          {projectPartyDisplay.billOnSub ? <BillingMark /> : null}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-bold text-slate-500">商社</dt>
                        <dd className="font-black text-slate-900">{projectPartyDisplay.trader}</dd>
                      </div>
                    </dl>
                  ) : null}
                  <div>
                    <label className={fieldLabel} htmlFor="foe-contractor">業者名</label>
                    <input id="foe-contractor" name="contractorName" type="text" value={editData.contractorName} onChange={handleInputChange} className={fieldInput} />
                  </div>
                  <div>
                    <label className={fieldLabel} htmlFor="foe-trader">商社名</label>
                    <input id="foe-trader" name="traderName" type="text" value={editData.traderName} onChange={handleInputChange} className={fieldInput} />
                  </div>
                  <div>
                    <label className={fieldLabel} htmlFor="foe-site">
                      現場名
                    </label>
                    <input id="foe-site" name="siteName" type="text" value={editData.siteName} onChange={handleInputChange} className={fieldInput} placeholder="例：〇〇ビル新築工事" />
                    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2">
                      <p className="text-[10px] font-bold text-slate-500">専用発注URL（現場名とは別）</p>
                      <SiteOrderUrlActions
                        urlToken={resolveSiteUrlToken(order, projectById, customerById)}
                        siteName={editData.siteName || resolveOrderSiteDisplayName(order)}
                        customerName={
                          customerById?.[String(order?.customer_id ?? order?.customerId ?? '')]?.company_name ||
                          editData.contractorName
                        }
                        traderName={editData.traderName}
                        project={projectById?.[String(order?.project_id ?? order?.projectId ?? '')]}
                        customer={customerById?.[String(order?.customer_id ?? order?.customerId ?? '')]}
                        onCopied={onSiteUrlCopied}
                        compact
                      />
                    </div>
                  </div>
                  <div>
                    <label className={fieldLabel} htmlFor="foe-addr">現場住所</label>
                    <input id="foe-addr" name="siteAddress" type="text" value={editData.siteAddress} onChange={handleInputChange} className={fieldInput} />
                  </div>
                </section>

                <section className="mt-4 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs font-black uppercase tracking-wider text-slate-500">補足情報</p>
                  <div>
                    <label className={fieldLabel} htmlFor="foe-phone">電話番号</label>
                    <input id="foe-phone" name="sitePhone" type="text" value={editData.sitePhone} onChange={handleInputChange} className={fieldInput} />
                  </div>
                  <div>
                    <label className={fieldLabel} htmlFor="foe-mix">配合</label>
                    <input id="foe-mix" name="mixText" type="text" value={editData.mixText} onChange={handleInputChange} className={fieldInput} />
                  </div>
                </section>
              </div>
              <div className="flex shrink-0 flex-col gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:flex-row">
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[52px] flex-1 rounded-xl border-2 border-slate-300 bg-white text-base font-black text-slate-800 hover:bg-slate-50 sm:text-lg"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  className="min-h-[52px] flex-1 rounded-xl border-2 border-indigo-700 bg-indigo-600 text-base font-black text-white shadow hover:bg-indigo-700 sm:text-lg"
                >
                  保存
                </button>
              </div>
            </form>
          </div>
        </div>
      );
    }

    function OrderRequestCard({
      order,
      idx,
      variant,
      currentFactoryId,
      isRead,
      onMarkRead,
      onAcceptOrder,
      onRejectOrder,
      onConsultOrder,
      onCustomerCancelOrder,
      onHideOrder,
      onResponseStatusChange,
      onRequestUnlock,
      onOrderFullPatch,
      chatMessages,
      hasUnreadChat,
      onMarkChatRead,
      onFactoryChatSent,
      factoryName,
      forceExpanded,
      projectById,
      customerById,
      organizationById,
      onSiteUrlCopied,
    }) {
      const isToast = variant === 'toast';
      const canAcceptOrder = !isToast && typeof onAcceptOrder === 'function' && Boolean(order.id);
      const canRejectOrder = !isToast && typeof onRejectOrder === 'function' && Boolean(order.id);
      const canConsultOrder = !isToast && typeof onConsultOrder === 'function' && Boolean(order.id);
      const canCustomerCancelOrder = !isToast && typeof onCustomerCancelOrder === 'function' && Boolean(order.id);
      const canHideOrder = !isToast && typeof onHideOrder === 'function' && Boolean(order.id);
      const canSetStatus = !isToast && typeof onResponseStatusChange === 'function' && Boolean(order.id);
      const orderStatus = order.status != null ? String(order.status) : '';
      const responseStatus = normalizeFactoryResponse(order.factoryResponseStatus || orderStatus);
      const responseLocked = Boolean(order.factoryResponseLocked);
      const assignedFactoryId = getAssignedFactoryId(order);
      const currentFid = normalizeFactoryIdForCompare(currentFactoryId);
      const rejectedFactoryIds = Array.isArray(order.rejected_factory_ids)
        ? order.rejected_factory_ids.map((x) => String(x).trim()).filter(Boolean)
        : [];
      const isAccepted = orderStatus === 'accepted' || responseStatus === FACTORY_RESPONSE.ACCEPTED;
      const isCustomerCancelled = orderStatus === 'customer_cancelled';
      const isAcceptedByMe = isOrderAcceptedByFactory(order, currentFid);
      const isAcceptedByOther = Boolean(isAccepted && assignedFactoryId && (!currentFid || !isSameFactoryId(assignedFactoryId, currentFid)));
      const acceptedFactoryLabel =
        String(order.factorySiteName || '').trim() ||
        String(order.acceptedFactoryLabel || '').replace(/^受注工場：/, '').trim() ||
        assignedFactoryId;
      const isRejectedByMe = currentFid && rejectedFactoryIds.includes(currentFid);
      const isConsulting = String(order.factory_consult_status || '').trim() === 'consulting';
      const consultByFid = normalizeFactoryIdForCompare(order.factory_consult_by_factory_id);
      const isConsultingByMe = isConsulting && currentFid && consultByFid === currentFid;
      const terminalLocked =
        responseLocked &&
        (responseStatus === FACTORY_RESPONSE.ACCEPTED || responseStatus === FACTORY_RESPONSE.REJECTED);
      const canEditOrder = isAcceptedByMe && !isCustomerCancelled;
      const canOpenOrderMenu =
        canEditOrder || (isAcceptedByMe && !isCustomerCancelled && canCustomerCancelOrder);
      const isActionable = !isAccepted && !isCustomerCancelled && !isRejectedByMe && !terminalLocked;

      const [tick, setTick] = useState(0);
      const pendingLocalStartRef = useRef(null);
      const [expanded, setExpanded] = useState(false);
      const [editOpen, setEditOpen] = useState(false);
      const [actionMenuOpen, setActionMenuOpen] = useState(false);
      const articleRef = useRef(null);

      useEffect(() => {
        if (expanded && order?.id && typeof onMarkChatRead === 'function') {
          onMarkChatRead(order.id, chatMessages);
        }
      }, [expanded, order?.id, chatMessages, onMarkChatRead]);

      useEffect(() => {
        if (!forceExpanded) return;
        setExpanded(true);
        window.setTimeout(() => {
          articleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 80);
      }, [forceExpanded]);

      const markRead = () => {
        if (!isToast && order?.id && typeof onMarkRead === 'function') {
          onMarkRead(order.id);
        }
      };

      useEffect(() => {
        if (responseStatus === FACTORY_RESPONSE.PENDING && !order.factoryPendingStartedAt) {
          if (pendingLocalStartRef.current == null) {
            pendingLocalStartRef.current = Date.now();
            setTick((t) => t + 1);
          }
        } else if (responseStatus !== FACTORY_RESPONSE.PENDING) {
          pendingLocalStartRef.current = null;
        }
      }, [responseStatus, order.factoryPendingStartedAt]);

      useEffect(() => {
        if (isToast || responseStatus !== FACTORY_RESPONSE.PENDING) return undefined;
        const id = window.setInterval(() => setTick((t) => t + 1), 1000);
        return () => window.clearInterval(id);
      }, [isToast, responseStatus]);

      const pendingCountdown = useMemo(() => {
        if (responseStatus !== FACTORY_RESPONSE.PENDING) return null;
        const iso = order.factoryPendingStartedAt;
        const parsed = iso && Date.parse(iso);
        const startMs = Number.isFinite(parsed)
          ? parsed
          : pendingLocalStartRef.current != null
            ? pendingLocalStartRef.current
            : null;
        if (startMs == null) return { label: '05:00', remainingSec: 300, expired: false };
        const elapsed = Math.floor((Date.now() - startMs) / 1000);
        const remainingSec = Math.max(0, 300 - elapsed);
        const mm = Math.floor(remainingSec / 60);
        const ss = remainingSec % 60;
        const label = `${pad2(mm)}:${pad2(ss)}`;
        return { label, remainingSec, expired: remainingSec <= 0 };
      }, [responseStatus, order.factoryPendingStartedAt, tick]);

      const dateStr = formatPreferredDateJp(order.preferredDate);
      const slotStr = getOrderTimeDisplay(order);
      const vehicle =
        order.vehicleLabel ||
        (order.vehicleType === 'small' ? '小型' : '大型');
      const q = formatQtyForBadge(order);
      const hasTest = Boolean(order.has_test);
      const elapsedMin =
        Number.isFinite(order.escalationElapsedMinutes) ? Number(order.escalationElapsedMinutes) : null;
      const nextEscalationMin =
        Number.isFinite(order.escalationNextThresholdMinutes)
          ? Number(order.escalationNextThresholdMinutes)
          : null;
      const escalationLabel = isCustomerCancelled
        ? 'お客様都合キャンセルのため停止'
        : isAccepted
        ? '受注確定のため、通知を終了しました。'
        : elapsedMin == null
          ? '経過時間 —'
          : nextEscalationMin == null
            ? `経過 ${elapsedMin}分 · 全体公開中`
            : `経過 ${elapsedMin}分 · 次段階まで ${Math.max(0, nextEscalationMin - elapsedMin)}分`;
      const stateBanner = isCustomerCancelled
        ? { label: '⚠️お客様都合キャンセル', className: 'border-red-700 bg-red-600 text-white' }
        : isAcceptedByMe
        ? { label: 'あなたが受注しました', className: 'border-emerald-700 bg-emerald-600 text-white' }
        : isAcceptedByOther
          ? { label: `【${acceptedFactoryLabel}】が受注済み`, className: 'border-slate-500 bg-slate-700 text-white' }
          : isRejectedByMe
            ? { label: '見送り済み', className: 'border-slate-500 bg-slate-200 text-slate-700' }
            : null;
      const siteNm = order.siteName?.trim() || '';
      const addrRaw = order.siteAddress?.trim() || '';
      const addr = addrRaw || '（住所未入力）';
      const mixDisplay = String(order.confirmedMixText ?? order.mixText ?? '').trim() || '—';
      const siteHeroLine = siteNm || addrRaw || '（未入力）';
      const party = orderPartyInfo(order, { preferSiteContact: true });
      const siteContactName = resolveSiteContactName(order);
      const ordererName = resolveOrdererName(order);
      const sitePhoneFormatted = formatPhoneNumberJP(resolveSitePhone(order));
      const phone = sitePhoneFormatted;
      const projectId = String(order?.project_id ?? order?.projectId ?? '').trim();
      const linkedProject = projectId ? projectById?.[projectId] : null;
      const linkedCustomerId = String(
        linkedProject?.customer_id ?? order?.customer_id ?? order?.customerId ?? '',
      ).trim();
      const linkedCustomer =
        (linkedCustomerId ? customerById?.[linkedCustomerId] : null) ?? null;
      const orderCustomerId = String(
        order?.customer_id ?? order?.customerId ?? '',
      ).trim();
      const orderCustomer =
        (orderCustomerId ? customerById?.[orderCustomerId] : null) ?? null;
      const contractorCustomerId = String(
        order?.contractor_customer_id ?? order?.contractorCustomerId ?? '',
      ).trim();
      const contractorCustomer =
        (contractorCustomerId ? customerById?.[contractorCustomerId] : null) ?? null;
      const orderPartyDisplay = resolveOrderPartyDisplay(order, {
        project: linkedProject,
        customer: linkedCustomer,
        contractorCustomer,
        orderingCustomer: orderCustomer,
        organizationById: organizationById || {},
      });
      const {
        prime: displayPrime,
        sub: displaySub,
        trader: displayTrader,
        billOnPrime,
        billOnSub,
        billingIsSub,
        orderedByLabel,
        orderedByCompanyName,
        orderedByIsProxy,
      } = orderPartyDisplay;
      const ordererPhoneFormatted = formatPhoneNumberJP(
        String(orderCustomer?.phone_number ?? '').trim(),
      );
      const ordererDisplayLine =
        [String(orderedByCompanyName || '').trim(), ordererName, ordererPhoneFormatted]
          .filter(Boolean)
          .join(' ') || '—';
      const missingBillingSub = billingIsSub && displaySub === '—';
      const isSpotOrder = Boolean(order.is_spot);
      const isLarge = vehicle === '大型';
      const unloadDurationText = factoryUnloadDurationLabel(order);
      const matchDate = order.scheduleMatchDate || order.preferredDate;
      const matchMinRaw =
        order.scheduleMatchMinutes ??
        order.timeSlotMinutes ??
        (String(order.timeSlot || '').match(/^\d+$/) ? parseInt(String(order.timeSlot), 10) : NaN);
      const matchMinOk = Number.isFinite(matchMinRaw);
      const pad = isToast ? 'p-3.5' : 'p-3 sm:p-3.5';

      const cardFrame =
        isToast
          ? 'rounded-none border-0 bg-white shadow-none dark:bg-slate-800 '
          : responseStatus === FACTORY_RESPONSE.ACCEPTED
            ? 'rounded-2xl border-[3px] border-emerald-500 bg-white shadow-xl ring-2 ring-emerald-200/80 dark:bg-slate-800 dark:ring-emerald-800/60 '
            : responseStatus === FACTORY_RESPONSE.PENDING
              ? 'rounded-2xl border-[3px] border-amber-400 bg-white shadow-xl ring-2 ring-amber-200/90 dark:bg-slate-800 dark:ring-amber-800/60 '
              : 'rounded-2xl border-2 border-slate-800/15 bg-white shadow-xl dark:border-slate-600 dark:bg-slate-800 ' +
                (idx === 0 && !isRead && !isRejectedByMe ? 'ring-4 ring-orange-400 ring-offset-2 ring-offset-slate-50 dark:ring-offset-slate-900 ' : '');

      /** メタ情報（1行目以外）の統一サイズ — ラベル / 値 */
      const metaLabelClass =
        'text-sm font-bold uppercase tracking-wider text-slate-500 dark:text-slate-300';
      const metaValueClass = 'text-xl font-bold text-slate-900 dark:text-slate-100';
      const metaValueMutedClass = 'text-xl font-bold leading-snug text-slate-700 dark:text-slate-100';
      const primaryValueDate = isToast ? 'text-base sm:text-lg' : 'text-lg sm:text-xl';
      const primaryValueTime = isToast ? 'text-base sm:text-lg' : 'text-lg sm:text-xl';
      const dateWrapClass =
        'rounded-lg border-2 border-sky-500 bg-gradient-to-b from-sky-50 to-sky-100/90 px-2 py-2 shadow-sm ring-1 ring-sky-200/70 dark:border-sky-500/60 dark:from-sky-950/50 dark:to-sky-900/40 dark:ring-sky-800/40';
      const timeWrapClass =
        'rounded-lg border-2 border-violet-500 bg-gradient-to-b from-violet-50 to-violet-100/90 px-2 py-2 shadow-sm ring-1 ring-violet-200/70 dark:border-violet-500/60 dark:from-violet-950/50 dark:to-violet-900/40 dark:ring-violet-800/40';
      const datePillClass =
        'inline-block rounded-md bg-sky-600 px-1.5 py-0.5 text-[11px] font-black leading-none text-white shadow-sm sm:text-xs';
      const timePillClass =
        'inline-block rounded-md bg-violet-600 px-1.5 py-0.5 text-[11px] font-black leading-none text-white shadow-sm sm:text-xs';
      const unloadWrapClass =
        'rounded-lg border-2 border-cyan-600 bg-gradient-to-b from-cyan-50 to-sky-100/90 px-2 py-2 shadow-sm ring-1 ring-cyan-200/70 dark:border-cyan-500/60 dark:from-cyan-950/50 dark:to-cyan-900/40 dark:ring-cyan-800/40';
      const unloadPillClass =
        'inline-block rounded-md bg-cyan-700 px-1.5 py-0.5 text-[11px] font-black leading-none text-white shadow-sm sm:text-xs';
      const vehicleWrapClass = isLarge
        ? 'rounded-lg border-2 border-emerald-600 bg-gradient-to-b from-emerald-50 to-emerald-100/90 px-2 py-2 shadow-sm ring-1 ring-emerald-200/70 dark:border-emerald-500/60 dark:from-emerald-950/50 dark:to-emerald-900/40 dark:ring-emerald-800/40'
        : 'rounded-lg border-2 border-amber-500 bg-gradient-to-b from-amber-50 to-amber-100/90 px-2 py-2 shadow-sm ring-1 ring-amber-200/70 dark:border-amber-500/60 dark:from-amber-950/50 dark:to-amber-900/40 dark:ring-amber-800/40';
      const vehiclePillClass = isLarge
        ? 'inline-block rounded-md bg-emerald-700 px-1.5 py-0.5 text-[11px] font-black leading-none text-white shadow-sm sm:text-xs'
        : 'inline-block rounded-md bg-amber-600 px-1.5 py-0.5 text-[11px] font-black leading-none text-white shadow-sm sm:text-xs';
      const qtyWrapClass = q.valid
        ? 'rounded-lg border-2 border-orange-500 bg-gradient-to-b from-orange-50 to-amber-50/90 px-2 py-2 shadow-sm ring-1 ring-orange-200/70 dark:border-orange-500/60 dark:from-orange-950/50 dark:to-orange-900/40 dark:ring-orange-800/40'
        : 'rounded-lg border-2 border-slate-400 bg-gradient-to-b from-slate-50 to-slate-100/90 px-2 py-2 shadow-sm ring-1 ring-slate-200/60 dark:border-slate-600 dark:from-slate-900/50 dark:to-slate-800/40 dark:ring-slate-700/40';
      const qtyPillClass = q.valid
        ? 'inline-block rounded-md bg-orange-600 px-1.5 py-0.5 text-[11px] font-black leading-none text-white shadow-sm sm:text-xs'
        : 'inline-block rounded-md bg-slate-500 px-1.5 py-0.5 text-[11px] font-black leading-none text-white shadow-sm sm:text-xs';
      const testWrapClass = hasTest
        ? 'rounded-lg border-2 border-fuchsia-600 bg-gradient-to-b from-fuchsia-50 to-fuchsia-100/90 px-2 py-2 shadow-sm ring-1 ring-fuchsia-200/70 dark:border-fuchsia-500/60 dark:from-fuchsia-950/50 dark:to-fuchsia-900/40 dark:ring-fuchsia-800/40'
        : 'rounded-lg border-2 border-slate-400 bg-gradient-to-b from-slate-50 to-slate-100/90 px-2 py-2 shadow-sm ring-1 ring-slate-200/60 dark:border-slate-600 dark:from-slate-900/50 dark:to-slate-800/40 dark:ring-slate-700/40';
      const testPillClass = hasTest
        ? 'inline-block rounded-md bg-fuchsia-700 px-1.5 py-0.5 text-[11px] font-black leading-none text-white shadow-sm sm:text-xs'
        : 'inline-block rounded-md bg-slate-500 px-1.5 py-0.5 text-[11px] font-black leading-none text-white shadow-sm sm:text-xs';

      const renderPrimarySummary = (opts) => {
        const { borderless } = opts || {};
        return (
          <div
            className={
              borderless
                ? ''
                : 'rounded-lg border border-slate-200/90 bg-slate-50/80 px-2.5 py-3.5 shadow-inner dark:border-slate-600/80 dark:bg-slate-800/80 sm:px-3'
            }
          >
            <div className="-mx-0.5 w-full overflow-x-auto overflow-y-visible">
              <div className={ORDER_GRID_TOP + ' border-b border-slate-200/80 pb-3.5'}>
              <div className="min-w-[120px] shrink-0 text-left">
                <div className={dateWrapClass}>
                  <span className={datePillClass}>日付</span>
                  <p
                    className={
                      'mt-1.5 whitespace-nowrap font-black tabular-nums text-sky-950 dark:text-sky-200 ' +
                      primaryValueDate
                    }
                    aria-label={`配車希望日 ${dateStr}`}
                  >
                    {dateStr}
                  </p>
                </div>
              </div>
              <div className="min-w-[120px] shrink-0 text-left">
                <div className={timeWrapClass}>
                  <span className={timePillClass}>時刻</span>
                  <p
                    className={
                      'mt-1.5 whitespace-nowrap font-black tabular-nums text-violet-950 dark:text-violet-200 ' +
                      primaryValueTime
                    }
                    aria-label={`配車希望時刻 ${slotStr}`}
                  >
                    {slotStr}
                  </p>
                </div>
              </div>
              <div className="min-w-[120px] shrink-0 text-left">
                <div className={unloadWrapClass}>
                  <span className={unloadPillClass}>荷卸し</span>
                  <p
                    className={
                      'mt-1.5 whitespace-nowrap font-black tabular-nums text-cyan-950 dark:text-cyan-200 ' +
                      primaryValueTime
                    }
                    aria-label={`荷卸し予定時間 ${unloadDurationText}`}
                  >
                    {unloadDurationText}
                  </p>
                </div>
              </div>
              <div className="min-w-0 shrink-0 text-left">
                <div className={vehicleWrapClass}>
                  <span className={vehiclePillClass}>車種</span>
                  <p
                    className={
                      'mt-1.5 whitespace-nowrap font-black tabular-nums ' +
                      primaryValueDate +
                      ' ' +
                      (isLarge ? 'text-emerald-900 dark:text-emerald-200' : 'text-amber-950 dark:text-amber-200')
                    }
                    aria-label={`車種 ${vehicle}`}
                  >
                    {vehicle}
                  </p>
                </div>
              </div>
              <div className="min-w-0 shrink-0 text-left">
                <div className={qtyWrapClass}>
                  <span className={qtyPillClass}>数量</span>
                  <p
                    className={
                      'mt-1.5 min-w-0 font-mono font-black tabular-nums ' +
                      primaryValueDate +
                      ' ' +
                      (q.valid ? 'text-orange-950 dark:text-orange-200' : 'text-slate-600 dark:text-slate-300')
                    }
                    aria-label={`数量 ${q.text}`}
                  >
                    {q.text}
                  </p>
                </div>
              </div>
              <div className="min-w-0 shrink-0 text-left">
                <div className={testWrapClass}>
                  <span className={testPillClass}>試験</span>
                  <p
                    className={
                      'mt-1.5 whitespace-nowrap font-black tabular-nums ' +
                      primaryValueDate +
                      ' ' +
                      (hasTest ? 'text-fuchsia-950 dark:text-fuchsia-200' : 'text-slate-600 dark:text-slate-300')
                    }
                    aria-label={hasTest ? '試験あり' : '試験なし'}
                  >
                    {hasTest ? 'あり' : 'なし'}
                  </p>
                </div>
              </div>
            </div>
            </div>
            <div className={ORDER_GRID_META_2X2 + ' border-t border-slate-200/80 pt-3.5 dark:border-slate-600/80'}>
              <div className="col-span-2 min-w-0 text-left">
                {isToast ? (
                  <p className="flex flex-wrap items-center gap-x-1.5 text-sm font-bold text-slate-700 dark:text-slate-200">
                    <span>
                      業者: {displayPrime}
                      {billOnPrime ? <BillingMark /> : null}
                    </span>
                    {displaySub !== '—' ? (
                      <span className="text-slate-500 dark:text-slate-300">
                        ／ 下請: {displaySub}
                        {billOnSub ? <BillingMark /> : null}
                      </span>
                    ) : null}
                    {displayTrader !== '—' ? (
                      <span className="text-slate-500 dark:text-slate-300">
                        ／ 商社: {displayTrader}
                      </span>
                    ) : null}
                    {orderedByIsProxy ? (
                      <span className="text-slate-500 dark:text-slate-300">
                        ／ 発注: {orderedByLabel}
                      </span>
                    ) : null}
                    {missingBillingSub ? (
                      <span className="text-sm font-bold text-red-600">
                        ⚠請求先(下請)未設定
                      </span>
                    ) : null}
                  </p>
                ) : (
                  <dl
                    className={
                      'grid grid-cols-2 items-start gap-y-3 ' +
                      (orderedByIsProxy
                        ? 'lg:grid-cols-[3fr_3fr_2fr_3fr]'
                        : 'lg:grid-cols-[3fr_3fr_2fr]')
                    }
                  >
                    <div className="min-w-0 pr-2">
                      <dt className={metaLabelClass}>業者（元請）</dt>
                      <dd className={'mt-0.5 break-words ' + metaValueClass}>
                        {displayPrime}
                        {billOnPrime ? <BillingMark /> : null}
                      </dd>
                    </div>
                    <div className="min-w-0 border-l border-slate-200 px-2 dark:border-slate-600">
                      <dt className={metaLabelClass}>下請</dt>
                      <dd className={'mt-0.5 break-words ' + metaValueClass}>
                        {displaySub}
                        {billOnSub && displaySub !== '—' ? <BillingMark /> : null}
                        {missingBillingSub ? (
                          <span className="mt-0.5 block text-sm font-bold text-red-600">
                            ⚠請求先(下請)未設定
                          </span>
                        ) : null}
                      </dd>
                    </div>
                    <div className="min-w-0 border-l border-slate-200 px-2 dark:border-slate-600">
                      <dt className={metaLabelClass}>商社</dt>
                      <dd className={'mt-0.5 break-words ' + metaValueClass}>
                        {displayTrader}
                      </dd>
                    </div>
                    {orderedByIsProxy ? (
                      <div className="min-w-0 border-l border-slate-200 pl-2 dark:border-slate-600">
                        <dt className={metaLabelClass}>発注</dt>
                        <dd className={'mt-0.5 break-words ' + metaValueClass}>
                          {orderedByLabel}
                          <span className="ml-1 inline-block rounded bg-sky-100 px-1 align-middle text-sm font-black text-sky-800 dark:bg-sky-900/60 dark:text-sky-200">
                            代理
                          </span>
                        </dd>
                      </div>
                    ) : null}
                  </dl>
                )}
              </div>
              <div className="col-span-2 flex min-w-0 flex-col border-t border-slate-200/60 pt-2.5 dark:border-slate-600/60 sm:flex-row">
                <div className="min-w-0 basis-full pb-2 sm:basis-1/2 sm:border-r sm:border-slate-200/60 sm:pb-0 sm:pr-2 dark:sm:border-slate-600/60">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className={metaLabelClass}>現場名</p>
                    {!isToast ? (
                      <SiteOrderUrlActions
                        urlToken={resolveSiteUrlToken(order, projectById, customerById)}
                        siteName={party.site !== '—' ? party.site : siteNm}
                        customerName={displayPrime !== '—' ? displayPrime : ''}
                        traderName={displayTrader !== '—' ? displayTrader : ''}
                        project={linkedProject}
                        customer={orderCustomer}
                        onCopied={onSiteUrlCopied}
                        compact
                      />
                    ) : null}
                  </div>
                  <p className={'mt-0.5 truncate ' + metaValueClass} title={party.site}>
                    {party.site}
                  </p>
                </div>
                <div className="flex min-w-0 basis-full items-start gap-2 border-t border-slate-200/60 pt-2 sm:basis-1/2 sm:border-t-0 sm:pl-2 sm:pt-0 dark:border-slate-600/60">
                  <div className="min-w-0 flex-1">
                    <p className={metaLabelClass}>現場住所</p>
                    <p className={'mt-0.5 truncate ' + metaValueMutedClass} title={addr}>
                      {addr}
                    </p>
                  </div>
                  <div className="min-w-0 max-w-[42%] shrink basis-[38%]">
                    <p className={metaLabelClass}>配合</p>
                    <p className={'mt-0.5 truncate ' + metaValueMutedClass} title={mixDisplay}>
                      {mixDisplay}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      };

      const renderCompactRequestSummary = () => {
        if (isAcceptedByOther) {
          const acceptedTimeLabel = formatAcceptedAtTimeJp(order);
          const deliveryLine = `${dateStr} ${slotStr}`;
          const qtyLabel = q.valid ? q.text : '—';
          return (
            <div className="space-y-1.5 rounded-xl border-2 border-slate-300 bg-slate-100 px-3 py-2.5 dark:border-slate-600 dark:bg-slate-900/60">
              <p className="text-sm font-black text-slate-800 dark:text-slate-100">
                ✓ {acceptedFactoryLabel}が受注しました（{acceptedTimeLabel}）
              </p>
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">納入：{deliveryLine}</p>
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">現場：{party.site || siteHeroLine}</p>
              <p className="text-xs font-bold text-slate-600 dark:text-slate-300">
                {qtyLabel} / {vehicle}
              </p>
            </div>
          );
        }
        return (
        <div className="grid min-w-0 gap-2">
          <div className="rounded-xl border-2 border-indigo-200 bg-indigo-50/70 p-2 shadow-inner dark:border-indigo-500/40 dark:bg-indigo-950/35">
            {renderPrimarySummary({ borderless: true })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!isAccepted && !isCustomerCancelled && !isRejectedByMe ? (
              <FactoryStatusMini status={order.factoryResponseStatus} />
            ) : null}
            {hasUnreadChat ? (
              <span
                className="inline-flex items-center gap-0.5 rounded bg-sky-500 px-1.5 py-0.5 text-[9px] font-black leading-none text-white sm:text-[10px]"
                aria-label="未読メッセージあり"
              >
                💬 未読
              </span>
            ) : null}
            {order.is_admin_modified ? (
              <span className="inline-flex rounded-full border-2 border-violet-400 bg-violet-50 px-2 py-0.5 text-[10px] font-black text-violet-800 sm:text-[11px]">
                管理者変更あり
              </span>
            ) : null}
            <LocationPendingBadge order={order} />
          </div>
        </div>
        );
      };

      const renderDetailBody = () => (
        <>
          <div className="grid min-w-0 grid-cols-1 gap-3 rounded-xl border border-slate-200/90 bg-white px-3 py-3 dark:border-slate-600 dark:bg-slate-900/60 sm:grid-cols-2">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 sm:text-sm">現場担当者</p>
              <p className="mt-1 break-words text-base font-black text-slate-900 dark:text-slate-100 sm:text-lg">
                {siteContactName || '—'}
                {phone ? (
                  <span className="ml-2 font-mono font-black text-slate-800 dark:text-slate-200">{phone}</span>
                ) : null}
              </p>
            </div>
            <div className="min-w-0 sm:border-l sm:border-slate-200 sm:pl-4 dark:sm:border-slate-600">
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 sm:text-sm">発注者</p>
              <p className="mt-1 break-words text-base font-black text-slate-900 dark:text-slate-100 sm:text-lg">
                {ordererDisplayLine}
              </p>
            </div>
          </div>

          <div className="mt-3 border-t border-slate-200 pt-3 dark:border-slate-600">
            <p className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 sm:text-sm">エスカレーション</p>
            <p className="mt-1 text-sm font-black text-slate-900 dark:text-slate-100 sm:text-base">{escalationLabel}</p>
          </div>

          {!isToast && order.id ? (
            <div className="mt-3">
              <OrderMapEditorUrlActions orderId={order.id} siteName={party.site} order={order} project={linkedProject} variant="compact" />
            </div>
          ) : null}

          {canSetStatus && false && (
            <div className="mt-4 border-t border-slate-200 pt-3">
              <p className="text-xs font-black uppercase tracking-wider text-slate-500 sm:text-sm">注文への回答</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                <button
                  type="button"
                  disabled={terminalLocked}
                  onClick={() => !terminalLocked && (canAcceptOrder ? onAcceptOrder(order) : onResponseStatusChange(order.id, FACTORY_RESPONSE.ACCEPTED))}
                  aria-pressed={responseStatus === FACTORY_RESPONSE.ACCEPTED}
                  className={
                    'min-h-[48px] rounded-lg border-2 px-2 py-2.5 text-sm font-black shadow-sm transition sm:min-h-[52px] sm:text-base ' +
                    (terminalLocked ? 'cursor-not-allowed opacity-45 ' : '') +
                    (responseStatus === FACTORY_RESPONSE.ACCEPTED
                      ? 'border-emerald-700 bg-emerald-600 text-white ring-1 ring-emerald-300'
                      : 'border-emerald-400 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 active:scale-[0.99]')
                  }
                >
                  受注
                </button>
                <button
                  type="button"
                  disabled={terminalLocked}
                  onClick={() => !terminalLocked && onResponseStatusChange(order.id, FACTORY_RESPONSE.REJECTED)}
                  aria-pressed={responseStatus === FACTORY_RESPONSE.REJECTED}
                  className={
                    'min-h-[48px] rounded-lg border-2 px-2 py-2.5 text-sm font-black shadow-sm transition sm:min-h-[52px] sm:text-base ' +
                    (terminalLocked ? 'cursor-not-allowed opacity-45 ' : '') +
                    (responseStatus === FACTORY_RESPONSE.REJECTED
                      ? 'border-red-800 bg-red-600 text-white ring-1 ring-red-300'
                      : 'border-red-400 bg-red-50 text-red-900 hover:bg-red-100 active:scale-[0.99]')
                  }
                >
                  拒否
                </button>
                <button
                  type="button"
                  disabled={terminalLocked}
                  onClick={() => !terminalLocked && onResponseStatusChange(order.id, FACTORY_RESPONSE.PENDING)}
                  aria-pressed={responseStatus === FACTORY_RESPONSE.PENDING}
                  className={
                    'min-h-[48px] rounded-lg border-2 px-2 py-2.5 text-sm font-black shadow-sm transition sm:min-h-[52px] sm:text-base ' +
                    (terminalLocked ? 'cursor-not-allowed opacity-45 ' : '') +
                    (responseStatus === FACTORY_RESPONSE.PENDING
                      ? 'border-amber-500 bg-amber-500 text-amber-950 ring-1 ring-amber-200'
                      : 'border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-100 active:scale-[0.99]')
                  }
                >
                  保留
                </button>
              </div>
              {terminalLocked ? (
                <div className="cl-alert-warning-panel mt-3 space-y-2 rounded-lg border-2 border-amber-300 bg-amber-50/95 px-3 py-3">
                  <p className="text-sm font-black text-amber-950 sm:text-base">マスターの許可が必要です</p>
                  <p className="text-xs font-bold leading-relaxed text-amber-900/90 dark:text-amber-200 sm:text-sm">
                    受注または拒否を確定したあとは、工場側からは変更できません。訂正が必要な場合はマスターが「ステータス再設定許可」で解除します。
                  </p>
                  {!order.factoryUnlockRequested && typeof onRequestUnlock === 'function' ? (
                    <button
                      type="button"
                      onClick={() => onRequestUnlock(order.id)}
                      className="w-full rounded-lg border-2 border-slate-800 bg-white py-2.5 text-sm font-black text-slate-900 shadow hover:bg-slate-50 sm:text-base"
                    >
                      マスターへロック解除を依頼
                    </button>
                  ) : null}
                  {order.factoryUnlockRequested ? (
                    <p className="text-center text-xs font-bold text-slate-700 sm:text-sm">
                      マスターへ解除依頼済みです。承認をお待ちください。
                    </p>
                  ) : null}
                </div>
              ) : null}
              {responseStatus === FACTORY_RESPONSE.PENDING && pendingCountdown ? (
                <div
                  className={
                    'mt-3 rounded-lg border-2 px-3 py-3 text-center ' +
                    (pendingCountdown.expired
                      ? 'border-red-600 bg-red-50 shadow-inner'
                      : 'border-amber-400 bg-amber-50/95')
                  }
                  role="status"
                >
                  <p className="text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-300 sm:text-xs">保留カウントダウン</p>
                  <p
                    className={
                      'mt-1 font-mono text-3xl font-black tabular-nums tracking-tight sm:text-4xl ' +
                      (pendingCountdown.expired ? 'text-red-600 animate-pulse' : 'text-amber-950')
                    }
                  >
                    {pendingCountdown.expired ? '時間切れ' : pendingCountdown.label}
                  </p>
                  {pendingCountdown.expired ? (
                    <p className="mt-2 text-xs font-bold text-red-700 dark:text-red-300 sm:text-sm">5分経過しました。対応を確定するには受注・拒否を選んでください</p>
                  ) : (
                    <p className="mt-1 text-xs font-bold text-amber-900/85 dark:text-amber-200 sm:text-sm">00:00 で時間切れ表示に切り替わります</p>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {!isToast && order.createdAt ? (
            <time
              className="mt-4 block border-t border-slate-100 pt-3 text-xs font-bold text-slate-400 dark:border-slate-600 dark:text-slate-300 sm:text-sm"
              dateTime={order.createdAt}
            >
              受信{' '}
              {new Date(order.createdAt).toLocaleTimeString('ja-JP', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </time>
          ) : null}
        </>
      );

      const renderDetail = () => (
        <>
          <div className="pr-0.5">
            {isToast ? renderPrimarySummary({}) : null}
            {renderDetailBody()}
          </div>
          {!isToast && order.id ? (
            <div>
              <FactoryOrderChatPanel
                order={order}
                orderId={order.id}
                messages={chatMessages}
                factoryName={factoryName}
                onAfterSend={onFactoryChatSent}
              />
            </div>
          ) : null}
        </>
      );

      if (isToast) {
        return (
          <article className={cardFrame + pad}>
            {renderDetail()}
          </article>
        );
      }

      const rejectedLook = responseStatus === FACTORY_RESPONSE.REJECTED;
      const collapsedRejected = rejectedLook && !expanded;
      const outerArticleClass = collapsedRejected
        ? 'rounded-xl border-2 border-red-600/90 bg-red-50/30 opacity-[0.72] shadow-sm ring-1 ring-red-200/60 dark:bg-red-950/30 dark:opacity-90 overflow-hidden'
        : isCustomerCancelled
          ? 'rounded-2xl border-[3px] border-red-600 bg-red-50 shadow-xl ring-2 ring-red-200 dark:bg-red-950/40 overflow-hidden'
          : isAcceptedByMe
          ? 'rounded-2xl border-[3px] border-emerald-600 bg-emerald-50 shadow-xl ring-2 ring-emerald-200 dark:bg-emerald-950/35 overflow-hidden'
          : isAcceptedByOther
            ? 'rounded-2xl border-2 border-slate-300 bg-slate-100 opacity-65 shadow-sm grayscale dark:border-slate-600 dark:bg-slate-800 dark:opacity-85 overflow-hidden'
            : isRejectedByMe
              ? 'rounded-2xl border-2 border-slate-300 bg-slate-100 opacity-80 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:opacity-90 overflow-hidden'
              : cardFrame.trimEnd() + ' overflow-hidden';

      return (
        <article ref={articleRef} className={outerArticleClass} onClick={markRead}>
          <div
            className={
              'flex w-full min-w-0 items-stretch ' +
              (collapsedRejected
                ? 'bg-red-50/40 dark:bg-red-950/20'
                : 'border-b border-slate-100 bg-white dark:border-slate-600 dark:bg-slate-800')
            }
          >
            <button
              type="button"
              className="min-w-0 flex-1 px-2 py-2.5 text-left text-sm transition hover:bg-slate-50/90 dark:hover:bg-slate-700/50 sm:px-3 sm:py-3"
              onClick={() => setExpanded((v) => !v)}
              aria-expanded={expanded}
            >
              {renderCompactRequestSummary()}
            </button>
            <div className="relative flex w-[3.25rem] shrink-0 flex-col items-center justify-between gap-0.5 border-l border-slate-200/90 bg-slate-50/60 py-1 dark:border-slate-600 dark:bg-slate-900/50">
              {canOpenOrderMenu ? (
                <button
                  type="button"
                  className="flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-slate-200/90 bg-white p-1.5 text-slate-600 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-800"
                  aria-label="注文操作メニュー"
                  title="注文操作"
                  aria-expanded={actionMenuOpen}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActionMenuOpen((v) => !v);
                  }}
                >
                  <span className="text-xl leading-none" aria-hidden="true">
                    ⚙️
                  </span>
                </button>
              ) : (
                <span className="h-10 w-8 shrink-0" aria-hidden="true" />
              )}
              {actionMenuOpen && canOpenOrderMenu ? (
                <div
                  className="absolute right-full top-1 z-20 mr-2 w-52 rounded-xl border-2 border-slate-200 bg-white p-2 text-left shadow-2xl"
                  onClick={(e) => e.stopPropagation()}
                >
                  {canEditOrder && typeof onOrderFullPatch === 'function' ? (
                    <button
                      type="button"
                      className="w-full rounded-lg px-3 py-2 text-left text-sm font-black text-slate-800 hover:bg-slate-100"
                      onClick={() => {
                        setActionMenuOpen(false);
                        setEditOpen(true);
                      }}
                    >
                      注文内容を編集
                    </button>
                  ) : null}
                  {isAcceptedByMe && !isCustomerCancelled && canCustomerCancelOrder ? (
                    <button
                      type="button"
                      className="mt-1 w-full rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-left text-sm font-black text-red-700 hover:bg-red-100"
                      onClick={() => {
                        setActionMenuOpen(false);
                        onCustomerCancelOrder(order);
                      }}
                    >
                      お客様都合でキャンセルする
                    </button>
                  ) : null}
                </div>
              ) : null}
              {canHideOrder ? (
                <button
                  type="button"
                  className="rounded-lg border border-slate-300 bg-white px-1.5 py-1 text-[10px] font-black leading-tight text-slate-600 shadow-sm hover:border-slate-500 hover:text-slate-900"
                  aria-label="この注文を非表示にする"
                  title="非表示にする"
                  onClick={(e) => {
                    e.stopPropagation();
                    onHideOrder(order.id);
                  }}
                >
                  非表示
                </button>
              ) : null}
              {(idx === 0 && !isRead && !isRejectedByMe) || hasUnreadChat ? (
                <div className="flex flex-col items-center gap-0.5">
                  {idx === 0 && !isRead && !isRejectedByMe ? (
                    <span className="rounded bg-orange-500 px-1.5 py-0.5 text-[9px] font-black leading-none text-white sm:text-[10px]">
                      NEW
                    </span>
                  ) : null}
                  {hasUnreadChat ? (
                    <span
                      className="inline-flex items-center gap-0.5 rounded bg-sky-500 px-1.5 py-0.5 text-[9px] font-black leading-none text-white sm:text-[10px]"
                      aria-label="未読メッセージあり"
                    >
                      💬 未読
                    </span>
                  ) : null}
                </div>
              ) : (
                <span className="h-3 w-full shrink-0" aria-hidden="true" />
              )}
              <button
                type="button"
                className="rounded-lg p-1.5 text-sm font-black text-slate-600 hover:bg-white sm:text-base"
                aria-label={expanded ? '折りたたむ' : '詳細を開く'}
                onClick={() => setExpanded((v) => !v)}
              >
                {expanded ? '▲' : '▼'}
              </button>
            </div>
          </div>
          <div
            className="grid transition-[grid-template-rows] duration-300 ease-out"
            style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
          >
            <div className="min-h-0 overflow-hidden">
              <div className={pad + ' flex flex-col gap-2'}>{renderDetail()}</div>
            </div>
          </div>
          {isActionable && (canAcceptOrder || canRejectOrder || canConsultOrder) ? (
            <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 dark:border-slate-600 dark:bg-slate-900/50">
              {isConsultingByMe ? (
                <div
                  className="mb-2 rounded-xl border-2 border-blue-400 bg-blue-50 px-3 py-2 text-center text-sm font-black text-blue-900"
                  role="status"
                >
                  🔵 相談中 — あなたの工場が対応中です。受注／拒否で相談を終了します。
                </div>
              ) : null}
              <div className="grid gap-2 sm:grid-cols-2">
                {canAcceptOrder ? (
                  <button
                    type="button"
                    onClick={() => onAcceptOrder(order)}
                    className="min-h-[46px] rounded-xl border-2 border-emerald-700 bg-emerald-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 active:scale-[0.99] sm:text-base"
                  >
                    受注する
                  </button>
                ) : null}
                {canRejectOrder ? (
                  <button
                    type="button"
                    onClick={() => onRejectOrder(order)}
                    className="min-h-[46px] rounded-xl border-2 border-slate-400 bg-slate-100 px-4 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-200 active:scale-[0.99] sm:text-base"
                  >
                    拒否する
                  </button>
                ) : null}
              </div>
              {/* 相談ボタンは押し間違い防止のため受注/拒否と間隔を空ける */}
              {canConsultOrder && !isConsultingByMe ? (
                <div className="mt-4 border-t border-dashed border-slate-200 pt-3">
                  <button
                    type="button"
                    onClick={() => onConsultOrder(order)}
                    className="min-h-[46px] w-full rounded-xl border-2 border-blue-400 bg-blue-50 px-4 text-sm font-black text-blue-900 shadow-sm transition hover:bg-blue-100 active:scale-[0.99] sm:text-base"
                  >
                    相談する
                  </button>
                  <p className="mt-1.5 text-center text-[11px] font-bold text-slate-500">
                    時間制限なし。顧客と対応時間・数量を調整します（相談中は他工場に表示されません）
                  </p>
                </div>
              ) : null}
            </div>
          ) : stateBanner ? (
            <div className={'border-t px-3 py-3 text-center text-sm font-black sm:text-base ' + (isAcceptedByOther ? 'border-slate-300 bg-slate-100 text-slate-800 dark:bg-slate-700 dark:text-slate-100' : isAcceptedByMe ? 'border-emerald-200 bg-emerald-100 text-emerald-900' : 'border-slate-200 bg-slate-100 text-slate-700')}>
              {stateBanner.label}
            </div>
          ) : null}
          {canEditOrder && typeof onOrderFullPatch === 'function' ? (
            <OrderFullEditModal
              order={order}
              open={editOpen}
              onClose={() => setEditOpen(false)}
              projectById={projectById}
              customerById={customerById}
              onSiteUrlCopied={onSiteUrlCopied}
              onSave={async (id, patch) => {
                const ok = await onOrderFullPatch(id, patch);
                if (ok !== false) setEditOpen(false);
              }}
            />
          ) : null}
        </article>
      );
    }


    function DispatchInbox({
      orders,
      currentFactoryId,
      readOrderIds,
      factorySearchLabel,
      onOrderFullPatch,
      onMarkRead,
      onAcceptOrder,
      onRejectOrder,
      onConsultOrder,
      onCustomerCancelOrder,
      onHideOrder,
      onResponseStatusChange,
      onRequestUnlock,
      chatThreads,
      readChatKeys,
      onMarkChatRead,
      onFactoryChatSent,
      focusedOrderId,
      projectById,
      customerById,
      organizationById,
      onSiteUrlCopied,
      exitingOrderIds,
    }) {
      const [searchQuery, setSearchQuery] = useState('');
      const filteredOrders = useMemo(
        () => orders.filter((o) => orderMatchesFactorySearch(o, searchQuery, factorySearchLabel)),
        [orders, searchQuery, factorySearchLabel],
      );

      useEffect(() => {
        if (focusedOrderId) setSearchQuery('');
      }, [focusedOrderId]);

      if (!orders.length) {
        return (
          <aside
            className="flex h-full min-h-0 flex-col rounded-lg border-2 border-dashed border-slate-300 bg-white p-2 dark:border-slate-600 dark:bg-slate-800"
            aria-label="新着の配車依頼"
          >
            <h2 className="text-sm font-black text-slate-800 dark:text-slate-100">新着の配車依頼</h2>
            <p className="mt-1 text-xs font-medium leading-snug text-slate-500 dark:text-slate-400">
              注文画面から発注されると、ここにカード形式で表示されます（別タブ連携）。
            </p>
          </aside>
        );
      }
      return (
        <aside
          className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-slate-300 bg-white shadow-md ring-1 ring-slate-200/60 dark:border-slate-600 dark:bg-slate-800 dark:ring-slate-700/60"
          aria-label="新着の配車依頼一覧"
        >
          <div className="shrink-0 border-b border-slate-200 bg-gradient-to-r from-slate-50 to-white px-2 py-2.5 dark:border-slate-600 dark:from-slate-800 dark:to-slate-800 sm:px-3">
            <h2 className="text-base font-black tracking-tight text-slate-900 dark:text-slate-100 sm:text-lg">新着の配車依頼</h2>
          </div>
          <div className="shrink-0 border-b border-slate-200 bg-slate-50/95 px-2 py-2 dark:border-slate-600 dark:bg-slate-900/60">
            <OrderListSearchInput id="factory-inbox-search" value={searchQuery} onChange={setSearchQuery} />
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-2 pt-2">
            <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-0.5">
            {filteredOrders.length === 0 ? (
              <li className="list-none">
                <p className="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-2 py-4 text-center text-xs font-bold text-slate-600 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
                  該当する依頼がありません
                </p>
              </li>
            ) : (
              filteredOrders.map((o, i) => {
                const isExiting = Boolean(o?.id && exitingOrderIds?.has?.(String(o.id)));
                return (
                <li key={o.id ?? `idx-${i}`} className="list-none">
                  <div
                    className="grid transition-[grid-template-rows,opacity,transform] duration-300 ease-in motion-reduce:transition-none"
                    style={{
                      gridTemplateRows: isExiting ? '0fr' : '1fr',
                      opacity: isExiting ? 0 : 1,
                      transform: isExiting ? 'translateX(24px) scale(0.98)' : 'none',
                    }}
                    aria-hidden={isExiting ? true : undefined}
                  >
                    <div className="min-h-0 overflow-hidden">
                      <OrderRequestCard
                        order={o}
                        idx={i}
                        currentFactoryId={currentFactoryId}
                        isRead={Boolean(o?.id && readOrderIds?.has(o.id))}
                        onMarkRead={onMarkRead}
                        onOrderFullPatch={onOrderFullPatch}
                        onAcceptOrder={onAcceptOrder}
                        onRejectOrder={onRejectOrder}
                        onConsultOrder={onConsultOrder}
                        onCustomerCancelOrder={onCustomerCancelOrder}
                        onHideOrder={onHideOrder}
                        onResponseStatusChange={onResponseStatusChange}
                        onRequestUnlock={onRequestUnlock}
                        chatMessages={chatThreads[o.id]}
                        hasUnreadChat={isUnreadForFactory(chatThreads[o.id], readChatKeys?.[o.id])}
                        onMarkChatRead={onMarkChatRead}
                        onFactoryChatSent={onFactoryChatSent}
                        factoryName={factorySearchLabel}
                        forceExpanded={Boolean(focusedOrderId && String(o.id) === String(focusedOrderId))}
                        projectById={projectById}
                        customerById={customerById}
                        organizationById={organizationById}
                        onSiteUrlCopied={onSiteUrlCopied}
                      />
                    </div>
                  </div>
                </li>
                );
              })
            )}
          </ul>
          </div>
        </aside>
      );
    }

    function NewOrderToast({
      order,
      isReassignment,
      onDismiss,
      projectById,
      customerById,
      organizationById,
    }) {
      if (!order) return null;
      return (
        <div
          className="fixed bottom-4 left-4 right-4 z-[90] mx-auto max-w-md sm:left-auto sm:right-6 sm:mx-0 lg:bottom-8 lg:right-8 lg:max-w-lg"
          role="alert"
        >
          <div className="overflow-hidden rounded-2xl border-2 border-orange-600 bg-white shadow-2xl dark:bg-slate-800">
            <div className="flex items-start justify-between gap-2 bg-orange-600 px-4 py-2.5">
              <p className="text-sm font-black text-white sm:text-base">
                {isReassignment ? '手配振替の注文を受信' : '新規注文を受信'}
              </p>
              <button
                type="button"
                onClick={onDismiss}
                className="shrink-0 rounded-lg bg-white/20 px-2.5 py-1 text-xs font-black text-white hover:bg-white/30"
              >
                閉じる
              </button>
            </div>
            <OrderRequestCard
              order={order}
              idx={0}
              variant="toast"
              projectById={projectById}
              customerById={customerById}
              organizationById={organizationById}
            />
          </div>
        </div>
      );
    }

    function VehicleToggleRow({ kindLabel, isFull, onPick }) {
      const free = !isFull;
      return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1 rounded-md border border-slate-200/90 bg-white p-1.5 shadow-inner dark:border-slate-600 dark:bg-slate-800">
          <span className="shrink-0 break-words text-xs font-black leading-tight text-slate-800 dark:text-slate-300 sm:text-sm">{kindLabel}</span>
          <div className="grid min-h-0 flex-1 grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => onPick('available')}
              aria-pressed={free}
              className={
                'flex min-h-[44px] h-full min-w-0 touch-manipulation items-center justify-center rounded-md border-2 px-1 py-2 text-xl font-black leading-none transition active:scale-[0.97] sm:min-h-[48px] sm:text-2xl ' +
                (free
                  ? 'border-sky-600 bg-sky-600 text-white shadow-sm'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-sky-400 hover:bg-sky-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-sky-400 dark:hover:bg-sky-950/40')
              }
            >
              ○
            </button>
            <button
              type="button"
              onClick={() => onPick('full')}
              aria-pressed={isFull}
              className={
                'flex min-h-[44px] h-full min-w-0 touch-manipulation items-center justify-center rounded-md border-2 px-1 py-2 text-xl font-black leading-none transition active:scale-[0.97] sm:min-h-[48px] sm:text-2xl ' +
                (isFull
                  ? 'border-orange-700 bg-gradient-to-b from-orange-600 to-red-600 text-white shadow-sm'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-orange-400 hover:bg-orange-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-orange-400 dark:hover:bg-orange-950/40')
              }
            >
              ×
            </button>
          </div>
        </div>
      );
    }

    function ScheduleBlockCard({ dateStr, blockMeta, dayState, onToggleVehicle }) {
      const st = dayState[blockMeta.id] || { large: 'available', small: 'available' };
      const largeFull = st.large === 'full';
      const smallFull = st.small === 'full';
      return (
        <article
          className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-md border border-slate-200 bg-gradient-to-b from-white to-slate-50/90 p-1.5 shadow-sm dark:border-slate-600 dark:from-slate-800 dark:to-slate-900"
          aria-label={`${blockMeta.shortLabel} ${blockMeta.label}`}
        >
          <div className="flex min-w-0 shrink-0 items-baseline justify-between gap-1 border-b border-slate-200 pb-1 dark:border-slate-600">
            <p className="shrink-0 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 sm:text-xs">{blockMeta.shortLabel}</p>
            <p className="min-w-0 break-words text-right text-xs font-black leading-tight text-slate-900 dark:text-slate-100 sm:text-sm">{blockMeta.label}</p>
          </div>
          <div className="mt-1 flex min-h-0 min-w-0 flex-1 flex-col gap-1">
            <VehicleToggleRow
              kindLabel="大型"
              isFull={largeFull}
              onPick={(next) => onToggleVehicle(dateStr, blockMeta.id, 'large', next)}
            />
            <VehicleToggleRow
              kindLabel="小型"
              isFull={smallFull}
              onPick={(next) => onToggleVehicle(dateStr, blockMeta.id, 'small', next)}
            />
          </div>
        </article>
      );
    }

    function ScheduleBulkToolbar({
      selectedDate,
      onFullDay,
      onMorning,
      onAfternoon,
      onClearAll,
      onFullDayLargeOnly,
      onFullDaySmallOnly,
    }) {
      const fullBtn =
        'flex min-h-[46px] touch-manipulation items-center justify-center rounded-md border-2 border-red-800 bg-gradient-to-b from-orange-600 to-red-600 px-2 py-2 text-xs font-black leading-tight text-white shadow-sm transition hover:from-orange-500 hover:to-red-500 active:scale-[0.98] sm:min-h-[50px] sm:text-sm';
      const clearBtn =
        'flex min-h-[46px] touch-manipulation items-center justify-center rounded-md border-2 border-teal-600 bg-gradient-to-b from-emerald-500 to-teal-600 px-2 py-2 text-xs font-black leading-tight text-white shadow-sm transition hover:from-emerald-400 hover:to-teal-500 active:scale-[0.98] sm:min-h-[50px] sm:text-sm';
      const typeBtn =
        'flex min-h-[44px] touch-manipulation items-center justify-center rounded-md border border-slate-700 bg-slate-800 px-2 py-2 text-[11px] font-black leading-tight text-white shadow-sm transition hover:bg-slate-900 active:scale-[0.98] sm:min-h-[48px] sm:text-xs dark:border-slate-500 dark:bg-slate-700 dark:hover:bg-slate-600';

      return (
        <div
          className="rounded-md border border-slate-200 bg-white p-1.5 shadow-sm dark:border-slate-600 dark:bg-slate-800"
          role="group"
          aria-label={`一括操作（${selectedDate}）`}
        >
          <div className="grid grid-cols-4 gap-1">
            <button type="button" className={fullBtn} onClick={onFullDay}>
              <span className="flex flex-col items-center leading-tight">
                <span>終日</span>
                <span>満車</span>
              </span>
            </button>
            <button type="button" className={fullBtn} onClick={onMorning}>
              <span className="flex flex-col items-center leading-tight">
                <span>午前</span>
                <span>満車</span>
              </span>
            </button>
            <button type="button" className={fullBtn} onClick={onAfternoon}>
              <span className="flex flex-col items-center leading-tight">
                <span>午後</span>
                <span>満車</span>
              </span>
            </button>
            <button type="button" className={clearBtn} onClick={onClearAll}>
              クリア
            </button>
            <button type="button" className={typeBtn + ' col-span-2'} onClick={onFullDayLargeOnly}>
              大型のみ終日×
            </button>
            <button type="button" className={typeBtn + ' col-span-2'} onClick={onFullDaySmallOnly}>
              小型のみ終日×
            </button>
          </div>
        </div>
      );
    }

    async function persistScheduleMap(factorySiteId, map) {
      const n = normalizeFullSchedule(map);
      for (const [d, blocks] of Object.entries(n)) {
        await db.upsertScheduleDay(factorySiteId, d, blocks);
      }
    }

    /** stampId: 'full' | 'am' | 'pm' | 'largeOnly' | 'smallOnly' | 'clear' */
    function applyStampToDayBlocks(dayBlocks, stampId) {
      const base = normalizeDayBlockSchedule(dayBlocks);
      if (stampId === 'clear') return defaultEmptyDayBlocks();
      if (stampId === 'full') {
        const next = defaultEmptyDayBlocks();
        for (const id of SCHEDULE_BLOCK_IDS) {
          next[id] = { large: 'full', small: 'full' };
        }
        return next;
      }
      if (stampId === 'am') {
        const next = { ...base };
        for (const id of ['am1', 'am2']) {
          next[id] = { large: 'full', small: 'full' };
        }
        return next;
      }
      if (stampId === 'pm') {
        const next = { ...base };
        for (const id of ['pm1', 'pm2']) {
          next[id] = { large: 'full', small: 'full' };
        }
        return next;
      }
      if (stampId === 'largeOnly') {
        const next = { ...base };
        for (const id of SCHEDULE_BLOCK_IDS) {
          next[id] = { ...next[id], large: 'full' };
        }
        return next;
      }
      if (stampId === 'smallOnly') {
        const next = { ...base };
        for (const id of SCHEDULE_BLOCK_IDS) {
          next[id] = { ...next[id], small: 'full' };
        }
        return next;
      }
      return base;
    }

    function isScheduleStampDateInBounds(day) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return false;
      const { minIso, maxIso } = getScheduleDateBoundsISO();
      return day >= minIso && day <= maxIso;
    }

    const SCHEDULE_STAMP_OPTIONS = [
      {
        id: 'full',
        label: '終日満車',
        idleClass: 'border-red-300 bg-white text-red-800 hover:bg-red-50 dark:border-red-700 dark:bg-slate-800 dark:text-red-300 dark:hover:bg-red-950/40',
        activeClass: 'border-red-800 bg-red-700 text-white ring-2 ring-red-300',
      },
      {
        id: 'am',
        label: '午前満車',
        idleClass: 'border-sky-300 bg-white text-sky-800 hover:bg-sky-50 dark:border-sky-700 dark:bg-slate-800 dark:text-sky-300 dark:hover:bg-sky-950/40',
        activeClass: 'border-sky-800 bg-sky-600 text-white ring-2 ring-sky-300',
      },
      {
        id: 'pm',
        label: '午後満車',
        idleClass: 'border-violet-300 bg-white text-violet-800 hover:bg-violet-50 dark:border-violet-700 dark:bg-slate-800 dark:text-violet-300 dark:hover:bg-violet-950/40',
        activeClass: 'border-violet-800 bg-violet-600 text-white ring-2 ring-violet-300',
      },
      {
        id: 'largeOnly',
        label: '大型のみ×',
        idleClass: 'border-slate-400 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
        activeClass: 'border-slate-900 bg-slate-800 text-white ring-2 ring-slate-400',
      },
      {
        id: 'smallOnly',
        label: '小型のみ×',
        idleClass: 'border-slate-400 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700',
        activeClass: 'border-slate-900 bg-slate-800 text-white ring-2 ring-slate-400',
      },
      {
        id: 'clear',
        label: 'クリア',
        idleClass: 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700',
        activeClass: 'border-slate-600 bg-slate-500 text-white ring-2 ring-slate-300',
      },
    ];

    function PullToRefresh({ children, onRefresh, className = '', suspended = false }) {
      const [pullDistance, setPullDistance] = useState(0);
      const [refreshing, setRefreshing] = useState(false);
      const startYRef = useRef(null);
      const pullingRef = useRef(false);
      const threshold = 70;
      const runRefresh = useCallback(async () => {
        if (suspended || refreshing || typeof onRefresh !== 'function') return;
        setRefreshing(true);
        try {
          await onRefresh();
        } finally {
          setRefreshing(false);
          setPullDistance(0);
          pullingRef.current = false;
          startYRef.current = null;
        }
      }, [onRefresh, refreshing, suspended]);
      return (
        <div
          className={'relative overscroll-y-contain ' + className}
          onTouchStart={(e) => {
            if (suspended || window.scrollY > 0 || refreshing) return;
            startYRef.current = e.touches[0]?.clientY ?? null;
            pullingRef.current = true;
          }}
          onTouchMove={(e) => {
            if (suspended || !pullingRef.current || startYRef.current == null) return;
            const next = Math.max(0, (e.touches[0]?.clientY ?? 0) - startYRef.current);
            if (next > 0 && window.scrollY <= 0) setPullDistance(Math.min(96, next * 0.55));
          }}
          onTouchEnd={() => {
            if (suspended) {
              setPullDistance(0);
              pullingRef.current = false;
              startYRef.current = null;
              return;
            }
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

    function FactoryScheduleSettings({
      selectedDate,
      dayBlocks,
      onSelectDate,
      scheduleMonth,
      onMonthChange,
      onToggleVehicle,
      onFullDay,
      onMorning,
      onAfternoon,
      onClearAll,
      onFullDayLargeOnly,
      onFullDaySmallOnly,
      holidays,
      scheduleByDate,
      selectedFactoryStatus,
      onFactoryStatusChange,
      activeStamp = null,
      onActiveStampChange,
      stampUndoAvailable = false,
      onStampUndo,
      onStampPaintSessionStart,
      onStampPaintDay,
      onStampPaintSessionEnd,
    }) {
      const holidayByDate = useMemo(() => {
        const map = {};
        for (const h of holidays || []) {
          const d = String(h?.holiday_date || '').slice(0, 10);
          if (d) map[d] = h;
        }
        return map;
      }, [holidays]);
      const days = useMemo(() => {
        const base = scheduleMonth instanceof Date && !Number.isNaN(scheduleMonth.getTime()) ? scheduleMonth : new Date();
        const first = new Date(base.getFullYear(), base.getMonth(), 1);
        const gridStart = new Date(first);
        gridStart.setDate(first.getDate() - first.getDay());
        return Array.from({ length: 42 }, (_, i) => {
          const d = new Date(gridStart);
          d.setDate(gridStart.getDate() + i);
          return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
        });
      }, [scheduleMonth]);
      const monthLabel = useMemo(() => {
        const base = scheduleMonth instanceof Date && !Number.isNaN(scheduleMonth.getTime()) ? scheduleMonth : new Date();
        return `${base.getFullYear()}年${base.getMonth() + 1}月`;
      }, [scheduleMonth]);
      const monthKey = useMemo(() => {
        const base = scheduleMonth instanceof Date && !Number.isNaN(scheduleMonth.getTime()) ? scheduleMonth : new Date();
        return `${base.getFullYear()}-${pad2(base.getMonth() + 1)}`;
      }, [scheduleMonth]);
      const selectedLabel = useMemo(() => {
        const d = new Date(`${selectedDate}T12:00:00`);
        if (Number.isNaN(d.getTime())) return selectedDate || '未選択';
        return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
      }, [selectedDate]);
      const stampPaintingRef = useRef(false);
      const calendarGridRef = useRef(null);

      const resolveStampDateFromPoint = useCallback((clientX, clientY) => {
        if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return null;
        const el = document.elementFromPoint(clientX, clientY);
        if (!el || typeof el.closest !== 'function') return null;
        const cell = el.closest('[data-date]');
        if (!cell) return null;
        const day = cell.getAttribute('data-date');
        return /^\d{4}-\d{2}-\d{2}$/.test(String(day || '')) ? day : null;
      }, []);

      const endStampPaintIfNeeded = useCallback(
        (e) => {
          if (!stampPaintingRef.current) return;
          stampPaintingRef.current = false;
          try {
            if (e?.currentTarget && e.pointerId != null && e.currentTarget.hasPointerCapture?.(e.pointerId)) {
              e.currentTarget.releasePointerCapture(e.pointerId);
            }
          } catch {
            /* ignore */
          }
          if (typeof onStampPaintSessionEnd === 'function') onStampPaintSessionEnd();
        },
        [onStampPaintSessionEnd],
      );

      const handleStampGridPointerDown = useCallback(
        (e) => {
          if (!activeStamp) return;
          if (e.pointerType === 'mouse' && e.button !== 0) return;
          const day = resolveStampDateFromPoint(e.clientX, e.clientY);
          if (!day || !isScheduleStampDateInBounds(day)) return;
          e.preventDefault();
          stampPaintingRef.current = true;
          try {
            e.currentTarget.setPointerCapture?.(e.pointerId);
          } catch {
            /* ignore */
          }
          if (typeof onStampPaintSessionStart === 'function') onStampPaintSessionStart();
          if (typeof onStampPaintDay === 'function') onStampPaintDay(day);
        },
        [activeStamp, onStampPaintDay, onStampPaintSessionStart, resolveStampDateFromPoint],
      );

      const handleStampGridPointerMove = useCallback(
        (e) => {
          if (!activeStamp || !stampPaintingRef.current) return;
          const day = resolveStampDateFromPoint(e.clientX, e.clientY);
          if (!day) return;
          if (typeof onStampPaintDay === 'function') onStampPaintDay(day);
        },
        [activeStamp, onStampPaintDay, resolveStampDateFromPoint],
      );

      const toggleStamp = useCallback(
        (stampId) => {
          if (typeof onActiveStampChange !== 'function') return;
          onActiveStampChange(activeStamp === stampId ? null : stampId);
        },
        [activeStamp, onActiveStampChange],
      );

      const getStatusMeta = (day) => {
        const holiday = holidayByDate[day];
        const description = String(holiday?.description || '');
        if (description.includes('メンテ')) {
          return { value: 'maintenance', label: '🔧 メンテ', badgeClass: 'bg-orange-500 text-slate-950', dayClass: 'border-yellow-300 bg-yellow-50 dark:border-yellow-700 dark:bg-yellow-950/40' };
        }
        if (holiday) {
          return { value: 'stopped', label: '❌ 休日', badgeClass: 'bg-red-600 text-white', dayClass: 'border-red-300 bg-red-50' };
        }
        return { value: 'normal', label: '通常営業', badgeClass: 'bg-emerald-100 text-emerald-800', dayClass: '' };
      };
      const getCapacityMeta = (day) => {
        const blocks = normalizeDayBlockSchedule(scheduleByDate?.[day]);
        const allFull = SCHEDULE_BLOCK_IDS.every((id) => blocks[id]?.large === 'full' && blocks[id]?.small === 'full');
        if (allFull) return { label: '満車: 終日', badgeClass: 'bg-red-700 text-white' };
        const morningFull = ['am1', 'am2'].every((id) => blocks[id]?.large === 'full' && blocks[id]?.small === 'full');
        const afternoonFull = ['pm1', 'pm2'].every((id) => blocks[id]?.large === 'full' && blocks[id]?.small === 'full');
        if (morningFull && afternoonFull) return { label: '満車: 終日', badgeClass: 'bg-red-700 text-white' };
        if (morningFull) return { label: '午前満車', badgeClass: 'bg-sky-600 text-white' };
        if (afternoonFull) return { label: '午後満車', badgeClass: 'bg-violet-600 text-white' };
        const largeFull = SCHEDULE_BLOCK_IDS.every((id) => blocks[id]?.large === 'full');
        const smallFull = SCHEDULE_BLOCK_IDS.every((id) => blocks[id]?.small === 'full');
        if (largeFull) return { label: '大型 終日×', badgeClass: 'bg-slate-800 text-white' };
        if (smallFull) return { label: '小型 終日×', badgeClass: 'bg-slate-800 text-white' };
        const fullEntries = SCHEDULE_BLOCK_IDS.flatMap((id) => {
          const meta = SCHEDULE_BLOCKS.find((b) => b.id === id);
          const shortLabel = meta?.shortLabel || id;
          const entries = [];
          if (blocks[id]?.large === 'full') entries.push(`${shortLabel}大型`);
          if (blocks[id]?.small === 'full') entries.push(`${shortLabel}小型`);
          return entries;
        });
        if (fullEntries.length > 0) {
          const shown = fullEntries.slice(0, 2).join('・');
          const label = fullEntries.length > 2 ? `${shown} 他${fullEntries.length - 2}件` : shown;
          return {
            label,
            title: fullEntries.join('・'),
            badgeClass: 'bg-orange-100 text-orange-900',
          };
        }
        return null;
      };
      return (
        <section className="grid min-h-0 gap-2 xl:h-full xl:grid-cols-[minmax(0,1fr)_20rem] xl:grid-rows-1">
          <div className="flex min-h-[22rem] flex-col rounded-2xl border-2 border-slate-200 bg-white p-2 shadow-sm xl:min-h-0">
            <div className="shrink-0">
            <div className="flex flex-wrap items-center justify-between gap-1">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600">スケジュール設定</p>
                <h2 className="text-base font-black leading-tight text-slate-900 sm:text-lg">{monthLabel}</h2>
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  onClick={() => {
                    const next = new Date(scheduleMonth);
                    next.setMonth(next.getMonth() - 1);
                    onMonthChange(next);
                  }}
                  className="min-h-[32px] rounded-lg border-2 border-slate-300 bg-white px-2 text-xs font-black text-slate-700"
                >
                  ◀ 前月
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = new Date(scheduleMonth);
                    next.setMonth(next.getMonth() + 1);
                    onMonthChange(next);
                  }}
                  className="min-h-[32px] rounded-lg border-2 border-slate-300 bg-white px-2 text-xs font-black text-slate-700"
                >
                  次月 ▶
                </button>
              </div>
            </div>

            <div className="mt-1.5 rounded-xl border border-slate-200 bg-slate-50/90 p-1.5 dark:border-slate-600 dark:bg-slate-800/80">
              <div className="flex flex-wrap items-stretch gap-1">
                {SCHEDULE_STAMP_OPTIONS.map((opt) => {
                  const selected = activeStamp === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleStamp(opt.id)}
                      className={
                        'min-h-[40px] flex-1 basis-[5rem] rounded-lg border-2 px-1.5 py-1.5 text-[11px] font-black leading-tight transition active:scale-[0.98] sm:text-xs ' +
                        (selected ? opt.activeClass : opt.idleClass)
                      }
                    >
                      {opt.label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  disabled={!stampUndoAvailable || typeof onStampUndo !== 'function'}
                  onClick={() => onStampUndo?.()}
                  className={
                    'min-h-[40px] shrink-0 rounded-lg border-2 px-2.5 py-1.5 text-[11px] font-black transition sm:text-xs ' +
                    (stampUndoAvailable
                      ? 'border-amber-500 bg-amber-50 text-amber-950 hover:bg-amber-100 active:scale-[0.98] dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-100 dark:hover:bg-amber-950/60'
                      : 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-500')
                  }
                >
                  元に戻す
                </button>
              </div>
              {activeStamp ? (
                <p className="mt-1 text-[10px] font-bold leading-relaxed text-slate-600 dark:text-slate-300 sm:text-[11px]">
                  日付をタップまたはなぞって適用 · もう一度スタンプを押すと解除
                </p>
              ) : null}
            </div>

            <div className="mt-1.5 grid grid-cols-7 gap-0.5 text-center text-[10px] font-black text-slate-500">
              {['日', '月', '火', '水', '木', '金', '土'].map((d) => (
                <div key={d} className="rounded-md bg-slate-100 py-0.5">{d}</div>
              ))}
            </div>
            </div>
            <div
              ref={calendarGridRef}
              className="mt-1 grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-0.5"
              style={{ touchAction: activeStamp ? 'none' : 'auto' }}
              onPointerDown={handleStampGridPointerDown}
              onPointerMove={handleStampGridPointerMove}
              onPointerUp={endStampPaintIfNeeded}
              onPointerCancel={endStampPaintIfNeeded}
              onLostPointerCapture={endStampPaintIfNeeded}
            >
              {days.map((day) => {
                const active = day === selectedDate;
                const inMonth = day.startsWith(monthKey);
                const statusMeta = getStatusMeta(day);
                const hasSpecialStatus = statusMeta.value !== 'normal';
                const capacityMeta = getCapacityMeta(day);
                const stampApplicable = isScheduleStampDateInBounds(day);
                const d = new Date(`${day}T12:00:00`);
                return (
                  <button
                    key={day}
                    type="button"
                    data-date={day}
                    onClick={() => {
                      if (activeStamp) return;
                      onSelectDate(day);
                    }}
                    className={
                      'flex h-full min-h-0 flex-col overflow-hidden rounded-lg border-2 p-0.5 text-left transition active:scale-[0.99] sm:p-1 ' +
                      (activeStamp && stampApplicable ? 'cursor-pointer hover:brightness-95 ' : '') +
                      (activeStamp && !stampApplicable ? 'opacity-40 ' : '') +
                      (active
                        ? `border-blue-600 ${hasSpecialStatus ? statusMeta.dayClass.replace('border-yellow-300 ', '').replace('border-red-300 ', '') : 'bg-blue-50'} ring-2 ring-blue-200`
                        : hasSpecialStatus
                          ? statusMeta.dayClass
                          : inMonth
                          ? 'border-slate-200 bg-white hover:bg-slate-50'
                          : 'border-slate-100 bg-slate-50 opacity-45')
                    }
                  >
                    <p className="shrink-0 text-[11px] font-black leading-none text-slate-600 dark:text-slate-300">{d.getDate()}</p>
                    <div className="mt-0.5 min-h-0 flex-1 space-y-0.5 overflow-hidden">
                      {hasSpecialStatus ? <span className={'block truncate rounded-md px-1 py-0.5 text-[9px] font-black leading-tight ' + statusMeta.badgeClass}>{statusMeta.label}</span> : null}
                      {capacityMeta ? (
                        <span
                          className={'block truncate rounded-md px-1 py-0.5 text-[9px] font-black leading-tight ' + capacityMeta.badgeClass}
                          title={capacityMeta.title || capacityMeta.label}
                        >
                          {capacityMeta.label}
                        </span>
                      ) : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-white p-2 shadow-sm dark:border-slate-600 dark:bg-slate-800 xl:max-h-full">
            <div className="shrink-0">
              <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-300">選択中の日付</p>
              <h3 className="text-sm font-black leading-tight text-slate-900 dark:text-slate-100 sm:text-base">{selectedLabel}</h3>
            </div>
            <div className="mt-1.5 min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-0.5">
              <label className="block text-sm font-black text-slate-700 dark:text-slate-300">
                工場の状況
                <select
                  value={selectedFactoryStatus}
                  onChange={(e) => onFactoryStatusChange(e.target.value)}
                  className="mt-1 min-h-[40px] w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-black text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-indigo-400 dark:focus:ring-indigo-800"
                >
                  <option value="normal">通常営業</option>
                  <option value="stopped">休日</option>
                  <option value="maintenance">メンテナンス</option>
                </select>
              </label>
              <p className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-[11px] font-bold leading-relaxed text-slate-600 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
                選択すると左のカレンダーへ即時反映されます。
              </p>
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-2 dark:border-slate-600 dark:bg-slate-900/50">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">選択日の受入枠</p>
                <div className="mt-1.5">
                <ScheduleBulkToolbar
                  selectedDate={selectedDate}
                  onFullDay={onFullDay}
                  onMorning={onMorning}
                  onAfternoon={onAfternoon}
                  onClearAll={onClearAll}
                  onFullDayLargeOnly={onFullDayLargeOnly}
                  onFullDaySmallOnly={onFullDaySmallOnly}
                />
                </div>
                <div className="mt-1.5 grid grid-cols-2 gap-1.5">
                  {SCHEDULE_BLOCKS.map((bm) => (
                    <ScheduleBlockCard key={bm.id} dateStr={selectedDate} blockMeta={bm} dayState={dayBlocks} onToggleVehicle={onToggleVehicle} />
                  ))}
                </div>
              </div>
            </div>
          </aside>
        </section>
      );
    }

    function FactoryAllocationCalendar({
      orders,
      scheduleOrders,
      todayIso,
      currentFactoryId,
      selectedDate,
      onSelectDate,
      currentMonth,
      onMonthChange,
      onOpenOrder,
    }) {
      const lastTapRef = useRef({ orderId: null, at: 0 });
      const isAcceptedCalendarOrder = (order) => {
        const responseStatus = normalizeFactoryResponse(order?.factoryResponseStatus);
        const orderStatus = String(order?.status || '').trim().toLowerCase();
        const accepted = responseStatus === FACTORY_RESPONSE.ACCEPTED || orderStatus === FACTORY_RESPONSE.ACCEPTED || orderStatus === '受注';
        if (!accepted) return false;
        const assignedFactoryId = getAssignedFactoryId(order);
        return !assignedFactoryId || isSameFactoryId(assignedFactoryId, currentFactoryId);
      };
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
          if (!isAcceptedCalendarOrder(order)) continue;
          const d = factoryOrderDate(order);
          if (!d) continue;
          if (!map[d]) map[d] = [];
          map[d].push(order);
        }
        for (const list of Object.values(map)) {
          list.sort((a, b) => getOrderMinutesForScheduleScan(a) - getOrderMinutesForScheduleScan(b));
        }
        return map;
      }, [orders, currentFactoryId]);
      const dayListSource =
        String(selectedDate || '').slice(0, 10) < String(todayIso || '').slice(0, 10)
          ? orders || []
          : scheduleOrders || orders || [];
      const dayOrdersByDate = useMemo(() => {
        const map = {};
        for (const order of dayListSource) {
          const day = getOrderDeliveryDateISO(order);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
          if (!map[day]) map[day] = [];
          map[day].push(order);
        }
        return map;
      }, [dayListSource]);
      const selectedOrders = dayOrdersByDate[selectedDate] || [];
      const getOrderKindClass = (order) => {
        const rawType = String(order?.type || order?.order_type || order?.project_type || order?.projectType || '').toLowerCase();
        const isSpot = Boolean(order?.is_spot || order?.isSpot || rawType.includes('spot') || rawType.includes('スポット'));
        return isSpot
          ? 'cl-alert-spot bg-amber-500 text-slate-950 shadow-sm'
          : 'bg-blue-600 text-white shadow-sm';
      };
      const openOrder = (order) => {
        if (!order?.id || typeof onOpenOrder !== 'function') return;
        onOpenOrder(order.id);
      };
      const handleOrderTouchEnd = (order) => {
        if (!order?.id) return;
        const now = Date.now();
        const last = lastTapRef.current;
        if (last.orderId === order.id && now - last.at <= 360) {
          lastTapRef.current = { orderId: null, at: 0 };
          openOrder(order);
          return;
        }
        lastTapRef.current = { orderId: order.id, at: now };
      };
      return (
        <section className="grid min-h-0 gap-2 lg:h-full lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.9fr)] lg:grid-rows-1">
          <div className="flex min-h-[22rem] flex-col rounded-2xl border-2 border-slate-200 bg-white p-2 shadow-sm lg:min-h-0">
            <div className="shrink-0">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600">割当カレンダー</p>
                <h2 className="text-base font-black leading-tight text-slate-900 sm:text-lg">月間配車予定</h2>
              </div>
              <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-[11px] font-black text-white">{selectedOrders.length}件</span>
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => {
                  const next = new Date(currentMonth);
                  next.setMonth(next.getMonth() - 1);
                  onMonthChange(next);
                }}
                className="min-h-[32px] rounded-lg border-2 border-slate-300 bg-white px-2 text-xs font-black text-slate-700 shadow-sm"
              >
                ◀ 前月
              </button>
              <p className="text-sm font-black text-slate-900 sm:text-base">{monthLabel}</p>
              <button
                type="button"
                onClick={() => {
                  const next = new Date(currentMonth);
                  next.setMonth(next.getMonth() + 1);
                  onMonthChange(next);
                }}
                className="min-h-[32px] rounded-lg border-2 border-slate-300 bg-white px-2 text-xs font-black text-slate-700 shadow-sm"
              >
                次月 ▶
              </button>
            </div>
            <div className="mt-1.5 grid grid-cols-7 gap-0.5 text-center text-[10px] font-black text-slate-500">
              {['日', '月', '火', '水', '木', '金', '土'].map((d) => (
                <div key={d} className="rounded-md bg-slate-100 py-0.5">{d}</div>
              ))}
            </div>
            </div>
            <div className="mt-1 grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-0.5">
              {days.map((day) => {
                const list = ordersByDate[day] || [];
                const active = day === selectedDate;
                const d = new Date(`${day}T12:00:00`);
                const inMonth = day.startsWith(monthKey);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => onSelectDate(day)}
                    className={
                      'flex h-full min-h-0 flex-col overflow-hidden rounded-lg border-2 p-0.5 text-left transition active:scale-[0.99] sm:p-1 ' +
                      (active
                        ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-200'
                        : inMonth
                          ? 'border-slate-200 bg-white hover:bg-slate-50'
                          : 'border-slate-100 bg-slate-50 opacity-45')
                    }
                  >
                    <p className="shrink-0 text-[11px] font-black leading-none text-slate-500">{d.getDate()}</p>
                    <div className="mt-0.5 min-h-0 flex-1 space-y-0.5 overflow-hidden">
                      {list.slice(0, 3).map((order) => {
                        const party = orderPartyInfo(order, { preferSiteContact: true });
                        return (
                          <span key={order.id} className={'block truncate rounded-md px-1 py-0.5 text-[9px] font-black leading-tight ' + getOrderKindClass(order)}>
                            {party.site || '現場未設定'}: {factoryOrderQuantity(order)}㎡
                            {isLocationPendingOrder(order) ? ' ⚠️' : ''}
                          </span>
                        );
                      })}
                      {list.length > 3 ? <span className="block text-[10px] font-black text-indigo-700">+{list.length - 3}件</span> : null}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
          <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-white p-2 shadow-sm lg:max-h-full">
            <div className="shrink-0">
              <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600">日別タイムスケジュール</p>
              <h3 className="text-sm font-black leading-tight text-slate-900 sm:text-base">{selectedDate.replace(/-/g, '/')}</h3>
            </div>
            {selectedOrders.length === 0 ? (
              <p className="mt-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center text-sm font-bold text-slate-500">
                この日の割当はありません
              </p>
            ) : (
              <ol className="mt-1.5 min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain pr-0.5">
                {selectedOrders.map((order) => {
                  const party = orderPartyInfo(order, { preferSiteContact: true });
                  return (
                    <li
                      key={order.id}
                      onDoubleClick={() => openOrder(order)}
                      onTouchEnd={() => handleOrderTouchEnd(order)}
                      className="cursor-pointer rounded-xl border border-slate-200 bg-slate-50 p-2 transition-all hover:-translate-y-0.5 hover:scale-[1.01] hover:border-indigo-300 hover:bg-indigo-50 hover:shadow-md active:scale-[0.99]"
                      title="ダブルタップで注文詳細へ移動"
                    >
                      <p className="text-sm font-black text-slate-900">{getOrderTimeDisplay(order)} ・ {party.site || '現場未設定'}</p>
                      <p className="mt-0.5 text-xs font-bold text-slate-600">{party.contractor} / {factoryOrderQuantity(order)}㎡ / {order.mixText || order.confirmedMixText || '配合未入力'}</p>
                      <div className="mt-1">
                        <LocationPendingBadge order={order} />
                      </div>
                      <p className="mt-1.5 text-[10px] font-black text-indigo-600">ダブルタップで注文詳細へ</p>
                    </li>
                  );
                })}
              </ol>
            )}
          </aside>
        </section>
      );
    }

    export function FactoryApp() {
      const lastNotifiedHeadIdRef = useRef(null);
      const notifiedOrderIds = useRef(new Set());
      const notifiedAdminModifiedOrderIds = useRef(new Set());
      const initialNotificationMuteDoneRef = useRef(false);
      const [factories, setFactories] = useState([]);
      const [activeFactoryId, setActiveFactoryId] = useState('');
      const [activeFactoryName, setActiveFactoryName] = useState(FACTORY_SITE_NAME);
      const [loginFactoryId, setLoginFactoryId] = useState('');
      const [loginPassword, setLoginPassword] = useState('');
      const [loginError, setLoginError] = useState('');
      const [loginLoading, setLoginLoading] = useState(false);
      const [isFactoryAuthenticated, setIsFactoryAuthenticated] = useState(false);
      const [selectedDate, setSelectedDate] = useState(() => {
        const t = todayLocalISODate();
        const { minIso, maxIso } = getScheduleDateBoundsISO();
        if (t < minIso) return minIso;
        if (t > maxIso) return maxIso;
        return t;
      });
      const [scheduleByDate, setScheduleByDate] = useState({});
      const scheduleByDateRef = useRef({});
      const [activeStamp, setActiveStamp] = useState(null);
      const [stampUndoAvailable, setStampUndoAvailable] = useState(false);
      const stampUndoRef = useRef(null);
      const stampUndoPaintedRef = useRef([]);
      const stampPaintActiveRef = useRef(false);
      const stampPaintedRef = useRef(new Set());
      const stampPaintMapRef = useRef(null);
      const stampPaintDirtyRef = useRef(false);
      const activeStampRef = useRef(null);
      const [rawOrders, setRawOrders] = useState([]);
      const rawOrdersRef = useRef([]);
      const [orders, setOrders] = useState([]);
      const [readOrderIds, setReadOrderIds] = useState(() => new Set());
      const [hiddenOrderIds, setHiddenOrderIds] = useState(() => new Set());
      const [exitingOrderIds, setExitingOrderIds] = useState(() => new Set());
      const exitingOrderSnapshotsRef = useRef(new Map());
      const [projects, setProjects] = useState([]);
      const [customers, setCustomers] = useState([]);
      const [organizations, setOrganizations] = useState([]);
      const [holidays, setHolidays] = useState([]);
      const [systemSettings, setSystemSettings] = useState({ start_time: '08:00:00', end_time: '16:00:00' });
      const [operationalSettings, setOperationalSettings] = useState(null);
      const [escalationStepsByFactoryId, setEscalationStepsByFactoryId] = useState({});
      const [nearPoolSize, setNearPoolSize] = useState(5);
      const [factorySmallVehicleInfo, setFactorySmallVehicleInfo] = useState({});
      const [monthlyVolumeByFactory, setMonthlyVolumeByFactory] = useState({});
      const masterDataReady = useMemo(
        () => factories.length > 0 && Object.keys(escalationStepsByFactoryId).length > 0,
        [factories, escalationStepsByFactoryId],
      );
      const escalationSettings = useMemo(
        () => ({
          ...systemSettings,
          allowed_delivery_areas:
            operationalSettings?.allowed_delivery_areas ?? systemSettings?.allowed_delivery_areas,
          spot_threshold_volume:
            operationalSettings?.spot_threshold_volume ?? systemSettings?.spot_threshold_volume,
          near_pool_size: nearPoolSize,
        }),
        [systemSettings, operationalSettings, nearPoolSize],
      );
      const [escalationTick, setEscalationTick] = useState(0);
      const [toastOrder, setToastOrder] = useState(null);
      const [toastIsReassignment, setToastIsReassignment] = useState(false);
      const [acceptModalOrder, setAcceptModalOrder] = useState(null);
      const [acceptSubmitting, setAcceptSubmitting] = useState(false);
      const [actionNotice, setActionNotice] = useState('');
      const [chatThreads, setChatThreads] = useState({});
      const chatThreadsRef = useRef(chatThreads);
      const [readChatKeys, setReadChatKeys] = useState({});
      const readChatKeysRef = useRef(readChatKeys);
      const [activeTab, setActiveTab] = useState('orders');
      const [calendarMode, setCalendarMode] = useState('orders'); // 'capacity' | 'orders' | 'charterRequests'
      const [historySearchQuery, setHistorySearchQuery] = useState('');
      const [historyDateFrom, setHistoryDateFrom] = useState('');
      const [historyDateTo, setHistoryDateTo] = useState('');
      const [factoryNewsUnread, setFactoryNewsUnread] = useState(0);
      const [charterPendingCount, setCharterPendingCount] = useState(0);
      const [focusedOrderId, setFocusedOrderId] = useState('');
      const applyFactoryPushRedirect = useCallback((payload) => {
        const id = String(payload?.orderId || '').trim();
        if (!id) return;
        setActiveTab('orders');
        setFocusedOrderId(id);
        clearPushRedirect();
      }, []);

      useEffect(() => {
        consumePushRedirectForApp('factory');
      }, []);

      useEffect(() => {
        return setupPushRedirectListener('factory', (payload) => {
          if (!isFactoryAuthenticated) return;
          applyFactoryPushRedirect(payload);
        });
      }, [applyFactoryPushRedirect, isFactoryAuthenticated]);

      useEffect(() => {
        if (!isFactoryAuthenticated || !activeFactoryId) return;
        const payload = readPushRedirectFromSession();
        if (!payload || payload.targetApp !== 'factory') return;
        const orderId = String(payload.orderId || '');
        const hasOrder =
          (orders || []).some((o) => String(o?.id || '') === orderId) ||
          (rawOrders || []).some((o) => String(o?.id || '') === orderId);
        if (!hasOrder && (rawOrders || []).length === 0) return;
        applyFactoryPushRedirect(payload);
      }, [
        activeFactoryId,
        applyFactoryPushRedirect,
        isFactoryAuthenticated,
        orders,
        rawOrders,
      ]);

      const [scheduleMonth, setScheduleMonth] = useState(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
      });
      const [calendarSelectedDate, setCalendarSelectedDate] = useState(() => todayLocalISODate());
      const [currentMonth, setCurrentMonth] = useState(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1);
      });

      const factoryNameById = useMemo(
        () => Object.fromEntries((factories || []).map((f) => [f.id, f.name])),
        [factories],
      );
      const projectById = useMemo(
        () => Object.fromEntries((projects || []).filter((p) => p?.id).map((p) => [String(p.id), p])),
        [projects],
      );
      const customerById = useMemo(
        () => Object.fromEntries((customers || []).filter((c) => c?.id).map((c) => [String(c.id), c])),
        [customers],
      );
      const organizationById = useMemo(
        () => Object.fromEntries((organizations || []).filter((o) => o?.id).map((o) => [String(o.id), o])),
        [organizations],
      );
      const handleSiteUrlCopied = useCallback(() => {
        setActionNotice('URLをコピーしました');
        window.setTimeout(() => setActionNotice(''), 2500);
      }, []);
      const activeFactoryRows = useMemo(
        () => (factories || []).filter((f) => f && String(f.id) === String(activeFactoryId)),
        [factories, activeFactoryId],
      );
      const activeFactoryMissing = Boolean(activeFactoryId) && factories.length > 0 && activeFactoryRows.length === 0;

      useEffect(() => {
        scheduleByDateRef.current = scheduleByDate;
      }, [scheduleByDate]);

      useEffect(() => {
        activeStampRef.current = activeStamp;
      }, [activeStamp]);

      useEffect(() => {
        if (activeTab !== 'calendar' || calendarMode !== 'capacity') {
          setActiveStamp(null);
        }
      }, [activeTab, calendarMode]);

      useEffect(() => {
        rawOrdersRef.current = rawOrders;
      }, [rawOrders]);

      useEffect(() => {
        chatThreadsRef.current = chatThreads;
      }, [chatThreads]);

      useEffect(() => {
        readChatKeysRef.current = readChatKeys;
      }, [readChatKeys]);

      const refreshChatThreads = useCallback(async () => {
        const { chatThreads: th } = await db.fetchOrdersWithChat();
        setChatThreads(th);
      }, []);

      const markOrderRead = useCallback((orderId) => {
        const id = String(orderId || '').trim();
        if (!id) return;
        setReadOrderIds((prev) => {
          if (prev.has(id)) return prev;
          const next = new Set(prev);
          next.add(id);
          return next;
        });
      }, []);

      const markChatRead = useCallback((orderId, messages) => {
        const id = String(orderId || '').trim();
        const key = chatMessageReadKey(latestChatMessage(messages));
        if (!id || !key) return;
        if (readChatKeysRef.current?.[id] === key) return;
        setReadChatKeys((prev) => {
          if (prev?.[id] === key) return prev;
          const next = { ...prev, [id]: key };
          readChatKeysRef.current = next;
          return next;
        });
        void db.markFactoryChatRead(id, key).catch((err) => {
          console.error('[FactoryApp] チャット既読の保存に失敗', err);
        });
      }, []);

      const hideOrder = useCallback((orderId) => {
        const id = String(orderId || '').trim();
        if (!id) return;
        setHiddenOrderIds((prev) => {
          if (prev.has(id)) return prev;
          const next = new Set(prev);
          next.add(id);
          return next;
        });
        setToastOrder((cur) => {
          if (cur?.id === id) {
            setToastIsReassignment(false);
            return null;
          }
          return cur;
        });
      }, []);

      const beginCardExit = useCallback((orderId, after, snapshot) => {
        const id = String(orderId || '').trim();
        if (!id) {
          after?.();
          return;
        }
        if (snapshot) exitingOrderSnapshotsRef.current.set(id, snapshot);

        const reduceMotion =
          typeof window !== 'undefined' &&
          window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        if (reduceMotion) {
          try {
            after?.();
          } finally {
            exitingOrderSnapshotsRef.current.delete(id);
          }
          return;
        }

        setExitingOrderIds((prev) => {
          if (prev.has(id)) return prev;
          return new Set(prev).add(id);
        });
        window.setTimeout(() => {
          try {
            after?.();
          } finally {
            setExitingOrderIds((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
            exitingOrderSnapshotsRef.current.delete(id);
          }
        }, 340);
      }, []);

      const showAllHiddenOrders = useCallback(() => {
        setHiddenOrderIds(new Set());
      }, []);

      const handleFactoryLogin = useCallback(
        async (e) => {
          if (e && typeof e.preventDefault === 'function') e.preventDefault();
          const fid = String(loginFactoryId || '').trim();
          if (!fid) {
            setLoginError('工場を選択してください');
            return;
          }
          setLoginError('');
          setLoginLoading(true);
          try {
            const ok = await db.verifyFactoryPassword(fid, loginPassword);
            if (!ok) {
              setLoginError('パスワードが間違っています');
              return;
            }
            const selected = (factories || []).find((f) => String(f.id) === fid);
            const displayName = selected?.name || (fid === FACTORY_SITE_ID ? FACTORY_SITE_NAME : fid);
            setActiveFactoryId(fid);
            setActiveFactoryName(displayName);
            setIsFactoryAuthenticated(true);
            primeNotificationAlarm();
            await registerOneSignalUser(buildFactoryOneSignalExternalId(fid), { role: 'factory', factory_id: String(fid) });
            setLoginPassword('');
            setHiddenOrderIds(new Set());
            setToastOrder(null);
            setToastIsReassignment(false);
            setFactoryPanelSession(fid, loginPassword);
            await issuePanelRealtimeAuth('factory', fid, loginPassword);
            try {
              writeAuthValue(FACTORY_SESSION_STORAGE_KEY, fid);
              writeAuthValue(FACTORY_AUTH_STORAGE_KEY, fid);
            } catch {
              /* ignore */
            }
          } catch (err) {
            console.error(err);
            setLoginError('ログインに失敗しました。通信状態を確認してください');
          } finally {
            setLoginLoading(false);
          }
        },
        [factories, loginFactoryId, loginPassword],
      );

      const dismissNewOrderToast = useCallback(() => {
        stopNotificationAlarm();
        setToastOrder(null);
        setToastIsReassignment(false);
      }, []);

      useEffect(() => {
        if (toastOrder) {
          startNotificationAlarm();
          return () => stopNotificationAlarm();
        }
        stopNotificationAlarm();
        return undefined;
      }, [toastOrder?.id]);

      useEffect(() => {
        if (!isFactoryAuthenticated) return undefined;
        const onGesture = () => primeNotificationAlarm();
        window.addEventListener('pointerdown', onGesture, { once: true, passive: true });
        return () => window.removeEventListener('pointerdown', onGesture);
      }, [isFactoryAuthenticated]);

      useEffect(() => {
        if (!isFactoryAuthenticated || !activeFactoryId) return undefined;
        let cancelled = false;
        const factoryId = String(activeFactoryId);
        (async () => {
          if (cancelled || !factoryId) return;
          await registerOneSignalUser(buildFactoryOneSignalExternalId(factoryId), {
            role: 'factory',
            factory_id: String(factoryId),
          });
        })();
        return () => {
          cancelled = true;
        };
      }, [isFactoryAuthenticated, activeFactoryId]);

      const handleFactoryLogout = useCallback(() => {
        void unregisterOneSignalUser().catch(() => {});
        stopNotificationAlarm();
        setToastOrder(null);
        setToastIsReassignment(false);
        clearFactoryPanelSession();
        try {
          removeAuthValue(FACTORY_AUTH_STORAGE_KEY);
          removeAuthValue(FACTORY_SESSION_STORAGE_KEY);
        } catch {
          /* ignore */
        }
        setIsFactoryAuthenticated(false);
        setActiveFactoryId('');
        setActiveFactoryName('');
        setOrders([]);
        setRawOrders([]);
        setToastOrder(null);
        setLoginPassword('');
        setLoginError('');
      }, []);

      const applyVisibleOrders = useCallback(
        (list) => {
          if (!activeFactoryId) return [];
          const ctx = buildEscalationContext(
            list,
            factories,
            projects,
            escalationSettings,
            holidays,
            new Date(),
            escalationStepsByFactoryId,
            customers,
            factorySmallVehicleInfo,
            monthlyVolumeByFactory,
          );
          return filterAndSortFactoryOrders(list, activeFactoryId, ctx).filter((o) => !hiddenOrderIds.has(String(o?.id || '')));
        },
        [activeFactoryId, factories, projects, customers, escalationSettings, holidays, hiddenOrderIds, escalationStepsByFactoryId, factorySmallVehicleInfo, monthlyVolumeByFactory],
      );

      const applyIncomingOrders = useCallback(
        (list, options) => {
          const playSound = options && options.playSound;
          const muteExisting = options && options.muteExisting;
          const notifyOrderIds = options?.notifyOrderIds;
          const reassignNotifyOrderIds = options?.reassignNotifyOrderIds;
          const forceNotify = (orderId) => {
            if (!notifyOrderIds) return false;
            if (notifyOrderIds instanceof Set) return notifyOrderIds.has(String(orderId));
            if (Array.isArray(notifyOrderIds)) return notifyOrderIds.includes(String(orderId));
            return false;
          };
          setRawOrders(Array.isArray(list) ? list : []);
          const visible = applyVisibleOrders(list);
          setOrders(visible);
          if (muteExisting) {
            for (const o of visible) {
              if (o?.id) notifiedOrderIds.current.add(o.id);
              if (o?.id && o.is_admin_modified) notifiedAdminModifiedOrderIds.current.add(o.id);
            }
            return;
          }
          const adminModified = visible.find((o) => o?.id && o.is_admin_modified && !notifiedAdminModifiedOrderIds.current.has(o.id));
          if (adminModified) {
            notifiedAdminModifiedOrderIds.current.add(adminModified.id);
            setActionNotice('⚠️ 管理者によって注文内容が変更されました。内容を確認してください。');
            window.setTimeout(() => setActionNotice(''), 6000);
            void db.clearOrderAdminModifiedFlag(adminModified.id).then((updated) => {
              if (!updated) return;
              const patchOrder = (o) =>
                o?.id === updated.id ? { ...o, ...updated, is_admin_modified: false } : o;
              setRawOrders((prev) => (Array.isArray(prev) ? prev.map(patchOrder) : prev));
              setOrders((prev) => (Array.isArray(prev) ? prev.map(patchOrder) : prev));
            });
          }
          const isNotifyCandidate = (o) => {
            if (!o?.id) return false;
            if (String(o.status || 'pending') !== 'pending') return false;
            if (isRejectedByFactory(o, activeFactoryId)) return false;
            return true;
          };
          const head =
            (notifyOrderIds && notifyOrderIds.size > 0
              ? visible.find((o) => isNotifyCandidate(o) && forceNotify(o.id))
              : null) ??
            visible.find((o) => {
              if (!isNotifyCandidate(o)) return false;
              if (forceNotify(o.id)) return true;
              if (notifiedOrderIds.current.has(o.id)) return false;
              return true;
            }) ??
            null;
          if (head && playSound) {
            const isReassign =
              reassignNotifyOrderIds instanceof Set
                ? reassignNotifyOrderIds.has(String(head.id))
                : false;
            setToastIsReassignment(isReassign);
            setToastOrder(head);
            lastNotifiedHeadIdRef.current = head.id;
            notifiedOrderIds.current.add(head.id);
          }
        },
        [activeFactoryId, applyVisibleOrders],
      );

      useEffect(() => {
        if (!rawOrders.length || !activeFactoryId) return;
        setOrders(applyVisibleOrders(rawOrders));
      }, [rawOrders, activeFactoryId, applyVisibleOrders, escalationTick]);

      useEffect(() => {
        const id = window.setInterval(() => setEscalationTick((t) => t + 1), 60000);
        return () => window.clearInterval(id);
      }, []);

      const persistOrders = useCallback(
        async (next) => {
          await db.upsertOrdersBatch(next, chatThreads);
        },
        [chatThreads],
      );

      const runScheduleAutoPipeline = useCallback(
        async (scheduleArg) => {
          let { orders: list, chatThreads: th } = await db.fetchOrdersWithChat();
          const idArr = collectScheduleFactoryIds(list, activeFactoryId);
          const byF = idArr.length ? await db.fetchSchedulesForFactories(idArr) : {};
          if (activeFactoryId) {
            const local =
              scheduleArg != null
                ? normalizeFullSchedule(scheduleArg)
                : normalizeFullSchedule(scheduleByDateRef.current);
            if (Object.keys(local).length) {
              byF[String(activeFactoryId)] = local;
            }
          }
          const r = await db.persistScheduleAutoRejections({
            schedulesByFactoryId: byF,
            orders: list,
            chatThreads: th,
            factoryNameById,
            defaultFactorySiteName: activeFactoryName || FACTORY_SITE_NAME,
            defaultFactorySiteId: activeFactoryId || FACTORY_SITE_ID,
          });
          if (r.changed) {
            setChatThreads(r.chatThreads);
            applyIncomingOrders(r.orders, { playSound: false });
          }
        },
        [activeFactoryId, activeFactoryName, applyIncomingOrders, factoryNameById],
      );

      const enrichOrdersWithProjectFactory = useCallback((list) => {
        const projectById = Object.fromEntries(
          (projects || []).filter((p) => p?.id).map((p) => [String(p.id), p]),
        );
        return (Array.isArray(list) ? list : []).map((order) => {
          if (!order) return order;
          const pid = String(order.project_id ?? order.projectId ?? '').trim();
          if (!pid) return order;
          const mainId = resolveFactoryIdFromProject(projectById[pid]);
          if (!mainId) return order;
          const existingMain = normalizeFactoryRefId(order.main_factory_id ?? order.mainFactoryId);
          if (existingMain === mainId) return order;
          return {
            ...order,
            main_factory_id: mainId,
            mainFactoryId: mainId,
          };
        });
      }, [projects]);

      const syncFromStorage = useCallback(
        async (options, realtimePayload) => {
          const prevOrders = rawOrdersRef.current;
          let { orders: list, chatThreads: th } = await db.fetchOrdersWithChat();
          list = enrichOrdersWithProjectFactory(list);
          setChatThreads(th);

          const mergedReadKeys = { ...(readChatKeysRef.current || {}) };
          let readKeysChanged = false;
          for (const order of list || []) {
            if (!order?.id) continue;
            const persisted = String(order.factory_chat_read_key ?? order.factoryChatReadKey ?? '').trim();
            if (persisted && !mergedReadKeys[order.id]) {
              mergedReadKeys[order.id] = persisted;
              readKeysChanged = true;
            }
          }
          if (readKeysChanged) {
            readChatKeysRef.current = mergedReadKeys;
            setReadChatKeys(mergedReadKeys);
          }

          const notifyOrderIds = new Set();
          const reassignNotifyOrderIds = new Set();
          if (activeFactoryId) {
            const ctx = buildEscalationContext(
              list,
              factories,
              projects,
              escalationSettings,
              holidays,
              new Date(),
              escalationStepsByFactoryId,
              customers,
              factorySmallVehicleInfo,
              monthlyVolumeByFactory,
            );
            const detected = detectFactoryNotifyOrderIds(prevOrders, list, activeFactoryId, ctx);
            for (const id of detected.notifyOrderIds) notifyOrderIds.add(id);
            for (const id of detected.reassignNotifyOrderIds) reassignNotifyOrderIds.add(id);
            if (realtimePayload) {
              try {
                const normalizedPayload = { ...realtimePayload };
                if (realtimePayload.new && typeof realtimePayload.new === 'object') {
                  const normalizedNew = db.normalizeOrderRow(realtimePayload.new);
                  if (normalizedNew) normalizedPayload.new = normalizedNew;
                }
                if (realtimePayload.old && typeof realtimePayload.old === 'object') {
                  const normalizedOld = db.normalizeOrderRow(realtimePayload.old);
                  if (normalizedOld) normalizedPayload.old = normalizedOld;
                }
                const analysis = analyzeFactoryOrderRealtimePayload(normalizedPayload, activeFactoryId, ctx);
                for (const id of analysis.notifyOrderIds) notifyOrderIds.add(id);
                for (const id of analysis.reassignNotifyOrderIds) reassignNotifyOrderIds.add(id);
              } catch (realtimeErr) {
                console.error('[FactoryApp] Realtime ペイロード解析に失敗（再フェッチ結果を優先）', realtimeErr);
              }
            }
          }

          const incomingOptions = {
            ...options,
            playSound: Boolean(options?.playSound) && masterDataReady,
            ...(notifyOrderIds.size > 0 ? { notifyOrderIds } : {}),
            ...(reassignNotifyOrderIds.size > 0 ? { reassignNotifyOrderIds } : {}),
          };
          applyIncomingOrders(list, incomingOptions);
          const idArr = collectScheduleFactoryIds(list, activeFactoryId);
          const byF = idArr.length ? await db.fetchSchedulesForFactories(idArr) : {};
          const r = await db.persistScheduleAutoRejections({
            schedulesByFactoryId: byF,
            orders: list,
            chatThreads: th,
            factoryNameById,
            defaultFactorySiteName: activeFactoryName || FACTORY_SITE_NAME,
            defaultFactorySiteId: activeFactoryId || FACTORY_SITE_ID,
          });
          if (r.changed) {
            setChatThreads(r.chatThreads);
            applyIncomingOrders(r.orders, {
              playSound: false,
              muteExisting: Boolean(options?.muteExisting),
            });
          }
        },
        [activeFactoryId, activeFactoryName, applyIncomingOrders, factoryNameById, factories, projects, customers, escalationSettings, holidays, enrichOrdersWithProjectFactory, escalationStepsByFactoryId, masterDataReady, factorySmallVehicleInfo, monthlyVolumeByFactory],
      );

      const syncFromStorageRef = useRef(syncFromStorage);
      const runScheduleAutoPipelineRef = useRef(runScheduleAutoPipeline);
      useEffect(() => {
        syncFromStorageRef.current = syncFromStorage;
      }, [syncFromStorage]);
      useEffect(() => {
        runScheduleAutoPipelineRef.current = runScheduleAutoPipeline;
      }, [runScheduleAutoPipeline]);

      useEffect(() => {
        if (!activeFactoryId) return undefined;
        if (!masterDataReady) return undefined;
        // マスタ再取得などに伴う再同期は既存注文の通知を出さない
        void syncFromStorage({ playSound: false, muteExisting: true });
        return undefined;
      }, [activeFactoryId, masterDataReady, factories, projects, holidays, escalationSettings, escalationStepsByFactoryId, factorySmallVehicleInfo, monthlyVolumeByFactory, syncFromStorage]);

      useEffect(() => {
        if (!activeFactoryId) return undefined;
        const pollId = window.setInterval(() => {
          void syncFromStorageRef.current({ playSound: true });
        }, 30000);
        const onFocus = () => {
          void syncFromStorageRef.current({ playSound: true });
        };
        window.addEventListener('focus', onFocus);
        return () => {
          window.clearInterval(pollId);
          window.removeEventListener('focus', onFocus);
        };
      }, [activeFactoryId]);

      useEffect(() => {
        const refreshAfterMapSave = () => {
          void syncFromStorage({ playSound: false });
        };
        const onStorage = (e) => {
          if (e.key === MAP_EDITOR_ORDER_SAVED_EVENT_KEY) refreshAfterMapSave();
        };
        const onMessage = (e) => {
          if (e?.data?.type === 'haisha_map_editor_saved') refreshAfterMapSave();
        };
        const onDom = () => refreshAfterMapSave();
        const onFocus = () => refreshAfterMapSave();
        window.addEventListener('storage', onStorage);
        window.addEventListener('message', onMessage);
        window.addEventListener(MAP_EDITOR_ORDER_SAVED_DOM_EVENT, onDom);
        window.addEventListener('focus', onFocus);
        return () => {
          window.removeEventListener('storage', onStorage);
          window.removeEventListener('message', onMessage);
          window.removeEventListener(MAP_EDITOR_ORDER_SAVED_DOM_EVENT, onDom);
          window.removeEventListener('focus', onFocus);
        };
      }, [syncFromStorage]);

      const refreshCharterPendingCount = useCallback(async () => {
        if (!activeFactoryId) {
          setCharterPendingCount(0);
          return;
        }
        try {
          const [openRequests, myResponses] = await Promise.all([
            db.fetchOpenCharterRequestsForResponder('factory', activeFactoryId),
            db.fetchMyCharterResponses('factory', activeFactoryId),
          ]);
          setCharterPendingCount(countPendingCharterResponses(openRequests, myResponses));
        } catch (e) {
          console.error('[FactoryApp] charter pending count failed', e);
        }
      }, [activeFactoryId]);

      useEffect(() => {
        void refreshCharterPendingCount();
      }, [refreshCharterPendingCount]);

      useEffect(() => {
        if (activeTab === 'charterRespond') {
          void refreshCharterPendingCount();
        }
      }, [activeTab, refreshCharterPendingCount]);

      useEffect(() => {
        if (!activeFactoryId) return undefined;
        const id = window.setInterval(() => {
          void refreshCharterPendingCount();
        }, 60000);
        return () => window.clearInterval(id);
      }, [activeFactoryId, refreshCharterPendingCount]);

      const handleFactoryRefresh = useCallback(async () => {
        await syncFromStorage({ playSound: false });
        try {
          const [projs, customerRows] = await Promise.all([db.fetchProjects(), db.fetchCustomers()]);
          setProjects(projs);
          setCustomers(customerRows);
        } catch (e) {
          console.error('物件・業者マスタの再取得に失敗しました', e);
        }
        if (activeFactoryId) {
          const m = await db.fetchSchedulesForFactory(activeFactoryId);
          setScheduleByDate(m);
          await runScheduleAutoPipeline(m);
        }
        await refreshCharterPendingCount();
      }, [activeFactoryId, refreshCharterPendingCount, runScheduleAutoPipeline, syncFromStorage]);

      const selectedFactoryStatus = useMemo(() => {
        const selectedHoliday = (holidays || []).find((h) => String(h?.holiday_date || '').slice(0, 10) === String(selectedDate || '').slice(0, 10));
        if (!selectedHoliday) return 'normal';
        return String(selectedHoliday.description || '').includes('メンテ') ? 'maintenance' : 'stopped';
      }, [holidays, selectedDate]);

      const handleFactoryStatusChange = useCallback(async (nextStatus) => {
        const status = ['normal', 'stopped', 'maintenance'].includes(nextStatus) ? nextStatus : 'normal';
        const targetDate = String(selectedDate || '').slice(0, 10);
        if (!targetDate) return;
        const description = status === 'maintenance' ? 'メンテナンス' : '休日';
        const optimisticHoliday = { id: `temp-${targetDate}`, holiday_date: targetDate, description };
        setHolidays((prev) => {
          const withoutTarget = (prev || []).filter((h) => String(h?.holiday_date || '').slice(0, 10) !== targetDate);
          return status === 'normal' ? withoutTarget : [...withoutTarget, optimisticHoliday];
        });
        try {
          const existingItems = (holidays || []).filter((h) => String(h?.holiday_date || '').slice(0, 10) === targetDate);
          for (const existing of existingItems) {
            if (existing?.id && !String(existing.id).startsWith('temp-')) {
              await db.deleteHoliday(existing.id);
            }
          }
          if (status !== 'normal') {
            await db.insertHoliday({ holiday_date: targetDate, description });
          }
          setActionNotice(status === 'normal' ? '通常営業に戻しました' : status === 'maintenance' ? 'メンテナンス日にしました' : '休日にしました');
          const hols = await db.fetchHolidays();
          setHolidays(hols);
          window.setTimeout(() => setActionNotice(''), 3500);
        } catch (error) {
          console.error(error);
          const hols = await db.fetchHolidays().catch(() => null);
          if (hols) setHolidays(hols);
          window.alert('工場状況の更新に失敗しました');
        }
      }, [holidays, selectedDate]);

      const handleScheduleMonthChange = useCallback((nextMonth) => {
        const next = nextMonth instanceof Date && !Number.isNaN(nextMonth.getTime()) ? nextMonth : new Date();
        const normalized = new Date(next.getFullYear(), next.getMonth(), 1);
        setScheduleMonth(normalized);
        setSelectedDate(`${normalized.getFullYear()}-${pad2(normalized.getMonth() + 1)}-01`);
      }, []);

      const handleSelectScheduleDate = useCallback((day) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(day || ''))) return;
        setSelectedDate(day);
        const next = new Date(`${day}T12:00:00`);
        if (!Number.isNaN(next.getTime())) {
          setScheduleMonth(new Date(next.getFullYear(), next.getMonth(), 1));
        }
      }, []);

      const handleCalendarMonthChange = useCallback(
        (nextMonth) => {
          const next = nextMonth instanceof Date && !Number.isNaN(nextMonth.getTime()) ? nextMonth : new Date();
          const normalized = new Date(next.getFullYear(), next.getMonth(), 1);
          setCurrentMonth(normalized);
          const nextSelected = `${normalized.getFullYear()}-${pad2(normalized.getMonth() + 1)}-01`;
          setCalendarSelectedDate(nextSelected);
          void handleFactoryRefresh();
        },
        [handleFactoryRefresh],
      );

      const todaySchedule = useMemo(() => todayLocalISODate(), [escalationTick]);

      const factoryInProgressOrders = useMemo(
        () => (orders || []).filter((o) => isOrderInProgressView(o, todaySchedule, activeFactoryId)),
        [orders, todaySchedule, activeFactoryId],
      );

      // 退場アニメ中は Realtime sync でリストから落ちてもスナップショットで描画を維持する
      const inboxOrders = useMemo(() => {
        const base = Array.isArray(factoryInProgressOrders) ? [...factoryInProgressOrders] : [];
        const present = new Set(base.map((o) => String(o?.id || '')).filter(Boolean));
        for (const id of exitingOrderIds) {
          if (present.has(id)) continue;
          const snap = exitingOrderSnapshotsRef.current.get(id);
          if (snap) base.push(snap);
        }
        return base;
      }, [factoryInProgressOrders, exitingOrderIds]);

      const factoryHistoryOrders = useMemo(
        () =>
          sortOrdersForHistory((orders || []).filter((o) => isOrderInHistoryView(o, todaySchedule, activeFactoryId))),
        [orders, todaySchedule, activeFactoryId],
      );

      const filteredFactoryHistoryOrders = useMemo(() => {
        const from = String(historyDateFrom || '').slice(0, 10);
        const to = String(historyDateTo || '').slice(0, 10);
        return factoryHistoryOrders.filter((order) => {
          if (!orderMatchesFactorySearch(order, historySearchQuery, activeFactoryName)) return false;
          const d = factoryOrderDate(order);
          if (from && (!d || d < from)) return false;
          if (to && (!d || d > to)) return false;
          return true;
        });
      }, [factoryHistoryOrders, historySearchQuery, historyDateFrom, historyDateTo, activeFactoryName]);

      const newOrdersCount = useMemo(
        () =>
          (factoryInProgressOrders || []).filter((order) => {
            if (!order?.id) return false;
            if (readOrderIds.has(String(order.id))) return false;
            if (isRejectedByFactory(order, activeFactoryId)) return false;
            const orderStatus = String(order.status || '').trim();
            if (['accepted', 'rejected', 'customer_cancelled', 'cancelled', 'completed', 'deleted'].includes(orderStatus)) {
              return false;
            }
            if (normalizeFactoryResponse(order.factoryResponseStatus)) return false;
            const assignedFactoryId = getAssignedFactoryId(order);
            return !assignedFactoryId || isSameFactoryId(assignedFactoryId, activeFactoryId);
          }).length,
        [factoryInProgressOrders, activeFactoryId, readOrderIds],
      );

      const unreadChatCount = useMemo(
        () =>
          (factoryInProgressOrders || []).filter((order) =>
            order?.id && isUnreadForFactory(chatThreads[order.id], readChatKeys?.[order.id]),
          ).length,
        [factoryInProgressOrders, chatThreads, readChatKeys],
      );

      useEffect(() => {
        setAppBadge(newOrdersCount + unreadChatCount);
      }, [newOrdersCount, unreadChatCount]);

      const handleOpenOrderFromCalendar = useCallback(
        (orderId) => {
          const id = String(orderId || '').trim();
          if (!id) return;
          const target = (orders || []).find((o) => String(o?.id) === id);
          setFocusedOrderId(id);
          setActiveTab(target && isOrderInHistoryView(target, todaySchedule, activeFactoryId) ? 'history' : 'orders');
          setActionNotice('注文詳細を開きました');
          window.setTimeout(() => setActionNotice(''), 2500);
        },
        [orders, todaySchedule, activeFactoryId],
      );

      const refreshFactoryNewsUnread = useCallback(async () => {
        if (!activeFactoryId) {
          setFactoryNewsUnread(0);
          return;
        }
        try {
          const feed = await db.fetchFactoryNewsFeed(activeFactoryId);
          setFactoryNewsUnread(countUnreadNewsForFactory(feed.news, feed.reads, activeFactoryId));
        } catch (e) {
          console.error('[FactoryApp] news unread count failed', e);
        }
      }, [activeFactoryId]);

      useEffect(() => {
        void refreshFactoryNewsUnread();
      }, [refreshFactoryNewsUnread]);

      useEffect(() => {
        if (activeTab === 'news') {
          void refreshFactoryNewsUnread();
        }
      }, [activeTab, refreshFactoryNewsUnread]);

      useEffect(() => {
        let cancelled = false;
        (async () => {
          try {
            const [rows, projs, hols, settings, customerRows, organizationRows, opSettings, escalationSteps, poolSize, smallVehicleInfo, monthlyVolumes] = await Promise.all([
              db.fetchFactories(),
              db.fetchProjects(),
              db.fetchHolidays(),
              db.fetchSystemSettings(),
              db.fetchCustomers(),
              db.fetchOrganizations().catch((error) => {
                console.warn('[FactoryApp] organizations load failed', error);
                return [];
              }),
              db.fetchDispatchOperationalSettings(),
              db.fetchEscalationSteps(),
              db.fetchNearPoolSize().catch((e) => {
                console.warn('[FactoryApp] near_pool_size fetch failed', e);
                return 5;
              }),
              db.fetchFactorySmallVehicleInfo().catch((e) => {
                console.warn('[FactoryApp] small vehicle info fetch failed', e);
                return {};
              }),
              db.fetchMonthlyVolumeByFactory().catch((e) => {
                console.warn('[FactoryApp] monthly volume fetch failed', e);
                return {};
              }),
            ]);
            if (cancelled) return;
            setFactories(rows);
            setProjects(projs);
            setCustomers(customerRows);
            setOrganizations(organizationRows);
            setHolidays(hols);
            setSystemSettings(settings);
            setOperationalSettings(opSettings);
            setEscalationStepsByFactoryId(escalationSteps || {});
            setNearPoolSize(poolSize);
            setFactorySmallVehicleInfo(smallVehicleInfo || {});
            setMonthlyVolumeByFactory(monthlyVolumes || {});
            const nameMap = Object.fromEntries((rows || []).map((r) => [r.id, r.name]));
            const urlId = getFactoryIdFromUrl();
            const stored = readStoredFactoryId();
            const authStored = readAuthenticatedFactoryId();
            const rowIds = new Set((rows || []).map((r) => String(r.id)));
            const preselected =
              urlId ||
              (stored && rowIds.has(stored) ? stored : '') ||
              (rows[0] ? rows[0].id : FACTORY_SITE_ID);
            setLoginFactoryId(preselected);

            const canRestoreAuth =
              authStored &&
              stored &&
              authStored === stored &&
              rowIds.has(stored) &&
              hasFactoryPanelSession();
            if (canRestoreAuth) {
              const selected = (rows || []).find((f) => String(f.id) === String(stored));
              const displayName = nameMap[stored] || FACTORY_SITE_NAME;
              setActiveFactoryId(stored);
              setActiveFactoryName(displayName);
              setIsFactoryAuthenticated(true);
              try {
                const storedPassword = String(readAuthValue(FACTORY_PANEL_PASSWORD_KEY) || '').trim();
                if (storedPassword) {
                  await issuePanelRealtimeAuth('factory', stored, storedPassword);
                } else {
                  await ensurePanelRealtimeAuth();
                }
              } catch {
                await ensurePanelRealtimeAuth();
              }
            } else {
              clearFactoryPanelSession();
              setActiveFactoryId('');
              setActiveFactoryName('');
              setIsFactoryAuthenticated(false);
            }
          } catch (e) {
            console.error(e);
            setLoginFactoryId(FACTORY_SITE_ID);
            setActiveFactoryId('');
            setActiveFactoryName('');
            setIsFactoryAuthenticated(false);
          }
        })();
        return () => {
          cancelled = true;
        };
      }, []);

      useEffect(() => {
        if (!activeFactoryId) return undefined;
        const factoryId = activeFactoryId;
        let cancel = false;
        (async () => {
          try {
            const m = await db.fetchSchedulesForFactory(factoryId);
            if (!cancel) setScheduleByDate(m);
          } catch (e) {
            console.error(e);
          }
        })();
        const muteInitial = !initialNotificationMuteDoneRef.current;
        if (muteInitial) initialNotificationMuteDoneRef.current = true;
        void syncFromStorageRef.current({ playSound: true, muteExisting: muteInitial });
        const realtimeSync = createSplitRealtimeSyncScheduler({
          debounceMs: 500,
          onOrderSync: async (payload) => {
            if (cancel) return;
            await syncFromStorageRef.current({ playSound: true }, payload);
            try {
              const m = await db.fetchSchedulesForFactory(factoryId);
              if (!cancel) setScheduleByDate(m);
            } catch {
              /* ignore */
            }
          },
          onChatSync: async (payload) => {
            if (cancel) return;
            try {
              if (payload) {
                const chatHint = analyzeFactoryChatRealtimePayload(payload, chatThreadsRef.current || {});
                if (chatHint.shouldPlayChatSound) {
                  const soundKey = chatSoundKeyFromRealtimePayload(payload);
                  if (shouldPlayChatSoundOnce(soundKey)) {
                    playFactoryChatNotificationSound();
                  }
                }
              }
              const { chatThreads: th } = await db.fetchOrdersWithChat();
              if (!cancel) setChatThreads(th);
            } catch (e) {
              console.error('[FactoryApp] chat realtime sync failed', e);
            }
          },
        });
        let unsubRealtime = () => {};
        void (async () => {
          try {
            const factoryPassword = String(readAuthValue(FACTORY_PANEL_PASSWORD_KEY) || '').trim();
            if (factoryPassword) {
              await issuePanelRealtimeAuth('factory', factoryId, factoryPassword);
            } else {
              await ensurePanelRealtimeAuth();
            }
            if (cancel) return;
            const subscribe = db?.subscribeOrdersRealtime;
            if (typeof subscribe !== 'function') return;
            unsubRealtime = await subscribe(
              (payload) => {
                dispatchRealtimePayloadByKind(payload, {
                  onOrder: (p) => realtimeSync.scheduleOrder(p),
                  onSchedule: (p) => realtimeSync.scheduleOrder(p),
                  onChat: (p) => {
                    realtimeSync.scheduleChat(p);
                  },
                });
              },
              { skipAuth: true },
            );
          } catch (e) {
            console.error('[FactoryApp] realtime subscribe failed', e);
          }
        })();
        return () => {
          cancel = true;
          realtimeSync.dispose();
          try {
            unsubRealtime();
          } catch {
            /* ignore */
          }
        };
      }, [activeFactoryId]);

      const handleToggleBlockVehicle = useCallback(
        (dateStr, blockId, vehicleKey, next) => {
          if (!dateStr || !blockId || (vehicleKey !== 'large' && vehicleKey !== 'small')) return;
          setScheduleByDate((prev) => {
            const safePrev = normalizeFullSchedule(prev);
            const base = normalizeDayBlockSchedule(safePrev[dateStr]);
            const prevBlock = base[blockId] || { large: 'available', small: 'available' };
            const nextDay = {
              ...base,
              [blockId]: { ...prevBlock, [vehicleKey]: next },
            };
            const nextAll = { ...safePrev, [dateStr]: nextDay };
            void persistScheduleMap(activeFactoryId, nextAll);
            window.queueMicrotask(() => runScheduleAutoPipeline(nextAll));
            return nextAll;
          });
        },
        [runScheduleAutoPipeline, activeFactoryId],
      );

      const handleOrderFullPatch = useCallback(
        async (orderId, patch) => {
          if (!orderId || !patch || typeof patch !== 'object') return false;
          const target =
            (rawOrders || []).find((o) => o?.id === orderId) ||
            (orders || []).find((o) => o?.id === orderId);
          if (!isOrderAcceptedByFactory(target, activeFactoryId)) {
            window.alert('自分が受注済みの注文のみ編集できます。');
            return false;
          }
          try {
            const nextPatch = { ...patch, is_factory_modified: true };
            // 受注済み: カスタマー表示用の確定値も同期する
            if (Object.prototype.hasOwnProperty.call(patch, 'quantityM3')) {
              nextPatch.confirmedQuantityM3 = patch.quantityM3;
            }
            if (Object.prototype.hasOwnProperty.call(patch, 'mixText')) {
              nextPatch.confirmedMixText = patch.mixText;
            }

            const updated = await db.updateOrderDetails(orderId, nextPatch);
            if (!updated) return false;

            const changeParts = buildOrderChangeDiffLines(target, updated);
            if (changeParts.length > 0) {
              const msg = `【内容変更】${activeFactoryName}が注文内容を変更しました：${changeParts.join('、')}`;
              await appendOrderChatMessage(orderId, 'system', msg);
              await refreshChatThreads();
            }

            setRawOrders((prev) =>
              Array.isArray(prev)
                ? prev.map((o) => (o?.id === orderId ? { ...o, ...updated } : o))
                : prev,
            );
            setOrders((prev) =>
              Array.isArray(prev)
                ? prev.map((o) => (o?.id === orderId ? { ...o, ...updated } : o))
                : prev,
            );
            setActionNotice('注文内容を更新しました');
            window.setTimeout(() => setActionNotice(''), 3500);
            return true;
          } catch (e) {
            console.error('handleOrderFullPatch failed', e);
            window.alert('注文の更新に失敗しました。通信状態を確認してください。');
            return false;
          }
        },
        [activeFactoryId, activeFactoryName, rawOrders, orders, appendOrderChatMessage, refreshChatThreads],
      );

      const handleAcceptOrder = useCallback(
        (order) => {
          if (!order?.id || !activeFactoryId) return;
          setAcceptModalOrder(order);
        },
        [activeFactoryId],
      );

      const executeAcceptOrder = useCallback(async () => {
        const order = acceptModalOrder;
        if (!order?.id || !activeFactoryId || acceptSubmitting) return;
        setAcceptSubmitting(true);
        markOrderRead(order.id);
        try {
          const accepted = await db.acceptOrderForFactory(order, activeFactoryId, activeFactoryName);
          setRawOrders((prev) => (Array.isArray(prev) ? prev.map((o) => (o?.id === accepted.id ? accepted : o)) : prev));
          setOrders((prev) => (Array.isArray(prev) ? prev.map((o) => (o?.id === accepted.id ? accepted : o)) : prev));
          setAcceptModalOrder(null);
          setActionNotice('受注しました！');
          window.setTimeout(() => setActionNotice(''), 4500);
          await appendOrderChatMessage(
            accepted.id,
            'system',
            `【受注】${activeFactoryName}がこの注文を受注しました。`,
          );
          await syncFromStorage({ playSound: false });
        } catch (e) {
          console.error(e);
          window.alert('受注処理に失敗しました。通信状態を確認して再度お試しください。');
        } finally {
          setAcceptSubmitting(false);
        }
      }, [
        acceptModalOrder,
        acceptSubmitting,
        activeFactoryId,
        activeFactoryName,
        markOrderRead,
        syncFromStorage,
      ]);

      const handleRejectOrder = useCallback(
        async (order) => {
          if (!order?.id || !activeFactoryId) return;
          if (exitingOrderIds.has(String(order.id))) return;
          if (!window.confirm('この注文を見送りますか？')) return;
          markOrderRead(order.id);
          if (order?.id) notifiedOrderIds.current.add(order.id);
          try {
            const nextIds = await db.rejectOrderForFactory(order.id, activeFactoryId, {
              factoryName: activeFactoryName,
            });

            setToastOrder((cur) => (cur?.id === order.id ? null : cur));
            setActionNotice('見送りました');
            window.setTimeout(() => setActionNotice(''), 3500);

            const orderSnapshot = { ...order };
            beginCardExit(order.id, () => {
              const patchRejected = (o) =>
                o?.id === order.id
                  ? {
                      ...o,
                      rejected_factory_ids: nextIds,
                      factoryResponseStatus: FACTORY_RESPONSE.REJECTED,
                      factoryResponseLocked: true,
                    }
                  : o;
              setRawOrders((prev) => (Array.isArray(prev) ? prev.map(patchRejected) : prev));
              setOrders((prev) => (Array.isArray(prev) ? prev.map(patchRejected) : prev));

              void (async () => {
                try {
                  const project = projectById[String(order.project_id ?? order.projectId ?? '')];
                  const preferredId = String(order?.preferred_factory_id ?? order?.preferredFactoryId ?? '').trim();
                  const alreadyDeclined = Boolean(
                    order?.preferredFactoryDeclinedAt ?? order?.preferred_factory_declined_at,
                  );
                  if (
                    isAssignedProject(order, project) &&
                    preferredId === String(activeFactoryId).trim() &&
                    !alreadyDeclined
                  ) {
                    await db.markPreferredFactoryDeclined(order.id);
                    await appendOrderChatMessage(
                      order.id,
                      'system',
                      `【ご指定工場の対応不可】${activeFactoryName}では予約が取れませんでした。` +
                        `\nチャットから次のご対応をお選びください。`,
                    );
                  }
                  await syncFromStorage({ playSound: false });
                } catch (syncErr) {
                  console.error('[FactoryApp] reject follow-up failed', syncErr);
                }
              })();
            }, orderSnapshot);
          } catch (e) {
            console.error(e);
            window.alert('見送り処理に失敗しました。通信状態を確認して再度お試しください。');
          }
        },
        [
          activeFactoryId,
          activeFactoryName,
          beginCardExit,
          exitingOrderIds,
          markOrderRead,
          projectById,
          syncFromStorage,
        ],
      );

      const handleConsultOrder = useCallback(
        async (order) => {
          if (!order?.id || !activeFactoryId) return;
          if (!window.confirm('この注文を「相談中」にしますか？\n相談中は他工場に表示されず、あなたの工場のみが対応できます。')) {
            return;
          }
          markOrderRead(order.id);
          try {
            const consulted = await db.startFactoryConsult(order, activeFactoryId, activeFactoryName);
            const applyConsult = (o) => (o?.id === order.id ? { ...o, ...consulted } : o);
            setRawOrders((prev) => (Array.isArray(prev) ? prev.map(applyConsult) : prev));
            setOrders((prev) => (Array.isArray(prev) ? prev.map(applyConsult) : prev));
            setActionNotice('相談中にしました');
            window.setTimeout(() => setActionNotice(''), 3500);
            await appendOrderChatMessage(
              order.id,
              'system',
              `【相談】${activeFactoryName}より:\n対応できる時間帯・数量についてご相談させてください`,
            );
            await syncFromStorage({ playSound: false });
          } catch (e) {
            console.error(e);
            window.alert('相談ステータスの設定に失敗しました。すでに受注済みの可能性があります。');
          }
        },
        [activeFactoryId, activeFactoryName, markOrderRead, syncFromStorage],
      );

      const handleCustomerCancelOrder = useCallback(
        async (order) => {
          if (!order?.id || !activeFactoryId) return;
          if (!isOrderAcceptedByFactory(order, activeFactoryId)) {
            window.alert('自分が受注済みの注文のみキャンセルできます。');
            return;
          }
          if (!window.confirm('本当にこの注文をお客様都合でキャンセルしますか？')) return;
          markOrderRead(order.id);
          try {
            const cancelled = await db.markOrderCustomerCancelled(order.id);
            setRawOrders((prev) =>
              Array.isArray(prev) ? prev.map((o) => (o?.id === order.id ? { ...o, ...cancelled } : o)) : prev,
            );
            setOrders((prev) =>
              Array.isArray(prev) ? prev.map((o) => (o?.id === order.id ? { ...o, ...cancelled } : o)) : prev,
            );
            setToastOrder((cur) => (cur?.id === order.id ? null : cur));
            setActionNotice('お客様都合キャンセルにしました');
            window.setTimeout(() => setActionNotice(''), 4500);
            await appendOrderChatMessage(order.id, 'system', '【キャンセル】工場により、お客様都合キャンセルとして処理されました。');
            await syncFromStorage({ playSound: false });
          } catch (e) {
            console.error(e);
            window.alert('キャンセル処理に失敗しました。通信状態を確認して再度お試しください。');
          }
        },
        [activeFactoryId, markOrderRead, syncFromStorage],
      );

      const handleResponseStatusChange = useCallback(
        (orderId, status) => {
          if (!orderId) return;
          const nextStatus = normalizeFactoryResponse(status);
          if (!nextStatus) return;
          const list = Array.isArray(orders) ? orders : [];
          const target = list.find((x) => x && x.id === orderId);
          if (!target) return;
          const cur = normalizeFactoryResponse(target.factoryResponseStatus);
          const locked = Boolean(target.factoryResponseLocked);
          if (locked && (cur === FACTORY_RESPONSE.ACCEPTED || cur === FACTORY_RESPONSE.REJECTED)) return;
          const next = list.map((o) => {
            if (!o || o.id !== orderId) return o;
            const patch = { factoryResponseStatus: nextStatus };
            if (nextStatus === FACTORY_RESPONSE.PENDING) {
              patch.factoryPendingStartedAt = new Date().toISOString();
              patch.factoryPendingByName = activeFactoryName;
              patch.factoryResponseLocked = false;
            } else {
              patch.factoryPendingStartedAt = undefined;
              patch.factoryPendingByName = undefined;
            }
            if (nextStatus === FACTORY_RESPONSE.ACCEPTED) {
              patch.status = 'accepted';
              patch.accepted_at = new Date().toISOString();
              patch.acceptedAt = patch.accepted_at;
              patch.acceptedFactoryLabel = o.acceptedFactoryLabel || `受注工場：${activeFactoryName}`;
              patch.factorySiteName = activeFactoryName;
              patch.factorySiteId = activeFactoryId;
              patch.factory_site_id = activeFactoryId;
              patch.factoryResponseLocked = true;
              patch.factoryUnlockRequested = false;
              const qRaw = o.quantityM3 ?? o.quantityCube;
              patch.confirmedQuantityM3 =
                qRaw !== undefined && qRaw !== null && String(qRaw).trim() !== '' ? qRaw : null;
              patch.confirmedMixText = o.mixText?.trim() || '';
            }
            if (nextStatus === FACTORY_RESPONSE.REJECTED) {
              patch.status = 'rejected';
              patch.acceptedFactoryLabel = undefined;
              patch.factorySiteName = activeFactoryName;
              patch.factorySiteId = activeFactoryId;
              patch.factory_site_id = activeFactoryId;
              patch.factoryResponseLocked = true;
              patch.factoryUnlockRequested = false;
            }
            return { ...o, ...patch };
          });
          setOrders(next);
          void persistOrders(next);
          if (nextStatus === FACTORY_RESPONSE.PENDING) {
            void appendOrderChatMessage(
              orderId,
              'system',
              `【保留】${activeFactoryName}が保留にしました。マスター画面で5分のカウントダウンが同期表示されます。`,
            ).then(() => {
              void refreshChatThreads();
            });
          }
        },
        [orders, persistOrders, refreshChatThreads, activeFactoryId, activeFactoryName],
      );

      const handleFactoryUnlockRequest = useCallback(
        (orderId) => {
          if (!orderId) return;
          setOrders((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const next = list.map((o) =>
              o && o.id === orderId ? { ...o, factoryUnlockRequested: true } : o,
            );
            void persistOrders(next);
            return next;
          });
          void appendOrderChatMessage(
            orderId,
            'system',
            `【依頼】${activeFactoryName}からステータス変更のロック解除を依頼されました。マスターが「ステータス再設定許可」で解除できます。`,
          ).then(() => {
            void refreshChatThreads();
          });
        },
        [persistOrders, refreshChatThreads, activeFactoryName],
      );

      const handleBulkApplyStamp = useCallback(
        (stampId) => {
          setScheduleByDate((prev) => {
            const safePrev = normalizeFullSchedule(prev);
            const nextDay = applyStampToDayBlocks(safePrev[selectedDate], stampId);
            const nextAll = { ...safePrev, [selectedDate]: nextDay };
            void persistScheduleMap(activeFactoryId, nextAll);
            window.queueMicrotask(() => runScheduleAutoPipeline(nextAll));
            return nextAll;
          });
        },
        [selectedDate, runScheduleAutoPipeline, activeFactoryId],
      );

      const handleBulkFullDay = useCallback(() => {
        handleBulkApplyStamp('full');
      }, [handleBulkApplyStamp]);

      const handleBulkMorning = useCallback(() => {
        handleBulkApplyStamp('am');
      }, [handleBulkApplyStamp]);

      const handleBulkAfternoon = useCallback(() => {
        handleBulkApplyStamp('pm');
      }, [handleBulkApplyStamp]);

      const handleBulkClearDay = useCallback(() => {
        handleBulkApplyStamp('clear');
      }, [handleBulkApplyStamp]);

      const handleBulkFullDayLargeOnly = useCallback(() => {
        handleBulkApplyStamp('largeOnly');
      }, [handleBulkApplyStamp]);

      const handleBulkFullDaySmallOnly = useCallback(() => {
        handleBulkApplyStamp('smallOnly');
      }, [handleBulkApplyStamp]);

      const handleStampPaintSessionStart = useCallback(() => {
        if (stampPaintActiveRef.current) return;
        stampPaintActiveRef.current = true;
        stampPaintedRef.current = new Set();
        stampPaintDirtyRef.current = false;
        const snap = normalizeFullSchedule(scheduleByDateRef.current);
        stampUndoRef.current = snap;
        stampPaintMapRef.current = snap;
        setStampUndoAvailable(true);
      }, []);

      const handleStampPaintDay = useCallback((day) => {
        const stampId = activeStampRef.current;
        if (!stampId || !stampPaintActiveRef.current) return;
        if (!isScheduleStampDateInBounds(day)) return;
        if (stampPaintedRef.current.has(day)) return;
        stampPaintedRef.current.add(day);
        stampPaintDirtyRef.current = true;
        setScheduleByDate((prev) => {
          const base = stampPaintMapRef.current ?? normalizeFullSchedule(prev);
          const nextDay = applyStampToDayBlocks(base[day], stampId);
          const nextAll = { ...base, [day]: nextDay };
          stampPaintMapRef.current = nextAll;
          return nextAll;
        });
      }, []);

      const handleStampPaintSessionEnd = useCallback(() => {
        if (!stampPaintActiveRef.current) return;
        stampPaintActiveRef.current = false;
        const finalMap = stampPaintMapRef.current;
        const dirty = stampPaintDirtyRef.current;
        const paintedDays = Array.from(stampPaintedRef.current);
        stampPaintMapRef.current = null;
        stampPaintedRef.current = new Set();
        stampPaintDirtyRef.current = false;
        if (!dirty || !finalMap) return;
        stampUndoPaintedRef.current = paintedDays;
        const normalized = normalizeFullSchedule(finalMap);
        void persistScheduleMap(activeFactoryId, normalized);
        window.queueMicrotask(() => runScheduleAutoPipeline(normalized));
      }, [activeFactoryId, runScheduleAutoPipeline]);

      const handleStampUndo = useCallback(() => {
        const snap = stampUndoRef.current;
        if (!snap) return;
        const paintedDays = Array.from(stampUndoPaintedRef.current || []);
        stampUndoRef.current = null;
        stampUndoPaintedRef.current = [];
        setStampUndoAvailable(false);
        stampPaintActiveRef.current = false;
        stampPaintMapRef.current = null;
        stampPaintedRef.current = new Set();
        stampPaintDirtyRef.current = false;
        const nextAll = normalizeFullSchedule(snap);
        for (const day of paintedDays) {
          nextAll[day] =
            snap[day] != null ? normalizeDayBlockSchedule(snap[day]) : defaultEmptyDayBlocks();
        }
        setScheduleByDate(nextAll);
        void persistScheduleMap(activeFactoryId, nextAll);
        window.queueMicrotask(() => runScheduleAutoPipeline(nextAll));
      }, [activeFactoryId, runScheduleAutoPipeline]);

      const dayBlocks = useMemo(
        () => normalizeDayBlockSchedule(scheduleByDate[selectedDate]),
        [scheduleByDate, selectedDate],
      );

      const handleDownloadFactoryCsv = useCallback(() => {
        const rows = [
          ['注文ID', '希望日', '希望時刻', 'ステータス', '業者', '現場名', '担当者', '連絡先', '数量', '配合'],
          ...(orders || []).map((o) => {
            const party = orderPartyInfo(o, { preferSiteContact: true });
            return [
              o.id,
              factoryOrderDate(o),
              o.delivery_time ?? o.preferredTime ?? o.timeSlotLabel ?? o.timeSlot ?? '',
              o.status || o.factoryResponseStatus || 'pending',
              party.contractor,
              party.site,
              party.orderedBy,
              party.phone,
              o.confirmedQuantityM3 ?? o.quantityM3 ?? o.quantityCube ?? '',
              o.confirmedMixText || o.mixText || '',
            ];
          }),
        ];
        downloadCsv(`concrete-link-factory-${todayLocalISODate()}.csv`, rows);
      }, [orders]);

      if (!isFactoryAuthenticated) {
        return (
          <div className="flex min-h-[100dvh] w-full items-center justify-center overflow-x-hidden bg-slate-100 px-4 py-[max(2rem,env(safe-area-inset-top))]">
            <form
              onSubmit={handleFactoryLogin}
              className="w-full max-w-md rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-2xl sm:p-6"
            >
              <p className="text-xs font-black uppercase tracking-widest text-indigo-600">Factory Login</p>
              <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">工場ログイン</h1>
              <p className="mt-2 text-sm font-bold leading-relaxed text-slate-600">
                工場を選択し、管理者から共有されたパスワードを入力してください。
              </p>

              <label htmlFor="factory-login-id" className="mt-5 block text-sm font-black text-slate-700">
                工場
              </label>
              <select
                id="factory-login-id"
                value={loginFactoryId}
                onChange={(e) => {
                  setLoginFactoryId(e.target.value);
                  setLoginError('');
                }}
                className="mt-2 w-full rounded-xl border-2 border-slate-300 bg-white px-3 py-3 text-base font-bold text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
              >
                {(factories || []).length === 0 ? (
                  <option value={FACTORY_SITE_ID}>{FACTORY_SITE_NAME}</option>
                ) : (
                  factories.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name || f.id}
                    </option>
                  ))
                )}
              </select>

              <label htmlFor="factory-login-password" className="mt-4 block text-sm font-black text-slate-700">
                パスワード
              </label>
              <input
                id="factory-login-password"
                type="password"
                value={loginPassword}
                onChange={(e) => {
                  setLoginPassword(e.target.value);
                  setLoginError('');
                }}
                autoComplete="current-password"
                className="mt-2 w-full rounded-xl border-2 border-slate-300 bg-white px-3 py-3 text-base font-bold text-slate-900 shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                placeholder="パスワードを入力"
              />

              {loginError ? (
                <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-black text-red-700">
                  {loginError}
                </p>
              ) : null}

              <button
                type="submit"
                disabled={loginLoading}
                className={
                  'mt-5 min-h-[52px] w-full rounded-xl border-2 px-4 text-base font-black text-white shadow-lg transition ' +
                  (loginLoading
                    ? 'cursor-wait border-slate-400 bg-slate-400'
                    : 'border-indigo-700 bg-indigo-600 hover:bg-indigo-700 active:scale-[0.99]')
                }
              >
                {loginLoading ? '確認中...' : 'ログイン'}
              </button>
            </form>
          </div>
        );
      }

      return (
        <div id="factory-dashboard" className="flex h-[100dvh] min-h-[100dvh] w-full max-w-full flex-col overflow-hidden overflow-x-hidden bg-slate-50 pt-[max(0.25rem,env(safe-area-inset-top))] antialiased dark:bg-gray-900 dark:text-gray-100">
          {activeFactoryMissing ? (
            <div className="shrink-0 border-b-4 border-red-700 bg-red-100 px-4 py-3 text-center text-lg font-black text-red-700 shadow sm:text-2xl">
              ⚠️警告: 工場ID【{activeFactoryId}】はデータベースに存在しません
            </div>
          ) : null}
          <header className="shrink-0 border-b border-slate-200 bg-white px-2 py-1 shadow-sm dark:border-slate-700 dark:bg-slate-900">
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="flex min-w-0 shrink items-center gap-2">
                <a
                  href="/"
                  className="inline-flex w-fit shrink-0 items-center rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
                  aria-label={APP_BRAND_HOME_LABEL}
                >
                  <img src={concreteLinkLogo} alt={APP_BRAND_NAME} className="h-7 w-auto sm:h-8" />
                </a>
                <div className="min-w-0">
                  <p className="truncate text-xs font-black leading-tight text-slate-900 dark:text-slate-100 sm:text-sm">
                    工場画面
                  </p>
                  <p className="truncate text-[10px] font-bold leading-tight text-slate-500 dark:text-slate-400 sm:text-xs">
                    {activeFactoryName}
                  </p>
                </div>
              </div>

              <nav
                className="flex min-w-0 flex-1 justify-end gap-1 overflow-x-auto overscroll-x-contain whitespace-nowrap [scrollbar-width:thin]"
                aria-label="工場画面タブ"
              >
                {[
                  ['news', '📢 お知らせ'],
                  ['orders', '🚚 注文'],
                  ['assignments', '割当物件'],
                  ['calendar', '📅 カレンダー'],
                  ['history', '📋 履歴'],
                  ['charter', '📣 チャーター募集'],
                  ['charterRespond', '🚚 応援要請'],
                  ['settings', '⚙️ 設定'],
                ].map(([id, label]) => {
                  const active = activeTab === id;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setActiveTab(id)}
                      className={
                        'relative min-h-[40px] shrink-0 rounded-lg px-3 text-xs font-black transition sm:px-4 sm:text-sm ' +
                        (active
                          ? 'bg-indigo-600 text-white shadow-sm'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700')
                      }
                    >
                      <span className="inline-flex items-center justify-center gap-1.5">
                        {label}
                        {id === 'news' && factoryNewsUnread > 0 ? (
                          <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold leading-none text-white shadow-sm">
                            {factoryNewsUnread}
                          </span>
                        ) : null}
                        {id === 'charterRespond' && charterPendingCount > 0 ? (
                          <span className="rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold leading-none text-white shadow-sm animate-pulse">
                            {charterPendingCount}
                          </span>
                        ) : null}
                      </span>
                      {id === 'orders' && (newOrdersCount > 0 || unreadChatCount > 0) ? (
                        <span className="absolute -right-1 -top-1 flex items-center gap-0.5">
                          {newOrdersCount > 0 ? (
                            <span
                              className="flex min-h-[16px] min-w-[16px] items-center justify-center rounded-full bg-orange-500 px-1 text-[9px] font-black leading-none text-white shadow-sm"
                              aria-label={`新着注文 ${newOrdersCount}件`}
                            >
                              {newOrdersCount > 9 ? '9+' : newOrdersCount}
                            </span>
                          ) : null}
                          {unreadChatCount > 0 ? (
                            <span
                              className="flex min-h-[16px] min-w-[16px] items-center justify-center rounded-full bg-sky-500 px-1 text-[9px] font-black leading-none text-white shadow-sm"
                              aria-label={`未読チャット ${unreadChatCount}件`}
                            >
                              💬{unreadChatCount > 9 ? '9+' : unreadChatCount}
                            </span>
                          ) : null}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </nav>
            </div>

            {activeTab === 'orders' ? (
              <button
                type="button"
                disabled={hiddenOrderIds.size === 0}
                onClick={showAllHiddenOrders}
                className={
                  'mt-1 min-h-[36px] rounded-lg border-2 px-2 py-1 text-[11px] font-black shadow-sm sm:text-xs ' +
                  (hiddenOrderIds.size === 0
                    ? 'cursor-not-allowed border-slate-200 bg-slate-100 text-slate-400'
                    : 'border-indigo-500 bg-indigo-50 text-indigo-800 hover:bg-indigo-100 active:scale-95 active:bg-indigo-200')
                }
              >
                非表示にした注文を一括再表示
                {hiddenOrderIds.size > 0 ? `（${hiddenOrderIds.size}件）` : ''}
              </button>
            ) : null}
          </header>
          <PullToRefresh
            onRefresh={handleFactoryRefresh}
            suspended={Boolean(activeStamp)}
            className={
              activeTab === 'calendar'
                ? 'flex min-h-0 flex-1 flex-col overflow-hidden px-2 py-0.5'
                : 'min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 py-1'
            }
          >            <div
              className={
                activeTab === 'calendar'
                  ? 'mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col'
                  : 'mx-auto grid max-w-6xl gap-2'
              }
            >
              {activeTab === 'news' ? (
                <div className="py-2 sm:py-4">
                  <FactoryNewsPanel
                    factoryId={activeFactoryId}
                    factories={factories}
                    onUnreadChange={refreshFactoryNewsUnread}
                  />
                </div>
              ) : null}
              {activeTab === 'assignments' ? (
                <FactoryAssignedProjectsTab
                  projects={projects}
                  customers={customers}
                  currentFactoryId={activeFactoryId}
                  onUrlCopied={handleSiteUrlCopied}
                />
              ) : null}
              {activeTab === 'charter' ? (
                <div className="py-2 sm:py-4">
                  <CharterRequestsPanel factoryId={activeFactoryId} factories={factories} />
                </div>
              ) : null}
              {activeTab === 'charterRespond' ? (
                <div className="py-2 sm:py-4">
                  <CharterOpenRequestsPanel
                    responderType="factory"
                    responderId={activeFactoryId}
                    excludeOwnFactoryId={activeFactoryId}
                    title="応援要請"
                    description="他工場からのチャーター募集に、供給側として応答できます。"
                    onResponsesChanged={refreshCharterPendingCount}
                  />
                </div>
              ) : null}
              {activeTab === 'orders' ? (
                <div className="grid gap-2">
                  <DispatchInbox
                    orders={inboxOrders}
                    currentFactoryId={activeFactoryId}
                    readOrderIds={readOrderIds}
                    factorySearchLabel={activeFactoryName}
                    onOrderFullPatch={handleOrderFullPatch}
                    onMarkRead={markOrderRead}
                    onAcceptOrder={handleAcceptOrder}
                    onRejectOrder={handleRejectOrder}
                    onConsultOrder={handleConsultOrder}
                    onCustomerCancelOrder={handleCustomerCancelOrder}
                    onHideOrder={hideOrder}
                    onResponseStatusChange={handleResponseStatusChange}
                    onRequestUnlock={handleFactoryUnlockRequest}
                    chatThreads={chatThreads}
                    readChatKeys={readChatKeys}
                    onMarkChatRead={markChatRead}
                    onFactoryChatSent={refreshChatThreads}
                    focusedOrderId={focusedOrderId}
                    projectById={projectById}
                    customerById={customerById}
                    organizationById={organizationById}
                    onSiteUrlCopied={handleSiteUrlCopied}
                    exitingOrderIds={exitingOrderIds}
                  />
                </div>
              ) : null}
              {activeTab === 'calendar' ? (
                <div className="flex min-h-0 flex-1 flex-col">
                  <div className="mb-1.5 flex shrink-0 gap-1 overflow-x-auto rounded-xl border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-600 dark:bg-slate-800">
                    {[
                      ['capacity', '受入枠設定'],
                      ['orders', '注文'],
                      ['charterRequests', 'チャーター募集'],
                    ].map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        onClick={() => setCalendarMode(mode)}
                        className={
                          'min-h-[36px] shrink-0 rounded-lg px-3 text-xs font-black transition sm:px-4 sm:text-sm ' +
                          (calendarMode === mode
                            ? 'bg-white text-indigo-700 shadow-sm dark:bg-slate-900 dark:text-indigo-300'
                            : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-slate-100')
                        }
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="min-h-0 flex-1 overflow-y-auto xl:overflow-hidden">
                  {calendarMode === 'capacity' ? (
                    <FactoryScheduleSettings
                      selectedDate={selectedDate}
                      dayBlocks={dayBlocks}
                      onSelectDate={handleSelectScheduleDate}
                      scheduleMonth={scheduleMonth}
                      onMonthChange={handleScheduleMonthChange}
                      onToggleVehicle={handleToggleBlockVehicle}
                      onFullDay={handleBulkFullDay}
                      onMorning={handleBulkMorning}
                      onAfternoon={handleBulkAfternoon}
                      onClearAll={handleBulkClearDay}
                      onFullDayLargeOnly={handleBulkFullDayLargeOnly}
                      onFullDaySmallOnly={handleBulkFullDaySmallOnly}
                      holidays={holidays}
                      scheduleByDate={scheduleByDate}
                      selectedFactoryStatus={selectedFactoryStatus}
                      onFactoryStatusChange={handleFactoryStatusChange}
                      activeStamp={activeStamp}
                      onActiveStampChange={setActiveStamp}
                      stampUndoAvailable={stampUndoAvailable}
                      onStampUndo={handleStampUndo}
                      onStampPaintSessionStart={handleStampPaintSessionStart}
                      onStampPaintDay={handleStampPaintDay}
                      onStampPaintSessionEnd={handleStampPaintSessionEnd}
                    />
                  ) : null}

                  {calendarMode === 'orders' ? (
                    <FactoryAllocationCalendar
                      orders={orders}
                      scheduleOrders={factoryInProgressOrders}
                      todayIso={todaySchedule}
                      currentFactoryId={activeFactoryId}
                      selectedDate={calendarSelectedDate}
                      onSelectDate={setCalendarSelectedDate}
                      currentMonth={currentMonth}
                      onMonthChange={handleCalendarMonthChange}
                      onOpenOrder={handleOpenOrderFromCalendar}
                    />
                  ) : null}

                  {calendarMode === 'charterRequests' ? (
                    <FactoryCharterRequestCalendar factoryId={activeFactoryId} />
                  ) : null}
                  </div>
                </div>
              ) : null}
              {activeTab === 'history' ? (
                <section className="space-y-3 pb-8">
                  <header>
                    <h2 className="text-xl font-black text-slate-900 dark:text-slate-100">注文履歴</h2>
                    <p className="mt-1 text-sm font-medium text-slate-600 dark:text-slate-300">
                      手動完了・予定日経過・他工場受注（受注日の翌日0時以降）の注文を表示します（予定日の新しい順）。
                    </p>
                  </header>
                  <div className="shrink-0 space-y-2 rounded-lg border border-slate-200 bg-slate-50/95 px-2 py-2 dark:border-slate-600 dark:bg-slate-800/80">
                    <OrderListSearchInput
                      id="factory-history-search"
                      value={historySearchQuery}
                      onChange={setHistorySearchQuery}
                    />
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="min-w-[9rem] flex-1">
                        <span className="mb-1 block text-xs font-bold text-slate-600 dark:text-slate-300">から</span>
                        <input
                          type="date"
                          value={historyDateFrom}
                          onChange={(e) => setHistoryDateFrom(e.target.value)}
                          className="min-h-[44px] w-full rounded-lg border border-slate-200/90 bg-white px-2 py-2 text-sm text-slate-800 shadow-inner outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200/80 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500 dark:focus:ring-slate-700"
                        />
                      </label>
                      <label className="min-w-[9rem] flex-1">
                        <span className="mb-1 block text-xs font-bold text-slate-600 dark:text-slate-300">まで</span>
                        <input
                          type="date"
                          value={historyDateTo}
                          onChange={(e) => setHistoryDateTo(e.target.value)}
                          className="min-h-[44px] w-full rounded-lg border border-slate-200/90 bg-white px-2 py-2 text-sm text-slate-800 shadow-inner outline-none transition focus:border-slate-300 focus:ring-2 focus:ring-slate-200/80 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-slate-500 dark:focus:ring-slate-700"
                        />
                      </label>
                    </div>
                  </div>
                  {filteredFactoryHistoryOrders.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-10 text-center text-sm font-bold text-slate-500 dark:border-slate-600 dark:bg-slate-900/50 dark:text-slate-300">
                      {String(historySearchQuery || '').trim() || historyDateFrom || historyDateTo
                        ? '条件に一致する注文はありません'
                        : '履歴に表示する注文はありません'}
                    </p>
                  ) : (
                    <ul className="max-h-[min(70vh,640px)] space-y-2 overflow-y-auto rounded-2xl border-2 border-slate-200 bg-white p-2 dark:border-slate-600 dark:bg-slate-800">
                      {filteredFactoryHistoryOrders.map((order) => {
                        const party = orderPartyInfo(order, { preferSiteContact: true });
                        const delivery = factoryOrderDate(order);
                        const autoPast =
                          !isOrderManuallyCompleted(order) &&
                          !['customer_cancelled', 'cancelled', 'deleted'].includes(String(order?.status || ''));
                        const isOtherAccepted = isOrderAcceptedByOtherFactory(order, activeFactoryId);
                        const otherFactoryLabel =
                          String(order.factorySiteName || '').trim() ||
                          String(order.acceptedFactoryLabel || '').replace(/^受注工場：/, '').trim() ||
                          '他工場';
                        const qtyRaw = order.confirmedQuantityM3 ?? order.quantityM3 ?? order.quantityCube;
                        const qtyText =
                          qtyRaw !== undefined && qtyRaw !== null && String(qtyRaw).trim() !== ''
                            ? `${String(qtyRaw).trim()} m³`
                            : '—';
                        const vehicleLabel =
                          order.vehicleLabel || (order.vehicleType === 'small' ? '小型車' : '大型車');
                        return (
                          <li
                            key={order.id}
                            className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 dark:border-slate-600 dark:bg-slate-900/50"
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <p className="text-sm font-black tabular-nums text-slate-700 dark:text-slate-300">
                                予定日 {delivery.replace(/-/g, '/')}
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {isOtherAccepted ? (
                                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                                    {otherFactoryLabel}が受注（{formatAcceptedAtDateTimeJp(order)}）
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-black text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                                    {autoPast ? '自動履歴' : '完了'}
                                  </span>
                                )}
                              </div>
                            </div>
                            <p className="mt-1 text-base font-black text-slate-900 dark:text-gray-100">
                              {party.site || '現場未設定'}
                            </p>
                            <p className="mt-1 text-sm font-bold text-slate-600 dark:text-gray-300">
                              納入 {formatPreferredDateJp(delivery)} {getOrderTimeDisplay(order)} · {qtyText} / {vehicleLabel}
                            </p>
                            {!isOtherAccepted ? (
                              <p className="mt-1 text-sm font-bold text-slate-600 dark:text-gray-300">
                                {party.contractor || '—'} · {getOrderTimeDisplay(order)} · {factoryOrderQuantity(order)}㎡
                              </p>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              ) : null}
              {activeTab === 'settings' ? (
                <FactorySettingsPanel
                  factoryId={activeFactoryId}
                  factories={factories}
                  projects={projects}
                  customers={customers}
                  onExportOrders={handleDownloadFactoryCsv}
                  onFactoriesUpdated={async () => {
                    try {
                      const list = await db.fetchFactories();
                      setFactories(list);
                    } catch (e) {
                      console.error('[FactoryApp] factories refresh failed', e);
                    }
                  }}
                  onCharterNotifySaved={(msg) => {
                    if (!msg) return;
                    setActionNotice(msg);
                    window.setTimeout(() => setActionNotice(''), 3000);
                  }}
                  onLogout={handleFactoryLogout}
                />
              ) : null}
            </div>
          </PullToRefresh>

          <NewOrderToast
            order={toastOrder}
            isReassignment={toastIsReassignment}
            onDismiss={dismissNewOrderToast}
            projectById={projectById}
            customerById={customerById}
            organizationById={organizationById}
          />
          <OrderAcceptModal
            order={acceptModalOrder}
            open={Boolean(acceptModalOrder)}
            submitting={acceptSubmitting}
            onClose={() => {
              if (!acceptSubmitting) setAcceptModalOrder(null);
            }}
            onConfirm={() => void executeAcceptOrder()}
          />
          {actionNotice ? (
            <div
              className="fixed bottom-4 left-4 z-[95] rounded-2xl border-2 border-emerald-600 bg-white px-4 py-3 text-sm font-black text-emerald-800 shadow-2xl sm:left-6 sm:text-base"
              role="status"
            >
              {actionNotice}
            </div>
          ) : null}
        </div>
      );
    }

