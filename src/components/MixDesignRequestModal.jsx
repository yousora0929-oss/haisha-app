import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as db from '../haishaDb.js';
import { MixDesignRequestPrint } from './MixDesignRequestPrint.jsx';
import {
  AGGREGATE_SIZE_CANDIDATES,
  NOMINAL_STRENGTH_LIST,
  SLUMP_CANDIDATES,
} from '../utils/mixDesignCalc.js';
import {
  MIX_DESIGN_GRID_COLS,
  MIX_DESIGN_REGIONS,
  applyAutoCorrection,
  createEmptyMixDesignItem,
  earliestPourDate,
  handleMixDesignNavKeyDown,
  mixCodeForItem,
  mixDesignHeaderFromOrder,
  prefillMixDesignDraft,
  selectAllOnFocus,
  sumMixDesignQuantityM3,
  validateMixDesignDraft,
} from '../utils/mixDesignRequest.js';

const FIELD =
  'min-h-[48px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300';

function MixDesignItemCard({ item, index, rowCount, onChange, onRemove, canRemove }) {
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
          <input
            data-mix-nav={nav(0)}
            type="number"
            inputMode="numeric"
            list="mix-design-base-strengths"
            value={item.baseStrength}
            onFocus={selectAllOnFocus}
            onChange={(e) => onChange({ baseStrength: e.target.value })}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
          スランプ
          <input
            data-mix-nav={nav(1)}
            type="number"
            inputMode="numeric"
            list="mix-design-slumps"
            value={item.slump}
            onFocus={selectAllOnFocus}
            onChange={(e) => onChange({ slump: e.target.value })}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
          骨材
          <input
            data-mix-nav={nav(2)}
            type="number"
            inputMode="numeric"
            list="mix-design-aggregates"
            value={item.aggregateSize}
            onFocus={selectAllOnFocus}
            onChange={(e) => onChange({ aggregateSize: e.target.value })}
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
          <input
            data-mix-nav={nav(4)}
            type="number"
            inputMode="decimal"
            value={item.quantityM3}
            onFocus={selectAllOnFocus}
            onChange={(e) => onChange({ quantityM3: e.target.value })}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
          打設日
          <input
            data-mix-nav={nav(5)}
            type="date"
            value={item.pourDate}
            onChange={(e) => onChange({ pourDate: e.target.value })}
            className={FIELD}
          />
        </label>
        <label className="col-span-2 flex flex-col gap-1 text-xs font-bold text-slate-600">
          施工箇所
          <input
            data-mix-nav={nav(6)}
            type="text"
            value={item.constructionLocation}
            onChange={(e) => onChange({ constructionLocation: e.target.value })}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
          W/C比（%）
          <input
            data-mix-nav={nav(7)}
            type="number"
            inputMode="decimal"
            value={item.waterCementRatio}
            onFocus={selectAllOnFocus}
            onChange={(e) => onChange({ waterCementRatio: e.target.value })}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
          単位水量
          <input
            data-mix-nav={nav(8)}
            type="number"
            inputMode="decimal"
            value={item.unitWaterContent}
            onFocus={selectAllOnFocus}
            onChange={(e) => onChange({ unitWaterContent: e.target.value })}
            className={FIELD}
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
          構造体補正値
          <input
            data-mix-nav={nav(9)}
            type="number"
            inputMode="numeric"
            value={item.correctionValue}
            disabled={item.correctionIsAuto}
            onFocus={selectAllOnFocus}
            onChange={(e) => onChange({ correctionValue: e.target.value, correctionIsAuto: false })}
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
  requestedByDefault = '',
  onClose,
  onSubmitted,
}) {
  const [draft, setDraft] = useState(() => prefillMixDesignDraft(null, null, requestedByDefault));
  const [rules, setRules] = useState([]);
  const [showPreview, setShowPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    setDraft(prefillMixDesignDraft(order, project, requestedByDefault));
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
  }, [open, order, project, requestedByDefault]);

  const updateItem = useCallback(
    (index, patch) => {
      setDraft((prev) => {
        const items = prev.items.map((item, i) => {
          if (i !== index) return item;
          const next = { ...item, ...patch };
          return applyAutoCorrection(next, rules, prev.region);
        });
        return { ...prev, items };
      });
    },
    [rules],
  );

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
      firstPourDate: earliestPourDate(draft),
      totalVolumeM3: sumMixDesignQuantityM3(draft),
      requestedBy: draft.requestedBy,
    }),
    [draft, headerContext],
  );
  const printRequest = useMemo(
    () => ({
      requestedBy: draft.requestedBy,
      vehicleTypes: headerContext.vehicleTypes,
      totalVolumeM3: sumMixDesignQuantityM3(draft),
      testSalt: draft.testSalt,
      testSplitPour: draft.testSplitPour,
      testSpecimenCount: draft.testSpecimenCount,
      testThirdParty: draft.testThirdParty,
      submissionMethod: draft.submissionMethod,
      submissionEmail: draft.submissionEmail,
      quoteRequested: draft.quoteRequested,
      memo: draft.memo,
    }),
    [draft, headerContext],
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
      await db.submitMixDesignRequestFromOrder({
        order,
        draft,
        requestedBy: draft.requestedBy || requestedByDefault,
      });
      onSubmitted?.();
      onClose?.();
    } catch (err) {
      console.error('配合計画書依頼の作成に失敗しました', err);
      const message = err?.message || '配合計画書依頼の作成に失敗しました';
      setError(message);
      window.alert(message);
    } finally {
      setSubmitting(false);
    }
  };

  if (!open || !order) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[100dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:max-h-[92dvh] sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
          <div>
            <h2 className="text-base font-black text-slate-900">配合計画書を依頼</h2>
            <p className="mt-1 text-xs font-medium text-slate-500">
              {headerContext.projectName || '現場未設定'}
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

          <dl className="mb-4 grid gap-1.5 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-bold text-slate-600">
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-slate-400">工事名</dt>
              <dd className="min-w-0 flex-1 break-words text-slate-900">{headerContext.projectName || '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-slate-400">業者名</dt>
              <dd className="min-w-0 flex-1 break-words text-slate-900">{headerContext.contractorName || '—'}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="w-20 shrink-0 text-slate-400">現場住所</dt>
              <dd className="min-w-0 flex-1 break-words text-slate-900">{headerContext.siteAddress || '—'}</dd>
            </div>
          </dl>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              <input
                type="number"
                inputMode="numeric"
                value={draft.copiesCount}
                onFocus={selectAllOnFocus}
                onChange={(e) => setDraft((prev) => ({ ...prev, copiesCount: e.target.value }))}
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

          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={draft.testSalt}
                onChange={(e) => setDraft((prev) => ({ ...prev, testSalt: e.target.checked }))}
              />
              塩化物
            </label>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={draft.testSplitPour}
                onChange={(e) => setDraft((prev) => ({ ...prev, testSplitPour: e.target.checked }))}
              />
              分割打設
            </label>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={draft.testThirdParty}
                onChange={(e) => setDraft((prev) => ({ ...prev, testThirdParty: e.target.checked }))}
              />
              第三者試験
            </label>
            <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={Boolean(draft.quoteRequested)}
                onChange={(e) => setDraft((prev) => ({ ...prev, quoteRequested: e.target.checked }))}
              />
              お見積書を依頼
            </label>
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
              供試体本数
              <input
                type="number"
                inputMode="numeric"
                value={draft.testSpecimenCount}
                onFocus={selectAllOnFocus}
                onChange={(e) => setDraft((prev) => ({ ...prev, testSpecimenCount: e.target.value }))}
                className={FIELD}
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-xs font-bold text-slate-600 sm:col-span-3">
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
                <MixDesignRequestPrint header={printHeader} request={printRequest} items={draft.items} />
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
            {submitting ? '送信中…' : '依頼を送信'}
          </button>
        </div>
      </div>
    </div>
  );
}
