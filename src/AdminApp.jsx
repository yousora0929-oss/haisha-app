import React, { useState, useCallback, useEffect, useMemo } from 'react';
import * as db from './haishaDb.js';
import {
  setAdminPanelSession,
  clearAdminPanelSession,
  hasAdminPanelSession,
  ensurePanelRealtimeAuth,
  ADMIN_AUTH_SESSION_KEY,
  readAuthValue,
  writeAuthValue,
  removeAuthValue,
} from './supabaseClient.js';
import { ProjectMapEditorUrlActions } from './components/ProjectMapEditorUrlActions.jsx';
import { DeliveryAreaAddressField } from './components/DeliveryAreaAddressField.jsx';
import { MasterSuggestInput } from './components/MasterSuggestInput.jsx';
import { LocationPendingBadge } from './components/LocationPendingBadge.jsx';
import { OrderVisibilityScopePanel } from './components/OrderVisibilityScopePanel.jsx';
import { OrderVisibilityScopeBadge } from './components/OrderVisibilityScopeBadge.jsx';
import { AssociationOrderApproveModal } from './components/AssociationOrderApproveModal.jsx';
import { OrderFactoryAssignmentForm } from './components/OrderFactoryAssignmentForm.jsx';
import AdminAppReleaseSection from './components/AdminAppReleaseSection.jsx';
import { setAutoReloadBlocked } from './hooks/useAppReleaseControl.js';
import {
  associationAssignedFactoryIds,
} from './utils/associationFactoryAssignment.js';
import {
  canAdminReassignOrderFactories,
  formatFactoryAssignmentSummary,
  shouldResetOrderStatusOnFactoryReassign,
} from './utils/orderFactoryReassign.js';
import { OrderMapEditorUrlActions } from './components/OrderMapEditorUrlActions.jsx';
import { ProjectExternalUrlActions } from './components/ProjectExternalUrlActions.jsx';
import { SiteOrderUrlActions } from './components/SiteOrderUrlActions.jsx';
import { externalUrlValidationMessage } from './utils/urlValidation.js';
import { buildOrderVisibilityContext } from './utils/orderVisibilityScope.js';
import {
  MAP_EDITOR_PROJECT_SAVED_DOM_EVENT,
  MAP_EDITOR_PROJECT_SAVED_EVENT_KEY,
  buildProjectMapEditorUrl,
  openMapEditorWindow,
} from './mapEditorConstants.js';
import {
  formatDeliveryAreasTextInput,
  getDeliveryAreaValidationMessage,
  normalizeAllowedDeliveryAreas,
  parseDeliveryAreasTextInput,
  parseSpotThresholdVolume,
} from './utils/deliveryAreas.js';
import { swapMainFactorySubIds } from './utils/projectFactory.js';
import {
  createSalesStaffMember,
  normalizeSalesStaffList,
} from './utils/salesStaff.js';
import { customerSuggestTexts, organizationSuggestTexts } from './utils/masterSuggest.js';
import { dedupeCustomersByCompany } from './utils/dedupeCustomersByCompany.js';
import { formatPhoneNumberJP } from './utils/phoneFormat.js';
import { fetchTownLocationsForMunicipality, resolveDeliveryPrefecture } from './utils/heartrailsGeo.js';
import { SCHEDULE_BLOCK_IDS, normalizeDayBlockSchedule, todayLocalISODate } from './haishaConstants.js';
import { resolveOrderSiteDisplayName, sanitizeSiteNameValue } from './utils/siteNameDisplay.js';
import { orderPartyInfo } from './utils/orderPartyInfo.js';
import concreteLinkLogo from './assets/concrete-link-logo.svg';
import { APP_BRAND_HOME_LABEL, APP_BRAND_NAME } from './constants/brand.js';
import { ThemeToggle } from './components/ThemeToggle.jsx';
import {
  registerOneSignalUser,
  unregisterOneSignalUser,
  buildAdminOneSignalExternalId,
} from './utils/notification.js';
import { AdminEscalationSection } from './components/AdminEscalationSection.jsx';
import { AdminCsvImportButton } from './components/AdminCsvImportButton.jsx';
import { AdminCsvDownloadButton } from './components/AdminCsvDownloadButton.jsx';
import { AdminFactoryNewsSection } from './components/AdminFactoryNewsSection.jsx';
import { AdminOrgSection } from './components/AdminOrgSection.jsx';
import { AdminCharterSection } from './components/AdminCharterSection.jsx';
import BillingMark from './components/BillingMark.jsx';
import {
  downloadProjectsExportCsv,
  parseProjectsCsvFile,
  stripImportMeta,
} from './utils/adminCsvImport.js';
import {
  findAgentOrganizationByName,
  isUnregisteredTradingCompanyName,
  resolveProjectTradingCompanyName,
} from './utils/projectTradingCompany.js';
import { resolveProjectPartyDisplay } from './utils/projectPartyDisplay.js';

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

function orderStatus(order) {
  return String(order?.status || 'pending');
}

function orderStatusLabel(status) {
  if (status === 'accepted') return '受注';
  if (status === 'completed') return '完了';
  if (status === 'customer_cancelled') return 'キャンセル';
  if (status === 'rejected') return '見送り';
  if (status === 'pending_association') return '組合承認待ち';
  if (status === 'awaiting_admin_followup') return '要フォロー';
  return '配車待ち';
}

