import React, { useState, useCallback, useEffect, useMemo } from 'react';
import * as db from './haishaDb.js';
import { supabase } from './supabaseClient.js';
import { MapPicker } from './MapPicker.jsx';
import { DeliveryAreaAddressField } from './components/DeliveryAreaAddressField.jsx';
import { LocationPendingBadge } from './components/LocationPendingBadge.jsx';
import { OrderVisibilityScopePanel } from './components/OrderVisibilityScopePanel.jsx';
import { OrderVisibilityScopeBadge } from './components/OrderVisibilityScopeBadge.jsx';
import { OrderMapEditorUrlActions } from './components/OrderMapEditorUrlActions.jsx';
import { ProjectExternalUrlActions } from './components/ProjectExternalUrlActions.jsx';
import { SiteOrderUrlActions } from './components/SiteOrderUrlActions.jsx';
import { externalUrlValidationMessage } from './utils/urlValidation.js';
import { buildOrderVisibilityContext } from './utils/orderVisibilityScope.js';
import {
  formatDeliveryAreasTextInput,
  getDeliveryAreaValidationMessage,
  normalizeAllowedDeliveryAreas,
  parseDeliveryAreasTextInput,
  parseSpotThresholdVolume,
} from './utils/deliveryAreas.js';
import { SCHEDULE_BLOCK_IDS, normalizeDayBlockSchedule, todayLocalISODate } from './haishaConstants.js';
import { resolveOrderSiteDisplayName, sanitizeSiteNameValue } from './utils/siteNameDisplay.js';
import concreteLinkLogo from './assets/concrete-link-logo.svg';
import { ThemeToggle } from './components/ThemeToggle.jsx';

const ADMIN_AUTH_SESSION_KEY = 'concrete_link_admin_auth_v1';

