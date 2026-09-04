import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as db from '../haishaDb.js';
import { MasterSuggestInput } from './MasterSuggestInput.jsx';
import { MixDesignRequestPrint } from './MixDesignRequestPrint.jsx';
import {
  AGGREGATE_SIZE_CANDIDATES,
  NOMINAL_STRENGTH_LIST,
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
  earliestPourDate,
  formatConstructionPeriod,
  handleMixDesignNavKeyDown,
  mixCodeForItem,
  mixDesignHeaderFromOrder,
  prefillMixDesignDraft,
  prefillMixDesignDraftFromRequest,
  preventMinusKey,
  pourYearChoices,
  sanitizeNonNegativeInput,
  selectAllOnFocus,
  sumMixDesignQuantityM3,
  toggleMixDesignVehicle,
  validateMixDesignDraft,
} from '../utils/mixDesignRequest.js';

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

function MixDesignItemCard({ item, index, rowCount, onChange, onRemove, canRemove, periodStart, periodEnd }) {
  const code = mixCodeForItem(item);
  const nav = (col) => `${index},${col}`;

  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-white p-3 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-black text-slate-800">配合 {index + 1}</p>
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
      {code ? (
        <p className="mb-3 rounded-lg bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800">{code}</p>
      ) : null}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
          設計基準強度
          <NonNegNumberInput
            data-mix-nav={nav(0)}
            inputMode="numeric"
            list="mix-design-base-strengths"
            value={item.baseStrength}
            onChange={(value) => onChange({ baseStrength: value })}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
          スランプ
          <NonNegNumberInput
            data-mix-nav={nav(1)}
            inputMode="numeric"
            list="mix-design-slumps"
            value={item.slump}
            onChange={(value) => onChange({ slump: value })}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
          骨材
          <NonNegNumberInput
            data-mix-nav={nav(2)}
            inputMode="numeric"
            list="mix-design-aggregates"
            value={item.aggregateSize}
            onChange={(value) => onChange({ aggregateSize: value })}
            className={FIELD}
          />
        </label>
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
  requestedByDefault = '',
  mode = 'create',
  editRequestId = '',
  initialRequest = null,
  initialItems = null,
  onClose,
  onSubmitted,
}) {
  const isEdit = mode === 'edit' && String(editRequestId || '').trim();
  const [draft, setDraft] = useState(() => prefillMixDesignDraft(null, null, requestedByDefault));
  const [baselineDraft, setBaselineDraft] = useState(null);
  const [rules, setRules] = useState([]);
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [siteContactCandidates, setSiteContactCandidates] = useState([]);
  const prevOpenRef = useRef(false);

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open) return undefined;
    if (wasOpen) return undefined;
    const nextDraft = isEdit
      ? prefillMixDesignDraftFromRequest(initialRequest, initialItems, project, requestedByDefault)
      : prefillMixDesignDraft(order, project, requestedByDefault);
    setDraft(nextDraft);
    setBaselineDraft(isEdit ? JSON.parse(JSON.stringify(nextDraft)) : null);
    setShowPreview(false);
    setError('');
    let cancelled = false;
    db.fetchCorrectionValueRules()
      .then((rows) => {
        if (!cancelled) setRules(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        console.error('correction_value_rules の取得に失敗しました', err);
      });
    return () => {
      cancelled = true;
    };
  }, [open, order, project, requestedByDefault, isEdit, initialRequest, initialItems]);

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
      if ('periodStart' in patch || 'periodEnd' in patch) {
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
      totalVolumeM3: sumMixDesignQuantityM3(draft),
      requestedBy: draft.requestedBy,
    }),
    [draft, headerContext],
  );
  const printRequest = useMemo(
    () => ({
      requestedBy: draft.requestedBy,
      vehicleTypes: draft.vehicleTypes,
      totalVolumeM3: sumMixDesignQuantityM3(draft),
      submissionMethod: draft.submissionMethod,
      submissionEmail: draft.submissionEmail,
      memo: draft.memo,
    }),
    [draft],
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

        <div
          className="min-h-0 flex-1 overflow-y-auto p-4"
          onKeyDown={(e) =>
            handleMixDesignNavKeyDown(e, {
              rowCount: draft.items.length,
              colCount: MIX_DESIGN_GRID_COLS.length,
            })
          }
        >
          <datalist id="mix-design-base-strengths">
            {NOMINAL_STRENGTH_LIST.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <datalist id="mix-design-slumps">
            {SLUMP_CANDIDATES.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
          <datalist id="mix-design-aggregates">
            {AGGREGATE_SIZE_CANDIDATES.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>

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
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600 sm:col-span-2">
              現場住所
              <input
                type="text"
                value={draft.siteAddress}
                onChange={(e) => patchDraft({ siteAddress: e.target.value })}
                className={FIELD}
              />
            </label>
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
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
                inputClassName={FIELD}
              />
            </label>
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
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
              地域
              <select value={draft.region} onChange={(e) => setRegion(e.target.value)} className={FIELD}>
                {MIX_DESIGN_REGIONS.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
              依頼先工場
              <select
                value={draft.requestedToFactoryId}
                onChange={(e) => setDraft((prev) => ({ ...prev, requestedToFactoryId: e.target.value }))}
                className={FIELD}
              >
                <option value="">未指定</option>
                {factoryOptions.map((factory) => (
                  <option key={factory.id} value={String(factory.id)}>
                    {factory.name || factory.id}
                  </option>
                ))}
              </select>
            </label>
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
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
              依頼者
              <input
                type="text"
                value={draft.requestedBy}
                onChange={(e) => setDraft((prev) => ({ ...prev, requestedBy: e.target.value }))}
                className={FIELD}
              />
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
              備考
              <textarea
                value={draft.memo}
                onChange={(e) => setDraft((prev) => ({ ...prev, memo: e.target.value }))}
                rows={2}
                className={FIELD}
              />
            </label>
          </div>

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
                onClick={() => {
                  document.body.classList.add('mix-design-printing');
                  const cleanup = () => {
                    document.body.classList.remove('mix-design-printing');
                    window.removeEventListener('afterprint', cleanup);
                  };
                  window.addEventListener('afterprint', cleanup);
                  window.setTimeout(() => window.print(), 50);
                }}
                className="min-h-[44px] rounded-xl bg-slate-900 px-4 text-sm font-bold text-white"
              >
                印刷 / PDF
              </button>
            ) : null}
          </div>

          {showPreview ? (
            <div className="mix-design-print-root">
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
