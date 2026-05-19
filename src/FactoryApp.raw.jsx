const { useState, useCallback, useEffect, useMemo, useRef } = React;

    const STORAGE_ORDERS_KEY = 'haisha_dispatch_orders_v1';
    const STORAGE_FACTORY_NOTIFIED_HEAD_KEY = 'haisha_factory_last_notified_order_id_v1';
    const STORAGE_SCHEDULE_KEY = 'haisha_factory_schedule_by_date_v1';
    const STORAGE_ORDER_CHAT_KEY = 'haisha_order_chat_threads_v1';
    const HAISHA_LS_SYNC = 'haisha-ls-sync';

    const FACTORY_SITE_ID = 'FACTORY_A';
    const FACTORY_SITE_NAME = 'A工場';

    function broadcastLocalStorageUpdate(key) {
      try {
        window.dispatchEvent(new CustomEvent(HAISHA_LS_SYNC, { detail: { key: String(key) } }));
      } catch {
        /* ignore */
      }
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

    function FactoryOrderChatPanel({ orderId, messages, onAfterSend }) {
      const [txt, setTxt] = useState('');
      if (!orderId) return null;
      const list = Array.isArray(messages) ? messages : [];
      const send = () => {
        const t = txt.trim();
        if (!t) return;
        appendOrderChatMessage(orderId, 'factory', t);
        setTxt('');
        if (typeof onAfterSend === 'function') onAfterSend();
      };
      return (
        <div className="mt-2 rounded-lg border-2 border-slate-300 bg-[#e5ddd5] p-2 shadow-inner">
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-700">質疑応答（チャット）</p>
          <p className="mt-0.5 text-[9px] font-bold text-slate-500">マスター画面と同じ履歴を共有します</p>
          <ul
            className="mt-1.5 max-h-36 min-h-[4rem] space-y-1.5 overflow-y-auto rounded-md bg-[#e5ddd5]/90 px-1 py-1.5"
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
                const isMaster = m.from === 'master';
                return (
                  <li key={m.id} className={'flex ' + (isMaster ? 'justify-start' : 'justify-end')}>
                    <div
                      className={
                        'max-w-[90%] rounded-2xl px-3 py-2 text-sm shadow-sm ' +
                        (isMaster
                          ? 'rounded-bl-md border border-slate-200 bg-white text-slate-900'
                          : 'rounded-br-md border border-emerald-300 bg-[#dcf8c6] text-slate-900')
                      }
                    >
                      <p className="whitespace-pre-wrap break-words leading-snug">{m.body}</p>
                      <p className="mt-1 text-[10px] font-bold text-slate-500">
                        {isMaster ? 'マスター' : '工場（この端末）'} ·{' '}
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
                className="min-h-[48px] min-w-0 flex-1 rounded-full border-2 border-slate-300 bg-white px-4 text-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-200"
              />
              <button
                type="button"
                onClick={send}
                className="shrink-0 rounded-full bg-emerald-600 px-5 py-2 text-sm font-black text-white shadow hover:bg-emerald-700"
              >
                返信
              </button>
            </div>
          </div>
        </div>
      );
    }

    function pad2(n) {
      return String(n).padStart(2, '0');
    }

    function todayLocalISO() {
      const d = new Date();
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    }

    /** 今日を含む31日分の type=date 用 min/max（今日〜30日先） */
    function getScheduleDateBoundsISO() {
      const start = todayLocalISO();
      const [y0, m0, d0] = start.split('-').map(Number);
      const base = new Date(y0, m0 - 1, d0);
      const end = new Date(base);
      end.setDate(base.getDate() + 30);
      const maxIso = `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`;
      return { minIso: start, maxIso: maxIso };
    }

    const SCHEDULE_BLOCK_IDS = ['am1', 'am2', 'pm1', 'pm2'];

    const SCHEDULE_BLOCKS = [
      { id: 'am1', label: '8:00 ～ 10:30', shortLabel: '午前 ①' },
      { id: 'am2', label: '10:30 ～ 12:00', shortLabel: '午前 ②' },
      { id: 'pm1', label: '13:00 ～ 13:59', shortLabel: '午後 ①' },
      { id: 'pm2', label: '14:00 ～ 15:30', shortLabel: '午後 ②' },
    ];

    function defaultEmptyDayBlocks() {
      const o = {};
      for (const id of SCHEDULE_BLOCK_IDS) {
        o[id] = { large: 'available', small: 'available' };
      }
      return o;
    }

    /** 1日分：4ブロック ×（大型・小型）。旧30分刻みデータは読み捨てて初期化する */
    function normalizeDayBlockSchedule(maybe) {
      const defaults = defaultEmptyDayBlocks();
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

    function normalizeFullSchedule(raw) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
      const out = {};
      for (const [dateKey, dayMap] of Object.entries(raw)) {
        if (typeof dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
          out[dateKey] = normalizeDayBlockSchedule(dayMap);
        }
      }
      return out;
    }

    function readFullSchedule() {
      try {
        const raw = localStorage.getItem(STORAGE_SCHEDULE_KEY);
        if (!raw) return {};
        const o = JSON.parse(raw);
        return normalizeFullSchedule(o);
      } catch {
        return {};
      }
    }

    function writeFullSchedule(obj) {
      try {
        localStorage.setItem(STORAGE_SCHEDULE_KEY, JSON.stringify(obj));
        broadcastLocalStorageUpdate(STORAGE_SCHEDULE_KEY);
      } catch {
        /* ignore */
      }
    }

    function minuteKeyToLabel(key) {
      const m = parseInt(key, 10);
      if (!Number.isFinite(m)) return key;
      const h = Math.floor(m / 60);
      const mm = m % 60;
      return `${h}:${pad2(mm)}`;
    }

    /** 希望時刻（分）が属する稼働ブロック。午前①は8:00〜10:29、午前②は10:30〜12:00（枠外は null） */
    function getScheduleBlockIdForMinutes(totalMin) {
      if (!Number.isFinite(totalMin)) return null;
      if (totalMin >= 8 * 60 && totalMin <= 10 * 60 + 29) return 'am1';
      if (totalMin >= 10 * 60 + 30 && totalMin <= 12 * 60) return 'am2';
      if (totalMin >= 13 * 60 && totalMin <= 13 * 60 + 59) return 'pm1';
      if (totalMin >= 14 * 60 && totalMin <= 15 * 60 + 30) return 'pm2';
      return null;
    }

    function getOrderVehicleScheduleKey(order) {
      if (order && order.vehicleType === 'small') return 'small';
      if (order && String(order.vehicleLabel || '').trim() === '小型') return 'small';
      return 'large';
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

    function getOrderMinutesForScheduleScan(order) {
      const m =
        order?.scheduleMatchMinutes ??
        order?.timeSlotMinutes ??
        (String(order?.timeSlot || '').match(/^\d+$/) ? parseInt(String(order.timeSlot), 10) : NaN);
      return Number.isFinite(m) ? m : NaN;
    }

    /** 注文の「指定時刻＋車種」が、当該ブロックの当該車種で満車なら拒否理由を返す */
    function computeScheduleAutoRejectReason(order, dayBlocks) {
      const orderMins = getOrderMinutesForScheduleScan(order);
      if (!Number.isFinite(orderMins)) return null;
      const bid = getScheduleBlockIdForMinutes(orderMins);
      if (!bid) return null;
      const vk = getOrderVehicleScheduleKey(order);
      const block = dayBlocks[bid];
      if (!block || block[vk] !== 'full') return null;
      const meta = SCHEDULE_BLOCKS.find((b) => b.id === bid);
      const windowLabel = meta ? meta.label : bid;
      const vj = vk === 'small' ? '小型' : '大型';
      return `【自動】${windowLabel}・${vj}は満車のため受諾不可`;
    }

    function readOrdersFromStorage() {
      try {
        const raw = localStorage.getItem(STORAGE_ORDERS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((item) => item != null && typeof item === 'object' && !Array.isArray(item));
      } catch {
        return [];
      }
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

    function factorySearchHaystack(order) {
      if (!order) return '';
      const parts = [
        order.siteName,
        order.siteAddress,
        order.traderName,
        order.contractorName,
        order.factorySiteName,
        order.acceptedFactoryLabel,
        order.factoryPendingByName,
        FACTORY_SITE_NAME,
      ];
      return parts.map((p) => (p == null ? '' : String(p))).join(' ').toLowerCase();
    }

    function orderMatchesFactorySearch(order, raw) {
      const q = String(raw || '').trim().toLowerCase();
      if (!q) return true;
      return factorySearchHaystack(order).includes(q);
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
            className="min-h-[40px] w-full rounded-lg border border-slate-200/90 bg-white py-2 pl-8 pr-2 text-xs text-slate-800 shadow-inner outline-none ring-0 transition placeholder:text-slate-400 focus:border-slate-300 focus:ring-1 focus:ring-slate-200/80"
            autoComplete="off"
          />
        </div>
      );
    }

    function FactoryStatusMini({ status }) {
      const st = normalizeFactoryResponse(status);
      if (st === FACTORY_RESPONSE.ACCEPTED) {
        return (
          <span className="inline-flex rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-black text-white shadow-sm">
            受注
          </span>
        );
      }
      if (st === FACTORY_RESPONSE.REJECTED) {
        return (
          <span className="inline-flex rounded-full bg-red-600 px-2 py-0.5 text-[10px] font-black text-white shadow-sm">
            拒否
          </span>
        );
      }
      if (st === FACTORY_RESPONSE.PENDING) {
        return (
          <span className="inline-flex rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-black text-amber-950 shadow-sm">
            保留
          </span>
        );
      }
      return (
        <span className="inline-flex rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-600">
          回答待ち
        </span>
      );
    }

    function OrderRequestCard({
      order,
      idx,
      variant,
      onQuantityChange,
      onResponseStatusChange,
      onRequestUnlock,
      chatMessages,
      onFactoryChatSent,
    }) {
      const isToast = variant === 'toast';
      const canEditQty = !isToast && typeof onQuantityChange === 'function';
      const canSetStatus = !isToast && typeof onResponseStatusChange === 'function' && Boolean(order.id);
      const responseStatus = normalizeFactoryResponse(order.factoryResponseStatus);
      const responseLocked = Boolean(order.factoryResponseLocked);
      const terminalLocked =
        responseLocked &&
        (responseStatus === FACTORY_RESPONSE.ACCEPTED || responseStatus === FACTORY_RESPONSE.REJECTED);

      const [qtyDraft, setQtyDraft] = useState(() => {
        const raw = order.quantityM3 ?? order.quantityCube;
        if (raw === undefined || raw === null) return '';
        const s = String(raw).trim();
        return s === '' || s === 'null' ? '' : String(raw);
      });

      const [tick, setTick] = useState(0);
      const pendingLocalStartRef = useRef(null);
      const [expanded, setExpanded] = useState(false);

      useEffect(() => {
        const raw = order.quantityM3 ?? order.quantityCube;
        if (raw === undefined || raw === null) {
          setQtyDraft('');
          return;
        }
        const s = String(raw).trim();
        setQtyDraft(s === '' || s === 'null' ? '' : String(raw));
      }, [order.id, order.quantityM3, order.quantityCube]);

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

      const commitQty = useCallback(() => {
        if (!canEditQty) return;
        const t = qtyDraft.trim();
        onQuantityChange(order.id, t === '' ? null : t);
      }, [canEditQty, onQuantityChange, order.id, qtyDraft]);

      const dateStr = formatPreferredDateJp(order.preferredDate);
      const slotStr = getOrderTimeDisplay(order);
      const vehicle =
        order.vehicleLabel ||
        (order.vehicleType === 'small' ? '小型' : '大型');
      const q = formatQtyForBadge(order);
      const mix = order.mixText?.trim() || '（配合未入力）';
      const siteNm = order.siteName?.trim() || '';
      const addrRaw = order.siteAddress?.trim() || '';
      const addr = addrRaw || '（住所未入力）';
      const siteHeroLine = siteNm || addrRaw || '（未入力）';
      const siteHeaderLine = siteNm || addrRaw || '（住所未入力）';
      const phone = order.sitePhone != null ? String(order.sitePhone).trim() : '';
      const trader = order.traderName?.trim() || '';
      const contractor = order.contractorName?.trim() || '';
      const isLarge = vehicle === '大型';
      const matchDate = order.scheduleMatchDate || order.preferredDate;
      const matchMinRaw =
        order.scheduleMatchMinutes ??
        order.timeSlotMinutes ??
        (String(order.timeSlot || '').match(/^\d+$/) ? parseInt(String(order.timeSlot), 10) : NaN);
      const matchMinOk = Number.isFinite(matchMinRaw);

      const pad = isToast ? 'p-3' : 'p-2 sm:p-2.5';
      const mixSize = isToast ? 'text-sm' : 'text-sm sm:text-base';
      const addrSize = isToast ? 'text-xs' : 'text-xs sm:text-sm';

      const cardFrame =
        isToast
          ? 'rounded-none border-0 bg-white shadow-none '
          : responseStatus === FACTORY_RESPONSE.ACCEPTED
            ? 'rounded-2xl border-[3px] border-emerald-500 bg-white shadow-xl ring-2 ring-emerald-200/80 '
            : responseStatus === FACTORY_RESPONSE.PENDING
              ? 'rounded-2xl border-[3px] border-amber-400 bg-white shadow-xl ring-2 ring-amber-200/90 '
              : 'rounded-2xl border-2 border-slate-800/15 bg-white shadow-xl ' +
                (idx === 0 ? 'ring-4 ring-orange-400 ring-offset-2 ring-offset-slate-50 ' : '');

      const renderDetail = () => (
        <>
          <div className="mb-2 grid min-w-0 grid-cols-3 gap-1 rounded-lg border-2 border-slate-800/25 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-2 shadow sm:gap-1.5">
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">商社</p>
              <p className="mt-0.5 truncate text-sm font-black leading-tight text-white sm:text-base">
                {trader || '（未入力）'}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">業者</p>
              <p className="mt-0.5 truncate text-sm font-black leading-tight text-white sm:text-base">
                {contractor || '（未入力）'}
              </p>
            </div>
            <div className="min-w-0">
              <p className="text-[9px] font-black uppercase tracking-wider text-amber-200/90">現場名</p>
              <p className="mt-0.5 truncate text-sm font-black leading-tight text-amber-50 sm:text-base">{siteHeroLine}</p>
            </div>
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-1.5">
            <span className="inline-flex shrink-0 items-center rounded-md bg-emerald-600 px-2 py-0.5 text-xs font-black text-white shadow sm:text-sm">
              {dateStr}
            </span>
            <div className="flex min-h-[2rem] min-w-0 flex-1 items-center gap-2 rounded-md bg-violet-600 px-2 py-1 shadow-sm">
              <span className="shrink-0 text-[9px] font-black uppercase text-violet-200">希望時刻</span>
              <span className="truncate text-sm font-black leading-none text-white sm:text-base">{slotStr}</span>
            </div>
          </div>
          {matchDate && matchMinOk ? (
            <p className="mt-1 font-mono text-[9px] font-bold leading-tight text-slate-500">
              照合 {String(matchDate).replace(/-/g, '/')} · {formatScheduleScanHint(order)}
            </p>
          ) : null}

          <div className="mt-2 grid min-w-0 grid-cols-2 gap-1.5">
            <span
              className={
                'inline-flex min-h-[2.75rem] w-full min-w-0 items-center justify-center rounded-lg border-2 border-transparent px-1.5 py-2 text-center text-base font-black leading-none text-white shadow-sm ring-1 sm:min-h-[3rem] sm:text-lg ' +
                (isLarge ? 'bg-sky-600 ring-sky-300/70' : 'bg-amber-500 ring-amber-300/70')
              }
            >
              {vehicle}
            </span>
            {canEditQty ? (
              <label className="flex min-h-[2.75rem] w-full min-w-0 flex-col items-center justify-center rounded-lg border-2 border-orange-400 bg-orange-50 px-1.5 py-1 shadow-sm ring-1 ring-orange-200/50 sm:min-h-[3rem]">
                <span className="text-[9px] font-black uppercase leading-none text-orange-900">数量 m³</span>
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={qtyDraft}
                  onChange={(e) => setQtyDraft(e.target.value)}
                  onBlur={commitQty}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      e.currentTarget.blur();
                    }
                  }}
                  className="mt-0.5 w-full min-w-0 border-0 bg-transparent p-0 text-center text-base font-black leading-none text-slate-900 outline-none focus:ring-0 sm:text-lg"
                  aria-label="数量（立方メートル）"
                />
              </label>
            ) : (
              <span
                className={
                  'inline-flex min-h-[2.75rem] w-full min-w-0 items-center justify-center rounded-lg border-2 px-1.5 py-2 text-center text-base font-black leading-none shadow-sm ring-1 sm:min-h-[3rem] sm:text-lg ' +
                  (q.valid
                    ? 'border-orange-400 bg-orange-50 text-orange-950 ring-orange-200/70'
                    : 'border-slate-300 bg-slate-100 text-slate-600 ring-slate-200/80')
                }
              >
                {q.text}
              </span>
            )}
          </div>

          <div className="mt-2 border-t border-slate-200 pt-2">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">配合</p>
            <p className={'mt-0.5 truncate font-mono font-black leading-tight text-slate-900 ' + mixSize}>{mix}</p>
          </div>

          <div className="mt-2 border-t border-slate-200 pt-2">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">現場住所</p>
            <p className={'mt-0.5 line-clamp-3 font-black leading-snug text-slate-900 ' + addrSize}>{addr}</p>
          </div>

          <div className="mt-2 border-t border-slate-200 pt-2">
            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">電話番号</p>
            <p className={'mt-0.5 font-mono font-bold text-slate-900 ' + (isToast ? 'text-xs' : 'text-sm')}>
              {phone || '（未入力）'}
            </p>
          </div>

          {!isToast && order.id ? (
            <FactoryOrderChatPanel orderId={order.id} messages={chatMessages} onAfterSend={onFactoryChatSent} />
          ) : null}

          {canSetStatus && (
            <div className="mt-3 border-t border-slate-200 pt-2">
              <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">注文への回答</p>
              <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  disabled={terminalLocked}
                  onClick={() => !terminalLocked && onResponseStatusChange(order.id, FACTORY_RESPONSE.ACCEPTED)}
                  aria-pressed={responseStatus === FACTORY_RESPONSE.ACCEPTED}
                  className={
                    'min-h-[40px] rounded-lg border-2 px-1.5 py-2 text-xs font-black shadow-sm transition sm:min-h-[42px] sm:text-sm ' +
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
                    'min-h-[40px] rounded-lg border-2 px-1.5 py-2 text-xs font-black shadow-sm transition sm:min-h-[42px] sm:text-sm ' +
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
                    'min-h-[40px] rounded-lg border-2 px-1.5 py-2 text-xs font-black shadow-sm transition sm:min-h-[42px] sm:text-sm ' +
                    (terminalLocked ? 'cursor-not-allowed opacity-45 ' : '') +
                    (responseStatus === FACTORY_RESPONSE.PENDING
                      ? 'border-amber-500 bg-amber-400 text-amber-950 ring-1 ring-amber-200'
                      : 'border-amber-400 bg-amber-50 text-amber-950 hover:bg-amber-100 active:scale-[0.99]')
                  }
                >
                  保留
                </button>
              </div>
              {terminalLocked ? (
                <div className="mt-2 space-y-2 rounded-lg border-2 border-amber-300 bg-amber-50/95 px-2 py-2">
                  <p className="text-xs font-black text-amber-950">マスターの許可が必要です</p>
                  <p className="text-[10px] font-bold leading-relaxed text-amber-900/90">
                    受注または拒否を確定したあとは、工場側からは変更できません。訂正が必要な場合はマスターが「ステータス再設定許可」で解除します。
                  </p>
                  {!order.factoryUnlockRequested && typeof onRequestUnlock === 'function' ? (
                    <button
                      type="button"
                      onClick={() => onRequestUnlock(order.id)}
                      className="w-full rounded-lg border-2 border-slate-800 bg-white py-2 text-xs font-black text-slate-900 shadow hover:bg-slate-50"
                    >
                      マスターへロック解除を依頼
                    </button>
                  ) : null}
                  {order.factoryUnlockRequested ? (
                    <p className="text-center text-[10px] font-bold text-slate-700">
                      マスターへ解除依頼済みです。承認をお待ちください。
                    </p>
                  ) : null}
                </div>
              ) : null}
              {responseStatus === FACTORY_RESPONSE.PENDING && pendingCountdown ? (
                <div
                  className={
                    'mt-2 rounded-lg border-2 px-2 py-2 text-center ' +
                    (pendingCountdown.expired
                      ? 'border-red-600 bg-red-50 shadow-inner'
                      : 'border-amber-400 bg-amber-50/95')
                  }
                  role="status"
                >
                  <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">保留カウントダウン</p>
                  <p
                    className={
                      'mt-0.5 font-mono text-2xl font-black tabular-nums tracking-tight sm:text-3xl ' +
                      (pendingCountdown.expired ? 'text-red-600 animate-pulse' : 'text-amber-950')
                    }
                  >
                    {pendingCountdown.expired ? '時間切れ' : pendingCountdown.label}
                  </p>
                  {pendingCountdown.expired ? (
                    <p className="mt-1 text-[10px] font-bold text-red-700">5分経過しました。対応を確定するには受注・拒否を選んでください</p>
                  ) : (
                    <p className="mt-0.5 text-[10px] font-bold text-amber-900/85">00:00 で時間切れ表示に切り替わります</p>
                  )}
                </div>
              ) : null}
            </div>
          )}

          {!isToast && order.createdAt ? (
            <time
              className="mt-3 block border-t border-slate-100 pt-2 text-[10px] font-bold text-slate-400"
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
        ? 'rounded-xl border-2 border-red-600/90 bg-red-50/30 opacity-[0.72] shadow-sm ring-1 ring-red-200/60 overflow-hidden'
        : cardFrame.trimEnd() + ' overflow-hidden';

      const headerBtnClass =
        'flex w-full min-h-[44px] items-center gap-2 px-2 py-2 text-left text-sm transition sm:min-h-[48px] sm:gap-2.5 sm:px-3 ' +
        (collapsedRejected
          ? 'bg-red-50/40 hover:bg-red-50/80 active:bg-red-50'
          : 'border-b border-slate-100 bg-white hover:bg-slate-50/90 active:bg-slate-50');

      return (
        <article className={outerArticleClass}>
          <button
            type="button"
            className={headerBtnClass}
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-black text-slate-500 sm:text-xs">
                {dateStr} · {slotStr} · {vehicle} · <span className="font-mono text-slate-800">{q.text}</span>
              </p>
              <p className="mt-0.5 truncate text-sm font-bold text-slate-800">{siteHeaderLine}</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <FactoryStatusMini status={order.factoryResponseStatus} />
              </div>
            </div>
            {idx === 0 ? (
              <span className="shrink-0 rounded bg-orange-500 px-1.5 py-0.5 text-[9px] font-black text-white">NEW</span>
            ) : (
              <span className="w-6 shrink-0" aria-hidden="true" />
            )}
            <span className="shrink-0 rounded-lg border border-slate-200/90 bg-slate-50 px-2 py-1 text-xs font-black text-slate-600 shadow-inner">
              {expanded ? '▲' : '▼'}
            </span>
          </button>
          <div
            className="grid transition-[grid-template-rows] duration-300 ease-out"
            style={{ gridTemplateRows: expanded ? '1fr' : '0fr' }}
          >
            <div className="min-h-0 overflow-hidden">
              <div className={pad}>{renderDetail()}</div>
            </div>
          </div>
        </article>
      );
    }


    function playPiloonChime() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = new AC();
      const done = () => {
        try {
          ctx.close();
        } catch {
          /* ignore */
        }
      };
      ctx
        .resume()
        .then(() => {
          const t0 = ctx.currentTime;
          const osc = ctx.createOscillator();
          const g = ctx.createGain();
          osc.type = 'sine';
          osc.connect(g);
          g.connect(ctx.destination);
          osc.frequency.setValueAtTime(880, t0);
          osc.frequency.exponentialRampToValueAtTime(1318, t0 + 0.2);
          g.gain.setValueAtTime(0.0001, t0);
          g.gain.exponentialRampToValueAtTime(0.1, t0 + 0.035);
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.42);
          osc.start(t0);
          osc.stop(t0 + 0.42);
          osc.onended = done;
        })
        .catch(done);
    }

    function DispatchInbox({
      orders,
      onQuantityChange,
      onResponseStatusChange,
      onRequestUnlock,
      chatThreads,
      onFactoryChatSent,
    }) {
      const [searchQuery, setSearchQuery] = useState('');
      const filteredOrders = useMemo(
        () => orders.filter((o) => orderMatchesFactorySearch(o, searchQuery)),
        [orders, searchQuery]
      );

      if (!orders.length) {
        return (
          <aside
            className="flex h-full min-h-0 flex-col rounded-lg border-2 border-dashed border-slate-300 bg-white p-2"
            aria-label="新着の配車依頼"
          >
            <h2 className="text-sm font-black text-slate-800">新着の配車依頼</h2>
            <p className="mt-1 text-xs font-medium leading-snug text-slate-500">
              注文画面から発注されると、ここにカード形式で表示されます（別タブ連携）。
            </p>
          </aside>
        );
      }
      return (
        <aside
          className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border-2 border-amber-500/90 bg-gradient-to-b from-amber-50 to-orange-50/80 p-2 shadow-sm"
          aria-label="新着の配車依頼一覧"
        >
          <div className="shrink-0 border-b border-amber-300/80 pb-2">
            <h2 className="text-sm font-black tracking-tight text-amber-950 sm:text-base">新着の配車依頼</h2>
            <p className="mt-0.5 text-[10px] font-bold text-amber-900/80">localStorage · 別タブと即時同期</p>
          </div>
          <div className="shrink-0 pt-2">
            <OrderListSearchInput id="factory-inbox-search" value={searchQuery} onChange={setSearchQuery} />
          </div>
          <ul className="mt-2 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto overflow-x-hidden pr-0.5">
            {filteredOrders.length === 0 ? (
              <li className="list-none">
                <p className="rounded-lg border border-dashed border-amber-200/90 bg-white/70 px-2 py-4 text-center text-xs font-bold text-amber-900/80">
                  該当する依頼がありません
                </p>
              </li>
            ) : (
              filteredOrders.map((o) => {
                const globalIdx = orders.findIndex((x) => x.id === o.id);
                const idx = globalIdx >= 0 ? globalIdx : orders.length;
                return (
                <li key={o.id ?? `idx-${idx}`}>
                  <OrderRequestCard
                    order={o}
                    idx={idx}
                    onQuantityChange={onQuantityChange}
                    onResponseStatusChange={onResponseStatusChange}
                    onRequestUnlock={onRequestUnlock}
                    chatMessages={chatThreads[o.id]}
                    onFactoryChatSent={onFactoryChatSent}
                  />
                </li>
              );
              })
            )}
          </ul>
        </aside>
      );
    }

    function NewOrderToast({ order, onDismiss }) {
      if (!order) return null;
      return (
        <div
          className="fixed bottom-4 left-4 right-4 z-[90] mx-auto max-w-md sm:left-auto sm:right-6 sm:mx-0 lg:bottom-8 lg:right-8 lg:max-w-lg"
          role="alert"
        >
          <div className="overflow-hidden rounded-2xl border-2 border-orange-600 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-2 bg-orange-600 px-4 py-2.5">
              <p className="text-sm font-black text-white sm:text-base">新規注文を受信</p>
              <button
                type="button"
                onClick={onDismiss}
                className="shrink-0 rounded-lg bg-white/20 px-2.5 py-1 text-xs font-black text-white hover:bg-white/30"
              >
                閉じる
              </button>
            </div>
            <OrderRequestCard order={order} idx={0} variant="toast" />
          </div>
        </div>
      );
    }

    function VehicleToggleRow({ kindLabel, isFull, onPick }) {
      const free = !isFull;
      return (
        <div className="flex min-w-0 flex-col gap-1.5 rounded-xl border border-slate-200/90 bg-white px-2 py-2 shadow-inner sm:gap-2 sm:px-2.5 sm:py-2.5">
          <span className="min-w-0 break-words text-xs font-black leading-tight text-slate-800 sm:text-sm">{kindLabel}</span>
          <div className="grid min-w-0 w-full grid-cols-2 gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={() => onPick('available')}
              aria-pressed={free}
              className={
                'min-h-[40px] w-full min-w-0 rounded-lg border-2 px-1 py-1.5 text-center text-xs font-black leading-tight transition sm:min-h-[42px] sm:px-2 sm:text-sm ' +
                (free
                  ? 'border-sky-600 bg-sky-600 text-white shadow-sm ring-1 ring-sky-200/80'
                  : 'border-slate-200 bg-slate-50 text-slate-600 hover:border-sky-400 hover:bg-sky-50')
              }
            >
              ○ 空き
            </button>
            <button
              type="button"
              onClick={() => onPick('full')}
              aria-pressed={isFull}
              className={
                'min-h-[40px] w-full min-w-0 rounded-lg border-2 px-1 py-1.5 text-center text-xs font-black leading-tight transition sm:min-h-[42px] sm:px-2 sm:text-sm ' +
                (isFull
                  ? 'border-orange-700 bg-gradient-to-b from-orange-600 to-red-600 text-white shadow-sm ring-1 ring-orange-200/80'
                  : 'border-slate-200 bg-white text-slate-600 hover:border-orange-400 hover:bg-orange-50')
              }
            >
              × 満車
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
          className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border-2 border-slate-200 bg-gradient-to-b from-white to-slate-50/90 p-2 shadow ring-1 ring-slate-200/60"
          aria-label={`${blockMeta.shortLabel} ${blockMeta.label}`}
        >
          <div className="min-w-0 border-b border-slate-200 pb-1.5">
            <p className="text-[9px] font-black uppercase tracking-wider text-slate-500">{blockMeta.shortLabel}</p>
            <p className="mt-0.5 break-words text-xs font-black leading-snug text-slate-900 sm:text-sm">{blockMeta.label}</p>
          </div>
          <div className="mt-2 flex min-h-0 min-w-0 flex-1 flex-col justify-center gap-1.5">
            <VehicleToggleRow
              kindLabel="大型車"
              isFull={largeFull}
              onPick={(next) => onToggleVehicle(dateStr, blockMeta.id, 'large', next)}
            />
            <VehicleToggleRow
              kindLabel="小型車"
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
        'min-h-[40px] rounded-lg border-2 border-red-800 bg-gradient-to-b from-orange-600 to-red-600 px-2 py-2 text-xs font-black text-white shadow-sm transition hover:from-orange-500 hover:to-red-500 active:scale-[0.99] sm:min-h-[42px] sm:text-sm';
      const clearBtn =
        'min-h-[40px] rounded-lg border-[3px] border-teal-600 bg-gradient-to-b from-emerald-500 to-teal-600 px-2 py-2 text-xs font-black text-white shadow-sm ring-1 ring-emerald-200/90 transition hover:from-emerald-400 hover:to-teal-500 active:scale-[0.99] sm:min-h-[42px] sm:text-sm';
      const typeBtn =
        'min-h-[38px] rounded-lg border-2 border-slate-700 bg-slate-800 px-2 py-2 text-[10px] font-black text-white shadow-sm transition hover:bg-slate-900 active:scale-[0.99] sm:text-xs';

      return (
        <div
          className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm"
          role="group"
          aria-label={`スケジュール一括操作（${selectedDate}）`}
        >
          <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">一括操作（選択中の日）</p>
          <div className="mt-2 grid grid-cols-2 gap-1.5 lg:grid-cols-4">
            <button type="button" className={fullBtn} onClick={onFullDay}>
              終日 満車
              <span className="mt-0.5 block text-[10px] font-bold opacity-90">4枠 · 大型・小型すべて ×</span>
            </button>
            <button type="button" className={fullBtn} onClick={onMorning}>
              午前 満車
              <span className="mt-0.5 block text-[10px] font-bold opacity-90">8:00〜12:00相当（午前2枠）</span>
            </button>
            <button type="button" className={fullBtn} onClick={onAfternoon}>
              午後 満車
              <span className="mt-0.5 block text-[10px] font-bold opacity-90">13:00〜15:30（午後2枠）</span>
            </button>
            <button type="button" className={clearBtn} onClick={onClearAll}>
              一括 クリア
              <span className="mt-0.5 block text-[10px] font-bold text-emerald-50">全日 · すべて ○</span>
            </button>
          </div>
          <p className="mt-2 text-[9px] font-black uppercase tracking-wider text-slate-500">車種のみ（終日・4枠）</p>
          <div className="mt-1 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            <button type="button" className={typeBtn} onClick={onFullDayLargeOnly}>
              大型のみ終日満車（全枠 ×）
            </button>
            <button type="button" className={typeBtn} onClick={onFullDaySmallOnly}>
              小型のみ終日満車（全枠 ×）
            </button>
          </div>
        </div>
      );
    }

    function App() {
      const dateBounds = useMemo(() => getScheduleDateBoundsISO(), []);
      const [selectedDate, setSelectedDate] = useState(() => {
        const t = todayLocalISO();
        const { minIso, maxIso } = getScheduleDateBoundsISO();
        if (t < minIso) return minIso;
        if (t > maxIso) return maxIso;
        return t;
      });
      const [scheduleByDate, setScheduleByDate] = useState(() => readFullSchedule());
      const [orders, setOrders] = useState([]);
      const [toastOrder, setToastOrder] = useState(null);
      const [chatThreads, setChatThreads] = useState(() => readOrderChatThreads());
      const refreshChatThreads = useCallback(() => {
        setChatThreads(readOrderChatThreads());
      }, []);

      const applyIncomingOrders = useCallback((list, options) => {
        const playSound = options && options.playSound;
        setOrders(list);
        const head = list[0] ?? null;
        let notifiedId = null;
        try {
          notifiedId = localStorage.getItem(STORAGE_FACTORY_NOTIFIED_HEAD_KEY);
        } catch {
          notifiedId = null;
        }
        if (head && head.id && head.id !== notifiedId && playSound) {
          playPiloonChime();
          setToastOrder(head);
          try {
            localStorage.setItem(STORAGE_FACTORY_NOTIFIED_HEAD_KEY, head.id);
          } catch {
            /* ignore */
          }
        }
      }, []);

      const persistOrders = useCallback((next) => {
        try {
          localStorage.setItem(STORAGE_ORDERS_KEY, JSON.stringify(next));
          broadcastLocalStorageUpdate(STORAGE_ORDERS_KEY);
        } catch {
          /* ignore */
        }
      }, []);

      const applyScheduleAutoRejectionsIfNeeded = useCallback(() => {
        const schedule = readFullSchedule();
        const rawOrders = readOrdersFromStorage();
        let changed = false;
        const chats = [];
        const next = rawOrders.map((o) => {
          if (!o || !o.id) return o;
          if (o.factoryResponseStatus || o.scheduleAutoChecked) return o;
          const date = o.scheduleMatchDate || o.preferredDate;
          if (!date || typeof date !== 'string') {
            changed = true;
            return { ...o, scheduleAutoChecked: true };
          }
          const slots = normalizeDayBlockSchedule(schedule[date]);
          const reason = computeScheduleAutoRejectReason(o, slots);
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
            factorySiteName: FACTORY_SITE_NAME,
            factorySiteId: FACTORY_SITE_ID,
            scheduleAutoChecked: true,
            acceptedFactoryLabel: undefined,
            factoryPendingStartedAt: undefined,
            factoryPendingByName: undefined,
            factoryUnlockRequested: false,
          };
        });
        if (!changed) return false;
        persistOrders(next);
        for (const c of chats) {
          appendOrderChatMessage(c.id, 'system', c.body);
        }
        return true;
      }, [persistOrders]);

      const syncFromStorage = useCallback(
        (options) => {
          applyIncomingOrders(readOrdersFromStorage(), options);
          const autoChanged = applyScheduleAutoRejectionsIfNeeded();
          if (autoChanged) {
            applyIncomingOrders(readOrdersFromStorage(), { playSound: false });
            refreshChatThreads();
          }
        },
        [applyIncomingOrders, applyScheduleAutoRejectionsIfNeeded, refreshChatThreads],
      );

      const runScheduleAutoPipeline = useCallback(() => {
        const changed = applyScheduleAutoRejectionsIfNeeded();
        if (changed) {
          applyIncomingOrders(readOrdersFromStorage(), { playSound: false });
          refreshChatThreads();
        }
      }, [applyScheduleAutoRejectionsIfNeeded, applyIncomingOrders, refreshChatThreads]);

      useEffect(() => {
        syncFromStorage({ playSound: true });
        refreshChatThreads();
      }, [syncFromStorage, refreshChatThreads]);

      useEffect(() => {
        const onStorage = (e) => {
          if (e.key === STORAGE_ORDERS_KEY || e.key === null) {
            syncFromStorage({ playSound: true });
          }
          if (e.key === STORAGE_ORDER_CHAT_KEY || e.key === null) {
            refreshChatThreads();
          }
          if (e.key === STORAGE_SCHEDULE_KEY || e.key === null) {
            setScheduleByDate(readFullSchedule());
            window.queueMicrotask(() => runScheduleAutoPipeline());
          }
        };
        const onLs = (e) => {
          const k = e && e.detail ? e.detail.key : undefined;
          if (k === undefined) {
            syncFromStorage({ playSound: true });
            refreshChatThreads();
            setScheduleByDate(readFullSchedule());
            window.queueMicrotask(() => runScheduleAutoPipeline());
            return;
          }
          if (k === STORAGE_ORDERS_KEY) syncFromStorage({ playSound: true });
          if (k === STORAGE_ORDER_CHAT_KEY) refreshChatThreads();
          if (k === STORAGE_SCHEDULE_KEY) {
            setScheduleByDate(readFullSchedule());
            window.queueMicrotask(() => runScheduleAutoPipeline());
          }
        };
        window.addEventListener('storage', onStorage);
        window.addEventListener(HAISHA_LS_SYNC, onLs);
        const poll = window.setInterval(() => {
          refreshChatThreads();
        }, 1600);
        return () => {
          window.removeEventListener('storage', onStorage);
          window.removeEventListener(HAISHA_LS_SYNC, onLs);
          window.clearInterval(poll);
        };
      }, [syncFromStorage, refreshChatThreads, runScheduleAutoPipeline]);

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
            writeFullSchedule(nextAll);
            return nextAll;
          });
          window.queueMicrotask(() => runScheduleAutoPipeline());
        },
        [runScheduleAutoPipeline],
      );

      const handleQuantityChange = useCallback(
        (orderId, quantityM3) => {
          if (!orderId) return;
          setOrders((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const next = list.map((o) => (o && o.id === orderId ? { ...o, quantityM3 } : o));
            persistOrders(next);
            return next;
          });
        },
        [persistOrders],
      );

      const handleResponseStatusChange = useCallback(
        (orderId, status) => {
          if (!orderId) return;
          const nextStatus = normalizeFactoryResponse(status);
          if (!nextStatus) return;
          setOrders((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const target = list.find((x) => x && x.id === orderId);
            if (!target) return prev;
            const cur = normalizeFactoryResponse(target.factoryResponseStatus);
            const locked = Boolean(target.factoryResponseLocked);
            if (locked && (cur === FACTORY_RESPONSE.ACCEPTED || cur === FACTORY_RESPONSE.REJECTED)) {
              return prev;
            }
            const next = list.map((o) => {
              if (!o || o.id !== orderId) return o;
              const patch = { factoryResponseStatus: nextStatus };
              if (nextStatus === FACTORY_RESPONSE.PENDING) {
                patch.factoryPendingStartedAt = new Date().toISOString();
                patch.factoryPendingByName = FACTORY_SITE_NAME;
                patch.factoryResponseLocked = false;
              } else {
                patch.factoryPendingStartedAt = undefined;
                patch.factoryPendingByName = undefined;
              }
              if (nextStatus === FACTORY_RESPONSE.ACCEPTED) {
                patch.acceptedFactoryLabel = o.acceptedFactoryLabel || `受注工場：${FACTORY_SITE_NAME}`;
                patch.factorySiteName = FACTORY_SITE_NAME;
                patch.factorySiteId = FACTORY_SITE_ID;
                patch.factoryResponseLocked = true;
                patch.factoryUnlockRequested = false;
                const qRaw = o.quantityM3 ?? o.quantityCube;
                patch.confirmedQuantityM3 =
                  qRaw !== undefined && qRaw !== null && String(qRaw).trim() !== '' ? qRaw : null;
                patch.confirmedMixText = o.mixText?.trim() || '';
              }
              if (nextStatus === FACTORY_RESPONSE.REJECTED) {
                patch.acceptedFactoryLabel = undefined;
                patch.factorySiteName = FACTORY_SITE_NAME;
                patch.factorySiteId = FACTORY_SITE_ID;
                patch.factoryResponseLocked = true;
                patch.factoryUnlockRequested = false;
              }
              return { ...o, ...patch };
            });
            persistOrders(next);
            return next;
          });
          if (nextStatus === FACTORY_RESPONSE.PENDING) {
            appendOrderChatMessage(
              orderId,
              'system',
              `【保留】${FACTORY_SITE_NAME}が保留にしました。マスター画面で5分のカウントダウンが同期表示されます。`,
            );
            refreshChatThreads();
          }
        },
        [persistOrders, refreshChatThreads],
      );

      const handleFactoryUnlockRequest = useCallback(
        (orderId) => {
          if (!orderId) return;
          setOrders((prev) => {
            const list = Array.isArray(prev) ? prev : [];
            const next = list.map((o) =>
              o && o.id === orderId ? { ...o, factoryUnlockRequested: true } : o,
            );
            persistOrders(next);
            return next;
          });
          appendOrderChatMessage(
            orderId,
            'system',
            `【依頼】${FACTORY_SITE_NAME}からステータス変更のロック解除を依頼されました。マスターが「ステータス再設定許可」で解除できます。`,
          );
          refreshChatThreads();
        },
        [persistOrders, refreshChatThreads],
      );

      const handleBulkFullDay = useCallback(() => {
        setScheduleByDate((prev) => {
          const safePrev = normalizeFullSchedule(prev);
          const nextDay = defaultEmptyDayBlocks();
          for (const id of SCHEDULE_BLOCK_IDS) {
            nextDay[id] = { large: 'full', small: 'full' };
          }
          const nextAll = { ...safePrev, [selectedDate]: nextDay };
          writeFullSchedule(nextAll);
          return nextAll;
        });
        window.queueMicrotask(() => runScheduleAutoPipeline());
      }, [selectedDate, runScheduleAutoPipeline]);

      const handleBulkMorning = useCallback(() => {
        setScheduleByDate((prev) => {
          const safePrev = normalizeFullSchedule(prev);
          const base = normalizeDayBlockSchedule(safePrev[selectedDate]);
          const nextDay = { ...base };
          for (const id of ['am1', 'am2']) {
            nextDay[id] = { large: 'full', small: 'full' };
          }
          const nextAll = { ...safePrev, [selectedDate]: nextDay };
          writeFullSchedule(nextAll);
          return nextAll;
        });
        window.queueMicrotask(() => runScheduleAutoPipeline());
      }, [selectedDate, runScheduleAutoPipeline]);

      const handleBulkAfternoon = useCallback(() => {
        setScheduleByDate((prev) => {
          const safePrev = normalizeFullSchedule(prev);
          const base = normalizeDayBlockSchedule(safePrev[selectedDate]);
          const nextDay = { ...base };
          for (const id of ['pm1', 'pm2']) {
            nextDay[id] = { large: 'full', small: 'full' };
          }
          const nextAll = { ...safePrev, [selectedDate]: nextDay };
          writeFullSchedule(nextAll);
          return nextAll;
        });
        window.queueMicrotask(() => runScheduleAutoPipeline());
      }, [selectedDate, runScheduleAutoPipeline]);

      const handleBulkClearDay = useCallback(() => {
        setScheduleByDate((prev) => {
          const safePrev = normalizeFullSchedule(prev);
          const nextAll = { ...safePrev, [selectedDate]: defaultEmptyDayBlocks() };
          writeFullSchedule(nextAll);
          return nextAll;
        });
        window.queueMicrotask(() => runScheduleAutoPipeline());
      }, [selectedDate, runScheduleAutoPipeline]);

      const handleBulkFullDayLargeOnly = useCallback(() => {
        setScheduleByDate((prev) => {
          const safePrev = normalizeFullSchedule(prev);
          const base = normalizeDayBlockSchedule(safePrev[selectedDate]);
          const nextDay = { ...base };
          for (const id of SCHEDULE_BLOCK_IDS) {
            nextDay[id] = { ...nextDay[id], large: 'full' };
          }
          const nextAll = { ...safePrev, [selectedDate]: nextDay };
          writeFullSchedule(nextAll);
          return nextAll;
        });
        window.queueMicrotask(() => runScheduleAutoPipeline());
      }, [selectedDate, runScheduleAutoPipeline]);

      const handleBulkFullDaySmallOnly = useCallback(() => {
        setScheduleByDate((prev) => {
          const safePrev = normalizeFullSchedule(prev);
          const base = normalizeDayBlockSchedule(safePrev[selectedDate]);
          const nextDay = { ...base };
          for (const id of SCHEDULE_BLOCK_IDS) {
            nextDay[id] = { ...nextDay[id], small: 'full' };
          }
          const nextAll = { ...safePrev, [selectedDate]: nextDay };
          writeFullSchedule(nextAll);
          return nextAll;
        });
        window.queueMicrotask(() => runScheduleAutoPipeline());
      }, [selectedDate, runScheduleAutoPipeline]);

      const dayBlocks = useMemo(
        () => normalizeDayBlockSchedule(scheduleByDate[selectedDate]),
        [scheduleByDate, selectedDate],
      );

      const onPickDate = useCallback(
        (e) => {
          const v = e.target.value;
          if (!v || typeof v !== 'string') return;
          let next = v;
          if (next < dateBounds.minIso) next = dateBounds.minIso;
          if (next > dateBounds.maxIso) next = dateBounds.maxIso;
          setSelectedDate(next);
        },
        [dateBounds.minIso, dateBounds.maxIso],
      );

      return (
        <div className="flex h-[100dvh] min-h-[100dvh] w-full max-w-full flex-col overflow-hidden overflow-x-hidden bg-slate-50 pt-11 antialiased sm:pt-12">
          <div className="grid min-h-0 min-w-0 flex-1 grid-cols-2 gap-1.5 px-1.5 pb-1.5 sm:gap-2 sm:px-2 sm:pb-2">
            <section
              aria-label="向こう1ヶ月の受入スケジュール"
              className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border-2 border-slate-200 bg-white shadow-sm"
            >
              <div className="shrink-0 border-b border-slate-100 p-2">
                <h2 className="text-xs font-black leading-tight text-slate-900 sm:text-sm">向こう1ヶ月の受入スケジュール</h2>
                <p className="mt-0.5 text-[10px] font-bold leading-snug text-slate-500">
                  選択日 {selectedDate.replace(/-/g, '/')} · 満車は発注と連動して自動拒否
                </p>
              </div>
              <div className="shrink-0 border-b border-slate-100 p-2">
                <label htmlFor="factory-schedule-date" className="text-[10px] font-bold text-slate-400">
                  日付を選択（今日〜30日先）
                </label>
                <input
                  id="factory-schedule-date"
                  type="date"
                  min={dateBounds.minIso}
                  max={dateBounds.maxIso}
                  value={selectedDate}
                  onChange={onPickDate}
                  className="mt-1 min-h-[40px] w-full max-w-full rounded-lg border-2 border-slate-200 bg-white px-2 py-1.5 text-sm font-bold text-slate-900 shadow-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200"
                />
                <p className="mt-1 text-[10px] font-medium text-slate-400">4時間枠 × 大型／小型 · 未設定はすべて空き</p>
              </div>
              <header className="shrink-0 border-b border-slate-100 px-2 py-1">
                <h3 className="text-[11px] font-black text-slate-800 sm:text-xs">4枠の受入設定</h3>
              </header>
              <div className="shrink-0 p-2 pt-0">
                <ScheduleBulkToolbar
                  selectedDate={selectedDate}
                  onFullDay={handleBulkFullDay}
                  onMorning={handleBulkMorning}
                  onAfternoon={handleBulkAfternoon}
                  onClearAll={handleBulkClearDay}
                  onFullDayLargeOnly={handleBulkFullDayLargeOnly}
                  onFullDaySmallOnly={handleBulkFullDaySmallOnly}
                />
              </div>
              <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-2 pt-0">
                <div className="grid min-h-0 grid-cols-2 gap-2">
                  {SCHEDULE_BLOCKS.map((bm) => (
                    <ScheduleBlockCard
                      key={bm.id}
                      dateStr={selectedDate}
                      blockMeta={bm}
                      dayState={dayBlocks}
                      onToggleVehicle={handleToggleBlockVehicle}
                    />
                  ))}
                </div>
              </div>
            </section>

            <section
              aria-label="配車依頼（新着・進行中）"
              className="flex min-h-0 min-w-0 flex-col overflow-hidden"
            >
              <DispatchInbox
                orders={orders}
                onQuantityChange={handleQuantityChange}
                onResponseStatusChange={handleResponseStatusChange}
                onRequestUnlock={handleFactoryUnlockRequest}
                chatThreads={chatThreads}
                onFactoryChatSent={refreshChatThreads}
              />
            </section>
          </div>

          <NewOrderToast order={toastOrder} onDismiss={() => setToastOrder(null)} />
        </div>
      );
    }


    const root = ReactDOM.createRoot(document.getElementById('root'));
    root.render(<App />);