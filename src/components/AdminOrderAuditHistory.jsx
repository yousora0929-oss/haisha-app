import React, { useEffect, useMemo, useState } from 'react';
import * as db from '../haishaDb.js';
import {
  actorRoleBadgeClass,
  actorRoleLabel,
  buildAuditEventView,
  formatAuditOccurredAtJst,
  formatAuditOccurredAtJstTitle,
  formatDeclineActorNote,
  splitAuditLogs,
} from '../utils/orderAuditDisplay.js';
import {
  defaultSnapshotIndex,
  formatEscalationStepsChip,
  formatSnapshotDistanceKm,
  formatSnapshotMonthlyVolume,
  formatVisibleFromLabel,
  isFactoryDeclinedInAudit,
  snapshotReasonLabel,
} from '../utils/orderPriorityDisplay.js';

function AuditChangeRows({ primary, internal }) {
  const [showInternal, setShowInternal] = useState(false);
  return (
    <div className="mt-1 space-y-0.5">
      {primary.length ? (
        <ul className="space-y-0.5">
          {primary.map((ch, idx) => (
            <li key={`p-${ch.field}-${idx}`} className="text-xs text-slate-700">
              <span className="font-bold text-slate-800">{ch.label}</span>
              <span className="font-medium text-slate-600">
                {': '}
                {ch.beforeText}
                {' → '}
                {ch.afterText}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {internal.length ? (
        <div className="mt-1">
          <button
            type="button"
            onClick={() => setShowInternal((v) => !v)}
            className="text-[11px] font-bold text-slate-500 underline-offset-2 hover:underline"
          >
            {showInternal
              ? '内部項目を隠す'
              : `内部項目 ${internal.length}件を表示`}
          </button>
          {showInternal ? (
            <ul className="mt-1 space-y-0.5">
              {internal.map((ch, idx) => (
                <li key={`i-${ch.field}-${idx}`} className="text-xs text-slate-600">
                  <span className="font-mono text-[10px] font-medium text-slate-400">
                    {ch.label}
                  </span>
                  <span className="font-medium text-slate-500">
                    {': '}
                    {ch.beforeText}
                    {' → '}
                    {ch.afterText}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * 管理者・注文詳細内の「対応履歴」（辞退＋変更タイムライン＋スポット優先順位）
 * @param {{
 *   orderId: string,
 *   open: boolean,
 *   isSpot?: boolean,
 *   factoryNameById?: Record<string, string>,
 * }} props
 */
export function AdminOrderAuditHistory({
  orderId,
  open,
  isSpot = false,
  factoryNameById = {},
}) {
  const [logs, setLogs] = useState([]);
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotIndex, setSnapshotIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [snapshotError, setSnapshotError] = useState('');

  useEffect(() => {
    if (!open) {
      setLogs([]);
      setSnapshots([]);
      setSnapshotIndex(0);
      setError('');
      setSnapshotError('');
      setLoading(false);
      return undefined;
    }
    const id = String(orderId || '').trim();
    if (!id) {
      setLogs([]);
      setSnapshots([]);
      setError('');
      setSnapshotError('');
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    setSnapshotError('');

    const auditPromise = db
      .fetchOrderAuditLogs(id)
      .then((rows) => {
        if (!cancelled) setLogs(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        console.warn('[AdminOrderAuditHistory] audit fetch failed', err);
        if (!cancelled) {
          setLogs([]);
          setError(err?.message || '対応履歴の取得に失敗しました');
        }
      });

    const snapshotPromise = isSpot
      ? db
          .fetchOrderPrioritySnapshots(id)
          .then((rows) => {
            if (cancelled) return;
            const list = Array.isArray(rows) ? rows : [];
            setSnapshots(list);
            setSnapshotIndex(defaultSnapshotIndex(list));
          })
          .catch((err) => {
            console.warn('[AdminOrderAuditHistory] priority snapshot fetch failed', err);
            if (!cancelled) {
              setSnapshots([]);
              setSnapshotError(err?.message || '優先順位の取得に失敗しました');
            }
          })
      : Promise.resolve().then(() => {
          if (!cancelled) {
            setSnapshots([]);
            setSnapshotIndex(0);
          }
        });

    Promise.all([auditPromise, snapshotPromise]).finally(() => {
      if (!cancelled) setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [open, orderId, isSpot]);

  const { declines, timeline } = useMemo(() => splitAuditLogs(logs), [logs]);
  const activeSnapshot = snapshots[snapshotIndex] || null;
  const rankingRows = Array.isArray(activeSnapshot?.ranking) ? activeSnapshot.ranking : [];
  const stepsChip = formatEscalationStepsChip(activeSnapshot?.steps);
  const rejectedAtSnapshot = Array.isArray(activeSnapshot?.rejected_at_snapshot)
    ? activeSnapshot.rejected_at_snapshot.map((id) => String(id || '').trim()).filter(Boolean)
    : [];

  return (
    <section className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50/80 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h5 className="text-xs font-black uppercase tracking-wider text-slate-500">対応履歴</h5>
        {loading ? <span className="text-[11px] font-bold text-slate-400">読込中…</span> : null}
      </div>
      {error ? (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-900">
          {error}
        </p>
      ) : null}

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-xs font-black text-slate-700">工場の辞退</p>
        {declines.length === 0 ? (
          <p className="mt-2 text-xs font-medium text-slate-500">辞退はありません</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {declines.map((row) => {
              const fid = String(row?.factory_id || '').trim();
              const factoryLabel = (fid && factoryNameById[fid]) || fid || '（工場不明）';
              const isRevoke = String(row?.event_type || '') === 'factory_decline_revoked';
              const backfilled = Boolean(row?.is_backfilled);
              const actorNote = formatDeclineActorNote(row);
              return (
                <li
                  key={row.id || `${row.event_type}-${row.occurred_at}-${fid}`}
                  className="rounded-md border border-slate-100 bg-slate-50/80 px-2.5 py-2 text-xs"
                >
                  <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                    <span
                      className={
                        'rounded px-1.5 py-0.5 text-[10px] font-black ' +
                        (isRevoke ? 'bg-sky-100 text-sky-800' : 'bg-rose-100 text-rose-800')
                      }
                    >
                      {isRevoke ? '辞退を取消' : '辞退'}
                    </span>
                    <span className="font-black text-slate-900">{factoryLabel}</span>
                    {backfilled ? (
                      <span className="font-medium text-slate-400">時刻不明（記録開始前）</span>
                    ) : (
                      <span
                        className="font-mono font-bold text-slate-600"
                        title={formatAuditOccurredAtJstTitle(row.occurred_at)}
                      >
                        {formatAuditOccurredAtJst(row.occurred_at)}
                      </span>
                    )}
                  </div>
                  {actorNote ? (
                    <p className="mt-1 font-medium text-slate-500">{actorNote}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {isSpot ? (
        <div className="rounded-lg border border-slate-200 bg-white p-3">
          <p className="text-xs font-black text-slate-700">スポット依頼時の優先順位</p>
          {snapshotError ? (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-bold text-amber-900">
              {snapshotError}
            </p>
          ) : null}
          {!snapshotError && snapshots.length === 0 ? (
            <p className="mt-2 text-xs font-medium text-slate-400">
              記録なし（機能追加前の注文）
            </p>
          ) : null}
          {snapshots.length > 0 ? (
            <div className="mt-2 space-y-2">
              {snapshots.length > 1 ? (
                <div className="flex flex-wrap gap-1.5">
                  {snapshots.map((snap, idx) => {
                    const active = idx === snapshotIndex;
                    return (
                      <button
                        key={snap.id || `${snap.reason}-${snap.computed_at}`}
                        type="button"
                        onClick={() => setSnapshotIndex(idx)}
                        className={
                          'rounded-full border px-2.5 py-1 text-[11px] font-black ' +
                          (active
                            ? 'border-indigo-600 bg-indigo-600 text-white'
                            : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50')
                        }
                      >
                        {snapshotReasonLabel(snap.reason)}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-[11px] font-bold text-slate-500">
                  {snapshotReasonLabel(activeSnapshot?.reason)}
                </p>
              )}

              {stepsChip ? (
                <p className="text-[11px] font-medium text-slate-600">
                  段階設定: <span className="font-bold text-slate-800">{stepsChip}</span>
                </p>
              ) : null}
              {String(activeSnapshot?.mode || '') === 'preferred_only' ? (
                <p className="text-[11px] font-bold text-amber-800">
                  第一希望のみ公開中。下表は拡大承認された場合の順位
                </p>
              ) : null}
              {String(activeSnapshot?.coords_source || '') === 'none' ? (
                <p className="text-[11px] font-bold text-amber-800">
                  現場位置が未確定のため距離順は無効です
                </p>
              ) : null}
              {activeSnapshot?.small_vehicle_filter ? (
                <p className="text-[11px] font-bold text-slate-600">
                  小型車のため大型のみの工場を除外
                </p>
              ) : null}
              {rejectedAtSnapshot.length ? (
                <p className="text-[11px] font-medium text-slate-600">
                  この時点の辞退済み:{' '}
                  {rejectedAtSnapshot
                    .map((fid) => factoryNameById[fid] || fid)
                    .join('、')}
                </p>
              ) : null}
              <p className="text-[10px] font-medium text-slate-400">
                拒否除外前の全体順位です。実際の通知対象は辞退状況で変わります
              </p>

              <div className="overflow-x-auto rounded-md border border-slate-200">
                <table className="min-w-full text-left text-[11px]">
                  <thead className="bg-slate-50 text-slate-600">
                    <tr>
                      <th className="px-2 py-1.5 font-black">順位</th>
                      <th className="px-2 py-1.5 font-black">工場</th>
                      <th className="px-2 py-1.5 font-black">距離(km)</th>
                      <th className="px-2 py-1.5 font-black">当時の月次出荷量(㎥)</th>
                      <th className="px-2 py-1.5 font-black">公開の目安</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rankingRows.map((row) => {
                      const fid = String(row?.factory_id || '').trim();
                      const name = (fid && factoryNameById[fid]) || fid || '—';
                      const declined = isFactoryDeclinedInAudit(fid, declines);
                      return (
                        <tr key={`${fid}-${row?.rank}`} className="border-t border-slate-100">
                          <td className="px-2 py-1.5 font-black text-slate-900">{row?.rank ?? '—'}</td>
                          <td className="px-2 py-1.5 font-bold text-slate-800">
                            <span>{name}</span>
                            {row?.in_near_pool ? (
                              <span className="ml-1 inline-flex rounded bg-emerald-100 px-1 py-0.5 text-[9px] font-black text-emerald-800">
                                近い候補
                              </span>
                            ) : null}
                            {declined ? (
                              <span className="ml-1 inline-flex rounded bg-rose-100 px-1 py-0.5 text-[9px] font-black text-rose-800">
                                辞退
                              </span>
                            ) : null}
                          </td>
                          <td className="px-2 py-1.5 font-mono text-slate-700">
                            {formatSnapshotDistanceKm(row?.distance_km)}
                          </td>
                          <td className="px-2 py-1.5 font-mono text-slate-700">
                            {formatSnapshotMonthlyVolume(row?.monthly_volume_m3)}
                          </td>
                          <td className="px-2 py-1.5 font-medium text-slate-700">
                            {formatVisibleFromLabel(
                              row?.visible_from_minutes,
                              activeSnapshot?.effective_start_at,
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-xs font-black text-slate-700">変更履歴</p>
        {timeline.length === 0 ? (
          <p className="mt-2 text-xs font-medium text-slate-500">変更履歴はありません</p>
        ) : (
          <ol className="mt-2 space-y-3">
            {timeline.map((row) => {
              const view = buildAuditEventView(row, { factoryNameById });
              return (
                <li
                  key={row.id || `${view.eventType}-${row.occurred_at}-${row.actor_id}`}
                  className="border-l-2 border-slate-200 pl-3"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    {view.backfilled ? (
                      <span className="text-[11px] font-medium text-slate-400">
                        時刻不明（記録開始前）
                      </span>
                    ) : (
                      <span
                        className="font-mono text-[11px] font-bold text-slate-600"
                        title={view.occurredAtTitle}
                      >
                        {view.occurredAtText}
                      </span>
                    )}
                    {view.actorRole ? (
                      <span
                        className={
                          'inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-black ' +
                          actorRoleBadgeClass(view.actorRole)
                        }
                      >
                        {actorRoleLabel(view.actorRole)}
                      </span>
                    ) : null}
                    {view.actorName ? (
                      <span className="text-[11px] font-bold text-slate-800">{view.actorName}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-xs font-black text-slate-800">{view.headline}</p>
                  {view.headlineExtra.map((line) => (
                    <p key={line} className="text-[11px] font-bold text-slate-700">
                      {line}
                    </p>
                  ))}
                  {view.eventType === 'created' &&
                  view.primary.length === 0 &&
                  view.internal.length === 0 ? null : (
                    <AuditChangeRows primary={view.primary} internal={view.internal} />
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </section>
  );
}
