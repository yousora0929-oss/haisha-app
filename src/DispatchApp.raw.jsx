const { useState, useCallback, useEffect, useRef, useMemo } = React;

    function pad2(n) {
      return String(n).padStart(2, '0');
    }

    function todayLocalISODate() {
      const d = new Date();
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }

    const STORAGE_ORDERS_KEY = 'haisha_dispatch_orders_v1';
    const STORAGE_ORDER_CHAT_KEY = 'haisha_order_chat_threads_v1';
    const STORAGE_SCHEDULE_KEY = 'haisha_factory_schedule_by_date_v1';
    const HAISHA_LS_SYNC = 'haisha-ls-sync';

    const DISPATCH_DEFAULT_FACTORY_SITE_NAME = 'A工場';
    const DISPATCH_DEFAULT_FACTORY_SITE_ID = 'FACTORY_A';

    /** 8:00, 8:30, … 17:00 まで30分刻みの指定時刻（値は当日0時からの分） */
    function buildTimePointsHalfHour() {
      const slots = [];
      const fmt = (totalMin) => {
        const h = Math.floor(totalMin / 60);
        const m = totalMin % 60;
        return `${h}:${pad2(m)}`;
      };
      for (let m = 8 * 60; m <= 17 * 60; m += 30) {
        slots.push({ value: String(m), label: fmt(m) });
      }
      return slots;
    }

    const TIME_SLOTS = buildTimePointsHalfHour();

    const SCHEDULE_BLOCK_IDS = ['am1', 'am2', 'pm1', 'pm2'];
    const SCHEDULE_BLOCKS = [
      { id: 'am1', label: '8:00 ～ 10:30', shortLabel: '午前 ①' },
      { id: 'am2', label: '10:30 ～ 12:00', shortLabel: '午前 ②' },
      { id: 'pm1', label: '13:00 ～ 13:59', shortLabel: '午後 ①' },
      { id: 'pm2', label: '14:00 ～ 15:30', shortLabel: '午後 ②' },
    ];

    function defaultEmptyDayBlocksMaster() {
      const o = {};
      for (const id of SCHEDULE_BLOCK_IDS) {
        o[id] = { large: 'available', small: 'available' };
      }
      return o;
    }

    function normalizeDayBlockScheduleMaster(maybe) {
      const defaults = defaultEmptyDayBlocksMaster();
      if (!maybe || typeof maybe !== 'object' || Array.isArray(maybe)) return defaults;
      const keys = Object.keys(maybe);
      if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) return defaults;
      const out = { ...defaults };
      for (const id of SCHEDULE_BLOCK_IDS) {
        const b = maybe[id];
        if (!b || typeof b !== 'object') continue;
        out[id] = {
          large: b.large === 'full' || b.large === 'available' ? b.large : defaults[id].large,
          small: b.small === 'full' || b.small === 'available' ? b.small : defaults[id].small,
        };
      }
      return out;
    }

    function normalizeFullScheduleMaster(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      const out = {};
      for (const [dateKey, dayMap] of Object.entries(raw)) {
        if (typeof dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
          out[dateKey] = normalizeDayBlockScheduleMaster(dayMap);
        }
      }
      return out;
    }

    function readFullScheduleMaster() {
      try {
        const raw = localStorage.getItem(STORAGE_SCHEDULE_KEY);
        if (!raw) return {};
        const o = JSON.parse(raw);
        return normalizeFullScheduleMaster(o);
      } catch {
        return {};
      }
    }

    function getScheduleBlockIdForMinutesMaster(totalMin) {
      if (!Number.isFinite(totalMin)) return null;
      if (totalMin >= 8 * 60 && totalMin <= 10 * 60 + 29) return 'am1';
      if (totalMin >= 10 * 60 + 30 && totalMin <= 12 * 60) return 'am2';
      if (totalMin >= 13 * 60 && totalMin <= 13 * 60 + 59) return 'pm1';
      if (totalMin >= 14 * 60 && totalMin <= 15 * 60 + 30) return 'pm2';
      return null;
    }

    function getOrderVehicleScheduleKeyMaster(order) {
      if (order && order.vehicleType === 'small') return 'small';
      if (order && String(order.vehicleLabel || '').trim() === '小型') return 'small';
      return 'large';
    }

    function getOrderMinutesForScheduleScanMaster(order) {
      const m =
        order?.scheduleMatchMinutes ??
        order?.timeSlotMinutes ??
        (String(order?.timeSlot || '').match(/^\d+$/) ? parseInt(String(order.timeSlot), 10) : NaN);
      return Number.isFinite(m) ? m : NaN;
    }

    function computeScheduleAutoRejectReasonMaster(order, dayBlocks) {
      const orderMins = getOrderMinutesForScheduleScanMaster(order);
      if (!Number.isFinite(orderMins)) return null;
      const bid = getScheduleBlockIdForMinutesMaster(orderMins);
      if (!bid) return null;
      const vk = getOrderVehicleScheduleKeyMaster(order);
      const block = dayBlocks[bid];
      if (!block || block[vk] !== 'full') return null;
      const meta = SCHEDULE_BLOCKS.find((b) => b.id === bid);
      const windowLabel = meta ? meta.label : bid;
      const vj = vk === 'small' ? '小型' : '大型';
      return `【自動】${windowLabel}・${vj}は満車のため受諾不可`;
    }

    function persistOrdersListMaster(next) {
      try {
        localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(next));
        broadcastLocalStorageUpdate(STORAGE_ORDERS_KEY);
      } catch {
        /* ignore */
      }
    }

    /** 工場タブが開いていない場合でも、発注直後・定期同期で満車自動拒否を適用する */
    function applyScheduleAutoRejectionsFromStorageMaster() {
      const schedule = readFullScheduleMaster();
      const orders = readOrdersFromStorage();
      let changed = false;
      const chats = [];
      const next = orders.map((o) => {
        if (!o || !o.id) return o;
        if (o.factoryResponseStatus || o.scheduleAutoChecked) return o;
        const date = o.scheduleMatchDate || o.preferredDate;
        if (!date || typeof date !== 'string') {
          changed = true;
          return { ...o, scheduleAutoChecked: true };
        }
        const dayBlocks = normalizeDayBlockScheduleMaster(schedule[date]);
        const reason = computeScheduleAutoRejectReasonMaster(o, dayBlocks);
        if (!reason) {
          changed = true;
          return { ...o, scheduleAutoChecked: true };
        }
        changed = true;
        chats.push({
          id: o.id,
          body: `${reason}\n（満車のため拒否 — システム自動応答）`,
        });
        return {
          ...o,
          factoryResponseStatus: 'rejected',
          factoryResponseLocked: true,
          factoryRejectSource: 'schedule_auto',
          factorySiteName: DISPATCH_DEFAULT_FACTORY_SITE_NAME,
          factorySiteId: DISPATCH_DEFAULT_FACTORY_SITE_ID,
          scheduleAutoChecked: true,
          acceptedFactoryLabel: undefined,
          factoryPendingStartedAt: undefined,
          factoryPendingByName: undefined,
          factoryUnlockRequested: false,
        };
      });
      if (!changed) return;
      persistOrdersListMaster(next);
      for (const c of chats) {
        appendOrderChatMessage(c.id, 'system', c.body);
      }
    }

    function broadcastLocalStorageUpdate(key) {
      try {
        window.dispatchEvent(new CustomEvent(HAISHA_LS_SYNC, { detail: { key: String(key) } }));
      } catch {
        /* ignore */
      }
    }

    function getDefaultFactoryDisplayName(order) {
      const site = order && order.factorySiteName ? String(order.factorySiteName).trim() : '';
      if (site) return site;
      const label = order && order.acceptedFactoryLabel ? String(order.acceptedFactoryLabel).trim() : '';
      if (label) return label.replace(/^受注工場[：:]\s*/, '') || label;
      return 'A工場（デモ）';
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

    function readOrderChatThreads() {
      try {
        const raw = localStorage.getItem(STORAGE_ORDER_CHAT_KEY);
        const o = raw ? JSON.parse(raw) : {};
        return o && typeof o === 'object' && !Array.isArray(o) ? o : {};
      } catch {
        return {};
      }
    }

    function appendOrderChatMessage(orderId, from, body) {
      const t = String(body || '').trim();
      if (!orderId || !t) return;
      const all = readOrderChatThreads();
      const list = Array.isArray(all[orderId]) ? [...all[orderId]] : [];
      list.push({
        id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        from: from === 'factory' ? 'factory' : from === 'system' ? 'system' : 'master',
        body: t,
        createdAt: new Date().toISOString(),
      });
      all[orderId] = list.slice(-100);
      try {
        localStorage.setItem(STORAGE_ORDER_CHAT_KEY, JSON.stringify(all));
        broadcastLocalStorageUpdate(STORAGE_ORDER_CHAT_KEY);
      } catch {
        /* ignore */
      }
    }

    const MIX_SHORTCUTS = ['18-8-20BB', '18-12-20BB', '21-8-20BB', '21-12-20BB'];

    const MASTER_TRADER_SUGGESTIONS = ['梅田建材', '大分商事', '九州生コン販売', '共栄商事'];
    const MASTER_CONTRACTOR_SUGGESTIONS = ['佐藤建設', '田中組', '大分土木', '九州コンクリート工業'];

    function filterMasterSuggestions(suggestions, inputValue) {
      const t = String(inputValue ?? '').trim();
      if (!t) return [];
      const tl = t.toLowerCase();
      return suggestions.filter((s) => String(s).toLowerCase().includes(tl));
    }

    /** 将来のAPI連携用（画面には表示しない） */
    function inferAggregateFromMix(text) {
      if (!text || typeof text !== 'string') return null;
      if (text.includes('-20')) return '20';
      if (text.includes('-40')) return '40';
      return null;
    }

    const ORDER_HISTORY_DUMMY = [
      {
        id: 'h1',
        date: '2026/05/08',
        slot: '10:30',
        vehicle: '大型',
        quantityM3: 4.5,
        traderName: '〇〇建材商事',
        contractorName: '△△土木 JV',
        siteName: '〇〇建設現場',
        mix: '21-18-20N',
        address: '東京都港区海岸1-1-1 〇〇建設現場',
      },
      {
        id: 'h2',
        date: '2026/05/05',
        slot: '13:00',
        vehicle: '小型',
        quantityM3: 2,
        traderName: '××生コン販売',
        contractorName: '□□興業',
        siteName: 'みなとみらい南門',
        mix: '24-18-15N',
        address: '神奈川県横浜市西区みなとみらい2-2 現場南門',
      },
      {
        id: 'h3',
        date: '2026/04/28',
        slot: '8:30',
        vehicle: '大型',
        quantityM3: 6,
        traderName: '◇◇建材',
        contractorName: '現場直行（自社）',
        siteName: '港町倉庫',
        mix: '18-25-20N',
        address: '千葉県千葉市中央区港町10-5',
      },
    ];

    function readOrdersFromStorage() {
      try {
        const raw = localStorage.getItem(STORAGE_ORDERS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }

    function appendOrderToStorage(order) {
      const prev = readOrdersFromStorage();
      const next = [order, ...prev].slice(0, 50);
      localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(next));
      broadcastLocalStorageUpdate(STORAGE_ORDERS_KEY);
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
      const st = order.factoryResponseStatus;
      const displayName = getDefaultFactoryDisplayName(order);
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
      const isSnapshot = order.factoryResponseStatus === 'accepted';
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

    function OrderChatPanel({ orderId, messages, onSendMaster, onAfterLocalChange }) {
      const [draft, setDraft] = useState('');
      const list = Array.isArray(messages) ? messages : [];
      const send = useCallback(() => {
        const t = draft.trim();
        if (!t) return;
        onSendMaster(orderId, t);
        setDraft('');
      }, [draft, onSendMaster, orderId]);
      return (
        <div className="flex flex-col rounded-xl border border-slate-200 bg-[#e5ddd5] p-2 shadow-inner">
          <p className="px-1 pb-1 text-[10px] font-black uppercase tracking-wider text-slate-400">質疑応答（チャット）</p>
          <ul
            className="scrollbar-thin max-h-44 min-h-[5.5rem] space-y-2 overflow-y-auto rounded-lg bg-[#e5ddd5] px-1 py-2"
            aria-live="polite"
          >
            {list.length === 0 ? (
              <li className="px-2 text-center text-xs text-slate-500">まだメッセージはありません</li>
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
                        {mine ? 'マスター' : '工場'} ·{' '}
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
          <div className="mt-2 flex gap-2 border-t border-slate-300/60 pt-2">
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
              className="min-h-[48px] flex-1 rounded-full border border-slate-300 bg-white px-4 text-sm outline-none focus:ring-2 focus:ring-indigo-300"
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
      );
    }

    function InProgressOrderCard({ order, messages, onSendMasterChat, onAllowStatusReset, refreshDashboard }) {
      const [expanded, setExpanded] = useState(false);
      const addr = order.siteAddress?.trim() || '';
      const siteNameDisp = order.siteName?.trim() || '';
      const siteNameLine = siteNameDisp || '—';
      const headerFocusLine = siteNameDisp || addr || '—';
      const trader = order.traderName?.trim() || '—';
      const contractor = order.contractorName?.trim() || '—';
      const phone = order.sitePhone != null ? String(order.sitePhone).trim() : '—';
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

      const renderDetail = () => (
        <>
          <div className="grid gap-3 rounded-2xl border-2 border-slate-800/25 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-4 shadow-lg sm:grid-cols-3 sm:gap-4 sm:p-5">
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">商社</p>
              <p className="mt-1 break-words text-lg font-black leading-snug text-white sm:text-xl">{trader}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">業者</p>
              <p className="mt-1 break-words text-lg font-black leading-snug text-white sm:text-xl">{contractor}</p>
            </div>
            <div className="min-w-0">
              <p className="text-[10px] font-black uppercase tracking-wider text-amber-200/90">現場名</p>
              <p className="mt-1 break-words text-lg font-black leading-snug text-amber-50 sm:text-xl">{siteNameLine}</p>
            </div>
          </div>

          <div className="mt-4 flex flex-col gap-3 border-b border-slate-100 pb-4 lg:flex-row lg:items-start lg:justify-between lg:gap-5">
            <div className="min-w-0 shrink-0 lg:max-w-[40%]">
              <p className={lbl}>希望日 · 時刻</p>
              <p className="mt-1 text-sm font-black leading-tight text-slate-900 sm:text-base">{timeSummary}</p>
              <p className="mt-1.5 font-mono text-[10px] text-slate-400">{order.id}</p>
            </div>
            <div className="min-w-0 flex-1">
              <p className={lbl}>電話番号</p>
              <p className={val + ' font-mono'}>{phone}</p>
            </div>
            <div className="shrink-0 lg:pt-0">
              <OrderStatusBadges order={order} />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-2 sm:px-3 sm:py-2.5">
              <p className={lbl}>車種</p>
              <p className={val + ' text-sm font-black sm:text-base'}>{vehicle}</p>
            </div>
            <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-2 sm:px-3 sm:py-2.5">
              <p className={lbl}>数量</p>
              <p className={val + ' font-mono text-sm font-black sm:text-base'}>{qtyDisp}</p>
            </div>
            <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-2 sm:px-3 sm:py-2.5">
              <p className={lbl}>配合</p>
              <p className={val + ' font-mono break-all text-xs sm:text-sm'}>{mixStr}</p>
            </div>
            <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50/60 px-2.5 py-2 sm:px-3 sm:py-2.5 sm:col-span-2 lg:col-span-1">
              <p className={lbl}>現場住所</p>
              <p className={val + ' line-clamp-4 text-xs sm:text-sm'}>{addrDisp}</p>
            </div>
          </div>

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
          <div className="mt-5">
            <ConfirmedDetailsBlock order={order} />
          </div>
          <div className="mt-5">
            <OrderChatPanel
              orderId={order.id}
              messages={messages}
              onSendMaster={onSendMasterChat}
              onAfterLocalChange={refreshDashboard}
            />
          </div>
        </>
      );

      return (
        <article className="overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-md">
          <button
            type="button"
            className="flex w-full min-h-[52px] items-start gap-3 border-b border-slate-100 bg-white px-4 py-3 text-left transition hover:bg-slate-50/90 active:bg-slate-50 sm:px-5 sm:py-3.5"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black text-slate-500 sm:text-xs">{timeSummary}</p>
              <p className="mt-0.5 text-[11px] font-bold text-slate-600 sm:text-xs">
                {vehicle} · <span className="font-mono text-slate-800">{qtyDisp}</span>
              </p>
              <p className="mt-0.5 truncate text-sm font-bold text-slate-900">{headerFocusLine}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <OrderStatusBadges order={order} />
              </div>
            </div>
            <span className="shrink-0 rounded-lg border border-slate-200/90 bg-slate-50 px-2.5 py-1.5 text-sm font-black text-slate-600 shadow-inner">
              {expanded ? '▲' : '▼'}
            </span>
          </button>
          <div
            className="grid transition-[grid-template-rows] duration-300 ease-out"
            style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
          >
            <div className="min-h-0 overflow-hidden">
              <div className="p-5 sm:p-6">{renderDetail()}</div>
            </div>
          </div>
        </article>
      );
    }

    function App() {
      const today = todayLocalISODate();

      const [preferredDate, setPreferredDate] = useState(today);
      const [timeSlot, setTimeSlot] = useState(TIME_SLOTS[0].value);
      const [vehicleType, setVehicleType] = useState('large');
      const [mixText, setMixText] = useState('');
      const [quantityM3, setQuantityM3] = useState('');
      const [traderName, setTraderName] = useState('');
      const [contractorName, setContractorName] = useState('');
      const [siteName, setSiteName] = useState('');
      const [siteAddress, setSiteAddress] = useState('');
      const [sitePhone, setSitePhone] = useState('');
      const [submitNotice, setSubmitNotice] = useState(null);
      const [submitError, setSubmitError] = useState('');
      const [dashboardOrders, setDashboardOrders] = useState(() => readOrdersFromStorage());
      const [chatThreads, setChatThreads] = useState(() => readOrderChatThreads());
      const [inProgressSectionOpen, setInProgressSectionOpen] = useState(true);
      const [inProgressSearchQuery, setInProgressSearchQuery] = useState('');
      const prevOrdersRef = useRef(null);

      const refreshDashboard = useCallback(() => {
        applyScheduleAutoRejectionsFromStorageMaster();
        const newOrders = readOrdersFromStorage();
        const newThreads = readOrderChatThreads();
        prevOrdersRef.current = newOrders;
        setDashboardOrders(newOrders);
        setChatThreads(newThreads);
      }, []);

      const filteredInProgressOrders = useMemo(
        () =>
          dashboardOrders
            .filter((o) => o && orderMatchesMasterSearch(o, inProgressSearchQuery))
            .slice(0, 15),
        [dashboardOrders, inProgressSearchQuery],
      );

      useEffect(() => {
        refreshDashboard();
        const onStorage = (ev) => {
          if (
            ev.key === STORAGE_ORDERS_KEY ||
            ev.key === STORAGE_ORDER_CHAT_KEY ||
            ev.key === STORAGE_SCHEDULE_KEY ||
            ev.key === null
          ) {
            refreshDashboard();
          }
        };
        const onLs = (ev) => {
          const k = ev && ev.detail ? ev.detail.key : undefined;
          if (
            k === STORAGE_ORDERS_KEY ||
            k === STORAGE_ORDER_CHAT_KEY ||
            k === STORAGE_SCHEDULE_KEY ||
            k === undefined
          ) {
            refreshDashboard();
          }
        };
        window.addEventListener('storage', onStorage);
        window.addEventListener(HAISHA_LS_SYNC, onLs);
        const poll = window.setInterval(refreshDashboard, 1500);
        return () => {
          window.removeEventListener('storage', onStorage);
          window.removeEventListener(HAISHA_LS_SYNC, onLs);
          window.clearInterval(poll);
        };
      }, [refreshDashboard]);

      const handleSendMasterChat = useCallback(
        (orderId, text) => {
          appendOrderChatMessage(orderId, 'master', text);
          refreshDashboard();
        },
        [refreshDashboard],
      );

      const handleAllowStatusReset = useCallback(
        (orderId) => {
          if (!orderId) return;
          const next = readOrdersFromStorage().map((o) =>
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
          persistOrdersListMaster(next);
          appendOrderChatMessage(
            orderId,
            'system',
            '【マスター】ステータス再設定を許可しました。工場は再度 受注／拒否／保留 を選択できます。',
          );
          refreshDashboard();
        },
        [refreshDashboard],
      );

      const applyHistory = useCallback((item) => {
        setPreferredDate(item.date.replace(/\//g, '-'));
        const byLabel = TIME_SLOTS.find((s) => s.label === item.slot);
        const byValue = TIME_SLOTS.find((s) => s.value === String(item.timeSlot));
        let resolved = byLabel || byValue;
        if (!resolved && item.slot && String(item.slot).includes('〜')) {
          const start = String(item.slot).split('〜')[0].trim();
          resolved = TIME_SLOTS.find((s) => s.label === start);
        }
        setTimeSlot((resolved || TIME_SLOTS[0]).value);
        setVehicleType(item.vehicle === '小型' ? 'small' : 'large');
        setMixText(item.mix);
        setQuantityM3(
          item.quantityM3 !== undefined && item.quantityM3 !== null && item.quantityM3 !== ''
            ? String(item.quantityM3)
            : '',
        );
        setTraderName(item.traderName ?? '');
        setContractorName(item.contractorName ?? '');
        setSiteName(item.siteName ?? '');
        setSiteAddress(item.address);
        setSitePhone(item.sitePhone ?? '');
      }, []);

      const handleSubmit = useCallback(
        (e) => {
          e.preventDefault();
          const missing = [];
          const nameTrim = siteName.trim();
          const addrTrim = siteAddress.trim();
          if (!String(quantityM3).trim()) missing.push('数量（m³）');
          if (!traderName.trim()) missing.push('商社');
          if (!contractorName.trim()) missing.push('業者');
          if (!sitePhone.trim()) missing.push('電話番号');
          if (!nameTrim && !addrTrim) missing.push('現場名または現場住所');
          if (missing.length) {
            setSubmitError(`次の項目を入力してください: ${missing.join('、')}`);
            return;
          }
          setSubmitError('');
          const slotMeta = TIME_SLOTS.find((s) => s.value === timeSlot);
          const slotLabel = slotMeta?.label ?? '';
          const timeMinutes = parseInt(timeSlot, 10);
          const qtyTrim = String(quantityM3).trim();
          const resolvedSiteName = nameTrim || addrTrim;
          const order = {
            id: 'ord_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
            createdAt: new Date().toISOString(),
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
            traderName: traderName.trim(),
            contractorName: contractorName.trim(),
            mixText: mixText.trim(),
            siteName: resolvedSiteName,
            siteAddress: addrTrim,
            sitePhone: sitePhone.trim(),
          };
          appendOrderToStorage(order);
          refreshDashboard();
          setSubmitNotice('発注を送信しました。右の「進行中」に反映され、工場画面でも新着として表示されます。');
          window.setTimeout(() => setSubmitNotice(null), 6000);
        },
        [
          preferredDate,
          timeSlot,
          vehicleType,
          quantityM3,
          traderName,
          contractorName,
          mixText,
          siteName,
          siteAddress,
          sitePhone,
          refreshDashboard,
        ],
      );

      const btnBase =
        'min-h-[56px] flex-1 rounded-xl border-2 px-4 py-3.5 text-base font-bold transition-colors';

      return (
        <div className="min-h-[100dvh] w-full overflow-x-hidden bg-slate-100 pt-11 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
          <header className="border-b border-slate-200 bg-white shadow-sm">
            <div className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:px-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <a href="/" className="inline-flex w-fit items-center rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" aria-label="CONCRETE LINK トップへ戻る">
                    <img src="src/assets/concrete-link-logo.svg" alt="CONCRETE LINK" className="h-10 w-auto" />
                  </a>
                  <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">管理者</p>
                </div>
              </div>
            </div>
          </header>

          <main id="dispatch-dashboard" className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
            <div className="grid min-w-0 gap-8 lg:grid-cols-2 lg:items-start">
              <div className="min-w-0 overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-md sm:p-6">
                <h2 className="text-sm font-black uppercase tracking-wider text-indigo-700">新規発注</h2>
                <p className="mt-1 text-xs text-slate-500">
                  数量・商社・業者・電話番号は必須です。現場名は未入力のとき、現場住所と同じ内容として扱われます。
                </p>
                <form className="mt-6 flex min-w-0 flex-col gap-10 overflow-hidden" onSubmit={handleSubmit}>
              <div className="flex min-w-0 max-w-full flex-col gap-3 overflow-hidden">
                <Label htmlFor="preferred-date">希望日</Label>
                <div className="w-full min-w-0 max-w-full overflow-hidden">
                  <input
                    id="preferred-date"
                    type="date"
                    value={preferredDate}
                    onChange={(e) => setPreferredDate(e.target.value)}
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
                <Label htmlFor="time-slot">希望時刻（8:00〜17:00・30分刻み）</Label>
                <p className="text-xs leading-relaxed text-slate-500">
                  到着・打設の目安時刻を、30分単位で指定します。
                </p>
                <select
                  id="time-slot"
                  value={timeSlot}
                  onChange={(e) => setTimeSlot(e.target.value)}
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
                    <option key={s.value} value={s.value}>
                      {s.label}
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
                  自由入力。発注時は空欄にできません（工場へ必ず伝わるようにします）。
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

              <AutocompleteField
                id="trader-name"
                labelText="商社"
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
                <Label htmlFor="site-name">現場名</Label>
                <p className="text-xs leading-relaxed text-slate-500">
                  物件名・現場の通称など。空欄のまま送信した場合は、下の「現場住所」の内容が現場名として保存されます。
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
                <Label htmlFor="mix-spec">配合（JIS規格など）</Label>
                <p className="text-xs leading-relaxed text-slate-500">自由入力のほか、下のショートカットから選べます。</p>
                <input
                  id="mix-spec"
                  type="text"
                  inputMode="text"
                  autoComplete="off"
                  placeholder="例：21-12-20BB"
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
                <Label htmlFor="site-address">現場住所</Label>
                <textarea
                  id="site-address"
                  rows={4}
                  placeholder="市区町村・番地・現場名など"
                  value={siteAddress}
                  onChange={(e) => setSiteAddress(e.target.value)}
                  className="min-h-[120px] w-full resize-y rounded-xl border-2 border-slate-200 px-4 py-3 text-base leading-relaxed placeholder:text-slate-400 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300"
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
                  className="rounded-xl border-2 border-red-400 bg-red-50 px-4 py-3 text-sm font-bold text-red-700 shadow-sm"
                  role="alert"
                >
                  {submitError}
                </p>
              ) : null}
              <button
                type="submit"
                className="mt-2 flex w-full min-h-[56px] items-center justify-center rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-4 text-base font-bold text-white shadow-lg shadow-orange-500/30 transition hover:from-orange-600 hover:to-amber-600 active:scale-[0.99]"
              >
                発注する（工場へ送信）
              </button>
              {submitNotice && (
                <p
                  className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-900"
                  role="status"
                >
                  {submitNotice}
                </p>
              )}
            </form>
              </div>

              <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md sm:p-5 lg:sticky lg:top-12">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-black text-slate-900">進行中の注文ステータス</h2>
                    {inProgressSectionOpen ? (
                      <p className="mt-1.5 text-xs leading-relaxed text-slate-400">
                        工場画面の受注／拒否／保留がここに反映されます。チャットは別タブの工場画面とも共有されます。
                      </p>
                    ) : null}
                  </div>
                  <button
                    type="button"
                    onClick={() => setInProgressSectionOpen((v) => !v)}
                    aria-expanded={inProgressSectionOpen}
                    className="shrink-0 rounded-xl border-2 border-slate-200 bg-slate-50 px-3 py-2 text-sm font-black text-slate-700 shadow-sm transition hover:bg-white"
                  >
                    {inProgressSectionOpen ? '▲ 縮小' : '▼ 表示'}
                  </button>
                </div>
                {inProgressSectionOpen ? (
                  <div className="mt-4 max-h-[min(70vh,32rem)] space-y-5 overflow-y-auto pr-1">
                    {dashboardOrders.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                        まだ注文がありません。左のフォームから発注してください。
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
                              onSendMasterChat={handleSendMasterChat}
                              onAllowStatusReset={handleAllowStatusReset}
                              refreshDashboard={refreshDashboard}
                            />
                          ))
                        )}
                      </>
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setInProgressSectionOpen(true)}
                    className="mt-4 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-sm font-bold text-slate-700 transition hover:bg-slate-100"
                  >
                    {dashboardOrders.length === 0
                      ? '進行中の注文はありません'
                      : `現在${dashboardOrders.length}件の注文あり — タップで一覧を表示`}
                  </button>
                )}
              </aside>
            </div>

            <section className="mt-12 rounded-2xl border border-slate-200 bg-white p-5 shadow-md sm:p-6">
              <h2 className="text-base font-bold text-slate-900">過去の注文履歴からコピー</h2>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">
                タップすると左の発注フォームに内容が反映されます（プロトタイプ）。
              </p>
              <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold leading-relaxed text-amber-950">
                ※ログインIDに基づく自身の履歴のみ表示されます（本番では認証・権限で絞り込みます）。
              </p>
              <ul className="mt-5 flex flex-col gap-4">
                {ORDER_HISTORY_DUMMY.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => applyHistory(item)}
                      className="w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-4 py-4 text-left transition hover:border-slate-300 hover:bg-white active:bg-slate-100"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-sm font-bold text-slate-900">{item.date}</span>
                        <span className="shrink-0 rounded-lg bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-200">
                          {item.slot}
                        </span>
                      </div>
                      <p className="mt-2 text-xs font-medium text-slate-600">
                        {item.traderName && <span className="block truncate">{item.traderName}</span>}
                        {item.contractorName && <span className="mt-0.5 block truncate">{item.contractorName}</span>}
                        <span className="mt-1 block">
                          {item.vehicle} · {item.quantityM3 ?? '—'}m³ · {item.mix}
                        </span>
                      </p>
                      <p className="mt-2 line-clamp-2 text-sm leading-snug text-slate-700">{item.address}</p>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          </main>
        </div>
      );
    }

    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<App />);