import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  DISPATCH_DEFAULT_FACTORY_SITE_NAME,
  DISPATCH_DEFAULT_FACTORY_SITE_ID,
  TIME_SLOTS,
  pad2,
  todayLocalISODate,
} from './haishaConstants.js';
import * as db from './haishaDb.js';
import { supabase } from './supabaseClient.js';
import { MapPicker } from './MapPicker.jsx';
import { geocodeAddress } from './utils/nominatimGeocode.js';
import {
  PUSH_CHAT_REDIRECT_SESSION_KEY,
  clearAppBadge,
  registerOneSignalUser,
  sendPushNotification,
  sendPushNotificationToRole,
  setupNotificationClickRedirect,
} from './utils/notification.js';
import concreteLinkLogo from './assets/concrete-link-logo.svg';
import { AiOrderAssistant } from './components/AiOrderAssistant.jsx';
import { AiGeneratedOrderList } from './components/AiGeneratedOrderList.jsx';
import { analyzeOrderText, ANALYZE_ORDER_TEXT_ERROR_MESSAGE } from './utils/analyzeOrderText.js';
import { buildDispatchOrderFromAiItem, validateBulkRegisterContext } from './utils/dispatchBulkOrder.js';

const DISPATCH_CUSTOMER_SESSION_KEY = 'haisha_dispatch_customer_id_v1';
const DISPATCH_AUTH_SESSION_KEY = 'haisha_dispatch_auth_customer_id_v1';
const UNLOAD_DURATION_OPTIONS = [
  { value: '15', label: '15分' },
  { value: '30', label: '30分（標準）' },
  { value: '45', label: '45分' },
  { value: '60', label: '60分（手押し車など時間要）' },
  { value: '95_plus', label: '95分以上（要相談）' },
];

