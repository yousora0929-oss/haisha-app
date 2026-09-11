import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as db from '../haishaDb.js';
import { MasterSuggestInput } from './MasterSuggestInput.jsx';
import { DeliveryAreaAddressField } from './DeliveryAreaAddressField.jsx';
import { MixDesignRequestPrint } from './MixDesignRequestPrint.jsx';
import { MixDesignEmailActions } from './MixDesignEmailActions.jsx';
import { MixDesignStatusButtons } from './MixDesignStatusButtons.jsx';
import {
  AGGREGATE_SIZE_CANDIDATES,
  BASE_STRENGTH_CANDIDATES,
  SLUMP_CANDIDATES,
} from '../utils/mixDesignCalc.js';
import { dedupeCustomersByCompany } from '../utils/dedupeCustomersByCompany.js';
import { customerSuggestTexts, organizationSuggestTexts } from '../utils/masterSuggest.js';
import {
  MIX_DESIGN_GRID_COLS,
  MIX_DESIGN_REGIONS,
  MIX_DESIGN_VEHICLE_OPTIONS,
  applyAutoCorrection,
  applyPourDateResolution,
  createEmptyMixDesignItem,
  duplicateMixDesignItem,
  earliestPourDate,
  formatConstructionPeriod,
  formatMixDesignFactoryNames,
  formatRequesterDisplay,
  handleMixDesignNavKeyDown,
  mixCodeForItem,
  mixDesignHeaderFromOrder,
  mixDesignStatusLabel,
  prefillMixDesignDraft,
  prefillMixDesignDraftFromRequest,
  preventMinusKey,
  pourYearChoices,
  printMixDesignSheet,
  regionFromDeliveryArea,
  sanitizeNonNegativeInput,
  selectAllOnFocus,
  stepCandidateValue,
  toggleMixDesignFactoryId,
  toggleMixDesignVehicle,
  validateMixDesignDraft,
} from '../utils/mixDesignRequest.js';
import { combineDeliveryAddress } from '../utils/deliveryAreas.js';
import {
  DEFAULT_DELIVERY_PREFECTURE,
  fetchTownLocationsForMunicipality,
} from '../utils/heartrailsGeo.js';

const FIELD =
  'min-h-[48px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300';

function NonNegNumberInput({ value, onChange, className, inputMode = 'decimal', ...rest }) {
  return (
    <input
      type="number"
      min="0"
      inputMode={inputMode}
      value={value}
      onKeyDown={preventMinusKey}
      onFocus={selectAllOnFocus}
      onChange={(e) => onChange(sanitizeNonNegativeInput(e.target.value))}
      onBlur={(e) => onChange(sanitizeNonNegativeInput(e.target.value))}
      className={className}
      {...rest}
    />
  );
}

function MixNumericSuggestInput({
  label,
  value,
  onChange,
  candidates,
  nav,
  placeholder = '',
}) {
  const items = (Array.isArray(candidates) ? candidates : []).map(String);
  return (
    <MasterSuggestInput
      label={label}
      value={value == null ? '' : String(value)}
      onValueChange={onChange}
      onSelect={(item) => onChange(String(item))}
      items={items}
      getItemKey={(item) => String(item)}
      getItemLabel={(item) => String(item)}
      placeholder={placeholder}
      emptyHint="候補にない値も直接入力できます"
      compact
      labelClassName="text-xs font-bold text-slate-600"
      inputClassName={FIELD}
      inputProps={{ 'data-mix-nav': nav, inputMode: 'numeric' }}
      onInputKeyDown={(event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        event.stopPropagation();
        onChange(stepCandidateValue(value, candidates, event.key === 'ArrowUp' ? 'up' : 'down'));
      }}
    />
  );
}