function statusBadgeClass(status) {
  if (status === 'customer_cancelled') return 'border-red-400 bg-red-50 text-red-700';
  if (status === 'completed') return 'border-slate-300 bg-slate-100 text-slate-700';
  if (status === 'accepted') return 'border-emerald-300 bg-emerald-50 text-emerald-800';
  if (status === 'rejected') return 'border-red-300 bg-red-50 text-red-800';
  if (status === 'pending_association') return 'cl-alert-association cl-alert-status border-violet-400 bg-violet-50 text-violet-900';
  if (status === 'awaiting_admin_followup') return 'cl-alert-status border-rose-400 bg-rose-50 text-rose-900';
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
    <div className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 py-2 shadow-sm dark:border-slate-700 dark:bg-slate-800">
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
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md dark:border-slate-700 dark:bg-slate-800 sm:p-6">
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
            <div key={group.area} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-3 dark:border-slate-600 dark:bg-slate-900/40">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2 dark:border-slate-600">
                <h3 className="text-base font-black text-slate-900">📍 {group.area}</h3>
                <span className="rounded-full bg-slate-900 px-2 py-0.5 text-xs font-black text-white">{group.rows.length}工場</span>
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {group.rows.map((f) => (
                  <article key={f.factoryId} className={'rounded-xl border-2 p-4 shadow-sm ' + (f.status.allFull ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800')}>
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

/**
 * 納入先（荷卸し地点）リスト
 * 座標は現場地図エディタで管理（このフォームでは読み取り専用）。名称ラベルのみここで編集できる。
 * ラベルの保存は map_annotations のJSONパッチのみで行い、画像PNGは再生成しない。
 */
function ProjectUnloadPointsField({ project, fieldClass }) {
  const projectId = String(project?.id || '').trim();
  const unloadPoints = useMemo(() => {
    const list = project?.map_annotations?.unloadPoints;
    return Array.isArray(list) ? list.filter((u) => u && typeof u === 'object') : [];
  }, [project]);

  const initialLabels = useMemo(() => {
    const map = {};
    for (const u of unloadPoints) {
      map[String(u.id || '')] = String(u.label || '').trim();
    }
    return map;
  }, [unloadPoints]);

  const [labels, setLabels] = useState(initialLabels);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setLabels(initialLabels);
    setNotice('');
    setError('');
  }, [initialLabels]);

  const dirty = useMemo(
    () =>
      Object.keys(initialLabels).some(
        (id) => String(labels[id] ?? '').trim() !== String(initialLabels[id] ?? '').trim(),
      ),
    [labels, initialLabels],
  );

  const openEditor = () => {
    if (!projectId) return;
    const url = buildProjectMapEditorUrl(projectId);
    if (url) openMapEditorWindow(url);
  };

  const handleSaveLabels = async () => {
    if (!projectId || saving) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await db.updateProjectUnloadPointLabels(projectId, labels);
      setNotice('納入先の名称を保存しました');
      window.setTimeout(() => setNotice(''), 3000);
    } catch (e) {
      console.error('納入先名称の保存に失敗', e);
      setError(formatSupabaseError(e, '納入先名称の保存に失敗しました'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black uppercase tracking-wide text-slate-500">
          📦 納入先（荷卸し地点）
          {unloadPoints.length > 0 ? (
            <span className="ml-2 rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-black text-white">
              {unloadPoints.length}件
            </span>
          ) : null}
        </p>
        {projectId ? (
          <button
            type="button"
            onClick={openEditor}
            className="min-h-[36px] rounded-lg border-2 border-emerald-600 bg-white px-3 text-xs font-black text-emerald-800 hover:bg-emerald-50"
          >
            ＋ 現場地図で納入先を追加
          </button>
        ) : null}
      </div>
      {!projectId ? (
        <p className="mt-2 text-[11px] font-medium text-slate-500">
          物件を一度保存すると、現場地図エディタで荷卸し地点（赤〇）を配置できます。
        </p>
      ) : unloadPoints.length === 0 ? (
        <p className="mt-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-xs font-bold text-slate-600">
          現場地図で荷卸し地点（赤〇）を配置してください
        </p>
      ) : (
        <ul className="mt-2 grid gap-2">
          {unloadPoints.map((u, index) => {
            const id = String(u.id || '');
            return (
              <li
                key={id || `unload-${index}`}
                className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-2 sm:grid-cols-[minmax(0,1fr)_auto]"
              >
                <div>
                  <label className="text-[11px] font-bold text-slate-600" htmlFor={`proj-unload-label-${index}`}>
                    名称ラベル（任意）
                  </label>
                  <input
                    id={`proj-unload-label-${index}`}
                    type="text"
                    value={labels[id] ?? ''}
                    onChange={(e) => setLabels((prev) => ({ ...prev, [id]: e.target.value }))}
                    placeholder={`納入先 ${index + 1}（例: 第一プラント搬入口）`}
                    className={fieldClass}
                  />
                </div>
                <div className="self-end text-right font-mono text-[11px] font-bold text-slate-500">
                  <p>緯度: {Number.isFinite(Number(u.lat)) ? Number(u.lat).toFixed(6) : '—'}</p>
                  <p>経度: {Number.isFinite(Number(u.lng)) ? Number(u.lng).toFixed(6) : '—'}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {unloadPoints.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void handleSaveLabels()}
            disabled={saving || !dirty}
            className="min-h-[40px] rounded-lg bg-indigo-600 px-4 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-40"
          >
            {saving ? '保存中…' : '納入先の名称を保存'}
          </button>
          <span className="text-[11px] font-medium text-slate-500">
            座標（緯度・経度）は現場地図エディタで管理します。ここでは名称のみ編集できます。
          </span>
        </div>
      ) : null}
      {notice ? <p className="mt-2 text-xs font-bold text-emerald-700">{notice}</p> : null}
      {error ? (
        <p className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-bold text-red-800" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ProjectForm({
  factories,
  customers,
  agentOrganizations = [],
  allowedDeliveryAreas = [],
  deliveryPrefecture = '',
  salesStaffList = [],
  initial,
  onSave,
  onCancel,
  saving,
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [customerId, setCustomerId] = useState(initial?.customer_id ?? '');
  const [contractorName, setContractorName] = useState('');
  const [tradingCompany, setTradingCompany] = useState(() => resolveProjectTradingCompanyName(initial));
  const [tradingCompanyOrganizationId, setTradingCompanyOrganizationId] = useState(
    initial?.trading_company_organization_id ?? '',
  );
  const [tradingContactName, setTradingContactName] = useState(
    () => String(initial?.trading_contact_name ?? '').trim(),
  );
  const [tradingContactPhone, setTradingContactPhone] = useState(
    () => String(initial?.trading_contact_phone ?? '').trim(),
  );
  const [siteContacts, setSiteContacts] = useState(() => {
    const list = Array.isArray(initial?.site_contacts) ? initial.site_contacts : [];
    return list.length ? list.map((c) => ({ name: c?.name || '', phone: c?.phone || '' })) : [{ name: '', phone: '' }];
  });
  const [siteContactCandidates, setSiteContactCandidates] = useState([]);
  const [subContractor, setSubContractor] = useState(
    initial?.sub_contractor_name ?? initial?.contractor ?? '',
  );
  const [billingTarget, setBillingTarget] = useState(
    initial?.billing_target === 'sub' ? 'sub' : 'main',
  );
  const [mainFactoryId, setMainFactoryId] = useState(initial?.main_factory_id ?? '');
  const [subIds, setSubIds] = useState(() => new Set(initial?.sub_factory_ids ?? []));
  const [mainFactorySwapNotice, setMainFactorySwapNotice] = useState('');
  const [deliveryArea, setDeliveryArea] = useState(initial?.delivery_area ?? '');
  const [siteAddressDetail, setSiteAddressDetail] = useState(initial?.site_address ?? '');
  const [townList, setTownList] = useState([]);
  const [townOptionsLoading, setTownOptionsLoading] = useState(false);
  const [townOptionsError, setTownOptionsError] = useState('');
  const [lat, setLat] = useState(initial?.lat != null && Number.isFinite(initial.lat) ? String(initial.lat) : '');
  const [lng, setLng] = useState(initial?.lng != null && Number.isFinite(initial.lng) ? String(initial.lng) : '');
  const [folderUrl, setFolderUrl] = useState(initial?.folder_url ?? '');
  const [sheetUrl, setSheetUrl] = useState(initial?.sheet_url ?? '');
  const [salesAdminId, setSalesAdminId] = useState(initial?.sales_admin_id ?? '');
  const [salesAdminName, setSalesAdminName] = useState(initial?.sales_admin_name ?? '');
  const [addressError, setAddressError] = useState('');
  const linkedCustomer = useMemo(
    () => (customers || []).find((c) => c && String(c.id) === String(customerId || '')),
    [customers, customerId],
  );
  const townSuggestions = useMemo(
    () =>
      (Array.isArray(townList) ? townList : [])
        .map((row) => ({
          town: String(row?.town ?? row?.name ?? '').trim(),
          town_kana: String(row?.town_kana ?? row?.kana ?? '').trim(),
        }))
        .filter((row) => row.town),
    [townList],
  );
  const staffOptions = useMemo(() => normalizeSalesStaffList(salesStaffList), [salesStaffList]);
  // 物件の元請は会社単位で選ぶ（同一会社の担当者アカウントが複数あっても候補は1件）
  const contractorCustomers = useMemo(
    () =>
      dedupeCustomersByCompany(
        (customers || []).filter((c) => (c?.role ?? 'contractor') === 'contractor'),
      ),
    [customers],
  );

  const handleSalesStaffChange = (staffId) => {
    const id = String(staffId || '').trim();
    if (!id) {
      setSalesAdminId('');
      setSalesAdminName('');
      return;
    }
    const member = staffOptions.find((m) => m.id === id);
    if (member) {
      setSalesAdminId(member.id);
      setSalesAdminName(member.name);
    } else if (id === String(salesAdminId || '').trim()) {
      return;
    }
  };

  useEffect(() => {
    setName(initial?.name ?? '');
    const display = String(initial?.contractor_display_name ?? '').trim();
    const cid = String(initial?.customer_id ?? '').trim();
    if (display) {
      setContractorName(display);
      setCustomerId(cid);
    } else if (cid) {
      const linked = (customers || []).find((c) => c && String(c.id) === cid);
      setContractorName(String(linked?.company_name || linked?.name || '').trim());
      setCustomerId(cid);
    } else {
      setContractorName('');
      setCustomerId('');
    }
    setTradingCompany(resolveProjectTradingCompanyName(initial));
    setTradingCompanyOrganizationId(initial?.trading_company_organization_id ?? '');
    setTradingContactName(String(initial?.trading_contact_name ?? '').trim());
    setTradingContactPhone(String(initial?.trading_contact_phone ?? '').trim());
    {
      const list = Array.isArray(initial?.site_contacts) ? initial.site_contacts : [];
      setSiteContacts(
        list.length
          ? list.map((c) => ({ name: String(c?.name || ''), phone: String(c?.phone || '') }))
          : [{ name: '', phone: '' }],
      );
    }
    setSubContractor(initial?.sub_contractor_name ?? initial?.contractor ?? '');
    setBillingTarget(initial?.billing_target === 'sub' ? 'sub' : 'main');
    setMainFactoryId(initial?.main_factory_id ?? '');
    setSubIds(new Set(initial?.sub_factory_ids ?? []));
    setMainFactorySwapNotice('');
    setDeliveryArea(initial?.delivery_area ?? '');
    setSiteAddressDetail(initial?.site_address ?? '');
    setLat(initial?.lat != null && Number.isFinite(initial.lat) ? String(initial.lat) : '');
    setLng(initial?.lng != null && Number.isFinite(initial.lng) ? String(initial.lng) : '');
    setFolderUrl(initial?.folder_url ?? '');
    setSheetUrl(initial?.sheet_url ?? '');
    const storedId = String(initial?.sales_admin_id ?? '').trim();
    const storedName = String(initial?.sales_admin_name ?? '').trim();
    const staffMember = storedId
      ? staffOptions.find((m) => m.id === storedId)
      : storedName
        ? staffOptions.find((m) => m.name === storedName)
        : null;
    if (staffMember) {
      setSalesAdminId(staffMember.id);
      setSalesAdminName(staffMember.name);
    } else {
      setSalesAdminId(storedId);
      setSalesAdminName(storedName);
    }
    setAddressError('');
  }, [initial, customers, staffOptions]);

  const findCustomerByExactName = useCallback(
    (text) => {
      const q = String(text || '').trim().toLowerCase();
      if (!q) return null;
      return (
        contractorCustomers.find(
          (c) => String(c?.company_name || c?.name || '').trim().toLowerCase() === q,
        ) || null
      );
    },
    [contractorCustomers],
  );

  const handleContractorNameChange = useCallback(
    (text) => {
      setContractorName(text);
      const trimmed = String(text || '').trim();
      if (!trimmed) {
        setCustomerId('');
        return;
      }
      const hit = findCustomerByExactName(trimmed);
      if (hit) setCustomerId(String(hit.id));
    },
    [findCustomerByExactName],
  );

  const handleContractorSelect = useCallback((customer) => {
    if (!customer?.id) return;
    setCustomerId(String(customer.id));
    setContractorName(String(customer.company_name || customer.name || '').trim());
  }, []);

  // 業者（元請）に紐づく会社メンバーを現場担当者サジェスト候補にする（DispatchApp と同 RPC）
  useEffect(() => {
    const cid = String(customerId || '').trim();
    if (!cid) {
      console.log('[AdminSiteContactSuggest] skip fetch: customerId empty', {
        contractorName: String(contractorName || ''),
      });
      setSiteContactCandidates([]);
      return undefined;
    }
    let cancelled = false;
    console.log('[AdminSiteContactSuggest] fetch start', {
      customerId: cid,
      contractorName: String(contractorName || ''),
    });
    void db
      .fetchCompanyMemberSuggestions(cid)
      .then((rows) => {
        if (cancelled) {
          console.log('[AdminSiteContactSuggest] fetch ignored (cancelled)', { customerId: cid });
          return;
        }
        const list = Array.isArray(rows) ? rows : [];
        console.log('[AdminSiteContactSuggest] fetch ok', {
          customerId: cid,
          count: list.length,
          rows: list,
        });
        setSiteContactCandidates(list);
      })
      .catch((err) => {
        console.warn('【SiteContactSuggest】物件フォームの現場担当者候補の取得に失敗 → 自由入力のみで続行', err);
        if (!cancelled) setSiteContactCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [customerId]);

  useEffect(() => {
    const municipality = String(deliveryArea || '').trim();
    if (!municipality) {
      setTownList([]);
      setTownOptionsLoading(false);
      setTownOptionsError('');
      return undefined;
    }

    let cancelled = false;
    setTownOptionsLoading(true);
    setTownOptionsError('');

    fetchTownLocationsForMunicipality(municipality, deliveryPrefecture)
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
        setTownOptionsError(String(err?.message || '町名候補の取得に失敗しました'));
      })
      .finally(() => {
        if (!cancelled) setTownOptionsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [deliveryArea, deliveryPrefecture]);

  const matchedAgentOrganization = useMemo(() => {
    const q = String(tradingCompany || '').trim();
    if (!q) return null;
    return (
      (agentOrganizations || []).find(
        (o) => String(o?.name || '').trim() === q,
      ) || null
    );
  }, [agentOrganizations, tradingCompany]);

  const tradingContactCandidates = useMemo(() => {
    const members = Array.isArray(matchedAgentOrganization?.members)
      ? matchedAgentOrganization.members
      : [];
    return members
      .map((m) => ({
        id: m?.id != null ? String(m.id) : '',
        manager_name: String(m?.manager_name || '').trim(),
        phone_number: String(m?.phone_number || '').trim(),
      }))
      .filter((m) => m.manager_name);
  }, [matchedAgentOrganization]);

  const formatTradingContactLabel = useCallback((member) => {
    const name = String(member?.manager_name || '').trim();
    const phone = String(member?.phone_number || '').trim();
    if (!name) return '';
    return phone ? `${name}（${phone}）` : name;
  }, []);

  const showTradingCompanyWarning = useMemo(
    () => isUnregisteredTradingCompanyName(tradingCompany, agentOrganizations, tradingCompanyOrganizationId),
    [tradingCompany, agentOrganizations, tradingCompanyOrganizationId],
  );

  const handleTradingCompanyChange = useCallback(
    (text) => {
      setTradingCompany(text);
      setTradingContactName('');
      setTradingContactPhone('');
      const trimmed = String(text || '').trim();
      if (!trimmed) {
        setTradingCompanyOrganizationId('');
        return;
      }
      const hit = findAgentOrganizationByName(agentOrganizations, trimmed);
      setTradingCompanyOrganizationId(hit?.id ? String(hit.id) : '');
    },
    [agentOrganizations],
  );

  const handleTradingCompanySelect = useCallback((org) => {
    if (!org?.id) return;
    setTradingCompanyOrganizationId(String(org.id));
    setTradingCompany(String(org.name || '').trim());
    setTradingContactName('');
    setTradingContactPhone('');
  }, []);

  const handleTradingContactNameChange = useCallback(
    (text) => {
      setTradingContactName(text);
      const trimmed = String(text || '').trim().toLowerCase();
      if (!trimmed) return;
      const hit = tradingContactCandidates.find(
        (c) => String(c?.manager_name || '').trim().toLowerCase() === trimmed,
      );
      if (hit?.phone_number) setTradingContactPhone(String(hit.phone_number).trim());
    },
    [tradingContactCandidates],
  );

  const handleTradingContactSelect = useCallback((member) => {
    setTradingContactName(String(member?.manager_name || '').trim());
    setTradingContactPhone(String(member?.phone_number || '').trim());
  }, []);

  const updateSiteContact = (index, key, value) => {
    setSiteContacts((prev) =>
      prev.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    );
  };

  const handleSiteContactSelect = useCallback((index, member) => {
    const contactName = String(member?.name || '').trim();
    const contactPhone = String(member?.phone_number || '').trim();
    setSiteContacts((prev) =>
      prev.map((row, i) =>
        i === index
          ? {
              ...row,
              name: contactName,
              // 候補選択時は電話を上書き（DispatchApp の sitePhone と同様）
              ...(contactPhone ? { phone: contactPhone } : {}),
            }
          : row,
      ),
    );
  }, []);

  const addSiteContact = () => {
    setSiteContacts((prev) => [...prev, { name: '', phone: '' }]);
  };

  const removeSiteContact = (index) => {
    setSiteContacts((prev) => {
      const next = prev.filter((_, i) => i !== index);
      return next.length ? next : [{ name: '', phone: '' }];
    });
  };

  const resolveFactoryName = (factoryId) => {
    const id = String(factoryId || '').trim();
    if (!id) return '工場';
    return factories.find((f) => f && String(f.id) === id)?.name || '工場';
  };

  const handleMainFactoryChange = (newMainId) => {
    const normalizedNew = String(newMainId || '').trim();
    const oldMainId = String(mainFactoryId || '').trim();
    if (normalizedNew === oldMainId) return;
    setMainFactoryId(normalizedNew);
    setSubIds((prev) => swapMainFactorySubIds(prev, oldMainId, normalizedNew));
    if (oldMainId && oldMainId !== normalizedNew) {
      setMainFactorySwapNotice(
        `旧メイン工場「${resolveFactoryName(oldMainId)}」をサブ工場リストに移動しました。保存ボタンを押すまでデータベースには反映されません。`,
      );
    } else {
      setMainFactorySwapNotice('');
    }
  };

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
    setMainFactorySwapNotice('');
    const typed = contractorName.trim();
    let nextCustomerId = String(customerId || '').trim();
    let nextDisplayName = '';

    if (!typed) {
      nextCustomerId = '';
    } else {
      const exactHit = findCustomerByExactName(typed);
      const linked = nextCustomerId
        ? (customers || []).find((c) => c && String(c.id) === nextCustomerId)
        : null;
      const masterName = linked ? String(linked.company_name || linked.name || '').trim() : '';

      if (exactHit) {
        nextCustomerId = String(exactHit.id);
        const exactMaster = String(exactHit.company_name || exactHit.name || '').trim();
        if (typed !== exactMaster) nextDisplayName = typed;
      } else if (nextCustomerId && masterName && typed !== masterName) {
        nextDisplayName = typed;
      } else if (!nextCustomerId) {
        nextDisplayName = typed;
      }
    }

    if (nextCustomerId) {
      const contractorHit = contractorCustomers.find(
        (c) => c && String(c.id) === String(nextCustomerId),
      );
      if (!contractorHit) {
        setAddressError('業者（元請）は業者マスタから選択してください（商社・組合の担当者は指定できません）。');
        return;
      }
    }

    if (billingTarget === 'sub' && !subContractor.trim()) {
      const ok = window.confirm('請求先が下請ですが、業者（下請）が未入力です');
      if (!ok) return;
    }

    onSave({
      name: name.trim(),
      customer_id: nextCustomerId,
      contractor_display_name: nextDisplayName,
      trading_company_name: tradingCompany.trim(),
      trading_company: tradingCompany.trim(),
      trading_company_organization_id: tradingCompanyOrganizationId || null,
      trading_contact_name: tradingContactName.trim(),
      trading_contact_phone: tradingContactPhone.trim(),
      site_contacts: siteContacts,
      contractor: subContractor.trim(),
      sub_contractor_name: subContractor.trim(),
      billing_target: billingTarget,
      main_factory_id: mainFactoryId,
      sub_factory_ids: [...subIds].filter((id) => id && id !== mainFactoryId),
      delivery_area: area,
      site_address: detail,
      lat: lat.trim(),
      lng: lng.trim(),
      folder_url: folderUrl.trim(),
      sheet_url: sheetUrl.trim(),
      sales_admin_id: salesAdminId.trim(),
      sales_admin_name: salesAdminName.trim(),
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
        <MasterSuggestInput
          label="業者（元請）"
          htmlFor="proj-contractor"
          name="proj_contractor"
          value={contractorName}
          onValueChange={handleContractorNameChange}
          onSelect={handleContractorSelect}
          items={contractorCustomers}
          getItemKey={(c) => String(c.id)}
          getItemLabel={(c) => String(c.company_name || c.name || c.id || '').trim()}
          getSearchTexts={customerSuggestTexts}
          placeholder="業者名を入力（候補から選択可）"
          emptyHint="該当する業者がありません（自由入力で表記用として保存できます）"
          inputClassName="min-h-[44px] rounded-lg border-2 border-slate-200 px-3 py-2 text-sm"
        />
        <p className="mt-1 text-[11px] font-medium text-slate-500">
          業者マスタから選ぶと紐づけられます。候補にない名称も自由入力でき、印刷物・専用URLの表記に使われます（任意）。
        </p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <MasterSuggestInput
            label="商社名（任意）"
            htmlFor="proj-trading-company"
            name="proj_trading_company"
            value={tradingCompany}
            onValueChange={handleTradingCompanyChange}
            onSelect={handleTradingCompanySelect}
            items={agentOrganizations}
            getItemKey={(o) => String(o.id)}
            getItemLabel={(o) => String(o.name || '').trim()}
            getSearchTexts={organizationSuggestTexts}
            placeholder="商社名を入力（候補から選択可）"
            emptyHint="該当する商社がありません（自由入力で保存できます）"
            inputClassName="min-h-[44px] rounded-lg border-2 border-slate-200 px-3 py-2 text-sm"
          />
          {showTradingCompanyWarning ? (
            <p className="mt-1 text-xs font-bold text-amber-800" role="status">
              ⚠️ 未登録の商社名です。登録済み商社から選択することを推奨します
            </p>
          ) : null}
          <div className="mt-3 space-y-2">
            <MasterSuggestInput
              label="商社担当者（任意）"
              htmlFor="proj-trading-contact-name"
              name="proj_trading_contact_name"
              value={tradingContactName}
              onValueChange={handleTradingContactNameChange}
              onSelect={handleTradingContactSelect}
              items={tradingContactCandidates}
              getItemKey={(c) => c.id || `${c.manager_name}::${c.phone_number}`}
              getItemLabel={formatTradingContactLabel}
              getSearchTexts={(c) => [c.manager_name || '', c.phone_number || '']}
              placeholder={
                tradingCompany.trim()
                  ? '担当者名を入力（候補から選択可）'
                  : '先に商社名を入力してください'
              }
              emptyHint="候補がありません（自由入力できます）"
              disabled={!tradingCompany.trim()}
              inputClassName="min-h-[44px] rounded-lg border-2 border-slate-200 px-3 py-2 text-sm"
            />
            <div>
              <label className="text-xs font-bold text-slate-600" htmlFor="proj-trading-contact-phone">
                商社担当者連絡先（任意）
              </label>
              <input
                id="proj-trading-contact-phone"
                type="tel"
                value={tradingContactPhone}
                onChange={(e) => setTradingContactPhone(e.target.value)}
                className={fieldClass}
                placeholder="例: 097-xxx-xxxx"
                disabled={!tradingCompany.trim()}
              />
            </div>
          </div>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-600" htmlFor="proj-sub-contractor">業者（下請）</label>
          <input id="proj-sub-contractor" type="text" value={subContractor} onChange={(e) => setSubContractor(e.target.value)} className={fieldClass} placeholder="例: △△建設" />
        </div>
      </div>
      <fieldset className="rounded-lg border border-slate-200 bg-white p-3">
        <legend className="px-1 text-xs font-bold text-slate-600">現場担当者（任意・複数可）</legend>
        <div className="mt-2 space-y-2">
          {siteContacts.map((row, index) => (
            <div key={`site-contact-${index}`} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-start">
              <MasterSuggestInput
                label=""
                htmlFor={`proj-site-contact-name-${index}`}
                name={`proj_site_contact_name_${index}`}
                value={row.name}
                onValueChange={(next) => updateSiteContact(index, 'name', next)}
                onSelect={(member) => handleSiteContactSelect(index, member)}
                items={siteContactCandidates}
                getItemKey={(c) => String(c?.id || `${c?.name}::${c?.phone_number}`)}
                getItemLabel={(c) => {
                  const contactName = String(c?.name || '').trim();
                  const contactPhone = formatPhoneNumberJP(String(c?.phone_number || '').trim());
                  return contactPhone
                    ? `${contactName || '—'}（${contactPhone}）`
                    : contactName;
                }}
                getSearchTexts={(c) => [c?.name || '', c?.phone_number || '']}
                placeholder="担当者名（候補から選択可）"
                emptyHint={
                  !String(customerId || '').trim()
                    ? '業者（元請）を選ぶと担当者候補が表示されます（自由入力もできます）'
                    : '登録された担当者がいません（自由入力もできます）'
                }
                inputClassName="min-h-[44px] rounded-lg border-2 border-slate-200 px-3 py-2 text-sm"
              />
              <input
                type="tel"
                value={row.phone}
                onChange={(e) => updateSiteContact(index, 'phone', e.target.value)}
                className="min-h-[44px] w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
                placeholder="電話番号"
                aria-label={`現場担当者の電話番号 ${index + 1}`}
              />
              <button
                type="button"
                onClick={() => removeSiteContact(index)}
                className="min-h-[44px] rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-bold text-red-700 hover:bg-red-100"
              >
                削除
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addSiteContact}
            className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"
          >
            ＋担当者を追加
          </button>
          <p className="text-[11px] font-medium text-slate-500">
            業者（元請）の担当者マスタから選ぶと、電話番号が自動入力されます（未登録名の自由入力も可）。
          </p>
          <p className="rounded border border-amber-200 bg-amber-50 px-2 py-1 font-mono text-[10px] text-amber-900" role="status">
            [診断] customerId={String(customerId || '').trim() || '(empty)'} / candidates=
            {siteContactCandidates.length}
            {siteContactCandidates.length > 0
              ? ` / ${siteContactCandidates.map((c) => c.name).join(', ')}`
              : ''}
          </p>
        </div>
      </fieldset>
      <fieldset>
        <legend className="text-xs font-bold text-slate-600">請求先</legend>
        <div className="mt-2 flex flex-wrap gap-3">
          <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800">
            <input
              type="radio"
              name="proj-billing-target"
              value="main"
              checked={billingTarget === 'main'}
              onChange={() => setBillingTarget('main')}
              className="h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            元請に請求
          </label>
          <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-800">
            <input
              type="radio"
              name="proj-billing-target"
              value="sub"
              checked={billingTarget === 'sub'}
              onChange={() => setBillingTarget('sub')}
              className="h-4 w-4 border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            下請に請求
          </label>
        </div>
      </fieldset>
      <div>
        <label className="text-xs font-bold text-slate-600" htmlFor="proj-main-factory">
          メイン工場（1社） <span className="text-red-600">*</span>
        </label>
        <select
          id="proj-main-factory"
          value={mainFactoryId}
          onChange={(e) => handleMainFactoryChange(e.target.value)}
          className={fieldClass}
          required
        >
          <option value="">選択してください</option>
          {factories.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
        {mainFactorySwapNotice ? (
          <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold leading-relaxed text-amber-900" role="status">
            {mainFactorySwapNotice}
          </p>
        ) : null}
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
      <div>
        <label className="text-xs font-bold text-slate-600" htmlFor="proj-sales-admin">
          担当営業
        </label>
        <select
          id="proj-sales-admin"
          value={salesAdminId}
          onChange={(e) => handleSalesStaffChange(e.target.value)}
          className={fieldClass}
        >
          <option value="">未設定</option>
          {salesAdminId && !staffOptions.some((m) => m.id === salesAdminId) ? (
            <option value={salesAdminId}>{salesAdminName || salesAdminId}（マスタ未登録）</option>
          ) : null}
          {staffOptions.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
              {m.phone ? `（${m.phone}）` : ''}
            </option>
          ))}
        </select>
        {salesAdminId ? (
          <p className="mt-1 font-mono text-[11px] text-slate-500">ID: {salesAdminId}</p>
        ) : null}
        <p className="mt-1 text-[11px] font-medium text-slate-500">
          「管理者情報設定」で担当営業を登録できます。全工場拒否時は管理画面の「要フォロー」で確認してください（SMS通知は将来対応）。
        </p>
        {staffOptions.length === 0 ? (
          <p className="mt-1 text-[11px] font-bold text-amber-800">担当営業が未登録です。先に管理者情報設定で追加してください。</p>
        ) : null}
      </div>
      <DeliveryAreaAddressField
        idPrefix="proj"
        allowedAreas={allowedDeliveryAreas}
        deliveryArea={deliveryArea}
        onDeliveryAreaChange={setDeliveryArea}
        addressDetail={siteAddressDetail}
        onAddressDetailChange={setSiteAddressDetail}
        showTownSuggestions
        townSuggestions={townSuggestions}
        townSuggestionsLoading={townOptionsLoading}
        townSuggestionsError={townOptionsError}
      />
      {addressError ? (
        <p className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800" role="alert">
          {addressError}
        </p>
      ) : null}
      <ProjectMapEditorUrlActions
        projectId={initial?.id}
        projectName={name}
        project={initial}
        variant="default"
      />
      <ProjectUnloadPointsField project={initial} fieldClass={fieldClass} />
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
          <p className="text-xs font-black text-slate-700">物件専用発注URL</p>
          <p className="mt-0.5 text-[11px] font-medium text-slate-500">
            ゲスト発注・QRコード用。保存後に URL をコピーできます。
          </p>
          <div className="mt-2">
            <SiteOrderUrlActions
              urlToken={initial?.url_token}
              siteName={name || initial?.name}
              customerName={linkedCustomer?.company_name || linkedCustomer?.name}
              traderName={resolveProjectTradingCompanyName(initial)}
              project={initial}
              customer={linkedCustomer}
              compact={false}
            />
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium text-slate-600">
          保存すると専用発注URLが自動発行されます。
        </p>
      )}
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
  const [agentOrganizations, setAgentOrganizations] = useState([]);
  const [allowedDeliveryAreas, setAllowedDeliveryAreas] = useState([]);
  const [salesStaff, setSalesStaff] = useState([]);
  const [deliveryPrefecture, setDeliveryPrefecture] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formMode, setFormMode] = useState(null);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [importNotice, setImportNotice] = useState('');

  const defaultMainFactoryId = factories?.[0]?.id ?? '';

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [rows, customerRows, agentOrgRows, settings] = await Promise.all([
        db.fetchProjects(),
        db.fetchCustomers(),
        db.fetchOrganizationsWithMembers('agent').catch((e) => {
          console.warn('[ProjectsSection] agent organizations load failed', e);
          return [];
        }),
        db.fetchAdminSettings(),
      ]);
      setProjects(rows);
      setCustomers(customerRows);
      setAgentOrganizations(agentOrgRows || []);
      setAllowedDeliveryAreas(normalizeAllowedDeliveryAreas(settings?.allowed_delivery_areas));
      setSalesStaff(normalizeSalesStaffList(settings?.sales_staff));
      setDeliveryPrefecture(resolveDeliveryPrefecture(settings));
    } catch (e) {
      console.error('物件取得エラー', e);
      setError(formatSupabaseError(e, '物件一覧の取得に失敗しました'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const refreshProjectAfterMapSave = async (projectId) => {
      const id = String(projectId || '').trim();
      if (!id) return;
      try {
        const rows = await db.fetchProjects();
        setProjects(rows);
        if (String(editing?.id) === id) {
          const fresh = rows.find((p) => String(p?.id) === id);
          if (fresh) setEditing(fresh);
        }
      } catch (e) {
        console.error('[ProjectsSection] project map saved refresh failed', e);
      }
    };

    const onProjectMapSaved = (event) => {
      void refreshProjectAfterMapSave(event?.detail?.projectId);
    };

    const onStorage = (event) => {
      if (event.key !== MAP_EDITOR_PROJECT_SAVED_EVENT_KEY) return;
      try {
        const parsed = JSON.parse(String(event.newValue || '{}'));
        void refreshProjectAfterMapSave(parsed?.projectId);
      } catch {
        /* ignore */
      }
    };

    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'haisha_map_editor_project_saved') {
        void refreshProjectAfterMapSave(event.data?.projectId);
      }
    };

    window.addEventListener(MAP_EDITOR_PROJECT_SAVED_DOM_EVENT, onProjectMapSaved);
    window.addEventListener('storage', onStorage);
    window.addEventListener('message', onMessage);
    return () => {
      window.removeEventListener(MAP_EDITOR_PROJECT_SAVED_DOM_EVENT, onProjectMapSaved);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('message', onMessage);
    };
  }, [editing?.id]);

  useEffect(() => {
    let timerId = null;
    let unsub = () => {};
    void (async () => {
      unsub = await db.subscribeHaishaRealtime((payload) => {
        if (payload?.table === 'customers' || payload?.table === 'admin_settings' || payload?.table === 'organizations') {
          if (timerId != null) window.clearTimeout(timerId);
          timerId = window.setTimeout(() => {
            timerId = null;
            void load();
          }, 500);
        }
      });
    })();
    return () => {
      if (timerId != null) window.clearTimeout(timerId);
      unsub();
    };
  }, [load]);

  const handleSave = async (payload) => {
    setSaving(true);
    setError('');
    try {
      const saved = editing?.id
        ? await db.updateProject(editing.id, payload)
        : await db.insertProject(payload);
      setFormMode('edit');
      setEditing(saved);
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
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => { setEditing(null); setFormMode('add'); }} className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-sm font-black text-white hover:bg-indigo-700">＋ 物件を追加</button>
          <AdminCsvImportButton
            label="CSV一括取込"
            disabled={!defaultMainFactoryId}
            entityLabel="件の物件"
            parseFile={(file) =>
              parseProjectsCsvFile(file, {
                customers,
                mainFactoryId: defaultMainFactoryId,
                allowedDeliveryAreas,
                agentOrganizations,
              })
            }
            previewColumns={[
              { key: 'name', label: '物件名' },
              {
                key: 'contractor',
                label: '元請業者',
                render: (r) => r.__contractorLabel || customers.find((c) => c.id === r.customer_id)?.company_name || '—',
              },
              { key: 'contractor_display_name', label: '業者名（表記用）' },
              { key: 'trading_company_name', label: '商社名' },
              { key: 'delivery_area', label: 'エリア' },
              { key: 'site_address', label: '現場住所' },
            ]}
            onImport={async (preview) => {
              const payload = preview.rows.map(stripImportMeta);
              await db.bulkInsertProjects(payload);
              const skipped = preview.skipped?.length ?? 0;
              const unregisteredWarnings = (preview.warnings || []).filter((w) =>
                String(w).startsWith('未登録商社名:'),
              );
              const warningNote = unregisteredWarnings.length ? ` ${unregisteredWarnings.join(' ')}` : '';
              setImportNotice(
                `${payload.length}件の物件を取り込みました。${skipped > 0 ? `（${skipped}行スキップ）` : ''}${warningNote}`,
              );
            }}
            onComplete={() => {
              void load();
              window.setTimeout(() => setImportNotice(''), 5000);
            }}
          />
          <AdminCsvDownloadButton
            disabled={loading}
            onDownload={() => {
              downloadProjectsExportCsv(projects, customers);
              setImportNotice(`${projects.length}件の物件をCSVでダウンロードしました。`);
              window.setTimeout(() => setImportNotice(''), 4000);
            }}
          />
        </div>
      </div>
      {!defaultMainFactoryId ? (
        <p className="mt-2 text-xs font-bold text-amber-800">CSV取込には工場マスタの登録が必要です。</p>
      ) : null}
      {importNotice ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800" role="status">
          {importNotice}
        </p>
      ) : null}
      {error ? <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800" role="alert">{error}</p> : null}
      {formMode ? (
        <div className="mt-4">
          <ProjectForm
            factories={factories}
            customers={customers}
            agentOrganizations={agentOrganizations}
            allowedDeliveryAreas={allowedDeliveryAreas}
            deliveryPrefecture={deliveryPrefecture}
            salesStaffList={salesStaff}
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
          <table className="w-full min-w-[900px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-slate-200 bg-slate-50">
                <th className="px-3 py-2 font-black text-slate-700">物件名</th>
                <th className="px-3 py-2 font-black text-slate-700">業者（元請）</th>
                <th className="px-3 py-2 font-black text-slate-700">下請</th>
                <th className="px-3 py-2 font-black text-slate-700">商社</th>
                <th className="px-3 py-2 font-black text-slate-700">メイン工場</th>
                <th className="px-3 py-2 font-black text-slate-700">サブ工場</th>
                <th className="px-3 py-2 font-black text-slate-700">緯度・経度</th>
                <th className="px-3 py-2 font-black text-slate-700">リンク</th>
                <th className="px-3 py-2 font-black text-slate-700">操作</th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => {
                const customer = customers.find(
                  (c) => String(c?.id || '') === String(p.customer_id || ''),
                );
                const display = resolveProjectPartyDisplay(p, customer);
                return (
                  <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                    <td className="px-3 py-2.5 font-bold text-slate-900">{p.name}</td>
                    <td className="px-3 py-2.5 font-bold text-slate-800">
                      {display.prime}
                      {display.billOnPrime ? <BillingMark /> : null}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">
                      <span className="font-bold text-slate-800">{display.sub}</span>
                      {display.billOnSub && display.sub !== '—' ? <BillingMark /> : null}
                      {display.billOnSub && display.sub === '—' ? (
                        <span className="mt-0.5 block text-[10px] font-bold text-red-600">
                          ⚠請求先未設定
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-slate-700">
                      {display.trader}
                    </td>
                  <td className="px-3 py-2.5">{factoryNameById[p.main_factory_id] || '—'}</td>
                  <td className="max-w-[12rem] px-3 py-2.5 text-xs text-slate-600">{(p.sub_factory_ids || []).map((id) => factoryNameById[id] || id).join('、') || '—'}</td>
                  <td className="px-3 py-2.5 font-mono text-xs">{p.lat != null && p.lng != null ? `${p.lat}, ${p.lng}` : '—'}</td>
                  <td className="min-w-[10rem] px-3 py-2.5">
                    <div className="flex flex-col gap-2">
                      <SiteOrderUrlActions
                        urlToken={p.url_token}
                        siteName={p.name}
                        customerName={customers.find((c) => c.id === p.customer_id)?.company_name || customers.find((c) => c.id === p.customer_id)?.name}
                        traderName={resolveProjectTradingCompanyName(p)}
                        project={p}
                        customer={customers.find((c) => c.id === p.customer_id)}
                        compact
                      />
                      <ProjectExternalUrlActions folderUrl={p.folder_url} sheetUrl={p.sheet_url} variant="compact" />
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex flex-wrap gap-1">
                      <button type="button" onClick={() => { setEditing(p); setFormMode('edit'); }} className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-bold hover:bg-slate-50">編集</button>
                      <button type="button" onClick={() => handleDelete(p)} className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-bold text-red-800 hover:bg-red-100">削除</button>
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
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
  const [salesStaff, setSalesStaff] = useState([]);
  const [newStaffName, setNewStaffName] = useState('');
  const [newStaffPhone, setNewStaffPhone] = useState('');
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
      setSalesStaff(normalizeSalesStaffList(settings.sales_staff));
      setNewStaffName('');
      setNewStaffPhone('');
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
    let unsub = () => {};
    void (async () => {
      unsub = await db.subscribeHaishaRealtime((payload) => {
        if (payload?.table === 'admin_settings') void load();
      });
    })();
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
        sales_staff: salesStaff,
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

  const handleAddSalesStaff = (e) => {
    e.preventDefault();
    setError('');
    try {
      const member = createSalesStaffMember({ name: newStaffName, phone: newStaffPhone });
      setSalesStaff((prev) => normalizeSalesStaffList([...(prev || []), member]));
      setNewStaffName('');
      setNewStaffPhone('');
    } catch (err) {
      setError(err instanceof Error ? err.message : '担当営業の追加に失敗しました');
    }
  };

  const handleRemoveSalesStaff = (staffId) => {
    const id = String(staffId || '').trim();
    if (!id) return;
    setSalesStaff((prev) => (prev || []).filter((m) => m.id !== id));
  };

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
          <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-sm font-black text-slate-800">担当営業マスタ</h3>
            <p className="mt-1 text-[11px] font-medium text-slate-500">
              物件の「担当営業」プルダウンに表示されます。電話番号は将来のSMS通知用です（現在は未対応）。
            </p>
            <ul className="mt-3 space-y-2">
              {salesStaff.length === 0 ? (
                <li className="text-sm text-slate-500">登録された担当営業はありません。</li>
              ) : (
                salesStaff.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    <div className="min-w-0">
                      <p className="text-sm font-black text-slate-900">{m.name}</p>
                      <p className="font-mono text-[11px] text-slate-500">ID: {m.id}</p>
                      {m.phone ? <p className="text-xs text-slate-600">{m.phone}</p> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRemoveSalesStaff(m.id)}
                      className="shrink-0 rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-bold text-red-800"
                    >
                      削除
                    </button>
                  </li>
                ))
              )}
            </ul>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
              <div>
                <label className="text-xs font-bold text-slate-600" htmlFor="admin-new-staff-name">担当営業名</label>
                <input
                  id="admin-new-staff-name"
                  type="text"
                  value={newStaffName}
                  onChange={(e) => setNewStaffName(e.target.value)}
                  className={fieldClass}
                  placeholder="例: 山田営業"
                />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-600" htmlFor="admin-new-staff-phone">電話番号（任意）</label>
                <input
                  id="admin-new-staff-phone"
                  type="tel"
                  value={newStaffPhone}
                  onChange={(e) => setNewStaffPhone(e.target.value)}
                  className={fieldClass}
                  placeholder="将来SMS用"
                />
              </div>
              <button
                type="button"
                onClick={handleAddSalesStaff}
                className="min-h-[44px] rounded-lg border-2 border-indigo-300 bg-indigo-50 px-4 text-sm font-black text-indigo-800 hover:bg-indigo-100"
              >
                追加
              </button>
            </div>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={saving} className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-sm font-black text-white shadow hover:bg-indigo-700 disabled:opacity-50">
              {saving ? '保存中…' : '管理者情報設定を保存'}
            </button>
          </div>
        </form>
      )}
      <AdminAppReleaseSection />
    </section>
  );
}

function AdminOrderDetailModal({
  order,
  project,
  open,
  saving,
  savingReassign,
  escalationCtx,
  factoryNameById,
  factories,
  onApproveAssociation,
  onReassignFactories,
  onClose,
  onSave,
}) {
  const [preferredDate, setPreferredDate] = useState('');
  const [timeValue, setTimeValue] = useState('');
  const [quantityM3, setQuantityM3] = useState('');
  const [mixText, setMixText] = useState('');
  const [siteName, setSiteName] = useState('');
  const [editingFactories, setEditingFactories] = useState(false);

  useEffect(() => {
    if (!open || !order) return;
    setEditingFactories(false);
    setPreferredDate(orderDeliveryDate(order));
    const t = formatOrderTime(order);
    setTimeValue(t === '—' ? '' : t);
    const q = order.quantityM3 ?? order.quantityCube ?? order.confirmedQuantityM3 ?? '';
    setQuantityM3(q != null ? String(q) : '');
    setMixText(order.mixText != null ? String(order.mixText) : '');
    setSiteName(orderSiteName(order) === '（現場名未入力）' ? '' : orderSiteName(order));
  }, [open, order]);

  if (!open || !order) return null;

  const party = orderPartyInfo(order, { preferSiteContact: true });
  const st = orderStatus(order);
  const assignedIds = associationAssignedFactoryIds(order);
  const preferredId = String(order.preferred_factory_id || order.preferredFactoryId || '').trim();
  const displayAssigned =
    assignedIds.length > 0
      ? formatFactoryAssignmentSummary(assignedIds, factoryNameById)
      : preferredId
        ? factoryNameById[preferredId] || preferredId
        : '—';
  const canReassign = canAdminReassignOrderFactories(order);
  const willResetOnReassign = shouldResetOrderStatusOnFactoryReassign(order);

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

          {st === 'pending_association' && onApproveAssociation ? (
            <div className="mt-4 rounded-xl border-2 border-violet-300 bg-violet-50/80 p-4">
              <p className="text-sm font-black text-violet-950">組合承認（手配先工場の指定）</p>
              <p className="mt-1 text-xs font-medium text-violet-900/90">
                この注文は工場に未公開です。手配先を選んで承認してください。
              </p>
              <button
                type="button"
                onClick={() => onApproveAssociation(order)}
                className="mt-3 min-h-[44px] w-full rounded-lg border-2 border-violet-800 bg-violet-700 px-4 text-sm font-black text-white hover:bg-violet-800"
              >
                工場を指定して手配・承認…
              </button>
            </div>
          ) : null}

          {canReassign && onReassignFactories ? (
            <div className="mt-4 rounded-xl border-2 border-indigo-200 bg-indigo-50/70 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-black text-indigo-950">手配先工場</p>
                  <p className="mt-1 text-sm font-bold text-slate-900">{displayAssigned}</p>
                  {willResetOnReassign ? (
                    <p className="mt-1 text-xs font-medium text-amber-800">
                      変更時は受注・確認済み状態を解除し、配車待ち（pending）へ差し戻します。
                    </p>
                  ) : null}
                </div>
                {!editingFactories ? (
                  <button
                    type="button"
                    disabled={saving || savingReassign}
                    onClick={() => setEditingFactories(true)}
                    className="min-h-[40px] shrink-0 rounded-lg border-2 border-indigo-600 bg-white px-3 text-sm font-black text-indigo-800 hover:bg-indigo-100 disabled:opacity-50"
                  >
                    手配先を変更
                  </button>
                ) : null}
              </div>
              {editingFactories ? (
                <div className="mt-3 border-t border-indigo-200 pt-3">
                  <OrderFactoryAssignmentForm
                    order={order}
                    factories={factories}
                    factoryNameById={factoryNameById}
                    escalationCtx={escalationCtx}
                    disabled={saving || savingReassign}
                    previewStatus={willResetOnReassign ? 'pending' : st}
                  >
                    {({ buildSelection, mainFactoryId }) => (
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          disabled={saving || savingReassign}
                          onClick={() => setEditingFactories(false)}
                          className="min-h-[44px] flex-1 rounded-lg border-2 border-slate-300 bg-white px-3 text-sm font-black text-slate-700"
                        >
                          キャンセル
                        </button>
                        <button
                          type="button"
                          disabled={saving || savingReassign || !mainFactoryId}
                          onClick={() => {
                            const sel = buildSelection();
                            if (!sel) {
                              window.alert('メインの手配先工場を選択してください。');
                              return;
                            }
                            const msg = willResetOnReassign
                              ? '手配先を変更し、ステータスを配車待ちに戻します。新しい工場が再度確認・受注できます。続行しますか？'
                              : '手配先工場を変更します。続行しますか？';
                            if (!window.confirm(msg)) return;
                            void (async () => {
                              await onReassignFactories(order.id, sel);
                              setEditingFactories(false);
                            })();
                          }}
                          className="min-h-[44px] flex-1 rounded-lg border-2 border-indigo-700 bg-indigo-600 px-3 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50"
                        >
                          {savingReassign ? '更新中…' : '手配先を更新'}
                        </button>
                      </div>
                    )}
                  </OrderFactoryAssignmentForm>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-4">
            <OrderMapEditorUrlActions orderId={order.id} siteName={party.site} order={order} project={project} />
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
              <dt className="text-xs font-bold text-slate-500">受注確定工場</dt>
              <dd className="font-bold text-slate-900">
                {order.factory_site_id ? factoryNameById[order.factory_site_id] || order.factory_site_id : '—'}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-bold text-slate-500">手配先（メイン・応援）</dt>
              <dd className="font-bold text-slate-900">{displayAssigned}</dd>
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

function AdminFollowupOrderCard({
  order,
  factories,
  factoryNameById,
  chatMessages,
  adminName,
  onOpenDetail,
  onOrderUpdated,
}) {
  const [noteType, setNoteType] = useState('phone');
  const [noteContent, setNoteContent] = useState('');
  const [selectedFactoryId, setSelectedFactoryId] = useState('');
  const [savingNote, setSavingNote] = useState(false);
  const [savingAssign, setSavingAssign] = useState(false);
  const [localError, setLocalError] = useState('');
  const [showChat, setShowChat] = useState(false);

  const party = orderPartyInfo(order, { preferSiteContact: true });
  const rejectedIds = Array.isArray(order.rejected_factory_ids) ? order.rejected_factory_ids : [];
  const notes = Array.isArray(order.admin_followup_notes)
    ? order.admin_followup_notes
    : Array.isArray(order.adminFollowupNotes)
      ? order.adminFollowupNotes
      : [];
  const messages = Array.isArray(chatMessages) ? chatMessages : [];

  const handleAddNote = async () => {
    if (!noteContent.trim()) return;
    setSavingNote(true);
    setLocalError('');
    try {
      const updated = await db.appendAdminFollowupNote(order.id, {
        type: noteType,
        content: noteContent.trim(),
        adminId: 'admin_1',
        adminName: adminName || '管理者',
      });
      onOrderUpdated(updated);
      setNoteContent('');
    } catch (e) {
      console.error(e);
      setLocalError('外部対応記録の保存に失敗しました。');
    } finally {
      setSavingNote(false);
    }
  };

  const handleAssignFactory = async () => {
    const fid = String(selectedFactoryId || '').trim();
    if (!fid) return;
    if (!window.confirm(`${factoryNameById[fid] || fid} に手動配車しますか？`)) return;
    setSavingAssign(true);
    setLocalError('');
    try {
      const updated = await db.adminAssignFactoryFromFollowup(order.id, fid, {
        factoryName: factoryNameById[fid] || fid,
        adminName: adminName || '管理者',
      });
      onOrderUpdated(updated);
    } catch (e) {
      console.error(e);
      setLocalError('工場の手動指定に失敗しました。');
    } finally {
      setSavingAssign(false);
    }
  };

  const noteTypeLabel = (type) => {
    if (type === 'email') return 'メール';
    if (type === 'phone') return '電話';
    if (type === 'meeting') return '面談';
    return 'その他';
  };

  return (
    <li className="rounded-xl border border-rose-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-black text-slate-900">
            {formatDateJp(orderDeliveryDate(order))} {formatOrderTime(order)} · {party.site}
          </p>
          <p className="mt-1 text-xs font-bold text-slate-600">
            {party.contractor} · 担当 {party.orderedBy} · {party.phone}
          </p>
          <p className="mt-2 text-xs text-slate-600">
            拒否工場:{' '}
            {rejectedIds.length
              ? rejectedIds.map((id) => factoryNameById[id] || id).join('、')
              : '—'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setShowChat((v) => !v)}
            className="min-h-[36px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-black text-slate-700"
          >
            {showChat ? 'チャットを閉じる' : 'チャットを開く'}
          </button>
          <button
            type="button"
            onClick={() => onOpenDetail(order)}
            className="min-h-[36px] rounded-lg border border-indigo-300 bg-indigo-50 px-3 text-xs font-black text-indigo-800"
          >
            注文詳細
          </button>
        </div>
      </div>

      {showChat ? (
        <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs">
          {messages.length === 0 ? (
            <p className="text-slate-500">チャットはまだありません。</p>
          ) : (
            messages.map((m) => (
              <p key={m.id} className="mb-2 border-b border-slate-200 pb-2 last:mb-0 last:border-0">
                <span className="font-black text-slate-700">[{m.from}]</span>{' '}
                <span className="text-slate-500">{m.createdAt ? new Date(m.createdAt).toLocaleString('ja-JP') : ''}</span>
                <br />
                {m.body}
              </p>
            ))
          )}
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
          <h4 className="text-xs font-black text-slate-700">外部対応記録</h4>
          <div className="mt-2 flex flex-wrap gap-2">
            <select
              value={noteType}
              onChange={(e) => setNoteType(e.target.value)}
              className="min-h-[36px] rounded-md border border-slate-200 bg-white px-2 text-xs font-bold"
            >
              <option value="email">メール</option>
              <option value="phone">電話</option>
              <option value="meeting">面談</option>
              <option value="other">その他</option>
            </select>
            <button
              type="button"
              onClick={handleAddNote}
              disabled={savingNote || !noteContent.trim()}
              className="min-h-[36px] rounded-md bg-slate-800 px-3 text-xs font-black text-white disabled:opacity-50"
            >
              {savingNote ? '保存中…' : '記録を追加'}
            </button>
          </div>
          <textarea
            value={noteContent}
            onChange={(e) => setNoteContent(e.target.value)}
            rows={3}
            placeholder="メール送信内容・電話メモなど"
            className="mt-2 w-full rounded-md border border-slate-200 bg-white px-2 py-1.5 text-xs"
          />
          {notes.length > 0 ? (
            <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto text-[11px] text-slate-700">
              {[...notes].reverse().map((n) => (
                <li key={n.id} className="rounded border border-slate-200 bg-white px-2 py-1">
                  <span className="font-black">{noteTypeLabel(n.type)}</span>
                  {' · '}
                  {n.admin_name || '管理者'}
                  {' · '}
                  {n.timestamp ? new Date(n.timestamp).toLocaleString('ja-JP') : ''}
                  <br />
                  {n.content}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
          <h4 className="text-xs font-black text-slate-700">工場を手動指定</h4>
          <p className="mt-1 text-[11px] text-slate-500">顧客と相談のうえ、依頼先工場を選んで配車待ちに戻します。</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <select
              value={selectedFactoryId}
              onChange={(e) => setSelectedFactoryId(e.target.value)}
              className="min-h-[36px] min-w-[12rem] flex-1 rounded-md border border-slate-200 bg-white px-2 text-xs font-bold"
            >
              <option value="">工場を選択</option>
              {(factories || []).map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name || f.id}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleAssignFactory}
              disabled={savingAssign || !selectedFactoryId}
              className="min-h-[36px] rounded-md bg-indigo-700 px-3 text-xs font-black text-white disabled:opacity-50"
            >
              {savingAssign ? '指定中…' : '工場を指定'}
            </button>
          </div>
        </div>
      </div>

      {localError ? <p className="mt-2 text-xs font-bold text-red-700">{localError}</p> : null}
    </li>
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
  const [associationApproveOrder, setAssociationApproveOrder] = useState(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [savingAssociation, setSavingAssociation] = useState(false);
  const [savingReassign, setSavingReassign] = useState(false);
  const [projects, setProjects] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [holidays, setHolidays] = useState([]);
  const [systemSettings, setSystemSettings] = useState({});
  const [escalationStepsByFactoryId, setEscalationStepsByFactoryId] = useState({});
  const [nearPoolSize, setNearPoolSize] = useState(5);
  const [factorySmallVehicleInfo, setFactorySmallVehicleInfo] = useState({});
  const [monthlyVolumeByFactory, setMonthlyVolumeByFactory] = useState({});
  const [chatThreads, setChatThreads] = useState({});
  const [adminName, setAdminName] = useState('管理者');
  /** 受注ボタン押下後の工場選択ドラフト { orderId, factoryId } */
  const [acceptDraft, setAcceptDraft] = useState(null);
  const [ordersSearchQuery, setOrdersSearchQuery] = useState('');

  useEffect(() => {
    const editing = Boolean(detailOrder || associationApproveOrder || acceptDraft || savingEdit || savingAssociation || savingReassign);
    setAutoReloadBlocked(editing);
    return () => setAutoReloadBlocked(false);
  }, [detailOrder, associationApproveOrder, acceptDraft, savingEdit, savingAssociation, savingReassign]);

  const load = useCallback(async () => {
    setError('');
    try {
      const [{ orders: rows, chatThreads: threads }, projs, custs, hols, settings, escalationSteps, adminSettings, poolSize, smallVehicleInfo, monthlyVolumes] =
        await Promise.all([
        db.fetchOrdersWithChat(),
        db.fetchProjects(),
        db.fetchCustomers(),
        db.fetchHolidays(),
        db.fetchSystemSettings(),
        db.fetchEscalationSteps(),
        db.fetchAdminSettings(),
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
      setOrders(rows);
      setChatThreads(threads || {});
      setProjects(projs);
      setCustomers(Array.isArray(custs) ? custs : []);
      setHolidays(hols);
      setSystemSettings(settings || {});
      setEscalationStepsByFactoryId(escalationSteps || {});
      setAdminName(String(adminSettings?.admin_name || '').trim() || '管理者');
      setNearPoolSize(poolSize);
      setFactorySmallVehicleInfo(smallVehicleInfo || {});
      setMonthlyVolumeByFactory(monthlyVolumes || {});
    } catch (e) {
      console.error(e);
      setError('注文一覧の取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  }, []);

  /** customer_id → 表示名（会社名。担当者名があれば併記） */
  const customerNameById = useMemo(() => {
    const map = {};
    for (const c of customers || []) {
      const id = String(c?.id || '').trim();
      if (!id) continue;
      const company = String(c.company_name || c.name || '').trim();
      const manager = String(c.manager_name || '').trim();
      map[id] = company && manager ? `${company}（${manager}）` : company || manager || id;
    }
    return map;
  }, [customers]);

  const resolveOrderPlacerLabel = useCallback(
    (order) => {
      const cid = String(order?.customer_id || order?.customerId || '').trim();
      if (cid && customerNameById[cid]) return customerNameById[cid];
      // fetchOrdersWithChat が付与する customerName（company_name）をフォールバック
      const fallback = String(order?.customerName || order?.customer_name || '').trim();
      return fallback || '—';
    },
    [customerNameById],
  );

  const escalationCtx = useMemo(
    () =>
      buildOrderVisibilityContext(
        orders,
        factories,
        projects,
        { ...(systemSettings || {}), near_pool_size: nearPoolSize },
        holidays,
        new Date(),
        escalationStepsByFactoryId,
        customers,
        factorySmallVehicleInfo,
        monthlyVolumeByFactory,
      ),
    [orders, factories, projects, systemSettings, holidays, escalationStepsByFactoryId, customers, nearPoolSize, factorySmallVehicleInfo, monthlyVolumeByFactory],
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
    let unsub = () => {};
    void (async () => {
      unsub = await db.subscribeHaishaRealtime(scheduleLoad);
    })();
    return () => {
      disposed = true;
      if (timerId != null) window.clearTimeout(timerId);
      unsub();
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
  const followupOrders = useMemo(
    () => visibleOrders.filter((o) => orderStatus(o) === 'awaiting_admin_followup'),
    [visibleOrders],
  );
  const followupCount = followupOrders.length;
  const acceptedCount = visibleOrders.filter((o) => orderStatus(o) === 'accepted').length;
  const completedCount = visibleOrders.filter((o) => orderStatus(o) === 'completed').length;
  const cancelledCount = visibleOrders.filter((o) => orderStatus(o) === 'customer_cancelled').length;

  /** 注文一覧テーブル／CSV用（集計カードは visibleOrders のまま） */
  const filteredVisibleOrders = useMemo(() => {
    const q = String(ordersSearchQuery || '')
      .normalize('NFKC')
      .toLowerCase()
      .trim();
    if (!q) return visibleOrders;
    return visibleOrders.filter((o) => {
      const party = orderPartyInfo(o, { preferSiteContact: true });
      const haystack = [
        resolveOrderPlacerLabel(o),
        party.contractor,
        party.site,
        o?.id,
      ]
        .map((v) =>
          String(v ?? '')
            .normalize('NFKC')
            .toLowerCase(),
        )
        .join('\n');
      return haystack.includes(q);
    });
  }, [visibleOrders, ordersSearchQuery, resolveOrderPlacerLabel]);

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

  const openAssociationApprove = (order) => {
    if (!order?.id) return;
    setAssociationApproveOrder(order);
  };

  const applyOrderUpdate = useCallback((updated) => {
    if (!updated?.id) return;
    setOrders((prev) => (Array.isArray(prev) ? prev.map((o) => (o?.id === updated.id ? updated : o)) : prev));
    setDetailOrder((prev) => (prev?.id === updated.id ? updated : prev));
  }, []);

  const handleReassignFactories = async (orderId, selection) => {
    if (!orderId) return;
    setSavingReassign(true);
    setError('');
    try {
      const updated = await db.reassignOrderFactories(orderId, selection);
      applyOrderUpdate(updated);
      await load();
    } catch (e) {
      console.error(e);
      setError(e?.message || '手配先の変更に失敗しました。');
    } finally {
      setSavingReassign(false);
    }
  };

  const handleConfirmAssociationApprove = async ({ preferredFactoryId, associationAssignedFactoryIds }) => {
    const order = associationApproveOrder;
    if (!order?.id) return;
    setSavingAssociation(true);
    setError('');
    try {
      const updated = await db.approveOrderForAssociation(order.id, {
        preferredFactoryId,
        associationAssignedFactoryIds,
      });
      applyOrderUpdate(updated);
      await load();
      setAssociationApproveOrder(null);
    } catch (e) {
      console.error(e);
      setError(e?.message || '組合承認に失敗しました。');
    } finally {
      setSavingAssociation(false);
    }
  };

  const handleForceClearConsult = async (order) => {
    if (!order?.id) return;
    if (!window.confirm('この注文の「相談中」を強制解除しますか？\n解除するとエスカレーションが再開し、他工場に表示が戻ります。')) {
      return;
    }
    setError('');
    try {
      const updated = await db.clearFactoryConsult(order.id);
      if (updated) {
        setOrders((prev) => (Array.isArray(prev) ? prev.map((o) => (o?.id === order.id ? updated : o)) : prev));
      }
      await db.appendChatMessage(order.id, 'system', '【相談解除】管理者により相談中を解除しました。エスカレーションを再開します。');
    } catch (e) {
      console.error(e);
      setError('相談の強制解除に失敗しました。');
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
        ...(status === 'accepted' ? { accepted_at: new Date().toISOString(), acceptedAt: new Date().toISOString() } : {}),
      };
      const updated = await db.adminUpdateOrder(order.id, patch);
      if (updated) setOrders((prev) => (Array.isArray(prev) ? prev.map((o) => (o?.id === order.id ? updated : o)) : prev));
    } catch (e) {
      console.error(e);
      setError('ステータス変更に失敗しました。');
    }
  };

  const resolveDefaultAcceptFactoryId = useCallback(
    (order) => {
      const existing = String(order?.factory_site_id || order?.factorySiteId || '').trim();
      if (existing) return existing;
      const projectId = String(order?.project_id || order?.projectId || '').trim();
      const project = projectId
        ? (projects || []).find((p) => p && String(p.id) === projectId)
        : null;
      const mainFactoryId = String(project?.main_factory_id || '').trim();
      if (mainFactoryId) return mainFactoryId;
      const preferred = String(order?.preferred_factory_id || order?.preferredFactoryId || '').trim();
      if (preferred) return preferred;
      return String(factories?.[0]?.id || '').trim();
    },
    [projects, factories],
  );

  const beginAcceptWithFactory = (order) => {
    if (!order?.id) return;
    setAcceptDraft({
      orderId: String(order.id),
      factoryId: resolveDefaultAcceptFactoryId(order),
    });
  };

  const cancelAcceptWithFactory = () => {
    setAcceptDraft(null);
  };

  const handleAcceptOrderWithFactory = async (order, factoryId) => {
    if (!order?.id) return;
    const fid = String(factoryId || '').trim();
    if (!fid) {
      setError('受注工場を選択してください。');
      return;
    }
    const factoryName = factoryNameById[fid] || fid;
    setError('');
    try {
      const now = new Date().toISOString();
      const patch = {
        status: 'accepted',
        factory_site_id: fid,
        factorySiteId: fid,
        factoryResponseStatus: 'accepted',
        factoryResponseLocked: true,
        factoryPendingStartedAt: undefined,
        factoryPendingByName: undefined,
        accepted_at: now,
        acceptedAt: now,
        acceptedFactoryLabel: `受注工場：${factoryName}`,
        factorySiteName: factoryName,
      };
      const updated = await db.adminUpdateOrder(order.id, patch);
      if (updated) setOrders((prev) => (Array.isArray(prev) ? prev.map((o) => (o?.id === order.id ? updated : o)) : prev));
      setAcceptDraft(null);
    } catch (e) {
      console.error(e);
      setError('受注（工場指定）に失敗しました。');
    }
  };

  const handleDownloadOrdersCsv = () => {
    const rows = [
      ['注文ID', 'ステータス', '希望日', '希望時刻', '種別', '業者', '現場名', '担当者', '連絡先', '受注工場', '数量', '配合'],
      ...filteredVisibleOrders.map((o) => {
        const fid = String(o.factory_site_id || '').trim();
        const party = orderPartyInfo(o, { preferSiteContact: true });
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
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md dark:border-slate-700 dark:bg-slate-800 sm:p-6">
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

      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-7">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="text-xs font-bold text-slate-500">全注文</p>
          <p className="mt-1 text-2xl font-black text-slate-900">{visibleOrders.length}</p>
        </div>
        <div className="cl-alert-warning-panel rounded-xl border border-violet-200 bg-violet-50 px-3 py-3">
          <p className="text-xs font-bold text-violet-700">組合承認待ち</p>
          <p className="mt-1 text-2xl font-black text-violet-900">{pendingAssociationCount}</p>
        </div>
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-3">
          <p className="text-xs font-bold text-rose-700">要フォロー</p>
          <p className="mt-1 text-2xl font-black text-rose-900">{followupCount}</p>
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
              const party = orderPartyInfo(o, { preferSiteContact: true });
              return (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2 dark:border-violet-700 dark:bg-slate-800">
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
                    onClick={() => openAssociationApprove(o)}
                    className="min-h-[40px] rounded-lg bg-violet-700 px-3 text-sm font-black text-white hover:bg-violet-800"
                  >
                    工場を指定して手配・承認
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {!loading && activeMonitorTab === 'orders' && followupOrders.length > 0 ? (
        <div className="mt-4 rounded-xl border-2 border-rose-300 bg-rose-50/60 p-4">
          <h3 className="text-base font-black text-rose-950">要フォロー（割当工場全拒否 · {followupOrders.length}件）</h3>
          <p className="mt-1 text-xs font-medium text-rose-900/90">
            メイン・サブ工場がすべて対応困難です。顧客と相談し、外部対応記録を残したうえで工場を手動指定してください。
          </p>
          <ul className="mt-3 space-y-3">
            {followupOrders.map((o) => (
              <AdminFollowupOrderCard
                key={o.id}
                order={o}
                factories={factories}
                factoryNameById={factoryNameById}
                chatMessages={chatThreads[o.id]}
                adminName={adminName}
                onOpenDetail={setDetailOrder}
                onOrderUpdated={applyOrderUpdate}
              />
            ))}
          </ul>
        </div>
      ) : null}

      {!loading && activeMonitorTab === 'orders' ? (
        <div className="mt-4">
          <div className="mb-3">
            <label htmlFor="orders-monitor-search" className="sr-only">
              注文検索
            </label>
            <input
              id="orders-monitor-search"
              type="search"
              value={ordersSearchQuery}
              onChange={(e) => setOrdersSearchQuery(e.target.value)}
              placeholder="発注者・業者・現場名・注文IDで検索"
              className="min-h-[44px] w-full max-w-xl rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-medium text-slate-800 shadow-inner outline-none placeholder:text-slate-400 focus:border-sky-300 focus:ring-2 focus:ring-sky-200/80 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:placeholder:text-slate-500"
              autoComplete="off"
            />
            {String(ordersSearchQuery || '').trim() ? (
              <p className="mt-1.5 text-xs font-bold text-slate-500">
                検索結果 {filteredVisibleOrders.length} / {visibleOrders.length} 件
              </p>
            ) : null}
          </div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[1500px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b-2 border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-900">
                <th className="px-3 py-2 font-black text-slate-700">種別</th>
                <th className="px-3 py-2 font-black text-slate-700">希望日時</th>
                <th className="px-3 py-2 font-black text-slate-700">業者</th>
                <th className="px-3 py-2 font-black text-slate-700">現場名</th>
                <th className="px-3 py-2 font-black text-slate-700">現場担当者</th>
                <th className="px-3 py-2 font-black text-slate-700">連絡先</th>
                <th className="px-3 py-2 font-black text-slate-700">公開範囲</th>
                <th className="px-3 py-2 font-black text-slate-700">status</th>
                <th className="px-3 py-2 font-black text-slate-700">受注工場</th>
                <th className="px-3 py-2 font-black text-slate-700">発注者</th>
                <th className="px-3 py-2 font-black text-slate-700">操作</th>
              </tr>
            </thead>
            <tbody>
              {visibleOrders.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-slate-500">注文はありません。</td>
                </tr>
              ) : filteredVisibleOrders.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-slate-500">該当する注文が見つかりません</td>
                </tr>
              ) : (
                filteredVisibleOrders.map((o) => {
                  const st = orderStatus(o);
                  const fid = String(o.factory_site_id || '').trim();
                  const party = orderPartyInfo(o, { preferSiteContact: true });
                  const placerLabel = resolveOrderPlacerLabel(o);
                  const isAcceptingThis = acceptDraft?.orderId === String(o.id);
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
                          {String(o.factory_consult_status || '').trim() === 'consulting' ? (
                            <span className="inline-flex rounded-full border border-blue-400 bg-blue-50 px-2 py-0.5 text-xs font-black text-blue-900">相談中</span>
                          ) : null}
                          {o.is_admin_modified ? (
                            <span className="inline-flex rounded-full border border-violet-300 bg-violet-50 px-2 py-0.5 text-xs font-black text-violet-800">管理者変更</span>
                          ) : null}
                          <LocationPendingBadge order={o} className="text-xs" />
                        </div>
                      </td>
                      <td className="px-3 py-2.5 font-bold text-slate-700">{fid ? factoryNameById[fid] || fid : '—'}</td>
                      <td
                        className="max-w-[14rem] break-words px-3 py-2.5 text-sm font-bold text-slate-800"
                        title={String(o.id || '')}
                      >
                        {placerLabel}
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {st === 'pending_association' ? (
                            <button
                              type="button"
                              onClick={() => openAssociationApprove(o)}
                              className="rounded border border-violet-400 bg-violet-100 px-2 py-1 text-xs font-black text-violet-900 hover:bg-violet-200"
                            >
                              工場指定で承認
                            </button>
                          ) : null}
                          {isAcceptingThis ? (
                            <div className="flex w-full min-w-[14rem] flex-col gap-1 rounded-lg border border-emerald-300 bg-emerald-50 p-1.5 dark:border-emerald-700 dark:bg-emerald-950/40">
                              <label className="text-[10px] font-black text-emerald-900 dark:text-emerald-200">
                                受注工場
                                <select
                                  value={acceptDraft.factoryId || ''}
                                  onChange={(e) =>
                                    setAcceptDraft((prev) =>
                                      prev ? { ...prev, factoryId: e.target.value } : prev,
                                    )
                                  }
                                  className="mt-0.5 min-h-[32px] w-full rounded border border-emerald-400 bg-white px-1.5 text-xs font-bold text-slate-900 dark:border-emerald-600 dark:bg-slate-900 dark:text-slate-100"
                                >
                                  <option value="">選択してください</option>
                                  {(factories || []).map((f) => (
                                    <option key={f.id} value={f.id}>
                                      {f.name || f.id}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <div className="flex flex-wrap gap-1">
                                <button
                                  type="button"
                                  onClick={() => void handleAcceptOrderWithFactory(o, acceptDraft.factoryId)}
                                  disabled={!String(acceptDraft.factoryId || '').trim()}
                                  className="rounded border border-emerald-600 bg-emerald-600 px-2 py-1 text-xs font-black text-white hover:bg-emerald-700 disabled:cursor-default disabled:opacity-40"
                                >
                                  確定
                                </button>
                                <button
                                  type="button"
                                  onClick={cancelAcceptWithFactory}
                                  className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-black text-slate-700 hover:bg-slate-100"
                                >
                                  キャンセル
                                </button>
                              </div>
                            </div>
                          ) : null}
                          {[
                            ['pending', '配車待ち'],
                            ['accepted', '受注'],
                            ['completed', '完了'],
                            ['customer_cancelled', 'キャンセル'],
                          ].map(([nextStatus, label]) => {
                            if (nextStatus === 'accepted' && isAcceptingThis) return null;
                            return (
                              <button
                                key={nextStatus}
                                type="button"
                                disabled={st === nextStatus}
                                onClick={() => {
                                  if (nextStatus === 'accepted') {
                                    beginAcceptWithFactory(o);
                                    return;
                                  }
                                  void handleChangeOrderStatus(o, nextStatus);
                                }}
                                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-black text-slate-700 hover:bg-gray-100 disabled:cursor-default disabled:bg-slate-100 disabled:text-slate-400"
                              >
                                {label}
                              </button>
                            );
                          })}
                          {String(o.factory_consult_status || '').trim() === 'consulting' ? (
                            <button
                              type="button"
                              onClick={() => handleForceClearConsult(o)}
                              className="rounded border border-blue-400 bg-blue-50 px-2 py-1 text-xs font-black text-blue-900 hover:bg-blue-100"
                            >
                              相談を強制解除
                            </button>
                          ) : null}
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
        </div>
      ) : null}

      {!loading && activeMonitorTab === 'schedule' ? (
        <div className="mt-4 space-y-4">
          {acceptedByFactory.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">受注済みの注文はありません。</p>
          ) : (
            acceptedByFactory.map((group) => (
              <div key={group.factoryId} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-900/40">
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
                <ul className="mt-3 divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white dark:divide-slate-600 dark:border-slate-600 dark:bg-slate-800">
                  {group.orders.map((o) => {
                    const party = orderPartyInfo(o, { preferSiteContact: true });
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
      <AssociationOrderApproveModal
        order={associationApproveOrder}
        open={Boolean(associationApproveOrder)}
        factories={factories}
        factoryNameById={factoryNameById}
        escalationCtx={escalationCtx}
        saving={savingAssociation}
        onClose={() => !savingAssociation && setAssociationApproveOrder(null)}
        onApprove={(payload) => void handleConfirmAssociationApprove(payload)}
      />
      <AdminOrderDetailModal
        order={detailOrder}
        project={
          detailOrder
            ? projects.find(
                (p) => String(p?.id) === String(detailOrder.project_id ?? detailOrder.projectId ?? ''),
              ) || null
            : null
        }
        open={Boolean(detailOrder)}
        escalationCtx={escalationCtx}
        factoryNameById={factoryNameById}
        factories={factories}
        saving={savingEdit}
        savingReassign={savingReassign}
        onClose={() => setDetailOrder(null)}
        onSave={handleSaveEdit}
        onApproveAssociation={openAssociationApprove}
        onReassignFactories={handleReassignFactories}
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
      setAdminPanelSession(phone, pass);
      await ensurePanelRealtimeAuth(admin?.realtime_token);
      try {
        writeAuthValue(ADMIN_AUTH_SESSION_KEY, '1');
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
        <a href="/" className="inline-flex w-fit rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" aria-label={APP_BRAND_HOME_LABEL}>
          <img src={concreteLinkLogo} alt={APP_BRAND_NAME} className="h-12 w-auto rounded bg-white/95 p-1" />
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

function readAdminTabFromUrl() {
  const allowed = new Set([
    'monitor',
    'availability',
    'factoryNews',
    'adminSettings',
    'projects',
    'agents',
    'cooperatives',
    'customers',
    'charter',
    'inquiries',
    'settings',
    'escalation',
  ]);
  try {
    const tab = new URLSearchParams(window.location.search).get('tab');
    if (tab && allowed.has(tab)) return tab;
  } catch {
    /* ignore */
  }
  return 'monitor';
}

export function AdminApp() {
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(() => {
    try {
      return readAuthValue(ADMIN_AUTH_SESSION_KEY) === '1' && hasAdminPanelSession();
    } catch {
      return false;
    }
  });
  const [factories, setFactories] = useState([]);
  const [schedulesByFactoryId, setSchedulesByFactoryId] = useState({});
  const [scheduleDate, setScheduleDate] = useState(() => todayLocalISODate());
  const [tab, setTab] = useState(readAdminTabFromUrl);
  const [activeMonitorTab, setActiveMonitorTab] = useState('orders');
  const [adminSettings, setAdminSettings] = useState({ admin_name: '', phone_number: '' });
  const factoryNameById = useMemo(() => Object.fromEntries(factories.map((f) => [f.id, f.name])), [factories]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get('tab') === tab) return;
      url.searchParams.set('tab', tab);
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {
      /* ignore */
    }
  }, [tab]);

  const handleAdminLogin = useCallback((admin) => {
    setIsAdminLoggedIn(true);
    if (admin) setAdminSettings(admin);
    void registerOneSignalUser(buildAdminOneSignalExternalId(admin?.id ?? 1), {
      role: 'admin',
      admin_id: String(admin?.id ?? 1),
    }).catch(() => {});
  }, []);

  const handleAdminLogout = useCallback(() => {
    void unregisterOneSignalUser().catch(() => {});
    try {
      removeAuthValue(ADMIN_AUTH_SESSION_KEY);
    } catch {
      /* ignore */
    }
    clearAdminPanelSession();
    setIsAdminLoggedIn(false);
  }, []);

  useEffect(() => {
    if (!isAdminLoggedIn) return undefined;
    void ensurePanelRealtimeAuth();
    return undefined;
  }, [isAdminLoggedIn]);

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
    let unsub = () => {};
    void (async () => {
      unsub = await db.subscribeHaishaRealtime(scheduleLoad);
    })();
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
    let unsub = () => {};
    void (async () => {
      unsub = await db.subscribeHaishaRealtime((payload) => {
        if (payload?.table === 'admin_settings') void loadAdminSettings();
      });
    })();
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
            <a href="/" className="inline-flex w-fit items-center rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300" aria-label={APP_BRAND_HOME_LABEL}>
              <img src={concreteLinkLogo} alt={APP_BRAND_NAME} className="h-10 w-auto" />
            </a>
            <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-slate-400">{APP_BRAND_NAME}</p>
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
            {tabBtn('factoryNews', 'ニュース配信')}
            {tabBtn('adminSettings', '管理者情報設定')}
            {tabBtn('projects', '物件管理')}
            {tabBtn('agents', '商社')}
            {tabBtn('cooperatives', '組合員')}
            {tabBtn('customers', '業者管理')}
            {tabBtn('charter', 'チャーター業務')}
            {tabBtn('inquiries', '問い合わせ対応')}
            {tabBtn('settings', '休日・稼働時間')}
            {tabBtn('escalation', 'エスカレーション設定')}
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
        {tab === 'factoryNews' ? <AdminFactoryNewsSection factories={factories} /> : null}
        {tab === 'adminSettings' ? <AdminSettingsSection /> : null}
        {tab === 'projects' ? <ProjectsSection factories={factories} factoryNameById={factoryNameById} /> : null}
        {tab === 'agents' ? <AdminOrgSection orgType="agent" label="商社" /> : null}
        {tab === 'cooperatives' ? <AdminOrgSection orgType="cooperative" label="組合員" /> : null}
        {tab === 'customers' ? <AdminOrgSection orgType="contractor" label="業者" /> : null}
        {tab === 'charter' ? <AdminCharterSection /> : null}
        {tab === 'inquiries' ? <CustomerInquirySection /> : null}
        {tab === 'settings' ? <HolidaysAndSettingsSection /> : null}
        {tab === 'escalation' ? <AdminEscalationSection factories={factories} /> : null}
      </main>
    </div>
  );
}