function unloadDurationLabel(value) {
  return UNLOAD_DURATION_OPTIONS.find((o) => o.value === String(value || ''))?.label || '30分（標準）';
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
      const site = String(order?.projectName ?? order?.project_name ?? order?.siteName ?? '').trim();
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
        <div className="relative">
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
      await db.appendChatMessage(orderId, from, body);
    }

    const MIX_SHORTCUTS = ['18-8-20BB', '18-12-20BB', '18-15-20N', '21-15-20N'];

    const MASTER_TRADER_SUGGESTIONS = ['梅田建材', '大分商事', '九州生コン販売', '共栄商事'];
    const MASTER_CONTRACTOR_SUGGESTIONS = ['佐藤建設', '田中組', '大分土木', '九州コンクリート工業'];

    function filterMasterSuggestions(suggestions, inputValue) {
      const t = String(inputValue ?? '').trim();
      if (!t) return [];
      const tl = t.toLowerCase();
      return suggestions.filter((s) => String(s).toLowerCase().includes(tl));
    }

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

    function AutocompleteField({ id, labelText, value, onValueChange, suggestions, placeholder, autoComplete }) {
      const [panelOpen, setPanelOpen] = useState(false);
      const filtered = useMemo(() => filterMasterSuggestions(suggestions, value), [suggestions, value]);
      const showList = panelOpen && String(value ?? '').trim().length > 0 && filtered.length > 0;

      return (
        <div className="flex flex-col gap-3">
          <Label htmlFor={id}>{labelText}</Label>
          <div className="relative">
            <input
              id={id}
              type="text"
              autoComplete={autoComplete || 'off'}
              placeholder={placeholder}
              value={value}
              onChange={(e) => {
                onValueChange(e.target.value);
                setPanelOpen(true);
              }}
              onFocus={() => setPanelOpen(true)}
              onBlur={() => window.setTimeout(() => setPanelOpen(false), 200)}
              className="min-h-[56px] w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300"
            />
            {showList ? (
              <ul
                className="absolute left-0 right-0 top-full z-[60] mt-1 max-h-52 overflow-y-auto rounded-xl border-2 border-indigo-200 bg-white py-1 shadow-xl ring-1 ring-slate-200/80"
                role="listbox"
                aria-label={`${labelText}の候補`}
              >
                {filtered.map((item) => (
                  <li key={item} role="option">
                    <button
                      type="button"
                      className="w-full px-4 py-3 text-left text-base font-medium text-slate-900 hover:bg-indigo-50 active:bg-indigo-100"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        onValueChange(item);
                        setPanelOpen(false);
                      }}
                    >
                      {item}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
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
      const send = useCallback(() => {
        const t = draft.trim();
        if (!t || !orderId) return;
        onSendMessage(orderId, t);
        setDraft('');
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
                <p className="mt-0.5 truncate text-xs font-bold text-slate-500">{order.siteName || order.projectName || '注文チャット'}</p>
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
                if (m.from === 'system') {
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
                const mine = m.from === 'master';
                const displaySenderName = mine ? senderName || '担当者' : '工場';
                return (
                  <li key={m.id} className={'flex ' + (mine ? 'justify-end' : 'justify-start')}>
                    <div
                      className={
                        'max-w-[88%] rounded-2xl px-3 py-2 text-sm shadow-sm ' +
                        (mine
                          ? 'rounded-br-md bg-[#dcf8c6] text-slate-900'
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
      messages,
      hasUnreadChat,
      onMarkChatRead,
      onOpenChat,
      onAllowStatusReset,
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

      const lbl = 'text-[11px] font-bold uppercase tracking-wide text-slate-400';
      const val = 'mt-0.5 text-sm font-bold leading-snug text-slate-900';

      const timeSummary = `${formatOrderDate(order)} · ${order.timePointLabel || order.timeSlotLabel || '—'}`;
      const isCustomerCancelled = order.status === 'customer_cancelled';

      useEffect(() => {
        if (order?.id && typeof onMarkChatRead === 'function') {
          onMarkChatRead(order.id, messages);
        }
      }, [order?.id, messages, onMarkChatRead]);

      return (
        <article className={'overflow-hidden rounded-2xl border-2 bg-white p-4 shadow-md sm:p-5 ' + (isCustomerCancelled ? 'border-red-500 ring-2 ring-red-100' : 'border-slate-200')}>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-3">
            <div className="min-w-0">
              <p className="text-[11px] font-black uppercase tracking-wider text-indigo-600">現在のステータス</p>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                <OrderStatusBadges order={order} />
                {hasUnreadChat ? (
                  <span className="inline-flex animate-pulse rounded-full border-2 border-red-500 bg-red-600 px-2.5 py-1 text-xs font-black text-white shadow-sm">
                    新着チャット
                  </span>
                ) : null}
                {order.is_admin_modified ? (
                  <span className="inline-flex rounded-full border-2 border-violet-400 bg-violet-50 px-2.5 py-1 text-xs font-black text-violet-800">
                    管理者変更あり
                  </span>
                ) : null}
              </div>
            </div>
            <div className="min-w-0 text-left sm:text-right">
              <p className={lbl}>希望日 · 時刻</p>
              <p className="mt-1 break-words text-sm font-black leading-tight text-slate-900 sm:text-base">{timeSummary}</p>
            </div>
          </div>

          <dl className="mt-4 grid gap-2 rounded-2xl border-2 border-indigo-100 bg-indigo-50 px-4 py-3 text-sm font-bold sm:grid-cols-2">
            {[
              ['業者', party.contractor],
              ['商社', trader],
              ['現場名', party.site],
              ['現場住所', addrDisp],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-[10px] font-black uppercase tracking-wider text-indigo-600">{label}</dt>
                <dd className="mt-0.5 break-words font-black text-indigo-950">{value || '—'}</dd>
              </div>
            ))}
          </dl>

          <dl className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {[
              ['車種', vehicle],
              ['数量', qtyDisp],
              ['配合', mixStr],
              ['連絡先', party.phone],
            ].map(([label, value]) => (
              <div key={label} className="min-w-0 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                <dt className={lbl}>{label}</dt>
                <dd className={val + (label === '配合' ? ' break-all font-mono text-xs' : label === '連絡先' ? ' break-words font-mono text-xs' : ' break-words')}>{value || '—'}</dd>
              </div>
            ))}
          </dl>

          <MasterPendingBanner order={order} />
          {order.factoryUnlockRequested ? (
            <div className="mt-4 rounded-xl border-2 border-indigo-300 bg-indigo-50 px-4 py-3">
              <p className="text-xs font-black text-indigo-950">工場からステータス変更のロック解除が依頼されています。</p>
              {typeof onAllowStatusReset === 'function' ? (
                <button
                  type="button"
                  onClick={() => onAllowStatusReset(order.id)}
                  className="mt-2 w-full rounded-xl border-2 border-indigo-700 bg-indigo-700 py-2.5 text-sm font-black text-white shadow hover:bg-indigo-800"
                >
                  ステータス再設定許可
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4">
            <ConfirmedDetailsBlock order={order} />
          </div>
          <button
            type="button"
            onClick={() => {
              if (typeof onOpenChat === 'function') onOpenChat(order.id);
            }}
            className="mt-5 flex min-h-[56px] w-full items-center justify-center rounded-2xl border-2 border-indigo-600 bg-indigo-600 px-4 py-3 text-base font-black text-white shadow-lg shadow-indigo-500/20 transition hover:bg-indigo-700 active:scale-[0.99]"
          >
            工場とチャットする
            {hasUnreadChat ? (
              <span className="ml-2 rounded-full bg-red-600 px-2 py-0.5 text-xs font-black text-white ring-2 ring-white">新着</span>
            ) : null}
          </button>
          {isCustomerCancelled ? (
            <div className="-mx-4 -mb-4 mt-4 border-t border-red-200 bg-red-50 px-4 py-3 text-center text-sm font-black text-red-700 sm:-mx-5 sm:-mb-5">
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
        <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-black text-slate-900">注文カレンダー</h2>
              <p className="mt-1 text-xs font-bold text-slate-500">自分が発注した注文を月間表示します。</p>
            </div>
            <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-black text-white">{selectedOrders.length}件</span>
          </div>
          <div className="mt-4 flex items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-2">
            <button type="button" onClick={() => { const next = new Date(currentMonth); next.setMonth(next.getMonth() - 1); onMonthChange(next); }} className="min-h-[44px] rounded-xl border-2 border-slate-300 bg-white px-3 text-sm font-black text-slate-700">◀ 前月</button>
            <p className="text-lg font-black text-slate-900">{monthLabel}</p>
            <button type="button" onClick={() => { const next = new Date(currentMonth); next.setMonth(next.getMonth() + 1); onMonthChange(next); }} className="min-h-[44px] rounded-xl border-2 border-slate-300 bg-white px-3 text-sm font-black text-slate-700">次月 ▶</button>
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
                <button key={day} type="button" onClick={() => onSelectDate(day)} className={'min-h-[6rem] rounded-xl border-2 p-1.5 text-left transition active:scale-[0.99] sm:min-h-[7rem] sm:p-2 ' + (active ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-200' : inMonth ? 'border-slate-200 bg-white hover:bg-slate-50' : 'border-slate-100 bg-slate-50 opacity-45')}>
                  <p className="text-xs font-black text-slate-500">{d.getDate()}</p>
                  <div className="mt-2 space-y-1">
                    {list.slice(0, 3).map((order) => {
                      const party = orderPartyInfo(order);
                      return <span key={order.id} className={'block truncate rounded-md px-1.5 py-1 text-[10px] font-black ' + statusClass(order)}>{party.site || '現場未設定'}</span>;
                    })}
                    {list.length > 3 ? <span className="block text-[10px] font-black text-indigo-700">+{list.length - 3}件</span> : null}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
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
        </section>
      );
    }

    export function DispatchApp() {
      const today = todayLocalISODate();
      const initialOrderDateTime = useMemo(() => nextAvailableOrderDateTime(today), [today]);

      const [preferredDate, setPreferredDate] = useState(initialOrderDateTime.date);
      const [timeSlot, setTimeSlot] = useState(initialOrderDateTime.slot);

      useEffect(() => {
        if (!TIME_SLOTS.some((s) => s.value === timeSlot)) {
          setTimeSlot(TIME_SLOTS[0]?.value ?? '480');
        }
      }, [timeSlot]);
      useEffect(() => {
        if (preferredDate && preferredDate < today) {
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
      const [siteAddress, setSiteAddress] = useState('');
      const [sitePhone, setSitePhone] = useState('');
      const [orderedBy, setOrderedBy] = useState('');
      const [hasTest, setHasTest] = useState(false);
      const [submitNotice, setSubmitNotice] = useState(null);
      const [submitError, setSubmitError] = useState('');
      const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);
      const [showConfirmModal, setShowConfirmModal] = useState(false);
      const [confirmOrder, setConfirmOrder] = useState(null);
      const [isLoggedIn, setIsLoggedIn] = useState(() => {
        try {
          return Boolean(sessionStorage.getItem(DISPATCH_AUTH_SESSION_KEY));
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
      const [deliveryLat, setDeliveryLat] = useState('');
      const [deliveryLng, setDeliveryLng] = useState('');
      const [mapPanTarget, setMapPanTarget] = useState(null);
      const [addressSearchLoading, setAddressSearchLoading] = useState(false);
      const [addressSearchError, setAddressSearchError] = useState('');
      const [preferredFactoryId, setPreferredFactoryId] = useState('');
      const [aiAssistText, setAiAssistText] = useState('');
      const [aiAssistLoading, setAiAssistLoading] = useState(false);
      const [aiAssistNotice, setAiAssistNotice] = useState('');
      const [aiGeneratedOrders, setAiGeneratedOrders] = useState([]);
      const [aiBulkRegisterLoading, setAiBulkRegisterLoading] = useState(false);
      const orderFormRef = useRef(null);

      const selectedProject = useMemo(
        () => (projects || []).find((p) => p && p.id === selectedProjectId) || null,
        [projects, selectedProjectId],
      );
      const currentCustomer = useMemo(
        () => (customers || []).find((c) => c && c.id === currentCustomerId) || null,
        [customers, currentCustomerId],
      );
      const currentCustomerPhone = String(currentCustomer?.phone_number || '').trim();
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
      const filteredProjects = useMemo(
        () => (projects || []).filter((p) => p && String(p.customer_id || '') === String(currentCustomerId || '')),
        [projects, currentCustomerId],
      );
      const hasCurrentCustomer = Boolean(String(currentCustomerId || '').trim());
      const selectCustomerTab = useCallback((tabId) => {
        setCustomerOrderTab(tabId);
        if (tabId === 'new') setNewOrderMode('');
      }, []);

      const prevOrdersRef = useRef(null);

      const refreshDashboard = useCallback(async () => {
        try {
          const factoryNameById = Object.fromEntries(
            (Array.isArray(factories) ? factories : []).map((f) => [f.id, f.name]),
          );
          let { orders: newOrders, chatThreads: newThreads } = await db.fetchOrdersWithChat();
          const idSet = new Set(
            (Array.isArray(newOrders) ? newOrders : [])
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
          newOrders = final.orders.filter((o) => o && o.status !== 'deleted');
          const displayOrders = String(currentCustomerId || '').trim()
            ? newOrders.filter((o) => isOrderForCurrentCustomer(o))
            : newOrders;
          newThreads = final.chatThreads;

          if (prevOrdersRef.current) {
            const prevOrderMapForAdmin = new Map(
              (Array.isArray(prevOrdersRef.current) ? prevOrdersRef.current : []).filter(Boolean).map((o) => [o.id, o]),
            );
            if (displayOrders.some((o) => o?.is_admin_modified && !prevOrderMapForAdmin.get(o.id)?.is_admin_modified)) {
              setAdminNotice('⚠️ 管理者によって注文内容が変更されました。内容を確認してください。');
              window.setTimeout(() => setAdminNotice(''), 6000);
            }
          }

          prevOrdersRef.current = displayOrders;
          setDashboardOrders(displayOrders);
          setChatThreads(newThreads);
        } catch (err) {
          console.error(err);
          window.alert(formatSupabaseError(err, '注文一覧の更新に失敗しました'));
        }
      }, [factories, preferredFactoryId, currentCustomerId, isOrderForCurrentCustomer]);

      useEffect(() => {
        let cancelled = false;
        (async () => {
          try {
            const [rows, projs, customerRows, adminSettingRows] = await Promise.all([
              db.fetchFactories(),
              db.fetchProjects(),
              db.fetchCustomers(),
              db.fetchAdminSettings(),
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
              if (!authId || !customerRows.some((c) => c && c.id === authId)) {
                setIsLoggedIn(false);
                setCurrentCustomerId('');
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
      }, [isLoggedIn]);

      useEffect(() => {
        try {
          sessionStorage.setItem(DISPATCH_CUSTOMER_SESSION_KEY, currentCustomerId || '');
        } catch {
          /* ignore */
        }
        setSelectedProjectId((cur) => {
          if (!cur) return cur;
          const p = (projects || []).find((x) => x && x.id === cur);
          return p && String(p.customer_id || '') === String(currentCustomerId || '') ? cur : '';
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
        if (!isLoggedIn || !currentCustomerPhone) return;
        void registerOneSignalUser(currentCustomerPhone, { role: 'customer', customer_id: currentCustomerId || '' });
      }, [isLoggedIn, currentCustomerPhone, currentCustomerId]);

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

      const filteredInProgressOrders = useMemo(
        () =>
          dashboardOrders
            .filter((o) => o && historyStatusMeta(o).key === 'active' && orderMatchesMasterSearch(o, inProgressSearchQuery))
            .slice(0, 15),
        [dashboardOrders, inProgressSearchQuery],
      );
      const activeOrders = useMemo(
        () => (dashboardOrders || []).filter((o) => o && historyStatusMeta(o).key === 'active'),
        [dashboardOrders],
      );
      const unreadChatCount = useMemo(
        () =>
          (activeOrders || []).filter((order) =>
            order?.id && isUnreadForDispatch(chatThreads[order.id], readChatKeys[order.id]),
          ).length,
        [activeOrders, chatThreads, readChatKeys],
      );
      const activeChatOrder = useMemo(
        () => (dashboardOrders || []).find((order) => String(order?.id || '') === String(activeChatOrderId || '')) || null,
        [dashboardOrders, activeChatOrderId],
      );
      useEffect(() => {
        if (activeChatOrderId && !activeChatOrder) setActiveChatOrderId('');
      }, [activeChatOrderId, activeChatOrder]);
      const historyRows = useMemo(() => {
        const realRows = (dashboardOrders || [])
          .filter((o) => o && ['completed', 'cancelled'].includes(historyStatusMeta(o).key))
          .map((o) => {
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
            createdAt: o.createdAt || '',
          };
        });
        if (realRows.length > 0) {
          return realRows.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        }
        return [];
      }, [dashboardOrders]);
      const filteredHistoryRows = useMemo(
        () =>
          historyRows.filter((row) => {
            if (historyStatusFilter !== 'all' && row.statusMeta.key !== historyStatusFilter) return false;
            if (historyCustomerFilter !== 'all' && String(row.customer_id || '') !== String(historyCustomerFilter)) return false;
            return true;
          }),
        [historyRows, historyStatusFilter, historyCustomerFilter],
      );

      useEffect(() => {
        let disposed = false;
        let timerId = null;
        let running = false;
        let pending = false;
        const runRefresh = async () => {
          if (running) {
            pending = true;
            return;
          }
          running = true;
          try {
            do {
              pending = false;
              await refreshDashboard();
            } while (pending && !disposed);
          } finally {
            running = false;
          }
        };
        const scheduleRefresh = () => {
          pending = true;
          if (timerId != null) return;
          timerId = window.setTimeout(() => {
            timerId = null;
            void runRefresh();
          }, 500);
        };
        void runRefresh();
        const channel = supabase
          .channel('custom-all-channel')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, scheduleRefresh)
          .subscribe();
        return () => {
          disposed = true;
          if (timerId != null) window.clearTimeout(timerId);
          void supabase.removeChannel(channel);
        };
      }, [refreshDashboard]);

      useEffect(() => {
        if (!isLoggedIn || !String(currentCustomerId || '').trim()) return undefined;
        let disposed = false;
        let timerId = null;
        let running = false;
        let pending = false;
        const runRefresh = async () => {
          if (running) {
            pending = true;
            return;
          }
          running = true;
          try {
            do {
              pending = false;
              await refreshDashboard();
            } while (pending && !disposed);
          } finally {
            running = false;
          }
        };
        const scheduleCustomerRefresh = (payload) => {
          const nextOrder = db.normalizeOrderRow(payload?.new);
          if (!isOrderForCurrentCustomer(nextOrder)) return;
          pending = true;
          if (timerId != null) return;
          timerId = window.setTimeout(() => {
            timerId = null;
            void runRefresh();
          }, 250);
        };
        const channel = supabase
          .channel(`dispatch-customer-orders-${String(currentCustomerId).replace(/[^a-zA-Z0-9_-]/g, '')}`)
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, scheduleCustomerRefresh)
          .subscribe();
        return () => {
          disposed = true;
          if (timerId != null) window.clearTimeout(timerId);
          void supabase.removeChannel(channel);
        };
      }, [currentCustomerId, isLoggedIn, isOrderForCurrentCustomer, refreshDashboard]);

      const handleSendMasterChat = useCallback(
        async (orderId, text) => {
          await appendOrderChatMessage(orderId, 'master', text);
          const targetOrder = (dashboardOrders || []).find((order) => String(order?.id || '') === String(orderId || ''));
          const targetExternalId = String(
            targetOrder?.factory_site_id ??
              targetOrder?.factorySiteId ??
              targetOrder?.preferred_factory_id ??
              targetOrder?.preferredFactoryId ??
              DISPATCH_DEFAULT_FACTORY_SITE_ID ??
              '',
          ).trim();
          const senderName = orderContactPersonName(targetOrder, currentCustomerDisplayName);
          void (async () => {
            try {
              console.log('Push Notification Target:', targetExternalId);
              if (targetExternalId) {
                await sendPushNotification(targetExternalId, `${senderName}から新しいメッセージが届きました。`, {
                  type: 'chat',
                  orderId,
                  targetApp: 'factory',
                });
              } else {
                await sendPushNotificationToRole('factory', `${senderName}から新しいメッセージが届きました。`, {
                  type: 'chat',
                  orderId,
                  targetApp: 'factory',
                });
              }
            } catch (error) {
              console.warn('[OneSignal] チャット通知の送信に失敗しました', error);
            }
          })();
          await refreshDashboard();
        },
        [currentCustomerDisplayName, dashboardOrders, refreshDashboard],
      );

      const markChatRead = useCallback((orderId, messages) => {
        const key = chatMessageReadKey(latestChatMessage(messages));
        if (!orderId || !key) return;
        clearAppBadge();
        setReadChatKeys((prev) => (prev?.[orderId] === key ? prev : { ...prev, [orderId]: key }));
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
          try {
            const customer = await db.loginCustomer(phone, password);
            if (!customer?.id) {
              setLoginError('電話番号またはパスワードが間違っています。');
              return;
            }
            setCurrentCustomerId(customer.id);
            setIsLoggedIn(true);
            void registerOneSignalUser(customer.phone_number, { role: 'customer', customer_id: customer.id });
            setLoginPhone('');
            setLoginPassword('');
            setLoginError('');
            try {
              sessionStorage.setItem(DISPATCH_AUTH_SESSION_KEY, customer.id);
              sessionStorage.setItem(DISPATCH_CUSTOMER_SESSION_KEY, customer.id);
            } catch {
              /* ignore */
            }
          } catch (err) {
            console.error('カスタマーログインエラー', err);
            setLoginError('電話番号またはパスワードが間違っています。');
          } finally {
            setLoginLoading(false);
          }
        },
        [loginPhone, loginPassword],
      );

      const handleCustomerLogout = useCallback(() => {
        setIsLoggedIn(false);
        setCurrentCustomerId('');
        setSelectedProjectId('');
        setPreferredFactoryId('');
        setShowConfirmModal(false);
        setConfirmOrder(null);
        setLoginPassword('');
        setLoginError('');
        try {
          sessionStorage.removeItem(DISPATCH_AUTH_SESSION_KEY);
          sessionStorage.removeItem(DISPATCH_CUSTOMER_SESSION_KEY);
        } catch {
          /* ignore */
        }
      }, []);

      const handleAddressMapSearch = useCallback(async () => {
        const addr = siteAddress.trim();
        if (!addr) {
          setAddressSearchError('現場住所を入力してから検索してください。');
          return;
        }
        setAddressSearchError('');
        setAddressSearchLoading(true);
        try {
          const { lat, lng } = await geocodeAddress(addr);
          setMapPanTarget({ lat, lng, key: Date.now() });
        } catch (e) {
          setAddressSearchError(e?.message || '住所検索に失敗しました。');
        } finally {
          setAddressSearchLoading(false);
        }
      }, [siteAddress]);

      const openRepeatOrderForm = useCallback((row) => {
        const next = nextAvailableOrderDateTime(today);
        setExpandedHistoryOrderId((cur) => (cur === row?.id ? '' : row?.id || ''));
        setRepeatPreferredDate(next.date);
        setRepeatTimeSlot(next.slot);
      }, [today]);

      const confirmRepeatOrder = useCallback(
        (row) => {
          const item = row?.source || row || {};
          if (!row?.id) return;
          if (isPastPreferredDateTime(repeatPreferredDate, repeatTimeSlot)) {
            window.alert('現在より過去の日時は指定できません。正しい希望日時を入力してください。');
            return;
          }
          const slotMeta = TIME_SLOTS.find((s) => s.value === repeatTimeSlot);
          const slotLabel = slotMeta?.label ?? '';
          const timeMinutes = parseInt(repeatTimeSlot, 10);
          const isSpot = item.is_spot === true || !String(item.project_id || row.project_id || '').trim();
          const prefFid = String(
            item.preferred_factory_id ??
              item.preferredFactoryId ??
              item.factory_site_id ??
              item.factorySiteId ??
              '',
          ).trim();
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
            is_spot: isSpot,
            project_id: !isSpot ? String(item.project_id || row.project_id || '') || null : null,
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
            vehicleType: item.vehicleType || (item.vehicle === '小型' ? 'small' : 'large'),
            vehicleLabel: item.vehicleLabel || item.vehicle || (item.vehicleType === 'small' ? '小型' : '大型'),
            quantityM3: item.confirmedQuantityM3 ?? item.quantityM3 ?? row.quantityM3 ?? '',
            confirmedQuantityM3: undefined,
            unloadDuration: item.unloadDuration || item.unloadDurationMinutes || item.unloadingTime || '30',
            unloadDurationMinutes: item.unloadDurationMinutes || item.unloadDuration || item.unloadingTime || '30',
            unloadDurationLabel: item.unloadDurationLabel || unloadDurationLabel(item.unloadDurationMinutes || item.unloadDuration || item.unloadingTime || '30'),
            mixText: item.mixText || item.confirmedMixText || row.mix || '',
            confirmedMixText: undefined,
            traderName: item.traderName || item.trading_company_name || item.projectTradingCompanyName || '',
            trading_company_name: item.trading_company_name || item.projectTradingCompanyName || item.traderName || '',
            projectTradingCompanyName: item.projectTradingCompanyName || item.trading_company_name || item.traderName || '',
            contractorName: item.contractorName || item.customerName || item.customer_name || row.contractor || '',
            siteName: item.siteName || item.projectName || row.site || '',
            siteAddress: item.siteAddress || row.siteAddress || '',
            sitePhone: item.sitePhone || item.phone || row.phone || currentCustomer?.phone_number || '',
            ordered_by: item.ordered_by || item.orderedBy || row.orderedBy || '',
            orderedBy: item.orderedBy || item.ordered_by || row.orderedBy || '',
            has_test: Boolean(item.has_test),
            delivery_lat: isSpot ? item.delivery_lat ?? item.deliveryLat ?? null : null,
            delivery_lng: isSpot ? item.delivery_lng ?? item.deliveryLng ?? null : null,
          };
          setConfirmOrder(repeatOrder);
          setShowConfirmModal(true);
        },
        [currentCustomer, currentCustomerId, repeatPreferredDate, repeatTimeSlot],
      );

      const handleAiOrderAssist = useCallback(async () => {
        const text = String(aiAssistText || '').trim();
        if (!text || aiAssistLoading) return;
        setAiAssistLoading(true);
        setAiAssistNotice('');
        setAiGeneratedOrders([]);
        setSubmitError('');
        try {
          const orders = await analyzeOrderText(text);
          const stamped = orders.map((o, i) => ({
            ...o,
            _key: `ai-${Date.now()}-${i}`,
          }));
          setAiGeneratedOrders(stamped);
          const count = stamped.length;
          setAiAssistNotice(`${count}件の注文を抽出しました。内容を確認して一括登録してください。`);
          window.setTimeout(() => setAiAssistNotice(''), 5000);
        } catch (err) {
          console.error('AI注文解析に失敗しました', err);
          setAiGeneratedOrders([]);
          setSubmitError(ANALYZE_ORDER_TEXT_ERROR_MESSAGE);
          window.alert(ANALYZE_ORDER_TEXT_ERROR_MESSAGE);
        } finally {
          setAiAssistLoading(false);
        }
      }, [aiAssistText, aiAssistLoading]);

      const bulkRegisterContext = useMemo(
        () => ({
          orderKind,
          currentCustomerId,
          currentCustomer,
          selectedProject,
          selectedProjectId,
          preferredFactoryId,
          factories,
          traderName,
          contractorName,
          siteName,
          siteAddress,
          sitePhone,
          orderedBy,
          vehicleType,
          unloadDuration,
          hasTest,
          deliveryLat,
          deliveryLng,
        }),
        [
          orderKind,
          currentCustomerId,
          currentCustomer,
          selectedProject,
          selectedProjectId,
          preferredFactoryId,
          factories,
          traderName,
          contractorName,
          siteName,
          siteAddress,
          sitePhone,
          orderedBy,
          vehicleType,
          unloadDuration,
          hasTest,
          deliveryLat,
          deliveryLng,
        ],
      );

      const aiBulkDisabledReason = useMemo(() => {
        const missing = validateBulkRegisterContext(bulkRegisterContext, aiGeneratedOrders);
        if (missing.length === 0) return '';
        return `一括登録には次が必要です: ${missing.join('、')}`;
      }, [bulkRegisterContext, aiGeneratedOrders]);

      const handleBulkRegisterAiOrders = useCallback(async () => {
        if (aiBulkRegisterLoading || aiGeneratedOrders.length === 0) return;
        const missing = validateBulkRegisterContext(bulkRegisterContext, aiGeneratedOrders);
        if (missing.length) {
          const message = `次の項目を入力してください: ${missing.join('、')}`;
          setSubmitError(message);
          window.alert(message);
          return;
        }
        setAiBulkRegisterLoading(true);
        setSubmitError('');
        try {
          const payloads = aiGeneratedOrders.map((item) => buildDispatchOrderFromAiItem(item, bulkRegisterContext));
          await db.insertOrdersBulk(payloads);
          const count = payloads.length;
          const contractorName =
            currentCustomer?.company_name || currentCustomer?.name || contractorName.trim() || '新規注文';
          void sendPushNotificationToRole('factory', `新規注文が${count}件入りました：${contractorName}`);
          await refreshDashboard();
          setAiGeneratedOrders([]);
          setAiAssistNotice('');
          setSubmitNotice(`${count}件の注文をカレンダーに一括登録しました！`);
          setCustomerOrderTab('calendar');
          window.setTimeout(() => setSubmitNotice(null), 6000);
        } catch (err) {
          console.error('AI一括登録に失敗しました', err);
          const message = formatSupabaseError(err, '一括登録に失敗しました');
          setSubmitError(message);
          window.alert(message);
        } finally {
          setAiBulkRegisterLoading(false);
        }
      }, [
        aiBulkRegisterLoading,
        aiGeneratedOrders,
        bulkRegisterContext,
        contractorName,
        currentCustomer,
        refreshDashboard,
      ]);

      const handleSubmit = useCallback(
        async (e) => {
          e.preventDefault();
          if (isSubmittingOrder) return;
          if (isPastPreferredDateTime(preferredDate, timeSlot)) {
            const message = '現在より過去の日時は指定できません。正しい希望日時を入力してください。';
            setSubmitError(message);
            window.alert(message);
            return;
          }
          const missing = [];
          const nameTrim = siteName.trim();
          const addrTrim = siteAddress.trim();
          if (!String(quantityM3).trim()) missing.push('数量（m³）');
          if (!contractorName.trim()) missing.push('業者');
          if (!sitePhone.trim()) missing.push('電話番号');
          if (orderKind === 'spot' && !nameTrim && !addrTrim) {
            missing.push('現場名または現場住所');
          }
          if (orderKind === 'project' && !String(selectedProjectId || '').trim()) {
            missing.push('物件');
          }
          if (!String(currentCustomerId || '').trim()) {
            missing.push('業者（会社）');
          }
          if (orderKind === 'spot') {
            const la = parseFloat(String(deliveryLat).trim());
            const ln = parseFloat(String(deliveryLng).trim());
            if (!Number.isFinite(la) || !Number.isFinite(ln)) {
              missing.push('地図上の現場位置（クリックで指定）');
            }
          }
          if (missing.length) {
            setSubmitError(`次の項目を入力してください: ${missing.join('、')}`);
            return;
          }
          setSubmitError('');
          const slotMeta = TIME_SLOTS.find((s) => s.value === timeSlot);
          const slotLabel = slotMeta?.label ?? '';
          const timeMinutes = parseInt(timeSlot, 10);
          const qtyTrim = String(quantityM3).trim();
          const resolvedSiteName =
            orderKind === 'project' && selectedProject?.name
              ? nameTrim || String(selectedProject.name)
              : nameTrim || addrTrim;
          const prefFidRaw = String(preferredFactoryId || '').trim();
          const prefFid =
            prefFidRaw && (Array.isArray(factories) ? factories : []).some((f) => f && String(f.id) === prefFidRaw)
              ? prefFidRaw
              : '';
          const preferredFactoryName =
            prefFid && (Array.isArray(factories) ? factories : []).find((f) => f && f.id === prefFid)?.name?.trim();
          const isSpot = orderKind === 'spot';
          const spotLat = isSpot ? parseFloat(String(deliveryLat).trim()) : null;
          const spotLng = isSpot ? parseFloat(String(deliveryLng).trim()) : null;
          const order = {
            createdAt: new Date().toISOString(),
            is_spot: isSpot,
            customer_id: currentCustomerId || null,
            customerName: currentCustomer?.company_name || currentCustomer?.name || '',
            phone_number: currentCustomer?.phone_number || '',
            customerPhone: currentCustomer?.phone_number || '',
            trading_company_name: selectedProject?.trading_company_name || selectedProject?.trading_company || traderName.trim(),
            projectTradingCompanyName: selectedProject?.trading_company_name || selectedProject?.trading_company || traderName.trim(),
            ordered_by: orderedBy.trim(),
            orderedBy: orderedBy.trim(),
            project_id: !isSpot && selectedProjectId ? String(selectedProjectId) : null,
            projectName: selectedProject?.name || '',
            delivery_lat: isSpot && Number.isFinite(spotLat) ? spotLat : null,
            delivery_lng: isSpot && Number.isFinite(spotLng) ? spotLng : null,
            preferred_factory_id: prefFid || null,
            preferredFactoryId: prefFid || null,
            preferredFactoryName: preferredFactoryName || '',
            preferredDate,
            timeSlot,
            timeSlotMinutes: Number.isFinite(timeMinutes) ? timeMinutes : null,
            timeSlotLabel: slotLabel,
            timePointLabel: slotLabel,
            scheduleMatchDate: preferredDate,
            scheduleMatchMinutes: Number.isFinite(timeMinutes) ? timeMinutes : null,
            vehicleType,
            vehicleLabel: vehicleType === 'large' ? '大型' : '小型',
            quantityM3: qtyTrim,
            unloadDuration,
            unloadDurationMinutes: unloadDuration,
            unloadDurationLabel: unloadDurationLabel(unloadDuration),
            traderName: traderName.trim(),
            contractorName: contractorName.trim(),
            mixText: mixText.trim(),
            siteName: resolvedSiteName,
            siteAddress: addrTrim,
            sitePhone: sitePhone.trim(),
            has_test: hasTest,
          };
          setConfirmOrder(order);
          setShowConfirmModal(true);
        },
        [
          isSubmittingOrder,
          preferredDate,
          timeSlot,
          vehicleType,
          quantityM3,
          unloadDuration,
          traderName,
          contractorName,
          mixText,
          siteName,
          siteAddress,
          sitePhone,
          orderedBy,
          hasTest,
          currentCustomerId,
          currentCustomer,
          preferredFactoryId,
          factories,
          selectedProject,
          orderKind,
          selectedProjectId,
          deliveryLat,
          deliveryLng,
        ],
      );

      const executeConfirmedOrder = useCallback(async () => {
        if (!confirmOrder || isSubmittingOrder) return;
        setIsSubmittingOrder(true);
        setSubmitError('');
        try {
          await db.insertOrder(confirmOrder);
          const contractorName = confirmOrder?.customerName || confirmOrder?.contractorName || currentCustomer?.company_name || currentCustomer?.name || '新規注文';
          void sendPushNotificationToRole('factory', `新規注文が入りました：${contractorName}`);
          await refreshDashboard();
          setCustomerOrderTab('active');
          setExpandedHistoryOrderId('');
          setShowConfirmModal(false);
          setConfirmOrder(null);
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
          setSiteAddress('');
          setSitePhone('');
          setOrderedBy('');
          setHasTest(false);
          setSubmitNotice('発注を送信しました。「進行中」タブに反映され、工場画面でも新着として表示されます。');
          window.setTimeout(() => setSubmitNotice(null), 6000);
        } catch (err) {
          console.error('注文保存に失敗しました', err);
          const message = formatSupabaseError(err, '発注の保存に失敗しました');
          setSubmitError(message);
          window.alert(message);
        } finally {
          setIsSubmittingOrder(false);
        }
      }, [confirmOrder, isSubmittingOrder, refreshDashboard]);

      const btnBase =
        'min-h-[56px] flex-1 rounded-xl border-2 px-4 py-3.5 text-base font-bold transition-colors';
      const confirmMix = parseMixDetails(confirmOrder?.mixText);
      const confirmMixLabel = confirmMix
        ? `強度${confirmMix.strength} / スランプ${confirmMix.slump} / 骨材${confirmMix.aggregate} / セメント${confirmMix.cement}`
        : confirmOrder?.mixText || '—';
      const adminPhoneNumber = String(adminSettings?.phone_number || '').trim();
      const adminTelHref = adminPhoneNumber ? `tel:${adminPhoneNumber.replace(/[^\d+]/g, '')}` : '';
      const adminDisplayName = String(adminSettings?.admin_name || '').trim() || '管理者';

      if (!isLoggedIn) {
        return (
          <div className="flex min-h-[100dvh] w-full items-center justify-center overflow-x-hidden bg-gradient-to-br from-slate-100 via-indigo-50 to-slate-100 px-4 py-[max(2rem,env(safe-area-inset-top))]">
            <form onSubmit={handleCustomerLogin} className="w-full max-w-md rounded-3xl border-2 border-slate-200 bg-white p-6 shadow-2xl sm:p-8">
              <p className="text-xs font-black uppercase tracking-widest text-indigo-600">現場注文ログイン</p>
              <h1 className="mt-2 break-words text-2xl font-black text-slate-900">カスタマーログイン</h1>
              <p className="mt-2 break-words text-sm font-bold leading-relaxed text-slate-500">
                管理画面で登録された電話番号とパスワードを入力してください。
              </p>

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
        <div className="min-h-[100dvh] w-full overflow-x-hidden bg-slate-100 pt-11 pb-[max(7rem,env(safe-area-inset-bottom))] lg:pb-[max(2.5rem,env(safe-area-inset-bottom))]">
          <header className="border-b border-slate-200 bg-white shadow-sm">
            <div className="mx-auto w-full max-w-6xl px-4 py-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <a href="/" className="inline-flex w-fit items-center rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" aria-label="CONCRETE LINK トップへ戻る">
                    <img src={concreteLinkLogo} alt="CONCRETE LINK" className="h-10 w-auto" />
                  </a>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{adminDisplayName}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <button
                    type="button"
                    onClick={handleCustomerLogout}
                    className="rounded-xl border-2 border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 sm:text-sm"
                  >
                    ログアウト
                  </button>
                  <p className="max-w-[10rem] break-words text-right text-xs font-black leading-snug text-indigo-700">
                    ログイン中：{currentCustomer?.company_name || currentCustomer?.name || '認証済み業者'}
                  </p>
                </div>
              </div>
            </div>
          </header>

          <div className="sticky top-0 z-30 hidden border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur lg:block">
            <div className="mx-auto w-full max-w-6xl overflow-x-auto">
            <div className="grid min-w-[32rem] grid-cols-4 gap-1 rounded-2xl bg-slate-100 p-1">
              {[
                ['new', '新規発注'],
                ['active', '進行中'],
                ['history', '履歴'],
                ['calendar', 'カレンダー'],
              ].map(([id, label]) => {
                const active = customerOrderTab === id;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => selectCustomerTab(id)}
                    className={
                      'min-h-[46px] rounded-xl px-1 text-sm font-black transition ' +
                      (active
                        ? 'bg-indigo-600 text-white shadow-md ring-2 ring-indigo-200'
                        : 'bg-transparent text-slate-500 hover:bg-white hover:text-slate-800')
                    }
                    aria-pressed={active}
                  >
                    <span className="inline-flex items-center justify-center">
                      {label}
                      {id === 'active' && unreadChatCount > 0 ? (
                        <span className="ml-2 rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold leading-none text-white shadow-sm animate-pulse">
                          {unreadChatCount}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
            </div>
          </div>

          <PullToRefresh onRefresh={refreshDashboard} className="mx-auto w-full max-w-6xl px-4 py-6">
          <main id="dispatch-dashboard">
            <div className="grid min-w-0 gap-6">
              {customerOrderTab === 'new' && !newOrderMode ? (
              <section className="mx-auto w-full max-w-6xl rounded-2xl border border-slate-200 bg-white p-5 shadow-md sm:p-6">
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
                        setSiteAddress('');
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
                      className="min-h-[150px] rounded-2xl border-2 border-slate-200 bg-slate-50 p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-indigo-300 hover:bg-white hover:shadow-lg active:scale-[0.99]"
                    >
                      <span className="text-xl font-black text-slate-900">{card.title}</span>
                      <span className="mt-3 block text-sm font-bold leading-relaxed text-slate-600">{card.body}</span>
                    </button>
                  ))}
                </div>
              </section>
              ) : null}
              {customerOrderTab === 'new' && newOrderMode ? (
              <div ref={orderFormRef} className="mx-auto w-full max-w-6xl min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-md sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-sm font-black uppercase tracking-wider text-indigo-700">新規発注</h2>
                <p className="mt-1 text-xs text-slate-500">
                  数量・業者・電話番号は必須です。商社は任意です。現場名は未入力のとき、現場住所と同じ内容として扱われます。
                </p>
                  </div>
                  <button type="button" onClick={() => setNewOrderMode('')} className="rounded-xl border-2 border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50">
                    発注スタイル選択へ戻る
                  </button>
                </div>
                <form className="mt-6 grid min-w-0 gap-6 overflow-hidden lg:grid-cols-2 lg:items-start" onSubmit={handleSubmit}>
              <div className="lg:col-span-2 grid gap-4">
                <AiOrderAssistant
                  value={aiAssistText}
                  onChange={setAiAssistText}
                  onSubmit={handleAiOrderAssist}
                  loading={aiAssistLoading}
                  notice={aiAssistNotice}
                />
                <AiGeneratedOrderList
                  orders={aiGeneratedOrders}
                  onOrdersChange={setAiGeneratedOrders}
                  onBulkRegister={handleBulkRegisterAiOrders}
                  bulkLoading={aiBulkRegisterLoading}
                  bulkDisabled={Boolean(aiBulkDisabledReason)}
                  bulkDisabledReason={aiBulkDisabledReason}
                />
              </div>
              <div className="flex flex-col gap-3">
                <span className="text-sm font-semibold text-slate-700">注文種別</span>
                <p className="text-xs leading-relaxed text-slate-500">
                  スポット注文は地図で現場位置を指定します。物件は管理画面で登録した座標を使います。
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setOrderKind('project');
                      setDeliveryLat('');
                      setDeliveryLng('');
                      setSiteAddress('');
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
                    新規スポット注文
                  </button>
                </div>
              </div>

              {orderKind === 'project' ? (
                <div className="flex flex-col gap-3">
                  <Label htmlFor="dispatch-project">物件を選択</Label>
                  <select
                    id="dispatch-project"
                    value={selectedProjectId}
                    disabled={!hasCurrentCustomer}
                    onChange={(e) => {
                      const id = e.target.value;
                      setSelectedProjectId(id);
                      setSubmitError('');
                      const p = (filteredProjects || []).find((x) => x && x.id === id);
                      if (p) {
                        if (p.trading_company_name || p.trading_company) setTraderName(String(p.trading_company_name || p.trading_company));
                        if (p.contractor) setContractorName(String(p.contractor));
                        if (p.name) setSiteName(String(p.name));
                        if (p.main_factory_id) setPreferredFactoryId(String(p.main_factory_id));
                      } else {
                        setPreferredFactoryId('');
                      }
                    }}
                    className="min-h-[56px] w-full appearance-none rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-base font-medium text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
                  >
                    <option value="">{hasCurrentCustomer ? '物件を選択してください' : '先に業者を選択してください'}</option>
                    {filteredProjects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  {!hasCurrentCustomer ? (
                    <p className="text-xs font-bold text-amber-800">ログイン中の業者情報を確認できません。再ログインしてください。</p>
                  ) : filteredProjects.length === 0 ? (
                    <p className="text-xs font-bold text-amber-800">この業者に紐づく物件がありません。管理画面で物件に業者（会社）を設定するか、スポット注文を選んでください。</p>
                  ) : null}
                </div>
              ) : null}

              {orderKind === 'project' &&
              selectedProject &&
              Number.isFinite(selectedProject.lat) &&
              Number.isFinite(selectedProject.lng) ? (
                <div className="flex flex-col gap-2 lg:row-span-3">
                  <Label>物件の位置（確認用）</Label>
                  <MapPicker
                    lat={String(selectedProject.lat)}
                    lng={String(selectedProject.lng)}
                    interactive={false}
                    className="min-h-[320px]"
                  />
                </div>
              ) : null}

              {orderKind === 'spot' ? (
                <>
                  <div className="flex flex-col gap-3">
                    <Label htmlFor="site-name">現場名</Label>
                    <p className="text-xs leading-relaxed text-slate-500">
                      現場の通称など。空欄のまま送信した場合は、下の「現場住所」の内容が現場名として保存されます。
                    </p>
                    <input
                      id="site-name"
                      type="text"
                      autoComplete="off"
                      placeholder="例：〇〇ビル新築工事"
                      value={siteName}
                      onChange={(e) => {
                        setSiteName(e.target.value);
                        setSubmitError('');
                      }}
                      className="min-h-[56px] w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-base font-semibold text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300"
                    />
                  </div>
                  <div className="flex flex-col gap-3">
                    <Label htmlFor="site-address">現場住所</Label>
                    <div className="flex flex-col gap-2 lg:flex-row lg:items-stretch">
                      <textarea
                        id="site-address"
                        rows={4}
                        placeholder="市区町村・番地・現場名など"
                        value={siteAddress}
                        onChange={(e) => {
                          setSiteAddress(e.target.value);
                          setAddressSearchError('');
                        }}
                        className="min-h-[120px] min-w-0 flex-1 resize-y rounded-xl border-2 border-slate-200 px-4 py-3 text-base leading-relaxed placeholder:text-slate-400 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300"
                      />
                      <button
                        type="button"
                        onClick={() => void handleAddressMapSearch()}
                        disabled={addressSearchLoading}
                        className="min-h-[52px] shrink-0 rounded-xl border-2 border-sky-600 bg-sky-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0 lg:self-stretch lg:px-5"
                      >
                        {addressSearchLoading ? '検索中…' : '地図を検索'}
                      </button>
                    </div>
                    {addressSearchError ? (
                      <p className="text-xs font-bold text-red-700" role="alert">
                        {addressSearchError}
                      </p>
                    ) : null}
                    <p className="text-xs leading-relaxed text-slate-500">
                      「地図を検索」で表示位置を移動します。確定するには地図上をクリックしてください。
                    </p>
                  </div>
                  <div className="flex min-h-[360px] flex-col gap-2 lg:row-span-3">
                    <Label>現場位置（地図）</Label>
                    <p className="text-xs leading-relaxed text-slate-500">
                      地図をクリックして緯度・経度を指定してください。納入場所からご指定、または近隣の工場へ確認を行います。
                    </p>
                    {deliveryLat || deliveryLng ? (
                      <p className="font-mono text-xs font-bold text-slate-600">
                        緯度: {deliveryLat || '—'} / 経度: {deliveryLng || '—'}
                      </p>
                    ) : null}
                    <MapPicker
                      lat={deliveryLat}
                      lng={deliveryLng}
                      panTarget={mapPanTarget}
                      className="min-h-[320px]"
                      onPositionChange={(la, ln) => {
                        setDeliveryLat(la);
                        setDeliveryLng(ln);
                        setSubmitError('');
                      }}
                    />
                  </div>
                </>
              ) : null}

              <div className="flex min-w-0 max-w-full flex-col gap-3 overflow-hidden lg:col-start-1">
                <Label htmlFor="preferred-date">希望日</Label>
                <div className="w-full min-w-0 max-w-full overflow-hidden">
                  <input
                    id="preferred-date"
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
                    className="block box-border min-h-[56px] min-w-0 w-full max-w-full appearance-none rounded-xl border-2 border-slate-200 bg-white px-3 py-3 text-base text-slate-900 outline-none ring-slate-400 focus:border-slate-400 focus:ring-2 focus:ring-slate-300"
                    style={{
                      width: '100%',
                      minWidth: 0,
                      maxWidth: '100%',
                      WebkitAppearance: 'none',
                      appearance: 'none',
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <Label htmlFor="time-slot">希望時刻（8:00〜15:30・30分刻み）</Label>
                <p className="text-xs leading-relaxed text-slate-500">
                  到着・打設の目安時刻を、30分単位で指定します（最遅 15:30）。
                </p>
                <select
                  id="time-slot"
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
                    <option key={s.value} value={s.value} disabled={isPastPreferredDateTime(preferredDate, s.value)}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-3">
                <Label htmlFor="dispatch-factory">第一希望工場（任意）</Label>
                <p className="text-xs leading-relaxed text-slate-500">
                  指定した工場に最初に配車依頼が届きます。物件を選ぶとメイン工場が自動入力されます（変更可）。未指定の場合はエスカレーションルールに従います。
                </p>
                <select
                  id="dispatch-factory"
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
                  {factories.map((f) => (
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

              <div className="flex flex-col gap-3">
                <Label htmlFor="quantity-m3">数量（m³）</Label>
                <p className="text-xs leading-relaxed text-slate-500">
                  発注時は空欄にできません。
                </p>
                <input
                  id="quantity-m3"
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
                <Label htmlFor="unload-duration">1台あたりの荷卸し（車返却）予定時間</Label>
                <p className="text-xs leading-relaxed text-slate-500">
                  現場での滞在想定時間です。工場側の帰着・次便計画に使用します。
                </p>
                <select
                  id="unload-duration"
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

              <AutocompleteField
                id="trader-name"
                labelText="商社（任意）"
                value={traderName}
                onValueChange={(v) => {
                  setTraderName(v);
                  setSubmitError('');
                }}
                suggestions={MASTER_TRADER_SUGGESTIONS}
                placeholder="例：梅田建材（入力すると候補が表示されます）"
                autoComplete="organization"
              />

              <AutocompleteField
                id="contractor-name"
                labelText="業者"
                value={contractorName}
                onValueChange={(v) => {
                  setContractorName(v);
                  setSubmitError('');
                }}
                suggestions={MASTER_CONTRACTOR_SUGGESTIONS}
                placeholder="例：佐藤建設（入力すると候補が表示されます）"
                autoComplete="off"
              />

              <div className="flex flex-col gap-3">
                <Label htmlFor="mix-spec">配合（JIS規格など）</Label>
                <p className="text-xs leading-relaxed text-slate-500">自由入力のほか、下のショートカットから選べます。</p>
                <input
                  id="mix-spec"
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

              <div className="flex flex-col gap-2">
                <div className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-slate-200 bg-slate-50/90 px-4 py-3 transition hover:border-slate-300 hover:bg-white">
                  <input
                    id="order-has-test"
                    type="checkbox"
                    checked={hasTest}
                    onChange={(e) => {
                      setHasTest(e.target.checked);
                      setSubmitError('');
                    }}
                    className="mt-1 h-5 w-5 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                  />
                  <label htmlFor="order-has-test" className="min-w-0 flex-1 cursor-pointer text-sm leading-snug text-slate-800">
                    <span className="font-black text-slate-900">試験の有無</span>
                    <span className="mt-1 block text-xs font-medium text-slate-500">
                      チェックを入れると「試験あり」として工場に伝わります。未チェックのときは試験なしです。
                    </span>
                  </label>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <Label htmlFor="ordered-by">発注担当者名</Label>
                <p className="text-xs leading-relaxed text-slate-500">当日連絡が取れる担当者名を自由入力してください（例：山田、佐藤）。</p>
                <input
                  id="ordered-by"
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
                <Label htmlFor="site-phone">電話番号</Label>
                <input
                  id="site-phone"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="例：03-1234-5678"
                  value={sitePhone}
                  onChange={(e) => {
                    setSitePhone(e.target.value);
                    setSubmitError('');
                  }}
                  className="min-h-[56px] w-full rounded-xl border-2 border-slate-200 px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300"
                />
              </div>

              {submitError ? (
                <p
                  className="rounded-xl border-2 border-red-400 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 shadow-sm lg:col-span-2"
                  role="alert"
                >
                  {submitError}
                </p>
              ) : null}
              <button
                type="submit"
                disabled={isSubmittingOrder || !hasCurrentCustomer}
                className="mt-2 flex min-h-[56px] w-full items-center justify-center rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-4 text-base font-bold text-white shadow-lg shadow-orange-500/30 transition hover:from-orange-600 hover:to-amber-600 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60 lg:col-span-2"
              >
                {isSubmittingOrder ? '送信中…' : hasCurrentCustomer ? '発注する（工場へ送信）' : '先に業者を選択してください'}
              </button>
              {submitNotice && (
                <p
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900 lg:col-span-2"
                  role="status"
                >
                  {submitNotice}
                </p>
              )}
            </form>
              </div>
              ) : null}

              {customerOrderTab === 'active' ? (
              <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md sm:p-5">
                {adminNotice ? (
                  <div className="mb-3 rounded-xl border-2 border-violet-300 bg-violet-50 px-3 py-2 text-sm font-black text-violet-800" role="status">
                    {adminNotice}
                  </div>
                ) : null}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-black text-slate-900">進行中の注文ステータス</h2>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                      工場画面の受注／拒否／保留がここに反映されます。
                    </p>
                  </div>
                </div>
                  <div className="mt-4 space-y-5">
                    {activeOrders.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                        進行中の注文はありません。「新規発注」タブから発注してください。
                      </p>
                    ) : (
                      <>
                        <OrderListSearchInput
                          id="master-in-progress-search"
                          value={inProgressSearchQuery}
                          onChange={setInProgressSearchQuery}
                        />
                        {filteredInProgressOrders.length === 0 ? (
                          <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm font-bold text-slate-500">
                            該当する注文がありません
                          </p>
                        ) : (
                          filteredInProgressOrders.map((ord, i) => (
                            <InProgressOrderCard
                              key={ord.id || `ord-${i}`}
                              order={ord}
                              messages={chatThreads[ord.id]}
                              hasUnreadChat={isUnreadForDispatch(chatThreads[ord.id], readChatKeys[ord.id])}
                              onMarkChatRead={markChatRead}
                              onOpenChat={setActiveChatOrderId}
                              onAllowStatusReset={handleAllowStatusReset}
                            />
                          ))
                        )}
                      </>
                    )}
                  </div>
              </aside>
              ) : null}
            </div>

            {customerOrderTab === 'history' ? (
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-md sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <h2 className="text-base font-black text-slate-900">注文履歴</h2>
                  <p className="mt-2 text-xs leading-relaxed text-slate-500">
                    完了・キャンセル済みの注文です。カードを展開して日付と時間だけ変更し、再発注できます。
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
                <ul className="mt-5 grid gap-4 lg:grid-cols-2">
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
                          <button
                            type="button"
                            onClick={() => openRepeatOrderForm(row)}
                            className="shrink-0 rounded-xl border-2 border-indigo-600 bg-indigo-600 px-3 py-2 text-xs font-black text-white shadow-sm transition hover:bg-indigo-700 active:scale-[0.99]"
                          >
                            この内容で再発注
                          </button>
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
                                  onClick={() => confirmRepeatOrder(row)}
                                  className="min-h-[52px] rounded-xl border-2 border-orange-500 bg-orange-500 px-4 text-base font-black text-white shadow-sm transition hover:bg-orange-600 active:scale-[0.99]"
                                >
                                  この日時で確定
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
          </main>
          </PullToRefresh>
          <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-slate-200 bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 shadow-[0_-10px_30px_rgba(15,23,42,0.12)] backdrop-blur lg:hidden" aria-label="カスタマー画面ナビゲーション">
            <div className="mx-auto grid max-w-md grid-cols-4 gap-1">
              {[
                ['new', '📝', '新規発注'],
                ['active', '🚚', '進行中'],
                ['calendar', '📅', 'カレンダー'],
                ['history', '📜', '履歴'],
              ].map(([id, icon, label]) => {
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
                        <span className="ml-1.5 rounded-full bg-red-500 px-2 py-0.5 text-xs font-bold leading-none text-white shadow-sm animate-pulse">
                          {unreadChatCount}
                        </span>
                      ) : null}
                    </span>
                  </button>
                );
              })}
            </div>
          </nav>
          {activeChatOrder ? (
            <CustomerChatScreen
              order={activeChatOrder}
              messages={chatThreads[activeChatOrder.id]}
              onBack={() => setActiveChatOrderId('')}
              onSendMessage={handleSendMasterChat}
              onMarkChatRead={markChatRead}
            />
          ) : null}
          {showConfirmModal && confirmOrder ? (
            <div className="fixed inset-0 z-[300] flex items-center justify-center overflow-y-auto overflow-x-hidden bg-slate-950/70 px-4 py-[max(1.5rem,env(safe-area-inset-top))]" role="dialog" aria-modal="true" aria-labelledby="dispatch-confirm-title">
              <div className="w-full max-w-lg rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-2xl sm:p-6">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs font-black uppercase tracking-wider text-indigo-600">最終確認</p>
                    <h2 id="dispatch-confirm-title" className="mt-1 break-words text-lg font-black text-slate-900">この内容で発注しますか？</h2>
                    <p className="mt-1 break-words text-xs font-bold leading-relaxed text-slate-500">
                      内容を確認してから「この内容で発注する」を押してください。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(false)}
                    className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1 text-sm font-black text-slate-500 hover:bg-slate-50"
                    aria-label="確認モーダルを閉じる"
                  >
                    ×
                  </button>
                </div>

                <dl className="mt-5 divide-y divide-slate-100 rounded-xl border border-slate-200 bg-slate-50 text-sm">
                  <div className="grid gap-1 px-3 py-3 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
                    <dt className="font-black text-slate-500">業者名</dt>
                    <dd className="min-w-0 break-words font-bold text-slate-900">{confirmOrder.customerName || '—'}</dd>
                  </div>
                  <div className="grid gap-1 px-3 py-3 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
                    <dt className="font-black text-slate-500">物件名</dt>
                    <dd className="min-w-0 break-words font-bold text-slate-900">{confirmOrder.projectName || confirmOrder.siteName || 'スポット注文'}</dd>
                  </div>
                  <div className="grid gap-1 px-3 py-3 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
                    <dt className="font-black text-slate-500">納入希望日時</dt>
                    <dd className="min-w-0 break-words font-bold text-slate-900">{formatOrderDate(confirmOrder)} {confirmOrder.timePointLabel || confirmOrder.timeSlotLabel || '—'}</dd>
                  </div>
                  <div className="grid gap-1 px-3 py-3 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
                    <dt className="font-black text-slate-500">配合</dt>
                    <dd className="min-w-0 break-words font-bold text-slate-900">{confirmMixLabel}</dd>
                  </div>
                  <div className="grid gap-1 px-3 py-3 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
                    <dt className="font-black text-slate-500">数量</dt>
                    <dd className="min-w-0 break-words font-bold text-slate-900">{confirmOrder.quantityM3 || '—'} m³</dd>
                  </div>
                  <div className="grid gap-1 px-3 py-3 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
                    <dt className="font-black text-slate-500">荷卸し時間</dt>
                    <dd className="min-w-0 break-words font-bold text-slate-900">{confirmOrder.unloadDurationLabel || unloadDurationLabel(confirmOrder.unloadDurationMinutes || confirmOrder.unloadDuration)}</dd>
                  </div>
                  <div className="grid gap-1 px-3 py-3 sm:grid-cols-[7.5rem_1fr] sm:gap-3">
                    <dt className="font-black text-slate-500">担当者・電話</dt>
                    <dd className="min-w-0 break-words font-bold text-slate-900">
                      {(confirmOrder.orderedBy || confirmOrder.ordered_by || '—') + ' / ' + (confirmOrder.sitePhone || '—')}
                    </dd>
                  </div>
                </dl>

                <div className="mt-5 grid gap-3 sm:grid-cols-2">
                  <button
                    type="button"
                    onClick={() => setShowConfirmModal(false)}
                    disabled={isSubmittingOrder}
                    className="min-h-[48px] rounded-xl border-2 border-slate-300 bg-white px-4 text-sm font-black text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    キャンセル（戻る）
                  </button>
                  <button
                    type="button"
                    onClick={() => void executeConfirmedOrder()}
                    disabled={isSubmittingOrder}
                    className="min-h-[48px] rounded-xl border-2 border-blue-700 bg-blue-600 px-4 text-sm font-black text-white shadow hover:bg-blue-700 disabled:opacity-50"
                  >
                    {isSubmittingOrder ? '送信中…' : 'この内容で発注する'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      );
    }