function MixDesignItemCard({ item, index, rowCount, onChange, onRemove, onDuplicate, canRemove, periodStart, periodEnd }) {
  const code = mixCodeForItem(item);
  const nav = (col) => `${index},${col}`;

  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-black text-slate-800">配合 {index + 1}</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onDuplicate}
            className="rounded-lg px-2 py-1 text-xs font-bold text-indigo-700 hover:bg-indigo-50"
          >
            複製
          </button>
          {canRemove ? (
            <button
              type="button"
              onClick={onRemove}
              className="rounded-lg px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-100 hover:text-red-700"
            >
              削除
            </button>
          ) : null}
        </div>
      </div>
      {code ? (
        <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800">{code}</p>
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <MixNumericSuggestInput
          label="設計基準強度"
          nav={nav(0)}
          value={item.baseStrength}
          candidates={BASE_STRENGTH_CANDIDATES}
          onChange={(value) => onChange({ baseStrength: value })}
          placeholder="例：30"
        />
        <MixNumericSuggestInput
          label="スランプ"
          nav={nav(1)}
          value={item.slump}
          candidates={SLUMP_CANDIDATES}
          onChange={(value) => onChange({ slump: value })}
          placeholder="例：15"
        />
        <MixNumericSuggestInput
          label="骨材"
          nav={nav(2)}
          value={item.aggregateSize}
          candidates={AGGREGATE_SIZE_CANDIDATES}
          onChange={(value) => onChange({ aggregateSize: value })}
          placeholder="例：20"
        />
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
          セメント
          <select
            data-mix-nav={nav(3)}
            value={item.cementType}
            onChange={(e) => onChange({ cementType: e.target.value })}
            className={FIELD}
          >
            <option value="N">N（普通）</option>
            <option value="BB">BB（高炉B種）</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
          数量（m³）
          <NonNegNumberInput
            data-mix-nav={nav(4)}
            value={item.quantityM3}
            onChange={(value) => onChange({ quantityM3: value })}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-600 sm:col-span-2">
          打設日
          <div className="flex flex-wrap items-center gap-1.5">
            <NonNegNumberInput
              data-mix-nav={nav(5)}
              inputMode="numeric"
              value={item.pourMonth}
              onChange={(value) => onChange({ pourMonth: value, pourYearOverride: item.pourYearOverride || '' })}
              placeholder="月"
              className={
                FIELD +
                ' max-w-[4.5rem] text-center' +
                (item.pourDateOutOfRange ? ' border-red-500 focus:border-red-500 focus:ring-red-200' : '')
              }
            />
            <span className="text-base font-black text-slate-400">/</span>
            <NonNegNumberInput
              data-mix-nav={nav(6)}
              inputMode="numeric"
              value={item.pourDay}
              onChange={(value) => onChange({ pourDay: value, pourYearOverride: item.pourYearOverride || '' })}
              placeholder="日"
              className={
                FIELD +
                ' max-w-[4.5rem] text-center' +
                (item.pourDateOutOfRange ? ' border-red-500 focus:border-red-500 focus:ring-red-200' : '')
              }
            />
            {item.pourDateOutOfRange || item.pourYearOverride ? (
              <select
                value={item.pourYearOverride || ''}
                onChange={(e) => onChange({ pourYearOverride: e.target.value })}
                className={FIELD + ' max-w-[7rem]'}
              >
                <option value="">年を選択</option>
                {pourYearChoices(periodStart, periodEnd, [item.pourYearOverride]).map((year) => (
                  <option key={year} value={String(year)}>
                    {year}年
                  </option>
                ))}
              </select>
            ) : null}
            {item.pourDate ? (
              <span className="text-xs font-medium text-slate-500">{item.pourDate.replace(/-/g, '/')}</span>
            ) : null}
          </div>
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs font-bold text-slate-600">
          施工箇所
          <input
            data-mix-nav={nav(7)}
            type="text"
            value={item.constructionLocation}
            onChange={(e) => onChange({ constructionLocation: e.target.value })}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
          W/C比（%）
          <NonNegNumberInput
            data-mix-nav={nav(8)}
            value={item.waterCementRatio}
            onChange={(value) => onChange({ waterCementRatio: value })}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
          単位水量
          <NonNegNumberInput
            data-mix-nav={nav(9)}
            value={item.unitWaterContent}
            onChange={(value) => onChange({ unitWaterContent: value })}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
          構造体補正値
          <NonNegNumberInput
            data-mix-nav={nav(10)}
            inputMode="numeric"
            value={item.correctionValue}
            disabled={item.correctionIsAuto}
            onChange={(value) => onChange({ correctionValue: value, correctionIsAuto: false })}
            className={FIELD + (item.correctionIsAuto ? ' bg-slate-100 text-slate-500' : '')}
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs font-bold text-slate-600 sm:col-span-4">
          備考
          <input
            data-mix-nav={nav(11)}
            type="text"
            value={item.memo || ''}
            onChange={(e) => onChange({ memo: e.target.value })}
            className={FIELD}
            placeholder="この配合パターンへの連絡事項（依頼全体の備考とは別）"
          />
        </label>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700 sm:col-span-2">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={Boolean(item.correctionIsAuto)}
            onChange={(e) => onChange({ correctionIsAuto: e.target.checked })}
          />
          補正値を自動計算
          {item.correctionIsAuto && item.correctionLabel ? (
            <span className="font-medium text-slate-500">（{item.correctionLabel}）</span>
          ) : null}
        </label>
        <label className="flex items-center gap-2 text-xs font-bold text-slate-700 sm:col-span-2">
          <input
            type="checkbox"
            className="h-4 w-4"
            checked={Boolean(item.aeAdmixture)}
            onChange={(e) => onChange({ aeAdmixture: e.target.checked })}
          />
          高性能AE減水剤あり
        </label>
      </div>
      <p className="sr-only">
        {rowCount}行中{index + 1}行目。Enter・矢印キーでマス目移動できます。
      </p>
    </div>
  );
}

export function MixDesignRequestModal({
  open,
  order,
  project,
  factories = [],
  customers = [],
  agentOrganizations = [],
  allowedDeliveryAreas = [],
  deliveryPrefecture = DEFAULT_DELIVERY_PREFECTURE,
  requestedByDefault = '',
  requestedByAffiliationDefault = '',
  mode = 'create',
  editRequestId = '',
  initialRequest = null,
  initialItems = null,
  initialFactoryIds = [],
  initialFactoryLinks = [],
  onClose,
  onSubmitted,
  onStatusChanged,
}) {
  const isEdit = mode === 'edit' && String(editRequestId || '').trim();
  const [draft, setDraft] = useState(() => prefillMixDesignDraft(null, null, requestedByDefault));
  const [baselineDraft, setBaselineDraft] = useState(null);
  const [rules, setRules] = useState([]);
  const [rulesError, setRulesError] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [requestStatus, setRequestStatus] = useState(() =>
    String(initialRequest?.status || 'requested'),
  );
  const [statusSaving, setStatusSaving] = useState(false);
  const [siteContactCandidates, setSiteContactCandidates] = useState([]);
  const [townList, setTownList] = useState([]);
  const [townOptionsLoading, setTownOptionsLoading] = useState(false);
  const [townOptionsError, setTownOptionsError] = useState('');
  const prevOpenRef = useRef(false);
  const printRootRef = useRef(null);

  useEffect(() => {
    if (!open) {
      prevOpenRef.current = false;
      return undefined;
    }
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = true;
    if (wasOpen) return undefined;
    const nextDraft = isEdit
      ? prefillMixDesignDraftFromRequest(
          initialRequest,
          initialItems,
          project,
          requestedByDefault,
          initialFactoryIds,
          allowedDeliveryAreas,
        )
      : prefillMixDesignDraft(
          order,
          project,
          requestedByDefault,
          allowedDeliveryAreas,
          requestedByAffiliationDefault,
        );
    setDraft(nextDraft);
    setBaselineDraft(isEdit ? JSON.parse(JSON.stringify(nextDraft)) : null);
    setRequestStatus(isEdit ? String(initialRequest?.status || 'requested') : 'requested');
    setShowPreview(false);
    setError('');
    return undefined;
  }, [
    open,
    order,
    project,
    requestedByDefault,
    requestedByAffiliationDefault,
    isEdit,
    initialRequest,
    initialItems,
    initialFactoryIds,
    allowedDeliveryAreas,
  ]);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setRulesError('');
    db.fetchCorrectionValueRules()
      .then((rows) => {
        if (cancelled) return;
        setRules(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        console.error('correction_value_rules の取得に失敗しました', err);
        if (!cancelled) {
          setRules([]);
          setRulesError(err?.message || '補正値ルールの取得に失敗しました');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const contractorCustomers = useMemo(
    () =>
      dedupeCustomersByCompany(
        (Array.isArray(customers) ? customers : []).filter(
          (c) => String(c?.role || '').trim() === 'contractor',
        ),
      ),
    [customers],
  );

  const unmatchedContractor = useMemo(() => {
    const name = String(draft.contractorName || '').trim();
    if (!name) return false;
    if (String(draft.contractorCustomerId || '').trim()) return false;
    return !contractorCustomers.some(
      (c) => String(c.company_name || c.name || '').trim() === name,
    );
  }, [draft.contractorName, draft.contractorCustomerId, contractorCustomers]);

  const unmatchedTrader = useMemo(() => {
    const name = String(draft.traderName || '').trim();
    if (!name) return false;
    if (String(draft.tradingCompanyOrganizationId || '').trim()) return false;
    return !(Array.isArray(agentOrganizations) ? agentOrganizations : []).some(
      (o) => String(o.name || '').trim() === name,
    );
  }, [draft.traderName, draft.tradingCompanyOrganizationId, agentOrganizations]);

  useEffect(() => {
    if (!open) return undefined;
    const cid = String(draft.contractorCustomerId || '').trim();
    if (!cid) {
      setSiteContactCandidates([]);
      return undefined;
    }
    let cancelled = false;
    db.fetchCompanyMemberSuggestions(cid)
      .then((rows) => {
        if (!cancelled) setSiteContactCandidates(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {
        if (!cancelled) setSiteContactCandidates([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, draft.contractorCustomerId]);

  useEffect(() => {
    if (!open) return undefined;
    const municipality = String(draft.siteDeliveryArea || '').trim();
    if (!municipality) {
      setTownList([]);
      setTownOptionsError('');
      setTownOptionsLoading(false);
      return undefined;
    }
    let cancelled = false;
    setTownOptionsLoading(true);
    setTownOptionsError('');
    fetchTownLocationsForMunicipality(municipality, deliveryPrefecture)
      .then((rows) => {
        if (cancelled) return;
        setTownList(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setTownList([]);
        setTownOptionsError(err?.message || '町名候補の取得に失敗しました');
      })
      .finally(() => {
        if (!cancelled) setTownOptionsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, draft.siteDeliveryArea, deliveryPrefecture]);

  const townSuggestionNames = useMemo(
    () =>
      (Array.isArray(townList) ? townList : []).map((row) => ({
        town: row?.town ?? '',
        town_kana: row?.town_kana ?? row?.kana ?? '',
      })),
    [townList],
  );

  const updateItem = useCallback(
    (index, patch) => {
      setDraft((prev) => {
        const items = prev.items.map((item, i) => {
          if (i !== index) return item;
          const next = applyPourDateResolution({ ...item, ...patch }, prev.periodStart, prev.periodEnd);
          return applyAutoCorrection(next, rules, prev.region);
        });
        return { ...prev, items };
      });
    },
    [rules],
  );

  const patchDraft = useCallback((patch) => {
    setDraft((prev) => {
      const next = { ...prev, ...patch };
      if ('periodStart' in patch || 'periodEnd' in patch || 'region' in patch) {
        next.items = prev.items.map((item) =>
          applyAutoCorrection(
            applyPourDateResolution(item, next.periodStart, next.periodEnd),
            rules,
            next.region,
          ),
        );
      }
      return next;
    });
  }, [rules]);

  const setRegion = useCallback(
    (region) => {
      setDraft((prev) => ({
        ...prev,
        region,
        items: prev.items.map((item) =>
          item.correctionIsAuto ? applyAutoCorrection(item, rules, region) : item,
        ),
      }));
    },
    [rules],
  );

  useEffect(() => {
    if (!open) return;
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.correctionIsAuto ? applyAutoCorrection(item, rules, prev.region) : item,
      ),
    }));
  }, [rules, open]);

  const headerContext = useMemo(() => mixDesignHeaderFromOrder(order, project), [order, project]);
  const factoryNameById = useMemo(() => {
    const map = {};
    for (const f of Array.isArray(factories) ? factories : []) {
      if (!f?.id) continue;
      map[String(f.id)] = String(f.name || f.id);
    }
    return map;
  }, [factories]);
  const printHeader = useMemo(
    () => ({
      ...headerContext,
      projectName: draft.projectName || headerContext.projectName,
      contractorName: draft.contractorName || headerContext.contractorName,
      primeContractorName: draft.primeContractorName || headerContext.primeContractorName,
      traderName: draft.traderName || headerContext.traderName,
      siteAddress: draft.siteAddress || headerContext.siteAddress,
      constructionPeriod: formatConstructionPeriod(draft.periodStart, draft.periodEnd),
      periodStart: draft.periodStart,
      periodEnd: draft.periodEnd,
      vehicleTypes: draft.vehicleTypes,
      siteManagerName: draft.siteManagerName,
      siteManagerContact: draft.siteManagerContact,
      siteContact: [draft.siteManagerName, draft.siteManagerContact].filter(Boolean).join(' / '),
      firstPourDate: earliestPourDate(draft),
      totalVolumeM3: draft.totalVolumeM3,
      requestedBy: formatRequesterDisplay(draft.requestedBy, draft.requestedByAffiliation),
      requestedByAffiliation: draft.requestedByAffiliation,
      requestedToFactoryIds: draft.requestedToFactoryIds,
      factoryNames: formatMixDesignFactoryNames(draft.requestedToFactoryIds, factoryNameById),
    }),
    [draft, headerContext, factoryNameById],
  );
  const printRequest = useMemo(
    () => ({
      requestedBy: formatRequesterDisplay(draft.requestedBy, draft.requestedByAffiliation),
      requestedByAffiliation: draft.requestedByAffiliation,
      vehicleTypes: draft.vehicleTypes,
      totalVolumeM3: draft.totalVolumeM3,
      submissionMethod: draft.submissionMethod,
      submissionEmail: draft.submissionEmail,
      memo: draft.memo,
      factoryNames: formatMixDesignFactoryNames(draft.requestedToFactoryIds, factoryNameById),
    }),
    [draft, factoryNameById],
  );

  const factoryOptions = Array.isArray(factories) ? factories.filter((f) => f?.id) : [];

  const handleSubmit = async () => {
    const missing = validateMixDesignDraft(draft);
    if (missing.length) {
      const message = `次の項目を入力してください: ${missing.join('、')}`;
      setError(message);
      window.alert(message);
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const by = draft.requestedBy || requestedByDefault;
      if (isEdit) {
        await db.updateMixDesignRequestWithLog({
          requestId: editRequestId,
          draft,
          requestedBy: by,
          beforeDraft: baselineDraft,
        });
      } else {
        await db.submitMixDesignRequestFromOrder({
          order,
          draft,
          requestedBy: by,
        });
      }
      onSubmitted?.();
      onClose?.();
    } catch (err) {
      console.error(isEdit ? '配合計画書依頼の更新に失敗しました' : '配合計画書依頼の作成に失敗しました', err);
      const message =
        err?.message || (isEdit ? '配合計画書依頼の更新に失敗しました' : '配合計画書依頼の作成に失敗しました');
      setError(message);
      window.alert(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStatusChange = async (nextStatus) => {
    const next = String(nextStatus || '').trim();
    if (!isEdit || !next || next === requestStatus) return;
    setStatusSaving(true);
    setError('');
    try {
      await db.updateMixDesignRequestStatus({
        requestId: editRequestId,
        status: next,
        changedBy: draft.requestedBy || requestedByDefault,
      });
      setRequestStatus(next);
      onStatusChanged?.(next);
    } catch (err) {
      console.error('配合計画書依頼のステータス更新に失敗しました', err);
      const message = err?.message || 'ステータスの更新に失敗しました';
      setError(message);
      window.alert(message);
    } finally {
      setStatusSaving(false);
    }
  };

  if (!open || (!order && !isEdit)) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[92dvh] sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-black text-slate-900">
              {isEdit ? '配合計画書依頼を編集' : '配合計画書を依頼'}
            </h2>
            <p className="mt-1 text-xs font-medium text-slate-500">
              {draft.projectName || '現場未設定'}
              {isEdit ? ` · ${mixDesignStatusLabel(requestStatus)}` : ''}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-3 py-2 text-sm font-bold text-slate-600 hover:bg-slate-100"
          >
            閉じる
          </button>
        </div>

        {isEdit ? (
          <div className="border-b border-slate-200 bg-slate-50 px-4 py-3">
            <MixDesignStatusButtons
              value={requestStatus}
              saving={statusSaving}
              disabled={submitting}
              onChange={(next) => void handleStatusChange(next)}
            />
          </div>
        ) : null}

        <div
          className="min-h-0 flex-1 overflow-y-auto p-4"
          onKeyDown={(e) =>
            handleMixDesignNavKeyDown(e, {
              rowCount: draft.items.length,
              colCount: MIX_DESIGN_GRID_COLS.length,
            })
          }
        >
          <div className="mb-4 grid grid-cols-1 gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600 sm:col-span-2">
              工事名
              <input
                type="text"
                value={draft.projectName}
                onChange={(e) => patchDraft({ projectName: e.target.value })}
                className={FIELD}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600 sm:col-span-2">
              <MasterSuggestInput
                label="業者名"
                name="mix_design_contractor"
                value={draft.contractorName}
                onValueChange={(value) =>
                  patchDraft({
                    contractorName: value,
                    contractorCustomerId: '',
                  })
                }
                onSelect={(c) =>
                  patchDraft({
                    contractorName: String(c?.company_name || c?.name || '').trim(),
                    contractorCustomerId: String(c?.id || '').trim(),
                    registerNewContractor: false,
                  })
                }
                items={contractorCustomers}
                getItemKey={(c) => String(c.id)}
                getItemLabel={(c) => String(c.company_name || c.name || c.id || '').trim()}
                getSearchTexts={customerSuggestTexts}
                placeholder="業者名を入力（候補から選択可）"
                emptyHint="該当する業者がありません（自由入力で新規登録できます）"
                inputClassName={FIELD}
              />
              {unmatchedContractor ? (
                <label className="mt-1 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] font-bold text-amber-900">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4"
                    checked={draft.registerNewContractor !== false}
                    onChange={(e) => patchDraft({ registerNewContractor: e.target.checked })}
                  />
                  <span>候補にないため、業者マスタに新規登録する</span>
                </label>
              ) : null}
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
              元請（配合計画書宛名）
              <input
                type="text"
                value={draft.primeContractorName}
                onChange={(e) => patchDraft({ primeContractorName: e.target.value })}
                className={FIELD}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600 sm:col-span-2">
              <MasterSuggestInput
                label="商社名"
                name="mix_design_trader"
                value={draft.traderName}
                onValueChange={(value) =>
                  patchDraft({
                    traderName: value,
                    tradingCompanyOrganizationId: '',
                  })
                }
                onSelect={(o) =>
                  patchDraft({
                    traderName: String(o?.name || '').trim(),
                    tradingCompanyOrganizationId: String(o?.id || '').trim(),
                    registerNewTrader: false,
                  })
                }
                items={Array.isArray(agentOrganizations) ? agentOrganizations : []}
                getItemKey={(o) => String(o.id)}
                getItemLabel={(o) => String(o.name || '').trim()}
                getSearchTexts={organizationSuggestTexts}
                placeholder="商社名を入力（候補から選択可）"
                emptyHint="該当する商社がありません（自由入力で新規登録できます）"
                inputClassName={FIELD}
              />
              {unmatchedTrader ? (
                <label className="mt-1 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] font-bold text-amber-900">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4"
                    checked={draft.registerNewTrader !== false}
                    onChange={(e) => patchDraft({ registerNewTrader: e.target.checked })}
                  />
                  <span>候補にないため、商社マスタに新規登録する</span>
                </label>
              ) : null}
            </label>
            <div className="sm:col-span-2">
              <DeliveryAreaAddressField
                idPrefix="mix-design-site"
                label="現場住所"
                allowedAreas={allowedDeliveryAreas}
                deliveryArea={draft.siteDeliveryArea}
                onDeliveryAreaChange={(v) => {
                  const mapped = regionFromDeliveryArea(v);
                  patchDraft({
                    siteDeliveryArea: v,
                    siteAddress: combineDeliveryAddress(v, draft.siteAddressDetail),
                    ...(mapped ? { region: mapped } : {}),
                  });
                }}
                addressDetail={draft.siteAddressDetail}
                onAddressDetailChange={(v) =>
                  patchDraft({
                    siteAddressDetail: v,
                    siteAddress: combineDeliveryAddress(draft.siteDeliveryArea, v),
                  })
                }
                detailLabel="番地・町名など"
                detailPlaceholder="町名・番地を入力"
                detailHint="市町村を選んだあと、番地などは自由入力できます"
                detailRequired={false}
                showTownSuggestions
                townSuggestions={townSuggestionNames}
                townSuggestionsLoading={townOptionsLoading}
                townSuggestionsError={townOptionsError}
              />
            </div>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
              地域（構造体補正値）
              <select value={draft.region} onChange={(e) => setRegion(e.target.value)} className={FIELD}>
                {MIX_DESIGN_REGIONS.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </select>
              <span className="text-[11px] font-medium text-slate-500">
                補正値表の地域です。大分市・挟間は自動で「大分市・挟間町」、湯布院・庄内は自動で切り替わります。由布市は現場に合わせて選んでください。
              </span>
            </label>
            <div className="grid grid-cols-1 gap-3 sm:col-span-2 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
                工期開始
                <input
                  type="date"
                  value={draft.periodStart}
                  onChange={(e) => patchDraft({ periodStart: e.target.value })}
                  className={FIELD}
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
                工期終了
                <input
                  type="date"
                  value={draft.periodEnd}
                  onChange={(e) => patchDraft({ periodEnd: e.target.value })}
                  className={FIELD}
                />
              </label>
            </div>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-xs font-bold text-slate-600">使用車両</legend>
              <div className="flex flex-wrap gap-3">
                {MIX_DESIGN_VEHICLE_OPTIONS.map((opt) => (
                  <label key={opt.id} className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={(draft.vehicleTypes || []).includes(opt.id)}
                      onChange={() => patchDraft({ vehicleTypes: toggleMixDesignVehicle(draft.vehicleTypes, opt.id) })}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-end">
            <MasterSuggestInput
              label="現場担当者"
              name="mix_design_site_manager"
              value={draft.siteManagerName}
              onValueChange={(value) => patchDraft({ siteManagerName: value })}
              onSelect={(c) =>
                patchDraft({
                  siteManagerName: String(c?.name || '').trim(),
                  siteManagerContact: String(c?.phone_number || c?.phone || '').trim(),
                })
              }
              items={siteContactCandidates}
              getItemKey={(c) => String(c.id || c.name)}
              getItemLabel={(c) => String(c.name || '').trim()}
              getItemSubLabel={(c) => String(c.phone_number || c.phone || '').trim()}
              getSearchTexts={(c) => [c?.name, c?.phone_number, c?.phone].filter(Boolean).map(String)}
              placeholder="担当者名（業者連絡先から候補表示）"
              emptyHint="候補がありません（自由入力可）"
              compact
              labelClassName="text-xs font-bold text-slate-600"
              inputClassName={FIELD}
            />
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
              現場担当者連絡先
              <input
                type="text"
                value={draft.siteManagerContact}
                onChange={(e) => patchDraft({ siteManagerContact: e.target.value })}
                className={FIELD}
              />
            </label>
            <label className="sm:col-span-2 flex items-start gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={Boolean(draft.registerSiteManagerAsContact)}
                disabled={!String(draft.contractorCustomerId || '').trim() && unmatchedContractor && draft.registerNewContractor === false}
                onChange={(e) => patchDraft({ registerSiteManagerAsContact: e.target.checked })}
              />
              <span>
                この担当者を業者の連絡先に登録する
                <span className="mt-0.5 block text-[11px] font-medium text-slate-500">
                  業者を候補から選ぶか新規登録すると保存できます（同名・同電話は重複登録しません）
                </span>
              </span>
            </label>
            <fieldset className="flex flex-col gap-1 text-xs font-bold text-slate-600 sm:col-span-2">
              <legend className="mb-1">依頼先工場（複数選択可）</legend>
              <div className="flex flex-col gap-2 rounded-xl border-2 border-slate-200 bg-white px-3 py-2">
                {factoryOptions.length ? (
                  factoryOptions.map((factory) => {
                    const fid = String(factory.id);
                    const checked = (draft.requestedToFactoryIds || []).includes(fid);
                    return (
                      <label key={fid} className="flex items-center gap-2 text-sm font-bold text-slate-700">
                        <input
                          type="checkbox"
                          className="h-4 w-4"
                          checked={checked}
                          onChange={() =>
                            patchDraft({
                              requestedToFactoryIds: toggleMixDesignFactoryId(
                                draft.requestedToFactoryIds,
                                fid,
                              ),
                            })
                          }
                        />
                        {factory.name || factory.id}
                      </label>
                    );
                  })
                ) : (
                  <p className="text-xs font-medium text-slate-400">工場マスタがありません</p>
                )}
              </div>
            </fieldset>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
              提出方法
              <select
                value={draft.submissionMethod}
                onChange={(e) => setDraft((prev) => ({ ...prev, submissionMethod: e.target.value }))}
                className={FIELD}
              >
                <option value="">未指定</option>
                <option value="original">原本</option>
                <option value="electronic">電子</option>
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
              宛先メール
              <input
                type="email"
                value={draft.submissionEmail}
                onChange={(e) => setDraft((prev) => ({ ...prev, submissionEmail: e.target.value }))}
                className={FIELD}
              />
            </label>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700 sm:col-span-2">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={Boolean(draft.creationDateSpecified)}
                onChange={(e) => setDraft((prev) => ({ ...prev, creationDateSpecified: e.target.checked }))}
              />
              作成日を指定する
            </label>
            {draft.creationDateSpecified ? (
              <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
                作成日
                <input
                  type="date"
                  value={draft.creationDate}
                  onChange={(e) => setDraft((prev) => ({ ...prev, creationDate: e.target.value }))}
                  className={FIELD}
                />
              </label>
            ) : null}
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
              作成部数
              <NonNegNumberInput
                inputMode="numeric"
                value={draft.copiesCount}
                onChange={(value) => patchDraft({ copiesCount: value })}
                className={FIELD}
              />
            </label>
            <div className="sm:col-span-2 rounded-xl border-2 border-slate-200 bg-white px-3 py-3">
              <p className="text-xs font-bold text-slate-600">依頼者</p>
              <label className="mt-2 flex flex-col gap-1 text-xs font-bold text-slate-600">
                氏名
                <input
                  type="text"
                  value={draft.requestedBy}
                  onChange={(e) => patchDraft({ requestedBy: e.target.value })}
                  className={FIELD}
                />
              </label>
              <label className="mt-2 flex flex-col gap-1 text-[11px] font-bold text-slate-500">
                所属
                <input
                  type="text"
                  value={draft.requestedByAffiliation}
                  onChange={(e) => patchDraft({ requestedByAffiliation: e.target.value })}
                  placeholder="ログイン中の会社名が入っていなければ手入力"
                  className={FIELD}
                />
              </label>
              {draft.requestedBy && draft.requestedByAffiliation ? (
                <p className="mt-2 text-[11px] font-medium text-slate-500">
                  表示: {formatRequesterDisplay(draft.requestedBy, draft.requestedByAffiliation)}
                </p>
              ) : null}
            </div>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600 sm:col-span-2">
              全体数量（m³）
              <NonNegNumberInput
                value={draft.totalVolumeM3}
                onChange={(value) => patchDraft({ totalVolumeM3: value })}
                className={FIELD}
                placeholder="物件全体の予定数量"
              />
              <span className="text-[11px] font-medium text-slate-500">
                配合パターンごとの数量とは別に、物件全体のおおよその数量を入力します。
              </span>
            </label>
          </div>

          <div className="mt-4 flex flex-col gap-3">
            {draft.items.map((item, index) => (
              <MixDesignItemCard
                key={item.localId}
                item={item}
                index={index}
                rowCount={draft.items.length}
                periodStart={draft.periodStart}
                periodEnd={draft.periodEnd}
                canRemove={draft.items.length > 1}
                onChange={(patch) => updateItem(index, patch)}
                onRemove={() =>
                  setDraft((prev) => ({
                    ...prev,
                    items: prev.items.filter((_, i) => i !== index),
                  }))
                }
                onDuplicate={() =>
                  setDraft((prev) => {
                    const copy = duplicateMixDesignItem(prev.items[index]);
                    const items = [...prev.items];
                    items.splice(index + 1, 0, copy);
                    return { ...prev, items };
                  })
                }
              />
            ))}
            <button
              type="button"
              onClick={() =>
                setDraft((prev) => ({
                  ...prev,
                  items: [...prev.items, createEmptyMixDesignItem()],
                }))
              }
              className="min-h-[48px] rounded-xl border-2 border-dashed border-indigo-300 bg-white px-4 text-sm font-bold text-indigo-800 hover:bg-indigo-50"
            >
              ＋ 配合パターンを追加
            </button>
          </div>

          <div className="mt-4">
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
              全体備考
              <textarea
                value={draft.memo}
                onChange={(e) => setDraft((prev) => ({ ...prev, memo: e.target.value }))}
                rows={2}
                className={FIELD}
                placeholder="依頼全体への連絡事項（配合パターンごとの備考・施工箇所とは別）"
              />
            </label>
          </div>

          {rulesError ? (
            <p className="mt-3 text-xs font-bold text-amber-800" role="status">
              補正値表の取得に失敗したため、内蔵の2026年度表で自動計算します（{rulesError}）
            </p>
          ) : null}

          {error ? (
            <p className="mt-3 text-sm font-bold text-red-700" role="alert">
              {error}
            </p>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="min-h-[44px] rounded-xl border-2 border-slate-300 bg-white px-4 text-sm font-bold text-slate-800"
            >
              {showPreview ? '帳票プレビューを閉じる' : '帳票プレビュー'}
            </button>
            {showPreview ? (
              <button
                type="button"
                onClick={() => printMixDesignSheet(printRootRef.current)}
                className="min-h-[44px] rounded-xl bg-slate-900 px-4 text-sm font-bold text-white"
              >
                印刷 / PDF
              </button>
            ) : null}
          </div>

          {showPreview ? (
            <>
              <div ref={printRootRef} className="mix-design-print-root">
                <div className="mix-design-print-preview">
                  <MixDesignRequestPrint
                    header={printHeader}
                    request={printRequest}
                    items={draft.items}
                    editable
                    onHeaderChange={patchDraft}
                    onRequestChange={patchDraft}
                    onItemChange={updateItem}
                  />
                </div>
              </div>
              {isEdit ? (
                <MixDesignEmailActions
                  factoryLinks={(Array.isArray(initialFactoryLinks) ? initialFactoryLinks : []).filter((link) =>
                    (draft.requestedToFactoryIds || []).map(String).includes(String(link.factoryId)),
                  )}
                  factories={factories}
                  header={printHeader}
                />
              ) : null}
            </>
          ) : null}
        </div>

        <div className="flex gap-2 border-t border-slate-200 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[48px] flex-1 rounded-xl border-2 border-slate-300 bg-white text-sm font-black text-slate-700"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting}
            className="min-h-[48px] flex-1 rounded-xl border-2 border-indigo-600 bg-indigo-600 text-sm font-black text-white disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300"
          >
            {submitting ? (isEdit ? '保存中…' : '送信中…') : isEdit ? '変更を保存' : '依頼を送信'}
          </button>
        </div>
      </div>
    </div>
  );
}
