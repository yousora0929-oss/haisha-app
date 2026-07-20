import React, { useEffect, useMemo, useState } from 'react';
import { rankFactoryIdsForOrder } from '../utils/escalationUtils.js';
import { getOrderVisibilityScope } from '../utils/orderVisibilityScope.js';
import { associationAssignedFactoryIds } from '../utils/associationFactoryAssignment.js';

/**
 * メイン / サブ工場の指定フォーム（組合承認・手配振替で共用）
 */
export function OrderFactoryAssignmentForm({
  order,
  factories,
  factoryNameById,
  escalationCtx,
  disabled = false,
  showPreview = true,
  previewStatus = 'pending',
  children,
}) {
  const [mainFactoryId, setMainFactoryId] = useState('');
  const [subFactoryIds, setSubFactoryIds] = useState(() => new Set());

  const factoryList = useMemo(
    () =>
      (factories || [])
        .filter((f) => f?.id)
        .map((f) => ({
          id: String(f.id),
          name: String(f.name || f.factory_name || factoryNameById?.[f.id] || f.id).trim(),
        }))
        .sort((a, b) => a.name.localeCompare(b.name, 'ja')),
    [factories, factoryNameById],
  );

  const suggestedRanked = useMemo(() => {
    if (!order || !escalationCtx) return [];
    return rankFactoryIdsForOrder(order, escalationCtx.projectById, factories, escalationCtx.globalAllowedAreas);
  }, [order, escalationCtx, factories]);

  useEffect(() => {
    if (!order) return;
    const existing = associationAssignedFactoryIds(order);
    const preferred = String(order.preferred_factory_id || order.preferredFactoryId || '').trim();
    const main = preferred || existing[0] || suggestedRanked[0] || '';
    setMainFactoryId(main);
    const subs = new Set(existing.filter((id) => id !== main));
    setSubFactoryIds(subs);
  }, [order, suggestedRanked]);

  const previewOrder = useMemo(() => {
    if (!order) return null;
    const subs = [...subFactoryIds].filter((id) => id && id !== mainFactoryId);
    const ids = mainFactoryId ? [mainFactoryId, ...subs] : subs;
    return {
      ...order,
      status: previewStatus,
      preferred_factory_id: mainFactoryId || null,
      preferredFactoryId: mainFactoryId || null,
      association_assigned_factory_ids: ids,
      associationAssignedFactoryIds: ids,
    };
  }, [order, mainFactoryId, subFactoryIds, previewStatus]);

  const previewScope = useMemo(
    () =>
      showPreview && previewOrder && escalationCtx
        ? getOrderVisibilityScope(previewOrder, escalationCtx, factoryNameById)
        : null,
    [showPreview, previewOrder, escalationCtx, factoryNameById],
  );

  const toggleSub = (id) => {
    if (id === mainFactoryId || disabled) return;
    setSubFactoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const buildSelection = () => {
    if (!mainFactoryId) return null;
    const subs = [...subFactoryIds].filter((id) => id && id !== mainFactoryId);
    return {
      preferredFactoryId: mainFactoryId,
      associationAssignedFactoryIds: [mainFactoryId, ...subs],
    };
  };

  return (
    <div className="space-y-4">
      <label className="block text-xs font-black text-slate-700">
        メイン手配先工場 <span className="text-red-600">*</span>
        <select
          value={mainFactoryId}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value;
            setMainFactoryId(next);
            if (next) {
              setSubFactoryIds((prev) => {
                const copy = new Set(prev);
                copy.delete(next);
                return copy;
              });
            }
          }}
          className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-indigo-300 bg-white px-3 text-sm font-bold text-slate-900 disabled:bg-slate-100"
        >
          <option value="">選択してください</option>
          {factoryList.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend className="text-xs font-black text-slate-700">サブ・応援工場（任意・複数可）</legend>
        <ul className="mt-2 space-y-1 rounded-lg border border-slate-200 bg-slate-50/80 p-2">
          {factoryList.length === 0 ? (
            <li className="px-2 py-2 text-xs text-slate-500">工場マスタがありません。</li>
          ) : (
            factoryList.map((f) => {
              const isMain = f.id === mainFactoryId;
              const checked = subFactoryIds.has(f.id);
              return (
                <li key={f.id}>
                  <label
                    className={
                      'flex min-h-[40px] cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-bold ' +
                      (isMain || disabled ? 'cursor-not-allowed text-slate-400' : 'text-slate-800 hover:bg-white')
                    }
                  >
                    <input
                      type="checkbox"
                      disabled={isMain || disabled}
                      checked={checked}
                      onChange={() => toggleSub(f.id)}
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    {f.name}
                    {isMain ? <span className="text-xs font-black text-indigo-700">（メイン）</span> : null}
                  </label>
                </li>
              );
            })
          )}
        </ul>
      </fieldset>

      {previewScope ? (
        <div className="rounded-xl border-2 border-sky-200 bg-sky-50/90 p-3">
          <p className="text-xs font-black text-sky-950">変更後の公開イメージ</p>
          <p className="mt-1 text-sm font-bold text-slate-900">{previewScope.summary}</p>
          {previewScope.chips.length > 0 ? (
            <p className="mt-2 text-xs font-medium text-slate-700">
              {previewScope.chips.map((c) => c.name).join('、')}
            </p>
          ) : null}
        </div>
      ) : null}

      {typeof children === 'function' ? children({ buildSelection, mainFactoryId }) : children}
    </div>
  );
}