function timeToInputValue(t) {
  const s = t != null ? String(t) : '';
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '08:00';
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

function inputValueToTime(v) {
  const parts = String(v || '08:00').split(':');
  const h = (parts[0] ?? '08').padStart(2, '0');
  const m = (parts[1] ?? '00').padStart(2, '0');
  return `${h}:${m}:00`;
}

function formatSupabaseError(err, fallback = '処理に失敗しました') {
  const message = err?.message ? String(err.message) : fallback;
  const code = err?.code ? ` (Code: ${err.code})` : '';
  const details = err?.details ? `\nDetails: ${err.details}` : '';
  const hint = err?.hint ? `\nHint: ${err.hint}` : '';
  return `${fallback}: ${message}${code}${details}${hint}`;
}

function formatDateJp(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso || '—';
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

function formatOrderTime(order) {
  const raw = order?.delivery_time ?? order?.preferredTime ?? order?.timeSlot ?? order?.time_slot ?? '';
  const minutes = Number(order?.delivery_time_minutes ?? order?.timeSlotMinutes);
  if (Number.isFinite(minutes)) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  if (raw == null || raw === '') return '—';
  const s = String(raw);
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
  }
  const m = s.match(/^(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : s;
}

function orderDeliveryDate(order) {
  return order?.delivery_date ?? order?.preferredDate ?? order?.preferred_date ?? '';
}

function orderSiteName(order) {
  const name = resolveOrderSiteDisplayName(order);
  return name || '（現場名未入力）';
}

function orderPartyInfo(order) {
  const tradingCompany = String(order?.trading_company_name ?? order?.projectTradingCompanyName ?? order?.projectTradingCompany ?? order?.tradingCompanyName ?? order?.traderName ?? '').trim();
  const contractor = String(order?.customerName ?? order?.customer_name ?? order?.contractorName ?? order?.contractor_name ?? '').trim();
  const site = resolveOrderSiteDisplayName(order);
  const orderedBy = String(order?.ordered_by ?? order?.orderedBy ?? '').trim();
  const phone = String(order?.sitePhone ?? order?.phone ?? '').trim();
  return {
    contractor: tradingCompany && contractor ? `${contractor} (商社: ${tradingCompany})` : contractor || '—',
    site: site || '—',
    orderedBy: orderedBy || '—',
    phone: phone || '—',
  };
}

function orderStatus(order) {
  return String(order?.status || 'pending');
}

function orderStatusLabel(status) {
  if (status === 'accepted') return '受注';
  if (status === 'completed') return '完了';
  if (status === 'customer_cancelled') return 'キャンセル';
  if (status === 'rejected') return '見送り';
  if (status === 'pending_association') return '組合承認待ち';
  return '配車待ち';
}

function statusBadgeClass(status) {
  if (status === 'customer_cancelled') return 'border-red-400 bg-red-50 text-red-700';
  if (status === 'completed') return 'border-slate-300 bg-slate-100 text-slate-700';
  if (status === 'accepted') return 'border-emerald-300 bg-emerald-50 text-emerald-800';
  if (status === 'rejected') return 'border-red-300 bg-red-50 text-red-800';
  if (status === 'pending_association') return 'cl-alert-association cl-alert-status border-violet-400 bg-violet-50 text-violet-900';
  return 'cl-alert-status border-amber-300 bg-amber-50 text-amber-900';
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

function kindBadgeClass(isSpot) {
  return isSpot ? 'cl-alert-spot cl-alert-status border-amber-300 bg-amber-50 text-amber-900' : 'border-indigo-300 bg-indigo-50 text-indigo-800';
}

function orderScheduleSortKey(order) {
  const date = orderDeliveryDate(order) || '9999-99-99';
  const time = formatOrderTime(order);
  return `${date} ${time === '—' ? '99:99' : time}`;
}

function parseTimeInputToMinutes(v) {
  const m = String(v || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

function isFullLike(value) {
  if (value === true) return true;
  const s = String(value ?? '').trim().toLowerCase();
  return ['full', 'packed', 'busy', 'unavailable', '満車', '空きなし'].includes(s);
}

function getFactoryDayStatus(schedulesByFactoryId, factoryId, dateStr, factory) {
  if (factory?.raw) {
    const raw = factory.raw;
    const hasFactoryStatus =
      raw.is_full_day_packed != null ||
      raw.is_full_day_full != null ||
      raw.full_day_status != null ||
      raw.large_vehicle_status != null ||
      raw.large_status != null ||
      raw.small_vehicle_status != null ||
      raw.small_status != null;
    if (hasFactoryStatus) {
      const allFull = isFullLike(raw.is_full_day_packed ?? raw.is_full_day_full ?? raw.full_day_status);
      const largeFull = allFull || isFullLike(raw.large_vehicle_status ?? raw.large_status);
      const smallFull = allFull || isFullLike(raw.small_vehicle_status ?? raw.small_status);
      return { allFull, largeFull, smallFull };
    }
  }
  const rawDay = schedulesByFactoryId?.[factoryId]?.[dateStr];
  const day = normalizeDayBlockSchedule(rawDay);
  const allFull = SCHEDULE_BLOCK_IDS.every((id) => day[id]?.large === 'full' && day[id]?.small === 'full');
  const largeFull = SCHEDULE_BLOCK_IDS.every((id) => day[id]?.large === 'full');
  const smallFull = SCHEDULE_BLOCK_IDS.every((id) => day[id]?.small === 'full');
  return {
    allFull,
    largeFull,
    smallFull,
  };
}

function FactoryAvailabilityBadges({ status }) {
  const st = status || { allFull: false, largeFull: false, smallFull: false };
  return (
    <div className="flex flex-wrap gap-1.5">
      {st.allFull ? (
        <span className="inline-flex rounded-full border-2 border-red-600 bg-red-600 px-2.5 py-1 text-xs font-black text-white shadow-sm">
          終日満車
        </span>
      ) : (
        <span className="inline-flex rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-800">
          稼働枠あり
        </span>
      )}
      <span className={'inline-flex rounded-full border px-2.5 py-1 text-xs font-black ' + (st.largeFull ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-300 bg-emerald-50 text-emerald-800')}>
        {st.largeFull ? '大型満車' : '大型空き'}
      </span>
      <span className={'inline-flex rounded-full border px-2.5 py-1 text-xs font-black ' + (st.smallFull ? 'border-amber-300 bg-amber-50 text-amber-900' : 'border-emerald-300 bg-emerald-50 text-emerald-800')}>
        {st.smallFull ? '小型満車' : '小型空き'}
      </span>
    </div>
  );
}

const FACTORY_AREA_ORDER = ['中心部', '東部', '南部', '西部', 'その他'];
const FACTORY_AREA_BY_NAME = {
  '恵藤建設㈱ 千歳生コン': '中心部',
  大分工場: '中心部',
  '松田砂利工業㈲': '中心部',
  '龍南運送㈱ 大分レミコン工場': '中心部',
  '㈱大分宇部 大分工場': '中心部',
  '㈱豊海': '中心部',
  '志村生コンクリート㈱': '東部',
  '大分味岡生コンクリート㈱': '東部',
  '㈱旭商 幸崎生コン工場': '東部',
  '㈱大分生コン': '南部',
  '龍南運送㈱ 大南レミコン工場': '南部',
  '㈱野津原': '西部',
  '㈱挾間生コン': '西部',
  '㈱九大技建': '西部',
};

function factoryAreaOf(factoryName) {
  return FACTORY_AREA_BY_NAME[String(factoryName || '').trim()] || 'その他';
}

function CompactFactoryStatusBar({ factories, schedulesByFactoryId, scheduleDate, onScheduleDateChange }) {
  const rows = (factories || []).map((f) => ({
    factoryId: f.id,
    factoryName: f.name || f.id,
    status: getFactoryDayStatus(schedulesByFactoryId, f.id, scheduleDate, f),
  }));
  return (
    <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="shrink-0 text-xs font-black text-slate-500">工場稼働</span>
        <input
          type="date"
          value={scheduleDate}
          onChange={(e) => onScheduleDateChange(e.target.value || todayLocalISODate())}
          className="min-h-[32px] rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-bold text-slate-900"
          aria-label="工場稼働ステータスの対象日"
        />
        <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {rows.length === 0 ? (
            <span className="text-xs font-bold text-slate-400">工場未登録</span>
          ) : (
            rows.map((f) => (
              <span
                key={f.factoryId}
                className={
                  'inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-black ' +
                  (f.status.allFull ? 'border-red-300 bg-red-50 text-red-800' : 'border-slate-200 bg-slate-50 text-slate-800')
                }
                title={`${f.factoryName}: ${f.status.allFull ? '終日満車' : '稼働枠あり'} / ${f.status.largeFull ? '大型満車' : '大型空き'} / ${f.status.smallFull ? '小型満車' : '小型空き'}`}
              >
                <span>{f.factoryName}</span>
                <span>{f.status.allFull ? '満車' : `${f.status.largeFull ? '大満' : '大空'}/${f.status.smallFull ? '小満' : '小空'}`}</span>
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function FactoryAvailabilitySection({ factories, schedulesByFactoryId, scheduleDate, onScheduleDateChange }) {
  const rows = (factories || []).map((f) => ({
    factoryId: f.id,
    factoryName: f.name || f.id,
    area: factoryAreaOf(f.name),
    status: getFactoryDayStatus(schedulesByFactoryId, f.id, scheduleDate, f),
  }));
  const groupedRows = FACTORY_AREA_ORDER.map((area) => ({
    area,
    rows: rows.filter((f) => f.area === area),
  })).filter((group) => group.rows.length > 0);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">工場稼働ステータス</h2>
          <p className="mt-1 text-xs text-slate-500">工場画面の満車設定・大型/小型空き状況を Realtime で確認</p>
        </div>
        <label className="text-xs font-black text-slate-600">
          対象日
          <input
            type="date"
            value={scheduleDate}
            onChange={(e) => onScheduleDateChange(e.target.value || todayLocalISODate())}
            className="ml-2 min-h-[40px] rounded-lg border-2 border-slate-200 bg-white px-2 text-sm font-bold text-slate-900"
          />
        </label>
      </div>
      <div className="mt-5 space-y-5">
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">工場マスタが未登録です。</p>
        ) : (
          groupedRows.map((group) => (
            <div key={group.area} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                <h3 className="text-base font-black text-slate-900">📍 {group.area}</h3>
                <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-black text-white">{group.rows.length}工場</span>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.rows.map((f) => (
                  <article key={f.factoryId} className={'rounded-xl border-2 bg-white p-4 shadow-sm ' + (f.status.allFull ? 'border-red-300 bg-red-50' : 'border-slate-200')}>
                    <p className="text-lg font-black text-slate-900">{f.factoryName}</p>
                    <div className="mt-3">
                      <FactoryAvailabilityBadges status={f.status} />
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function ProjectForm({ factories, customers, allowedDeliveryAreas = [], initial, onSave, onCancel, saving }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? '');
  const [tradingCompany, setTradingCompany] = useState(initial?.trading_company_name ?? initial?.trading_company ?? '');
  const [contractor, setContractor] = useState(initial?.contractor ?? '');
  const [mainFactoryId, setMainFactoryId] = useState(initial?.main_factory_id ?? '');
  const [subIds, setSubIds] = useState(() => new Set(initial?.sub_factory_ids ?? []));
  const [deliveryArea, setDeliveryArea] = useState(initial?.delivery_area ?? '');
  const [siteAddressDetail, setSiteAddressDetail] = useState(initial?.site_address ?? '');
  const [lat, setLat] = useState(initial?.lat != null && Number.isFinite(initial.lat) ? String(initial.lat) : '');
  const [lng, setLng] = useState(initial?.lng != null && Number.isFinite(initial.lng) ? String(initial.lng) : '');
  const [folderUrl, setFolderUrl] = useState(initial?.folder_url ?? '');
  const [sheetUrl, setSheetUrl] = useState(initial?.sheet_url ?? '');
  const [addressError, setAddressError] = useState('');
  const linkedCustomer = useMemo(
    () => (customers || []).find((c) => c && String(c.id) === String(customerId || '')),
    [customers, customerId],
  );

  useEffect(() => {
    setName(initial?.name ?? '');
    setCustomerId(initial?.customer_id ?? '');
    setTradingCompany(initial?.trading_company_name ?? initial?.trading_company ?? '');
    setContractor(initial?.contractor ?? '');
    setMainFactoryId(initial?.main_factory_id ?? '');
    setSubIds(new Set(initial?.sub_factory_ids ?? []));
    setDeliveryArea(initial?.delivery_area ?? '');
    setSiteAddressDetail(initial?.site_address ?? '');
    setLat(initial?.lat != null && Number.isFinite(initial.lat) ? String(initial.lat) : '');
    setLng(initial?.lng != null && Number.isFinite(initial.lng) ? String(initial.lng) : '');
    setFolderUrl(initial?.folder_url ?? '');
    setSheetUrl(initial?.sheet_url ?? '');
    setAddressError('');
  }, [initial]);

  const toggleSub = (fid) => {
    setSubIds((prev) => {
      const next = new Set(prev);
      if (next.has(fid)) next.delete(fid);
      else next.add(fid);
      return next;
    });
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const area = String(deliveryArea || '').trim();
    const detail = String(siteAddressDetail || '').trim();
    const full = area && detail ? `${area} ${detail}` : area || detail;
    const msg = getDeliveryAreaValidationMessage(full, allowedDeliveryAreas);
    if (msg) {
      setAddressError(msg);
      return;
    }
    if (!area) {
      setAddressError('納入エリア（市町村）を選択してください。');
      return;
    }
    if (!detail) {
      setAddressError('町名・地名を入力してください（例：横尾。番地・現場名が未定の場合は町名まで）。');
      return;
    }
    setAddressError('');
    onSave({
      name: name.trim(),
      customer_id: customerId,
      trading_company_name: tradingCompany.trim(),
      trading_company: tradingCompany.trim(),
      contractor: contractor.trim(),
      main_factory_id: mainFactoryId,
      sub_factory_ids: [...subIds].filter((id) => id && id !== mainFactoryId),
      delivery_area: area,
      site_address: detail,
      lat: lat.trim(),
      lng: lng.trim(),
      folder_url: folderUrl.trim(),
      sheet_url: sheetUrl.trim(),
    });
  };

  const fieldClass =
    'mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200';

  return (
    <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border-2 border-indigo-200 bg-indigo-50/40 p-4 sm:p-5">
      <h3 className="text-base font-black text-slate-900">{initial?.id ? '物件を編集' : '物件を追加'}</h3>
      <div>
        <label className="text-xs font-bold text-slate-600" htmlFor="proj-name">
          物件名 <span className="text-red-600">*</span>
        </label>
        <input id="proj-name" type="text" value={name} onChange={(e) => setName(e.target.value)} className={fieldClass} required />
      </div>
      <div>
        <label className="text-xs font-bold text-slate-600" htmlFor="proj-customer">業者（会社）</label>
        <select id="proj-customer" value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={fieldClass}>
          <option value="">未設定</option>
          {(customers || []).map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-bold text-slate-600" htmlFor="proj-trading-company">商社名（任意）</label>
          <input id="proj-trading-company" type="text" value={tradingCompany} onChange={(e) => setTradingCompany(e.target.value)} className={fieldClass} placeholder="例: ○○商事" />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600" htmlFor="proj-contractor">業者</label>
          <input id="proj-contractor" type="text" value={contractor} onChange={(e) => setContractor(e.target.value)} className={fieldClass} placeholder="例: △△建設" />
        </div>
      </div>
      <div>
        <label className="text-xs font-bold text-slate-600" htmlFor="proj-main-factory">
          メイン工場（1社） <span className="text-red-600">*</span>
        </label>
        <select
          id="proj-main-factory"
          value={mainFactoryId}
          onChange={(e) => {
            const v = e.target.value;
            setMainFactoryId(v);
            if (v) setSubIds((prev) => { const n = new Set(prev); n.delete(v); return n; });
          }}
          className={fieldClass}
          required
        >
          <option value="">選択してください</option>
          {factories.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </div>
      <fieldset className="rounded-lg border border-slate-200 bg-white p-3">
        <legend className="px-1 text-xs font-bold text-slate-600">サブ工場（複数可）</legend>
        {factories.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">工場マスタが未登録です。</p>
        ) : (
          <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto">
            {factories.map((f) => {
              const isMain = f.id === mainFactoryId;
              return (
                <li key={f.id}>
                  <label className={'flex cursor-pointer items-center gap-2 rounded-md border px-2 py-2 text-sm ' + (isMain ? 'cursor-not-allowed border-slate-100 bg-slate-50 text-slate-400' : 'border-slate-200 hover:bg-slate-50')}>
                    <input type="checkbox" checked={subIds.has(f.id)} disabled={isMain} onChange={() => toggleSub(f.id)} className="h-4 w-4 rounded border-slate-300 text-indigo-600" />
                    <span className="font-bold">{f.name}</span>
                    {isMain ? <span className="text-[10px] font-bold text-indigo-600">（メイン）</span> : null}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </fieldset>
      <DeliveryAreaAddressField
        idPrefix="proj"
        allowedAreas={allowedDeliveryAreas}
        deliveryArea={deliveryArea}
        onDeliveryAreaChange={setDeliveryArea}
        addressDetail={siteAddressDetail}
        onAddressDetailChange={setSiteAddressDetail}
      />
      {addressError ? (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800" role="alert">
          {addressError}
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-bold text-slate-600" htmlFor="proj-lat">緯度（lat）</label>
          <input id="proj-lat" type="text" inputMode="decimal" placeholder="例: 33.5902" value={lat} onChange={(e) => setLat(e.target.value)} className={fieldClass} />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600" htmlFor="proj-lng">経度（lng）</label>
          <input id="proj-lng" type="text" inputMode="decimal" placeholder="例: 130.4017" value={lng} onChange={(e) => setLng(e.target.value)} className={fieldClass} />
        </div>
      </div>
      <MapPicker
        key={initial?.id ?? 'new'}
        lat={lat}
        lng={lng}
        onPositionChange={(la, ln) => {
          setLat(la);
          setLng(ln);
        }}
      />
      <div className="grid gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <p className="text-xs font-black uppercase tracking-wide text-slate-500">外部リンク（Google Drive / スプレッドシート）</p>
        <div>
          <label className="text-xs font-bold text-slate-600" htmlFor="proj-folder-url">フォルダURL</label>
          <input
            id="proj-folder-url"
            type="url"
            inputMode="url"
            value={folderUrl}
            onChange={(e) => setFolderUrl(e.target.value)}
            placeholder="https://drive.google.com/..."
            className={fieldClass}
          />
          {folderUrl.trim() && externalUrlValidationMessage(folderUrl) ? (
            <p className="mt-1 text-xs font-bold text-amber-800">{externalUrlValidationMessage(folderUrl)}</p>
          ) : null}
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600" htmlFor="proj-sheet-url">シートURL</label>
          <input
            id="proj-sheet-url"
            type="url"
            inputMode="url"
            value={sheetUrl}
            onChange={(e) => setSheetUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/..."
            className={fieldClass}
          />
          {sheetUrl.trim() && externalUrlValidationMessage(sheetUrl) ? (
            <p className="mt-1 text-xs font-bold text-amber-800">{externalUrlValidationMessage(sheetUrl)}</p>
          ) : null}
        </div>
        {initial?.id ? (
          <ProjectExternalUrlActions folderUrl={folderUrl} sheetUrl={sheetUrl} variant="inline" />
        ) : null}
      </div>
      {initial?.id ? (
        <div className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
          <p className="text-xs font-black text-slate-700">専用発注URL（現場向け）</p>
          <div className="mt-2">
            <SiteOrderUrlActions
              urlToken={initial?.url_token}
              siteName={name || initial?.name}
              customerName={linkedCustomer?.company_name || linkedCustomer?.name || contractor}
              traderName={tradingCompany}
              compact
            />
          </div>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="submit" disabled={saving} className="min-h-[44px] flex-1 rounded-lg bg-indigo-600 px-4 text-sm font-black text-white shadow hover:bg-indigo-700 disabled:opacity-50">{saving ? '保存中…' : '保存'}</button>
        <button type="button" onClick={onCancel} disabled={saving} className="min-h-[44px] rounded-lg border-2 border-slate-300 bg-white px-4 text-sm font-black text-slate-700 hover:bg-slate-50">キャンセル</button>
      </div>
    </form>
  );
}

function ProjectsSection({ factories, factoryNameById }) {
  const [projects, setProjects] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [allowedDeliveryAreas, setAllowedDeliveryAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formMode, setFormMode] = useState(null);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [rows, customerRows, settings] = await Promise.all([
        db.fetchProjects(),
        db.fetchCustomers(),
        db.fetchAdminSettings(),
      ]);
      setProjects(rows);
      setCustomers(customerRows);
      setAllowedDeliveryAreas(normalizeAllowedDeliveryAreas(settings?.allowed_delivery_areas));
    } catch (e) {
      console.error('物件取得エラー', e);
      setError(formatSupabaseError(e, '物件一覧の取得に失敗しました'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    let timerId = null;
    const unsub = db.subscribeHaishaRealtime((payload) => {
      if (payload?.table !== 'customers') return;
      if (timerId != null) window.clearTimeout(timerId);
      timerId = window.setTimeout(() => {
        timerId = null;
        void load();
      }, 500);
    });
    return () => {
      if (timerId != null) window.clearTimeout(timerId);
      unsub();
    };
  }, [load]);

  const handleSave = async (payload) => {
    setSaving(true);
    setError('');
    try {
      if (editing?.id) await db.updateProject(editing.id, payload);
      else await db.insertProject(payload);
      setFormMode(null);
      setEditing(null);
      await load();
    } catch (e) {
      console.error(e);
      setError(e?.message || '保存に失敗しました。');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p) => {
    if (!p?.id) return;
    if (!window.confirm(`「${p.name}」を削除しますか？`)) return;
    setError('');
    try {
      await db.deleteProject(p.id);
      if (editing?.id === p.id) { setEditing(null); setFormMode(null); }
      await load();
    } catch (e) {
      console.error(e);
      const code = e?.code ? ` (Code: ${e.code})` : '';
      setError(`削除に失敗しました: ${e?.message || '不明なエラー'}${code}`);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">物件管理</h2>
          <p className="mt-1 text-xs text-slate-500">projects テーブル · メイン／サブ工場・位置情報</p>
        </div>
        <button type="button" onClick={() => { setEditing(null); setFormMode('add'); }} className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-sm font-black text-white hover:bg-indigo-700">＋ 物件を追加</button>
      </div>
      {error ? <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800" role="alert">{error}</p> : null}
      {formMode ? (
        <div className="mt-4">
          <ProjectForm
            factories={factories}
            customers={customers}
            allowedDeliveryAreas={allowedDeliveryAreas}
            initial={editing}
            onSave={handleSave}
            onCancel={() => { setFormMode(null); setEditing(null); }}
            saving={saving}
          />
        </div>
      ) : null}
      {loading ? <p className="mt-4 text-sm text-slate-500">読み込み中…</p> : null}
      {!loading && projects.length === 0 && !formMode ? <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">登録された物件はありません。</p> : null}
      {!loading && projects.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[800px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-slate-200 bg-slate-50">
                <th className="px-3 py-2 font-black text-slate-700">物件名</th>
                <th className="px-3 py-2 font-black text-slate-700">業者（会社）</th>
                <th className="px-3 py-2 font-black text-slate-700">商社名</th>
                <th className="px-3 py-2 font-black text-slate-700">業者</th>
                <th className="px-3 py-2 font-black text-slate-700">メイン工場</th>
                <th className="px-3 py-2 font-black text-slate-700">サブ工場</th>
                <th className="px-3 py-2 font-black text-slate-700">緯度・経度</th>
                <th className="px-3 py-2 font-black text-slate-700">リンク</th>
                <th className="px-3 py-2 font-black text-slate-700">操作</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                  <td className="px-3 py-2.5 font-bold text-slate-900">{p.name}</td>
                  <td className="px-3 py-2.5 text-slate-700">{customers.find((c) => c.id === p.customer_id)?.name || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-700">{(p.trading_company_name || p.trading_company)?.trim() || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-700">{p.contractor?.trim() || '—'}</td>
                  <td className="px-3 py-2.5">{factoryNameById[p.main_factory_id] || '—'}</td>
                  <td className="max-w-[12rem] px-3 py-2.5 text-xs text-slate-600">{(p.sub_factory_ids || []).map((id) => factoryNameById[id] || id).join('、') || '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{p.lat != null && p.lng != null ? `${p.lat}, ${p.lng}` : '—'}</td>
                  <td className="min-w-[8rem] px-3 py-2.5">
                    <ProjectExternalUrlActions folderUrl={p.folder_url} sheetUrl={p.sheet_url} variant="compact" />
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      <button type="button" onClick={() => { setEditing(p); setFormMode('edit'); }} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-bold hover:bg-slate-50">編集</button>
                      <button type="button" onClick={() => handleDelete(p)} className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-bold text-red-800 hover:bg-red-100">削除</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function CustomersSection() {
  const [customers, setCustomers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [managerName, setManagerName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await db.fetchCustomers();
      setCustomers(rows);
    } catch (e) {
      console.error('業者一覧取得エラー', e);
      setError(formatSupabaseError(e, '業者一覧の取得に失敗しました'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const unsub = db.subscribeHaishaRealtime((payload) => {
      if (payload?.table === 'customers') void load();
    });
    return () => unsub();
  }, [load]);

  const resetForm = () => {
    setCompanyName('');
    setManagerName('');
    setPhoneNumber('');
    setLoginPassword('');
    setEditingCustomer(null);
  };

  const startEdit = (customer) => {
    setEditingCustomer(customer);
    setCompanyName(customer?.company_name || customer?.name || '');
    setManagerName(customer?.manager_name || '');
    setPhoneNumber(customer?.phone_number || '');
    setLoginPassword(customer?.login_password || '');
    setError('');
    setNotice('');
  };

  const handleSave = async (e) => {
    e.preventDefault();
    const name = companyName.trim();
    if (!name) {
      setError('業者名（会社名）を入力してください。');
      return;
    }
    if (!loginPassword.trim()) {
      setError('ログインパスワードを入力してください。');
      return;
    }
    if (!phoneNumber.trim()) {
      setError('電話番号を入力してください。');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        company_name: name,
        manager_name: managerName.trim(),
        phone_number: phoneNumber.trim(),
        login_password: loginPassword.trim(),
      };
      if (editingCustomer?.id) await db.updateCustomer(editingCustomer.id, payload);
      else await db.addCustomer(payload);
      resetForm();
      setNotice(editingCustomer?.id ? '業者情報を更新しました。' : '業者を登録しました。');
      await load();
      window.setTimeout(() => setNotice(''), 3000);
    } catch (e2) {
      console.error('業者保存エラー', e2);
      setError(formatSupabaseError(e2, '業者の保存に失敗しました'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (customer) => {
    if (!customer?.id) return;
    const name = customer.company_name || customer.name || 'この業者';
    if (!window.confirm(`「${name}」を削除しますか？\n物件に紐づいている場合は削除できないことがあります。`)) return;
    setError('');
    setNotice('');
    try {
      await db.deleteCustomer(customer.id);
      setNotice('業者を削除しました。');
      await load();
      window.setTimeout(() => setNotice(''), 3000);
    } catch (e) {
      console.error('業者削除エラー', e);
      setError(formatSupabaseError(e, '業者の削除に失敗しました'));
    }
  };

  const fieldClass =
    'mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200';
  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) => {
      const text = [c.company_name, c.name, c.manager_name, c.phone_number].map((v) => String(v || '')).join(' ').toLowerCase();
      return text.includes(q);
    });
  }, [customers, searchQuery]);

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">業者管理</h2>
          <p className="mt-1 text-xs text-slate-500">customers テーブル · 物件管理と注文画面の業者選択に反映されます</p>
        </div>
      </div>

      {error ? <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800" role="alert">{error}</p> : null}
      {notice ? <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800" role="status">{notice}</p> : null}

      <form onSubmit={handleSave} className="mt-4 grid gap-3 rounded-xl border-2 border-indigo-100 bg-indigo-50/40 p-4 sm:grid-cols-4">
        <div className="sm:col-span-4">
          <h3 className="text-sm font-black text-slate-900">{editingCustomer ? '業者を編集' : '業者を新規登録'}</h3>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600" htmlFor="customer-company-name">
            業者名（会社名） <span className="text-red-600">*</span>
          </label>
          <input
            id="customer-company-name"
            type="text"
            value={companyName}
            onChange={(e) => setCompanyName(e.target.value)}
            className={fieldClass}
            placeholder="例: 〇〇建設"
            required
          />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600" htmlFor="customer-manager-name">代表担当者名（任意）</label>
          <input
            id="customer-manager-name"
            type="text"
            value={managerName}
            onChange={(e) => setManagerName(e.target.value)}
            className={fieldClass}
            placeholder="例: 山田"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600" htmlFor="customer-phone-number">
            電話番号（ログインID） <span className="text-red-600">*</span>
          </label>
          <input
            id="customer-phone-number"
            type="tel"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
            className={fieldClass}
            placeholder="例: 090-1234-5678"
            required
          />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600" htmlFor="customer-login-password">
            ログインパスワード <span className="text-red-600">*</span>
          </label>
          <input
            id="customer-login-password"
            type="text"
            value={loginPassword}
            onChange={(e) => setLoginPassword(e.target.value)}
            className={fieldClass}
            placeholder="例: 1234"
            required
          />
        </div>
        <div className="flex flex-wrap gap-2 sm:col-span-4">
          <button type="submit" disabled={saving} className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-sm font-black text-white shadow hover:bg-indigo-700 disabled:opacity-50">
            {saving ? '保存中…' : editingCustomer ? '業者情報を更新' : '＋ 業者を登録'}
          </button>
          {editingCustomer ? (
            <button type="button" onClick={resetForm} disabled={saving} className="min-h-[44px] rounded-lg border-2 border-slate-300 bg-white px-4 text-sm font-black text-slate-700 hover:bg-slate-50">
              編集をキャンセル
            </button>
          ) : null}
        </div>
      </form>

      {loading ? <p className="mt-4 text-sm text-slate-500">読み込み中…</p> : null}
      {!loading && customers.length > 0 ? (
        <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <label className="text-xs font-black text-slate-600" htmlFor="customer-search">業者検索</label>
          <input
            id="customer-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            placeholder="業者名・担当者名・電話番号で検索"
          />
        </div>
      ) : null}
      {!loading && customers.length === 0 ? <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">登録された業者はありません。</p> : null}
      {!loading && customers.length > 0 ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-slate-200 bg-slate-50">
                <th className="px-3 py-2 font-black text-slate-700">業者名（会社名）</th>
                <th className="px-3 py-2 font-black text-slate-700">代表担当者名</th>
                <th className="px-3 py-2 font-black text-slate-700">電話番号</th>
                <th className="px-3 py-2 font-black text-slate-700">ログインPW</th>
                <th className="px-3 py-2 font-black text-slate-700">操作</th>
              </tr>
            </thead>
            <tbody>
              {filteredCustomers.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                  <td className="px-3 py-2.5 font-bold text-slate-900">{c.company_name || c.name || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-700">{c.manager_name?.trim() || '—'}</td>
                  <td className="px-3 py-2.5 text-slate-700">{c.phone_number?.trim() || '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-xs text-slate-600">{c.login_password?.trim() || '—'}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      <button type="button" onClick={() => startEdit(c)} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50">
                        編集
                      </button>
                      <button type="button" onClick={() => handleDelete(c)} className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-bold text-red-800 hover:bg-red-100">
                        削除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filteredCustomers.length === 0 ? (
            <p className="rounded-b-lg border-x border-b border-slate-200 bg-slate-50 px-4 py-5 text-center text-sm font-bold text-slate-500">
              検索条件に一致する業者はありません。
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function HolidaysAndSettingsSection() {
  const [holidays, setHolidays] = useState([]);
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayDesc, setHolidayDesc] = useState('');
  const [startTime, setStartTime] = useState('08:00');
  const [endTime, setEndTime] = useState('16:00');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [hRows, settings] = await Promise.all([db.fetchHolidays(), db.fetchSystemSettings()]);
      setHolidays(hRows);
      setStartTime(timeToInputValue(settings.start_time));
      setEndTime(timeToInputValue(settings.end_time));
    } catch (e) {
      console.error(e);
      setError('休日・稼働時間の取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const holidaySet = useMemo(() => new Set(holidays.map((h) => h.holiday_date)), [holidays]);

  const handleAddHoliday = async (e) => {
    e.preventDefault();
    if (!holidayDate) { setError('休日の日付を選択してください。'); return; }
    if (holidaySet.has(holidayDate)) { setError('この日付は既に休日として登録されています。'); return; }
    setError('');
    try {
      await db.insertHoliday({ holiday_date: holidayDate, description: holidayDesc });
      setHolidayDate('');
      setHolidayDesc('');
      setNotice('休日を登録しました。');
      await load();
      window.setTimeout(() => setNotice(''), 3000);
    } catch (err) {
      console.error(err);
      setError(err?.message || '休日の登録に失敗しました。');
    }
  };

  const handleDeleteHoliday = async (h) => {
    if (!h?.id) return;
    if (!window.confirm(`${formatDateJp(h.holiday_date)} の休日を削除しますか？`)) return;
    setError('');
    try {
      await db.deleteHoliday(h.id);
      setNotice('休日を削除しました。');
      await load();
      window.setTimeout(() => setNotice(''), 3000);
    } catch (err) {
      console.error(err);
      setError('削除に失敗しました。');
    }
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSavingSettings(true);
    setError('');
    try {
      await db.updateSystemSettings({ start_time: inputValueToTime(startTime), end_time: inputValueToTime(endTime) });
      setNotice('稼働時間を保存しました。');
      await load();
      window.setTimeout(() => setNotice(''), 3000);
    } catch (err) {
      console.error(err);
      setError('稼働時間の保存に失敗しました。');
    } finally {
      setSavingSettings(false);
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md sm:p-6">
      <h2 className="text-lg font-black text-slate-900">休日・稼働時間</h2>
      <p className="mt-1 text-xs text-slate-500">holidays · system_settings（通常 8:00〜16:00）</p>
      {error ? <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800" role="alert">{error}</p> : null}
      {notice ? <p className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900" role="status">{notice}</p> : null}
      {loading ? <p className="mt-4 text-sm text-slate-500">読み込み中…</p> : (
        <div className="mt-6 grid gap-8 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-black text-slate-800">休日登録</h3>
            <form onSubmit={handleAddHoliday} className="mt-3 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <label className="text-xs font-bold text-slate-600" htmlFor="holiday-date">日付（カレンダー）</label>
                <input id="holiday-date" type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-bold" required />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600" htmlFor="holiday-desc">説明（任意）</label>
                <input id="holiday-desc" type="text" value={holidayDesc} onChange={(e) => setHolidayDesc(e.target.value)} placeholder="例: 年末年始" className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-sm" />
              </div>
              <button type="submit" className="min-h-[44px] w-full rounded-lg bg-teal-600 text-sm font-black text-white hover:bg-teal-700">休日を登録</button>
            </form>
            <ul className="mt-4 max-h-64 space-y-2 overflow-y-auto">
              {holidays.length === 0 ? <li className="text-sm text-slate-500">登録された休日はありません。</li> : holidays.map((h) => (
                <li key={h.id} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-bold text-slate-900">{formatDateJp(h.holiday_date)}</p>
                    {h.description ? <p className="break-words text-xs text-slate-500">{h.description}</p> : null}
                  </div>
                  <button type="button" onClick={() => handleDeleteHoliday(h)} className="shrink-0 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-bold text-red-800">削除</button>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-black text-slate-800">稼働時間</h3>
            <form onSubmit={handleSaveSettings} className="mt-3 space-y-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <div>
                <label className="text-xs font-bold text-slate-600" htmlFor="sys-start">稼働開始時間</label>
                <input id="sys-start" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-bold" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600" htmlFor="sys-end">稼働終了時間</label>
                <input id="sys-end" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-bold" />
              </div>
              <button type="submit" disabled={savingSettings} className="min-h-[44px] w-full rounded-lg bg-indigo-600 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50">{savingSettings ? '保存中…' : '稼働時間を保存'}</button>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

function AdminSettingsSection() {
  const [adminName, setAdminName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [deliveryAreasText, setDeliveryAreasText] = useState('');
  const [spotThresholdVolume, setSpotThresholdVolume] = useState('50');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const settings = await db.fetchAdminSettings();
      setAdminName(settings.admin_name || '');
      setPhoneNumber(settings.phone_number || '');
      setDeliveryAreasText(formatDeliveryAreasTextInput(settings.allowed_delivery_areas));
      setSpotThresholdVolume(String(parseSpotThresholdVolume(settings.spot_threshold_volume)));
      setCurrentPassword('');
      setNewPassword('');
      setNewPasswordConfirm('');
    } catch (e) {
      console.error('管理者情報設定取得エラー', e);
      setError(formatSupabaseError(e, '管理者情報設定の取得に失敗しました'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const unsub = db.subscribeHaishaRealtime((payload) => {
      if (payload?.table === 'admin_settings') void load();
    });
    return () => unsub();
  }, [load]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const wantsPasswordChange = Boolean(currentPassword.trim() || newPassword.trim() || newPasswordConfirm.trim());
      if (wantsPasswordChange) {
        if (!currentPassword.trim() || !newPassword.trim() || !newPasswordConfirm.trim()) {
          throw new Error('パスワードを変更する場合は、現在のパスワード・新しいパスワード・確認用パスワードをすべて入力してください');
        }
        if (newPassword.trim() !== newPasswordConfirm.trim()) {
          throw new Error('新しいパスワードと確認用パスワードが一致しません');
        }
      }
      await db.updateAdminSettings({
        admin_name: adminName.trim(),
        phone_number: phoneNumber.trim(),
        allowed_delivery_areas: parseDeliveryAreasTextInput(deliveryAreasText),
        spot_threshold_volume: parseSpotThresholdVolume(spotThresholdVolume),
      });
      if (wantsPasswordChange) {
        await db.updateAdminPassword(currentPassword.trim(), newPassword.trim());
      }
      setNotice('管理者情報設定を保存しました。');
      await load();
      window.setTimeout(() => setNotice(''), 3000);
    } catch (e2) {
      console.error('管理者情報設定保存エラー', e2);
      setError(formatSupabaseError(e2, '管理者情報設定の保存に失敗しました'));
    } finally {
      setSaving(false);
    }
  };

  const fieldClass =
    'mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200';

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md sm:p-6">
      <h2 className="text-lg font-black text-slate-900">管理者情報設定</h2>
      <p className="mt-1 text-xs text-slate-500">admin_settings テーブル · 注文アプリのログイン画面に表示する管理者情報</p>
      {error ? <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800" role="alert">{error}</p> : null}
      {notice ? <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800" role="status">{notice}</p> : null}
      {loading ? (
        <p className="mt-4 text-sm text-slate-500">読み込み中…</p>
      ) : (
        <form onSubmit={handleSave} className="mt-4 grid gap-3 rounded-xl border-2 border-indigo-100 bg-indigo-50/40 p-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-bold text-slate-600" htmlFor="admin-setting-name">管理者名</label>
            <input id="admin-setting-name" type="text" value={adminName} onChange={(e) => setAdminName(e.target.value)} className={fieldClass} placeholder="例: 配車管理者" />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600" htmlFor="admin-setting-phone">管理者の電話番号</label>
            <input id="admin-setting-phone" type="tel" value={phoneNumber} onChange={(e) => setPhoneNumber(e.target.value)} className={fieldClass} placeholder="例: 097-123-4567" />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-bold text-slate-600" htmlFor="admin-setting-delivery-areas">
              納入可能エリア（市町村）
            </label>
            <p className="mt-0.5 text-[11px] font-medium text-slate-500">1行1件、またはカンマ区切りで入力（例: 大分市、由布市）</p>
            <textarea
              id="admin-setting-delivery-areas"
              rows={5}
              value={deliveryAreasText}
              onChange={(e) => setDeliveryAreasText(e.target.value)}
              className={fieldClass + ' min-h-[120px] font-mono'}
              placeholder={'大分市\n由布市\n杵築市'}
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600" htmlFor="admin-setting-spot-threshold">
              スポット数量の組合承認しきい値（m³）
            </label>
            <input
              id="admin-setting-spot-threshold"
              type="number"
              min="1"
              step="0.1"
              value={spotThresholdVolume}
              onChange={(e) => setSpotThresholdVolume(e.target.value)}
              className={fieldClass}
            />
            <p className="mt-1 text-[11px] font-medium text-slate-500">スポット注文でカート合計がこの値を超えると「組合承認待ち」になります。</p>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600" htmlFor="admin-setting-current-password">現在のパスワード</label>
            <input
              id="admin-setting-current-password"
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className={fieldClass}
              placeholder="現在のパスワード"
              autoComplete="current-password"
            />
          </div>
          <div>
            <label className="text-xs font-bold text-slate-600" htmlFor="admin-setting-new-password">新しいパスワード</label>
            <input
              id="admin-setting-new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={fieldClass}
              placeholder="新しいパスワード"
              autoComplete="new-password"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="text-xs font-bold text-slate-600" htmlFor="admin-setting-new-password-confirm">新しいパスワード（確認）</label>
            <input
              id="admin-setting-new-password-confirm"
              type="password"
              value={newPasswordConfirm}
              onChange={(e) => setNewPasswordConfirm(e.target.value)}
              className={fieldClass}
              placeholder="確認のためもう一度入力"
              autoComplete="new-password"
            />
            <p className="mt-1 text-xs font-bold text-slate-500">パスワードを変更しない場合は3つのパスワード欄をすべて空欄にしてください。</p>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={saving} className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-sm font-black text-white shadow hover:bg-indigo-700 disabled:opacity-50">
              {saving ? '保存中…' : '管理者情報設定を保存'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function AdminOrderDetailModal({ order, open, saving, escalationCtx, factoryNameById, onClose, onSave }) {
  const [preferredDate, setPreferredDate] = useState('');
  const [timeValue, setTimeValue] = useState('');
  const [quantityM3, setQuantityM3] = useState('');
  const [mixText, setMixText] = useState('');
  const [siteName, setSiteName] = useState('');

  useEffect(() => {
    if (!open || !order) return;
    setPreferredDate(orderDeliveryDate(order));
    const t = formatOrderTime(order);
    setTimeValue(t === '—' ? '' : t);
    const q = order.quantityM3 ?? order.quantityCube ?? order.confirmedQuantityM3 ?? '';
    setQuantityM3(q != null ? String(q) : '');
    setMixText(order.mixText != null ? String(order.mixText) : '');
    setSiteName(orderSiteName(order) === '（現場名未入力）' ? '' : orderSiteName(order));
  }, [open, order]);

  if (!open || !order) return null;

  const party = orderPartyInfo(order);
  const st = orderStatus(order);
  const submit = (e) => {
    e.preventDefault();
    const minutes = parseTimeInputToMinutes(timeValue);
    onSave(order.id, {
      preferredDate,
      delivery_date: preferredDate,
      timeSlot: minutes != null ? String(minutes) : order.timeSlot,
      timeSlotMinutes: minutes,
      timeSlotLabel: timeValue,
      timePointLabel: timeValue,
      scheduleMatchDate: preferredDate,
      scheduleMatchMinutes: minutes,
      quantityM3: quantityM3.trim(),
      mixText: mixText.trim(),
      siteName: siteName.trim(),
    });
  };

  const inputClass = 'mt-1 min-h-[42px] w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-900';
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form onSubmit={submit} className="flex max-h-[min(92vh,900px)] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-white shadow-2xl">
        <div className="overflow-y-auto p-4 sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-lg font-black text-slate-900">注文詳細</h3>
              <p className="mt-0.5 font-mono text-xs text-slate-500">{order.id}</p>
            </div>
            <div className="flex flex-wrap gap-1">
              <span className={'inline-flex rounded-full border px-2 py-0.5 text-xs font-black ' + kindBadgeClass(Boolean(order.is_spot))}>
                {order.is_spot ? 'スポット' : '物件'}
              </span>
              <span className={'inline-flex rounded-full border px-2 py-0.5 text-xs font-black ' + statusBadgeClass(st)}>{orderStatusLabel(st)}</span>
              <LocationPendingBadge order={order} />
            </div>
          </div>

          <div className="mt-4">
            <OrderVisibilityScopePanel
              order={order}
              escalationCtx={escalationCtx}
              factoryNameById={factoryNameById}
            />
          </div>

          <div className="mt-4">
            <OrderMapEditorUrlActions orderId={order.id} siteName={party.site} order={order} />
          </div>

          <dl className="mt-4 grid gap-2 rounded-xl border border-slate-200 bg-slate-50/80 p-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs font-bold text-slate-500">希望日時</dt>
              <dd className="font-black text-slate-900">{formatDateJp(orderDeliveryDate(order))} {formatOrderTime(order)}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-slate-500">業者 / 現場</dt>
              <dd className="font-bold text-slate-900">{party.contractor} · {party.site}</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-slate-500">数量</dt>
              <dd className="font-black text-slate-900">{order.quantityM3 ?? order.quantityCube ?? '—'} m³</dd>
            </div>
            <div>
              <dt className="text-xs font-bold text-slate-500">受注工場</dt>
              <dd className="font-bold text-slate-900">
                {order.factory_site_id ? factoryNameById[order.factory_site_id] || order.factory_site_id : '—'}
              </dd>
            </div>
          </dl>

          <h4 className="mt-5 text-sm font-black text-slate-800">内容を編集</h4>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-black text-slate-600">希望日<input type="date" value={preferredDate} onChange={(e) => setPreferredDate(e.target.value)} className={inputClass} /></label>
            <label className="text-xs font-black text-slate-600">希望時刻<input type="time" value={timeValue} onChange={(e) => setTimeValue(e.target.value)} className={inputClass} /></label>
            <label className="text-xs font-black text-slate-600">数量<input type="text" value={quantityM3} onChange={(e) => setQuantityM3(e.target.value)} className={inputClass} /></label>
            <label className="text-xs font-black text-slate-600">配合<input type="text" value={mixText} onChange={(e) => setMixText(e.target.value)} className={inputClass} /></label>
            <label className="text-xs font-black text-slate-600 sm:col-span-2">現場名<input type="text" value={siteName} onChange={(e) => setSiteName(e.target.value)} className={inputClass} /></label>
          </div>
        </div>
        <div className="flex shrink-0 gap-2 border-t border-slate-200 bg-white p-4">
          <button type="button" onClick={onClose} disabled={saving} className="min-h-[44px] flex-1 rounded-lg border-2 border-slate-300 bg-white text-sm font-black text-slate-700">閉じる</button>
          <button type="submit" disabled={saving} className="min-h-[44px] flex-1 rounded-lg border-2 border-indigo-700 bg-indigo-600 text-sm font-black text-white">{saving ? '保存中…' : '保存'}</button>
        </div>
      </form>
    </div>
  );
}

function OrdersMonitorSection({
  factories,
  factoryNameById,
  schedulesByFactoryId,
  scheduleDate,
  onScheduleDateChange,
  activeMonitorTab,
  onActiveMonitorTabChange,
}) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detailOrder, setDetailOrder] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [projects, setProjects] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [systemSettings, setSystemSettings] = useState({});

  const load = useCallback(async () => {
    setError('');
    try {
      const [{ orders: rows }, projs, hols, settings] = await Promise.all([
        db.fetchOrdersWithChat(),
        db.fetchProjects(),
        db.fetchHolidays(),
        db.fetchSystemSettings(),
      ]);
      setOrders(rows);
      setProjects(projs);
      setHolidays(hols);
      setSystemSettings(settings || {});
    } catch (e) {
      console.error(e);
      setError('注文一覧の取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  }, []);

  const escalationCtx = useMemo(
    () => buildOrderVisibilityContext(orders, factories, projects, systemSettings, holidays, new Date()),
    [orders, factories, projects, systemSettings, holidays],
  );

  useEffect(() => {
    let disposed = false;
    let timerId = null;
    let running = false;
    let pending = false;
    const runLoad = async () => {
      if (running) {
        pending = true;
        return;
      }
      running = true;
      try {
        do {
          pending = false;
          await load();
        } while (pending && !disposed);
      } finally {
        running = false;
      }
    };
    const scheduleLoad = () => {
      pending = true;
      if (timerId != null) return;
      timerId = window.setTimeout(() => {
        timerId = null;
        void runLoad();
      }, 500);
    };
    void runLoad();
    const channel = supabase
      .channel('custom-all-channel')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, scheduleLoad)
      .subscribe();
    return () => {
      disposed = true;
      if (timerId != null) window.clearTimeout(timerId);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const acceptedByFactory = useMemo(() => {
    const grouped = new Map();
    for (const order of orders) {
      if (orderStatus(order) !== 'accepted') continue;
      const fid = String(order.factory_site_id || '').trim();
      if (!fid) continue;
      if (!grouped.has(fid)) grouped.set(fid, []);
      grouped.get(fid).push(order);
    }
    return [...grouped.entries()]
      .map(([factoryId, list]) => ({
        factoryId,
        factoryName: factoryNameById[factoryId] || factoryId,
        orders: [...list].sort((a, b) => orderScheduleSortKey(a).localeCompare(orderScheduleSortKey(b))),
      }))
      .sort((a, b) => a.factoryName.localeCompare(b.factoryName, 'ja'));
  }, [orders, factoryNameById]);

  const visibleOrders = useMemo(() => orders.filter((o) => orderStatus(o) !== 'deleted'), [orders]);
  const pendingCount = visibleOrders.filter((o) => orderStatus(o) === 'pending').length;
  const pendingAssociationCount = visibleOrders.filter((o) => orderStatus(o) === 'pending_association').length;
  const pendingAssociationOrders = useMemo(
    () => visibleOrders.filter((o) => orderStatus(o) === 'pending_association'),
    [visibleOrders],
  );
  const acceptedCount = visibleOrders.filter((o) => orderStatus(o) === 'accepted').length;
  const completedCount = visibleOrders.filter((o) => orderStatus(o) === 'completed').length;
  const cancelledCount = visibleOrders.filter((o) => orderStatus(o) === 'customer_cancelled').length;

  const handleSaveEdit = async (orderId, patch) => {
    setSavingEdit(true);
    setError('');
    try {
      const updated = await db.adminUpdateOrder(orderId, patch);
      if (updated) {
        setOrders((prev) => (Array.isArray(prev) ? prev.map((o) => (o?.id === orderId ? updated : o)) : prev));
      }
      setDetailOrder(null);
    } catch (e) {
      console.error(e);
      setError('注文の編集に失敗しました。');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteOrder = async (order) => {
    if (!order?.id) return;
    if (!window.confirm('本当にこの注文を削除しますか？')) return;
    setError('');
    try {
      const updated = await db.adminDeleteOrder(order.id);
      setOrders((prev) => (Array.isArray(prev) ? prev.map((o) => (o?.id === order.id ? updated : o)) : prev));
    } catch (e) {
      console.error(e);
      setError('注文の削除に失敗しました。');
    }
  };

  const handleApproveAssociation = async (order) => {
    if (!order?.id) return;
    if (!window.confirm('この注文を組合承認し、工場の配車待ち一覧へ回しますか？')) return;
    setError('');
    try {
      const updated = await db.approveOrderForAssociation(order.id);
      if (updated) setOrders((prev) => (Array.isArray(prev) ? prev.map((o) => (o?.id === order.id ? updated : o)) : prev));
    } catch (e) {
      console.error(e);
      setError('組合承認に失敗しました。');
    }
  };

  const handleChangeOrderStatus = async (order, status) => {
    if (!order?.id) return;
    setError('');
    try {
      const patch = {
        status,
        factoryResponseStatus: status === 'completed' || status === 'customer_cancelled' ? status : status === 'accepted' ? 'accepted' : undefined,
        factoryResponseLocked: status === 'accepted' || status === 'completed' || status === 'customer_cancelled',
        factoryPendingStartedAt: undefined,
        factoryPendingByName: undefined,
      };
      const updated = await db.adminUpdateOrder(order.id, patch);
      if (updated) setOrders((prev) => (Array.isArray(prev) ? prev.map((o) => (o?.id === order.id ? updated : o)) : prev));
    } catch (e) {
      console.error(e);
      setError('ステータス変更に失敗しました。');
    }
  };

  const handleDownloadOrdersCsv = () => {
    const rows = [
      ['注文ID', 'ステータス', '希望日', '希望時刻', '種別', '業者', '現場名', '担当者', '連絡先', '受注工場', '数量', '配合'],
      ...visibleOrders.map((o) => {
        const fid = String(o.factory_site_id || '').trim();
        const party = orderPartyInfo(o);
        return [
          o.id,
          orderStatusLabel(orderStatus(o)),
          orderDeliveryDate(o),
          formatOrderTime(o),
          o.is_spot ? 'スポット' : '物件',
          party.contractor,
          party.site,
          party.orderedBy,
          party.phone,
          fid ? factoryNameById[fid] || fid : '',
          o.quantityM3 ?? o.quantityCube ?? '',
          o.confirmedMixText || o.mixText || '',
        ];
      }),
    ];
    downloadCsv(`concrete-link-orders-${todayLocalISODate()}.csv`, rows);
  };

  const viewBtn = (id, label) => (
    <button
      type="button"
      onClick={() => onActiveMonitorTabChange(id)}
      className={'min-h-[40px] rounded-lg border-2 px-3 text-sm font-black transition ' + (activeMonitorTab === id ? 'border-sky-600 bg-sky-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-sky-300')}
    >
      {label}
    </button>
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">全注文モニター</h2>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleDownloadOrdersCsv} className="min-h-[40px] rounded-lg border-2 border-emerald-300 bg-emerald-50 px-3 text-sm font-black text-emerald-800 hover:bg-emerald-100">
            CSV出力
          </button>
          <button type="button" onClick={() => void load()} className="min-h-[40px] rounded-lg border-2 border-slate-300 bg-white px-3 text-sm font-black text-slate-700 hover:bg-slate-50">
            手動更新
          </button>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-6">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="text-xs font-bold text-slate-500">全注文</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{visibleOrders.length}</p>
        </div>
        <div className="cl-alert-warning-panel rounded-xl border border-violet-200 bg-violet-50 px-3 py-3">
          <p className="text-xs font-bold text-violet-700">組合承認待ち</p>
          <p className="mt-1 text-2xl font-black text-violet-900">{pendingAssociationCount}</p>
        </div>
        <div className="cl-alert-warning-panel rounded-xl border border-amber-200 bg-amber-50 px-3 py-3">
          <p className="text-xs font-bold text-amber-700">pending</p>
          <p className="mt-1 text-2xl font-black text-amber-900">{pendingCount}</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3">
          <p className="text-xs font-bold text-emerald-700">accepted</p>
          <p className="mt-1 text-2xl font-black text-emerald-900">{acceptedCount}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="text-xs font-bold text-slate-600">completed</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{completedCount}</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-3">
          <p className="text-xs font-bold text-red-700">cancelled</p>
          <p className="mt-1 text-2xl font-black text-red-900">{cancelledCount}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {viewBtn('orders', '注文一覧')}
        {viewBtn('schedule', 'スケジュール')}
      </div>

      {error ? <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800" role="alert">{error}</p> : null}
      {loading ? <p className="mt-4 text-sm text-slate-500">読み込み中…</p> : null}

      {!loading && activeMonitorTab === 'orders' && pendingAssociationOrders.length > 0 ? (
        <div className="cl-alert-warning-panel mt-4 rounded-xl border-2 border-violet-300 bg-violet-50/60 p-4">
          <h3 className="text-base font-black text-violet-950">組合承認が必要なスポット注文（{pendingAssociationOrders.length}件）</h3>
          <p className="mt-1 text-xs font-medium text-violet-900/90">
            数量上限を超えるスポット注文です。承認するまで工場の通常配車リストには表示されません。
          </p>
          <ul className="mt-3 space-y-2">
            {pendingAssociationOrders.map((o) => {
              const party = orderPartyInfo(o);
              return (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2">
                  <div className="min-w-0">
                    <p className="text-sm font-black text-slate-900">
                      {formatDateJp(orderDeliveryDate(o))} {formatOrderTime(o)} · {party.site}
                    </p>
                    <p className="text-xs font-bold text-slate-600">
                      {o.quantityM3 ?? o.quantityCube ?? '—'} m³ · {party.contractor}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleApproveAssociation(o)}
                    className="min-h-[40px] rounded-lg bg-violet-700 px-3 text-sm font-black text-white hover:bg-violet-800"
                  >
                    組合承認して配車待ちへ
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {!loading && activeMonitorTab === 'orders' ? (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[1500px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-slate-200 bg-slate-50">
                <th className="px-3 py-2 font-black text-slate-700">種別</th>
                <th className="px-3 py-2 font-black text-slate-700">希望日時</th>
                <th className="px-3 py-2 font-black text-slate-700">業者</th>
                <th className="px-3 py-2 font-black text-slate-700">現場名</th>
                <th className="px-3 py-2 font-black text-slate-700">担当者</th>
                <th className="px-3 py-2 font-black text-slate-700">連絡先</th>
                <th className="px-3 py-2 font-black text-slate-700">公開範囲</th>
                <th className="px-3 py-2 font-black text-slate-700">status</th>
                <th className="px-3 py-2 font-black text-slate-700">受注工場</th>
                <th className="px-3 py-2 font-black text-slate-700">注文ID</th>
                <th className="px-3 py-2 font-black text-slate-700">操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleOrders.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-slate-500">注文はありません。</td>
                </tr>
              ) : (
                visibleOrders.map((o) => {
                  const st = orderStatus(o);
                  const fid = String(o.factory_site_id || '').trim();
                  const party = orderPartyInfo(o);
                  return (
                    <tr key={o.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                      <td className="px-3 py-2.5">
                        <span className={'inline-flex rounded-full border px-2 py-0.5 text-xs font-black ' + kindBadgeClass(Boolean(o.is_spot))}>
                          {o.is_spot ? 'スポット' : '物件'}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs text-slate-700">{formatDateJp(orderDeliveryDate(o))} {formatOrderTime(o)}</td>
                      <td className="max-w-[18rem] break-words px-3 py-2.5 font-bold text-slate-900" title={party.contractor}>{party.contractor}</td>
                      <td className="max-w-[16rem] break-words px-3 py-2.5 font-bold text-slate-800" title={party.site}>{party.site}</td>
                      <td className="max-w-[10rem] break-words px-3 py-2.5 text-slate-700">{party.orderedBy}</td>
                      <td className="max-w-[10rem] break-words px-3 py-2.5 font-mono text-xs text-slate-700">{party.phone}</td>
                      <td className="px-3 py-2.5">
                        <OrderVisibilityScopeBadge order={o} escalationCtx={escalationCtx} factoryNameById={factoryNameById} />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          <span className={'inline-flex rounded-full border px-2 py-0.5 text-xs font-black ' + statusBadgeClass(st)}>{orderStatusLabel(st)}</span>
                          {o.is_admin_modified ? (
                            <span className="inline-flex rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-black text-violet-800">管理者変更</span>
                          ) : null}
                          <LocationPendingBadge order={o} className="text-xs" />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-bold text-slate-700">{fid ? factoryNameById[fid] || fid : '—'}</td>
                      <td className="max-w-[14rem] break-all px-3 py-2.5 font-mono text-xs text-slate-500" title={String(o.id || '')}>{o.id}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {st === 'pending_association' ? (
                            <button
                              type="button"
                              onClick={() => void handleApproveAssociation(o)}
                              className="rounded border border-violet-400 bg-violet-100 px-2 py-1 text-xs font-black text-violet-900 hover:bg-violet-200"
                            >
                              組合承認
                            </button>
                          ) : null}
                          {[
                            ['pending', '配車待ち'],
                            ['accepted', '受注'],
                            ['completed', '完了'],
                            ['customer_cancelled', 'キャンセル'],
                          ].map(([nextStatus, label]) => (
                            <button
                              key={nextStatus}
                              type="button"
                              disabled={st === nextStatus}
                              onClick={() => handleChangeOrderStatus(o, nextStatus)}
                              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-black text-slate-700 hover:bg-gray-100 disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-400"
                            >
                              {label}
                            </button>
                          ))}
                          <button type="button" onClick={() => setDetailOrder(o)} className="rounded border border-indigo-300 bg-indigo-50 px-2 py-1 text-xs font-black text-indigo-800 hover:bg-indigo-100">詳細</button>
                          <button type="button" onClick={() => handleDeleteOrder(o)} className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-black text-red-700 hover:bg-red-100">削除</button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {!loading && activeMonitorTab === 'schedule' ? (
        <div className="mt-4 space-y-4">
          {acceptedByFactory.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">受注済みの注文はありません。</p>
          ) : (
            acceptedByFactory.map((group) => (
              <div key={group.factoryId} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-base font-black text-slate-900">{group.factoryName}</h3>
                    <div className="mt-1">
                      <FactoryAvailabilityBadges
                        status={getFactoryDayStatus(
                          schedulesByFactoryId,
                          group.factoryId,
                          scheduleDate,
                          (factories || []).find((f) => f.id === group.factoryId),
                        )}
                      />
                    </div>
                  </div>
                  <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-black text-white">{group.orders.length}件</span>
                </div>
                <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white">
                  {group.orders.map((o) => {
                    const party = orderPartyInfo(o);
                    return (
                      <li key={o.id} className="grid gap-2 px-3 py-3 sm:grid-cols-[12rem_5rem_repeat(4,minmax(0,1fr))] sm:items-center">
                        <p className="font-mono text-sm font-black text-slate-900">{formatDateJp(orderDeliveryDate(o))} {formatOrderTime(o)}</p>
                        <span className={'w-fit rounded-full border px-2 py-0.5 text-xs font-black ' + kindBadgeClass(Boolean(o.is_spot))}>{o.is_spot ? 'スポット' : '物件'}</span>
                        <p className="min-w-0 break-words font-bold text-slate-800"><span className="text-xs text-slate-400">業者 </span>{party.contractor}</p>
                        <p className="min-w-0 break-words font-bold text-slate-800"><span className="text-xs text-slate-400">現場 </span>{party.site}</p>
                        <p className="min-w-0 break-words text-sm text-slate-700"><span className="text-xs text-slate-400">担当 </span>{party.orderedBy}</p>
                        <p className="min-w-0 break-words font-mono text-xs text-slate-700"><span className="font-sans text-xs text-slate-400">連絡先 </span>{party.phone}</p>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))
          )}
        </div>
      ) : null}
      <AdminOrderDetailModal
        order={detailOrder}
        open={Boolean(detailOrder)}
        escalationCtx={escalationCtx}
        factoryNameById={factoryNameById}
        saving={savingEdit}
        onClose={() => setDetailOrder(null)}
        onSave={handleSaveEdit}
      />
    </section>
  );
}

function CustomerInquirySection() {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">問い合わせ対応</h2>
          <p className="mt-1 text-xs text-slate-500">カスタマー（現場）からの問い合わせを確認・対応するための先行UI枠組みです。</p>
        </div>
        <span className="rounded-full border border-slate-300 bg-slate-50 px-3 py-1 text-xs font-black text-slate-600">準備中</span>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-[18rem_1fr]">
        <aside className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-black text-slate-800">問い合わせ一覧</p>
          <div className="mt-3 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-8 text-center text-sm font-bold text-slate-400">
            新着問い合わせはここに表示されます
          </div>
        </aside>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <p className="text-sm font-black text-slate-800">対応メモ・返信エリア</p>
          <textarea
            className="mt-3 min-h-[180px] w-full rounded-xl border-2 border-slate-200 bg-slate-50 p-3 text-sm font-bold text-slate-700 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100"
            placeholder="問い合わせを選択すると、対応履歴と返信フォームを表示します。"
          />
        </div>
      </div>
    </section>
  );
}

function AdminLoginScreen({ onLogin }) {
  const [phoneNumber, setPhoneNumber] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const phone = phoneNumber.trim();
    const pass = password.trim();
    if (!phone || !pass) {
      setError('管理者の電話番号とパスワードを入力してください。');
      return;
    }
    setLoading(true);
    try {
      const admin = await db.loginAdmin(phone, pass);
      try {
        sessionStorage.setItem(ADMIN_AUTH_SESSION_KEY, '1');
      } catch {
        /* ignore */
      }
      onLogin(admin);
    } catch (e2) {
      console.error('管理者ログインエラー', e2);
      setError(e2?.message || '管理者ログインに失敗しました。');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-[100dvh] w-full items-center justify-center overflow-x-hidden bg-gradient-to-br from-slate-950 via-slate-900 to-slate-800 px-4 py-[max(2rem,env(safe-area-inset-top))] text-white">
      <form onSubmit={submit} className="w-full max-w-md rounded-3xl border border-white/10 bg-slate-950/80 p-6 shadow-2xl ring-1 ring-white/10 backdrop-blur sm:p-8">
        <a href="/" className="inline-flex w-fit rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" aria-label="CONCRETE LINK トップへ戻る">
          <img src={concreteLinkLogo} alt="CONCRETE LINK" className="h-12 w-auto rounded bg-white/95 p-1" />
        </a>
        <p className="mt-6 text-xs font-black uppercase tracking-[0.24em] text-indigo-300">Admin Control Panel</p>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-white">管理者専用ログイン</h1>
        <p className="mt-2 text-sm font-bold leading-relaxed text-slate-400">管理者の電話番号とパスワードを入力してください。</p>

        <label className="mt-6 block text-sm font-black text-slate-200" htmlFor="admin-login-phone">管理者の電話番号</label>
        <input
          id="admin-login-phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          value={phoneNumber}
          onChange={(e) => {
            setPhoneNumber(e.target.value);
            setError('');
          }}
          className="mt-2 min-h-[52px] w-full rounded-xl border-2 border-slate-700 bg-slate-900 px-4 text-base font-bold text-white outline-none placeholder:text-slate-500 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/30"
          placeholder="例: 097-123-4567"
        />

        <label className="mt-4 block text-sm font-black text-slate-200" htmlFor="admin-login-password">パスワード</label>
        <input
          id="admin-login-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
            setError('');
          }}
          className="mt-2 min-h-[52px] w-full rounded-xl border-2 border-slate-700 bg-slate-900 px-4 text-base font-bold text-white outline-none placeholder:text-slate-500 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-400/30"
          placeholder="パスワードを入力"
        />

        {error ? <p className="mt-4 rounded-xl border border-red-500/50 bg-red-950/70 px-3 py-2 text-sm font-black text-red-100" role="alert">{error}</p> : null}

        <button type="submit" disabled={loading} className="mt-6 min-h-[52px] w-full rounded-xl border-2 border-indigo-500 bg-indigo-600 px-4 text-base font-black text-white shadow-lg shadow-indigo-950/60 transition hover:bg-indigo-500 active:scale-[0.99] disabled:cursor-wait disabled:border-slate-600 disabled:bg-slate-700">
          {loading ? 'ログイン中…' : '管理者としてログイン'}
        </button>
      </form>
    </div>
  );
}

export function AdminApp() {
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(() => {
    try {
      return sessionStorage.getItem(ADMIN_AUTH_SESSION_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [factories, setFactories] = useState([]);
  const [schedulesByFactoryId, setSchedulesByFactoryId] = useState({});
  const [scheduleDate, setScheduleDate] = useState(() => todayLocalISODate());
  const [tab, setTab] = useState('monitor');
  const [activeMonitorTab, setActiveMonitorTab] = useState('orders');
  const [adminSettings, setAdminSettings] = useState({ admin_name: '', phone_number: '' });
  const factoryNameById = useMemo(() => Object.fromEntries(factories.map((f) => [f.id, f.name])), [factories]);
  const adminDisplayName = String(adminSettings?.admin_name || '').trim() || '管理者';

  const handleAdminLogin = useCallback((admin) => {
    setIsAdminLoggedIn(true);
    if (admin) setAdminSettings(admin);
  }, []);

  const handleAdminLogout = useCallback(() => {
    try {
      sessionStorage.removeItem(ADMIN_AUTH_SESSION_KEY);
    } catch {
      /* ignore */
    }
    setIsAdminLoggedIn(false);
  }, []);

  const loadFactoryStatus = useCallback(async () => {
    try {
      const rows = await db.fetchFactories();
      setFactories(rows);
      const ids = rows.map((f) => f?.id).filter(Boolean);
      const schedules = await db.fetchSchedulesForFactories(ids);
      setSchedulesByFactoryId(schedules);
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    let timerId = null;
    let running = false;
    let pending = false;
    const runLoad = async () => {
      if (running) {
        pending = true;
        return;
      }
      running = true;
      try {
        do {
          pending = false;
          await loadFactoryStatus();
        } while (pending && !disposed);
      } finally {
        running = false;
      }
    };
    const scheduleLoad = () => {
      pending = true;
      if (timerId != null) return;
      timerId = window.setTimeout(() => {
        timerId = null;
        void runLoad();
      }, 500);
    };
    void runLoad();
    const unsub = db.subscribeHaishaRealtime(scheduleLoad);
    return () => {
      disposed = true;
      if (timerId != null) window.clearTimeout(timerId);
      unsub();
    };
  }, [loadFactoryStatus]);

  const loadAdminSettings = useCallback(async () => {
    try {
      const settings = await db.fetchAdminSettings();
      setAdminSettings(settings || { admin_name: '', phone_number: '' });
    } catch (e) {
      console.error('管理者情報取得エラー', e);
    }
  }, []);

  useEffect(() => {
    void loadAdminSettings();
    const unsub = db.subscribeHaishaRealtime((payload) => {
      if (payload?.table === 'admin_settings') void loadAdminSettings();
    });
    return () => unsub();
  }, [loadAdminSettings]);

  const tabBtn = (id, label) => (
    <button
      type="button"
      onClick={() => setTab(id)}
      className={'min-h-[44px] rounded-lg border-2 px-4 text-sm font-black transition ' + (tab === id ? 'border-indigo-600 bg-indigo-600 text-white' : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:border-indigo-500')}
    >
      {label}
    </button>
  );

  if (!isAdminLoggedIn) {
    return <AdminLoginScreen onLogin={handleAdminLogin} />;
  }

  return (
    <div className="min-h-[100dvh] w-full overflow-x-hidden bg-slate-100 pt-11 pb-[max(2.5rem,env(safe-area-inset-bottom))] dark:bg-gray-900 dark:text-gray-100">
      <header className="border-b border-slate-200 bg-white shadow-sm dark:border-slate-700 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl flex-wrap items-start justify-between gap-3 px-4 py-5 sm:px-6">
          <div className="min-w-0">
            <a href="/" className="inline-flex w-fit items-center rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" aria-label="CONCRETE LINK トップへ戻る">
              <img src={concreteLinkLogo} alt="CONCRETE LINK" className="h-10 w-auto" />
            </a>
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{adminDisplayName}</p>
            <p className="mt-2 text-sm text-slate-500">全注文の監視・工場別スケジュール・物件マスタ・休日設定（Supabase 連携）</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ThemeToggle />
            <button type="button" onClick={handleAdminLogout} className="min-h-[40px] rounded-xl border-2 border-slate-300 bg-white px-4 text-sm font-black text-slate-700 shadow-sm transition hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-red-500 dark:hover:bg-red-950/50">
              ログアウト
            </button>
          </div>
        </div>
      </header>
      <main id="admin-dashboard" className="mx-auto w-full max-w-[1600px] space-y-6 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex flex-wrap gap-2">
            {tabBtn('monitor', '注文モニター')}
            {tabBtn('availability', '工場稼働')}
            {tabBtn('adminSettings', '管理者情報設定')}
            {tabBtn('projects', '物件管理')}
            {tabBtn('customers', '業者管理')}
            {tabBtn('inquiries', '問い合わせ対応')}
            {tabBtn('settings', '休日・稼働時間')}
          </div>
        </div>
        {tab === 'monitor' ? (
          <OrdersMonitorSection
            factories={factories}
            factoryNameById={factoryNameById}
            schedulesByFactoryId={schedulesByFactoryId}
            scheduleDate={scheduleDate}
            onScheduleDateChange={setScheduleDate}
            activeMonitorTab={activeMonitorTab}
            onActiveMonitorTabChange={setActiveMonitorTab}
          />
        ) : null}
        {tab === 'availability' ? (
          <FactoryAvailabilitySection
            factories={factories}
            schedulesByFactoryId={schedulesByFactoryId}
            scheduleDate={scheduleDate}
            onScheduleDateChange={setScheduleDate}
          />
        ) : null}
        {tab === 'adminSettings' ? <AdminSettingsSection /> : null}
        {tab === 'projects' ? <ProjectsSection factories={factories} factoryNameById={factoryNameById} /> : null}
        {tab === 'customers' ? <CustomersSection /> : null}
        {tab === 'inquiries' ? <CustomerInquirySection /> : null}
        {tab === 'settings' ? <HolidaysAndSettingsSection /> : null}
      </main>
    </div>
  );
}