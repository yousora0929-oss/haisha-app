import React, { useEffect, useMemo, useState } from 'react';
import * as db from '../haishaDb.js';
import {
  actorRoleBadgeClass,
  actorRoleLabel,
  formatAuditOccurredAtJst,
  formatDeclineActorNote,
  formatTimelineActorName,
  normalizeAuditChanges,
  splitAuditLogs,
} from '../utils/orderAuditDisplay.js';

/**
 * 管理者・注文詳細内の「対応履歴」（辞退＋変更タイムライン）
 * @param {{ orderId: string, open: boolean, factoryNameById?: Record<string, string> }} props
 */
export function AdminOrderAuditHistory({ orderId, open, factoryNameById = {} }) {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setLogs([]);
      setError('');
      setLoading(false);
      return undefined;
    }
    const id = String(orderId || '').trim();
    if (!id) {
      setLogs([]);
      setError('');
      return undefined;
    }
    let cancelled = false;
    setLoading(true);
    setError('');
    db.fetchOrderAuditLogs(id)
      .then((rows) => {
        if (!cancelled) setLogs(Array.isArray(rows) ? rows : []);
      })
      .catch((err) => {
        console.warn('[AdminOrderAuditHistory] fetch failed', err);
        if (!cancelled) {
          setLogs([]);
          setError(err?.message || '対応履歴の取得に失敗しました');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, orderId]);

  const { declines, timeline } = useMemo(() => splitAuditLogs(logs), [logs]);

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
                        (isRevoke
                          ? 'bg-sky-100 text-sky-800'
                          : 'bg-rose-100 text-rose-800')
                      }
                    >
                      {isRevoke ? '辞退を取消' : '辞退'}
                    </span>
                    <span className="font-black text-slate-900">{factoryLabel}</span>
                    {backfilled ? (
                      <span className="font-medium text-slate-400">時刻不明（記録開始前）</span>
                    ) : (
                      <span className="font-mono font-bold text-slate-600">
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

      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="text-xs font-black text-slate-700">変更履歴</p>
        {timeline.length === 0 ? (
          <p className="mt-2 text-xs font-medium text-slate-500">変更履歴はありません</p>
        ) : (
          <ol className="mt-2 space-y-3">
            {timeline.map((row) => {
              const eventType = String(row?.event_type || '');
              const backfilled = Boolean(row?.is_backfilled);
              const actorName = formatTimelineActorName(row);
              const role = String(row?.actor_role || '').trim();
              const changeRows = normalizeAuditChanges(row?.changes);
              return (
                <li
                  key={row.id || `${eventType}-${row.occurred_at}-${row.actor_id}`}
                  className="border-l-2 border-slate-200 pl-3"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    {backfilled ? (
                      <span className="text-[11px] font-medium text-slate-400">
                        時刻不明（記録開始前）
                      </span>
                    ) : (
                      <span className="font-mono text-[11px] font-bold text-slate-600">
                        {formatAuditOccurredAtJst(row.occurred_at)}
                      </span>
                    )}
                    {role ? (
                      <span
                        className={
                          'inline-flex rounded-full border px-1.5 py-0.5 text-[10px] font-black ' +
                          actorRoleBadgeClass(role)
                        }
                      >
                        {actorRoleLabel(role)}
                      </span>
                    ) : null}
                    {actorName ? (
                      <span className="text-[11px] font-bold text-slate-800">{actorName}</span>
                    ) : null}
                  </div>
                  {eventType === 'created' ? (
                    <p className="mt-1 text-xs font-medium text-slate-700">注文が作成されました</p>
                  ) : changeRows.length === 0 ? (
                    <p className="mt-1 text-xs font-medium text-slate-500">
                      {eventType === 'status_changed' ? 'ステータスが変更されました' : '更新されました'}
                    </p>
                  ) : (
                    <ul className="mt-1 space-y-0.5">
                      {changeRows.map((ch, idx) => (
                        <li key={`${ch.field}-${idx}`} className="text-xs text-slate-700">
                          {ch.known ? (
                            <span className="font-bold text-slate-800">{ch.label}</span>
                          ) : (
                            <span className="font-mono text-[10px] font-medium text-slate-400">
                              {ch.label}
                            </span>
                          )}
                          <span className="font-medium text-slate-600">
                            {': '}
                            {ch.beforeText}
                            {' → '}
                            {ch.afterText}
                          </span>
                        </li>
                      ))}
                    </ul>
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
