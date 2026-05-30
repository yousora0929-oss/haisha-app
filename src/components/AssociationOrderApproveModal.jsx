import React from 'react';
import { OrderFactoryAssignmentForm } from './OrderFactoryAssignmentForm.jsx';

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
  if (!open || !order) return null;

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
      <div className="flex max-h-[min(92vh,880px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border-2 border-violet-300 bg-white shadow-2xl">
        <div className="overflow-y-auto p-4 sm:p-5">
          <h3 className="text-lg font-black text-violet-950">工場を指定して手配・承認</h3>
          <p className="mt-1 text-xs font-medium text-slate-600">
            大口スポット注文を組合承認し、選択した工場の配車待ち一覧へ公開します。
          </p>
          <p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-900">
            {partySite} · {order.quantityM3 ?? order.quantityCube ?? '—'} m³
          </p>

          <div className="mt-4">
            <OrderFactoryAssignmentForm
              order={order}
              factories={factories}
              factoryNameById={factoryNameById}
              escalationCtx={escalationCtx}
              disabled={saving}
              previewStatus="pending"
            >
              {({ buildSelection, mainFactoryId }) => (
                <form
                  className="mt-4 flex gap-2 border-t border-slate-200 pt-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const sel = buildSelection();
                    if (!sel) {
                      window.alert('メインの手配先工場を選択してください。');
                      return;
                    }
                    onApprove(sel);
                  }}
                >
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
                </form>
              )}
            </OrderFactoryAssignmentForm>
          </div>
        </div>
      </div>
    </div>
  );
}
