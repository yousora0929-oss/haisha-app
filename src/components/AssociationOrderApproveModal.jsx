import React, { useEffect, useMemo, useState } from 'react';
import { rankFactoryIdsForOrder } from '../utils/escalationUtils.js';
import { getOrderVisibilityScope } from '../utils/orderVisibilityScope.js';
import { associationAssignedFactoryIds } from '../utils/associationFactoryAssignment.js';

/**
 * 組合承認待ち注文: 手配先工場を指定して配車待ちへ回す
 */
export function AssociationOrderApproveModal({
  order,
  open,
  factories,
  factoryNameById,
  escalationCtx,
  saving,
  onClose,
  onApprove,
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
    if (!open || !order) return;
    const existing = associationAssignedFactoryIds(order);
    const preferred = String(order.preferred_factory_id || order.preferredFactoryId || '').trim();
    const main = preferred || existing[0] || suggestedRanked[0] || '';
    setMainFactoryId(main);
    const subs = new Set(existing.filter((id) => id !== main));
    for (const id of suggestedRanked.slice(1, 3)) {
      if (id && id !== main) subs.add(id);
    }
    setSubFactoryIds(subs);
  }, [open, order, suggestedRanked]);

  const previewOrder = useMemo(() => {
    if (!order) return null;
    const subs = [...subFactoryIds].filter((id) => id && id !== mainFactoryId);
    const ids = mainFactoryId ? [mainFactoryId, ...subs] : subs;
    return {
      ...order,
      status: 'pending',
      preferred_factory_id: mainFactoryId || null,
      preferredFactoryId: mainFactoryId || null,
      association_assigned_factory_ids: ids,
      associationAssignedFactoryIds: ids,
    };
  }, [order, mainFactoryId, subFactoryIds]);

  const previewScope = useMemo(
    () =>
      previewOrder && escalationCtx
        ? getOrderVisibilityScope(previewOrder, escalationCtx, factoryNameById)
        : null,
    [previewOrder, escalationCtx, factoryNameById],
  );

  if (!open || !order) return null;

  const toggleSub = (id) => {
    if (id === mainFactoryId) return;
    setSubFactoryIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const submit = (e) => {
    e.preventDefault();
    if (!mainFactoryId) {
      window.alert('メインの手配先工場を選択してください。');
      return;
    }
    const subs = [...subFactoryIds].filter((id) => id && id !== mainFactoryId);
    onApprove({
      preferredFactoryId: mainFactoryId,
      associationAssignedFactoryIds: [mainFactoryId, ...subs],
    });
  };

  const partySite =
    order.siteName || order.site_name || order.projectName || order.project_name || '（現場名未入力）';

  return (
    <div
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/55 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !saving) onClose();
      }}
    >
      <form
        onSubmit={submit}
        className="flex max-h-[min(92vh,880px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border-2 border-violet-300 bg-white shadow-2xl"
      >
        <div className="overflow-y-auto p-4 sm:p-5">
          <h3 className="text-lg font-black text-violet-950">工場を指定して手配・承認</h3>
          <p className="mt-1 text-xs font-medium text-slate-600">
            大口スポット注文を組合承認し、選択した工場の配車待ち一覧へ公開します。
          </p>
          <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900">
            {partySite} · {order.quantityM3 ?? order.quantityCube ?? '—'} m³
          </p>

          <label className="mt-4 block text-xs font-black text-slate-700">
            メイン手配先工場 <span className="text-red-600">*</span>
            <select
              value={mainFactoryId}
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
              required
              className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-violet-300 bg-white px-3 text-sm font-bold text-slate-900"
            >
              <option value="">選択してください</option>
              {factoryList.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="mt-4">
            <legend className="text-xs font-black text-slate-700">サブ・応援工場（任意・複数可）</legend>
            <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50/80 p-2">
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
                          (isMain ? 'cursor-not-allowed text-slate-400' : 'text-slate-800 hover:bg-white')
                        }
                      >
                        <input
                          type="checkbox"
                          disabled={isMain || saving}
                          checked={checked}
                          onChange={() => toggleSub(f.id)}
                          className="h-4 w-4 rounded border-slate-300"
                        />
                        {f.name}
                        {isMain ? <span className="text-xs font-black text-violet-700">（メイン）</span> : null}
                      </label>
                    </li>
                  );
                })
              )}
            </ul>
          </fieldset>

          {previewScope ? (
            <div className="mt-4 rounded-xl border-2 border-sky-200 bg-sky-50/90 p-3">
              <p className="text-xs font-black text-sky-950">承認後の公開イメージ</p>
              <p className="mt-1 text-sm font-bold text-slate-900">{previewScope.summary}</p>
              {previewScope.chips.length > 0 ? (
                <p className="mt-2 text-xs font-medium text-slate-700">
                  {previewScope.chips.map((c) => c.name).join('、')}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2 border-t border-slate-200 bg-white p-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="min-h-[44px] flex-1 rounded-lg border-2 border-slate-300 bg-white text-sm font-black text-slate-700"
          >
            キャンセル
          </button>
          <button
            type="submit"
            disabled={saving || !mainFactoryId}
            className="min-h-[44px] flex-1 rounded-lg border-2 border-violet-800 bg-violet-700 text-sm font-black text-white hover:bg-violet-800 disabled:opacity-50"
          >
            {saving ? '処理中…' : '工場を指定して手配・承認'}
          </button>
        </div>
      </form>
    </div>
  );
}
