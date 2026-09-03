import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useState } from 'react';
import * as db from '../haishaDb.js';
import { MixDesignRequestPrint } from './MixDesignRequestPrint.jsx';
import {
  MIX_DESIGN_GRID_COLS,
  MIX_DESIGN_REGIONS,
  applyAutoCorrection,
  createEmptyMixDesignDraft,
  createEmptyMixDesignItem,
  earliestPourDate,
  handleMixDesignNavKeyDown,
  mixCodeForItem,
  selectAllOnFocus,
  sumMixDesignQuantityM3,
  validateMixDesignDraft,
} from '../utils/mixDesignRequest.js';

const FIELD =
  'min-h-[48px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300';

function MixDesignItemCard({
  item,
  index,
  rowCount,
  onChange,
  onRemove,
  canRemove,
}) {
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

export const MixDesignRequestSection = forwardRef(function MixDesignRequestSection(
  { headerContext, preferredFactoryId },
  ref,
) {
  const [enabled, setEnabled] = useState(false);
  const [draft, setDraft] = useState(createEmptyMixDesignDraft);
  const [rules, setRules] = useState([]);
  const [showPreview, setShowPreview] = useState(false);

  useEffect(() => {
    if (!enabled) return undefined;
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
  }, [enabled]);

  const updateItem = useCallback(
    (index, patch) => {
      setDraft((prev) => {
        const items = prev.items.map((item, i) => {
          if (i !== index) return item;
          const next = { ...item, ...patch };
          if (
            next.correctionIsAuto &&
            ('pourDate' in patch ||
              'cementType' in patch ||
              'correctionIsAuto' in patch ||
              'baseStrength' in patch)
          ) {
            return applyAutoCorrection(next, rules, prev.region);
          }
          if ('baseStrength' in patch || 'correctionValue' in patch) {
            return applyAutoCorrection(
              { ...next, correctionIsAuto: next.correctionIsAuto },
              rules,
              prev.region,
            );
          }
          return next;
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
    setDraft((prev) => ({
      ...prev,
      items: prev.items.map((item) =>
        item.correctionIsAuto ? applyAutoCorrection(item, rules, prev.region) : item,
      ),
    }));
  }, [rules]);

  useImperativeHandle(
    ref,
    () => ({
      isEnabled: () => enabled,
      getDraft: () => draft,
      validate: () => (enabled ? validateMixDesignDraft(draft) : []),
      reset: () => {
        setEnabled(false);
        setDraft(createEmptyMixDesignDraft());
        setShowPreview(false);
      },
    }),
    [enabled, draft],
  );

  const printHeader = useMemo(() => {
    const siteContactParts = [headerContext?.siteContactName, headerContext?.sitePhone]
      .map((v) => String(v || '').trim())
      .filter(Boolean);
    return {
      projectName: headerContext?.projectName || '',
      contractorName: headerContext?.contractorName || '',
      traderName: headerContext?.traderName || '',
      siteContact: siteContactParts.join(' / '),
      primeContractorName: headerContext?.primeContractorName || '',
      siteAddress: headerContext?.siteAddress || '',
      constructionPeriod: headerContext?.constructionPeriod || '',
      firstPourDate: earliestPourDate(draft),
      vehicleTypes: headerContext?.vehicleType ? [headerContext.vehicleType] : [],
      totalVolumeM3: sumMixDesignQuantityM3(draft),
      requestedBy: headerContext?.requestedBy || '',
    };
  }, [draft, headerContext]);

  const printRequest = useMemo(
    () => ({
      requestedBy: headerContext?.requestedBy || '',
      vehicleTypes: headerContext?.vehicleType ? [headerContext.vehicleType] : [],
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

  return (
    <div className="flex flex-col gap-3">
      <label className="flex cursor-pointer items-start gap-3 rounded-xl border-2 border-indigo-200 bg-indigo-50/70 px-4 py-3 transition hover:border-indigo-300 hover:bg-white">
        <input
          type="checkbox"
          className="mt-1 h-5 w-5 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
        />
        <span className="min-w-0 flex-1 text-sm leading-snug text-slate-800">
          <span className="font-black text-slate-900">配合計画書作成依頼</span>
          <span className="mt-1 block text-xs font-medium text-slate-500">
            チェックすると配合パターンを入力し、発注確定と同時に工場へ作成依頼します。
          </span>
        </span>
      </label>

      {enabled ? (
        <div
          className="flex flex-col gap-3 rounded-2xl border-2 border-indigo-100 bg-indigo-50/40 p-3"
          onKeyDown={(e) =>
            handleMixDesignNavKeyDown(e, {
              rowCount: draft.items.length,
              colCount: MIX_DESIGN_GRID_COLS.length,
            })
          }
        >
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-xs font-bold text-slate-600">
              地域
              <select
                value={draft.region}
                onChange={(e) => setRegion(e.target.value)}
                className={FIELD}
              >
                {MIX_DESIGN_REGIONS.map((region) => (
                  <option key={region} value={region}>
                    {region}
                  </option>
                ))}
              </select>
            </label>
            <p className="self-end text-xs font-medium text-slate-500">
              地域は住所から自動判定しません。補正値表の区分を選んでください。
              {preferredFactoryId ? ` 依頼先工場ID: ${preferredFactoryId}` : ''}
            </p>
          </div>

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

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
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
            <label className="col-span-2 flex flex-col gap-1 text-xs font-bold text-slate-600">
              宛先メール
              <input
                type="email"
                value={draft.submissionEmail}
                onChange={(e) => setDraft((prev) => ({ ...prev, submissionEmail: e.target.value }))}
                className={FIELD}
              />
            </label>
            <label className="col-span-2 flex flex-col gap-1 text-xs font-bold text-slate-600 sm:col-span-4">
              備考
              <textarea
                value={draft.memo}
                onChange={(e) => setDraft((prev) => ({ ...prev, memo: e.target.value }))}
                rows={2}
                className={FIELD}
              />
            </label>
          </div>

          <div className="flex flex-wrap gap-2">
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
      ) : null}
    </div>
  );
});
