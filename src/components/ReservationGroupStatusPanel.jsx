import React, { useCallback, useEffect, useState } from 'react';
import * as db from '../haishaDb.js';
import { reservationGroupStatusLabel } from '../utils/reservationGroup.js';

const STATUS_CLASS = {
  pending: 'border-amber-300 bg-amber-50 text-amber-950',
  matched: 'border-emerald-300 bg-emerald-50 text-emerald-950',
  conflict: 'border-rose-400 bg-rose-100 text-rose-950',
};

export function ReservationGroupStatusPanel({
  groupId,
  factoryNameById = {},
  pollMs = 8000,
}) {
  const [group, setGroup] = useState(null);
  const [orders, setOrders] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const id = String(groupId || '').trim();
    if (!id) return;
    try {
      const nextGroup = await db.fetchReservationGroupById(id);
      if (!nextGroup) {
        throw new Error('予約グループが見つかりません');
      }
      let nextOrders = [];
      try {
        nextOrders = await db.fetchReservationGroupOrders([id], factoryNameById);
      } catch (err) {
        console.warn('[ReservationGroupStatusPanel] group orders fetch failed', err);
      }
      setGroup(nextGroup);
      setOrders(nextOrders);
      setError('');
    } catch (err) {
      setError(err?.message || '予約グループの状態を取得できませんでした');
    } finally {
      setLoading(false);
    }
  }, [groupId, factoryNameById]);

  useEffect(() => {
    void load();
    const ms = Number(pollMs) > 0 ? Number(pollMs) : 8000;
    const timer = window.setInterval(() => {
      void load();
    }, ms);
    return () => window.clearInterval(timer);
  }, [load, pollMs]);

  const status = group?.status || 'pending';
  const label = reservationGroupStatusLabel(status);
  const tone = STATUS_CLASS[status] || STATUS_CLASS.pending;

  return (
    <section className={`rounded-2xl border-2 p-4 shadow-sm ${tone}`} role="status">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs font-black uppercase tracking-wider">複数日予約</p>
          <h3 className="mt-1 text-lg font-black">
            {status === 'conflict' ? '要調整' : label}
          </h3>
          <p className="mt-1 font-mono text-[11px] opacity-80">{groupId}</p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="min-h-[40px] rounded-lg border-2 border-current bg-white/70 px-3 text-xs font-black"
        >
          再読み込み
        </button>
      </div>
      {group?.same_factory_required ? (
        <p className="mt-2 text-xs font-bold">同一工場必須: オン</p>
      ) : null}
      {loading ? <p className="mt-3 text-sm font-bold">状態を確認しています…</p> : null}
      {error ? <p className="mt-3 text-sm font-bold">{error}</p> : null}
      <ul className="mt-3 space-y-2">
        {orders.map((order) => (
          <li
            key={order.id}
            className="rounded-xl border border-white/70 bg-white/80 px-3 py-2 text-sm text-slate-900"
          >
            <p className="font-black">
              {order.preferredDate || '日付未設定'}
              {order.timeSlotLabel ? ` ${order.timeSlotLabel}` : ''}
            </p>
            <p className="mt-0.5 text-xs font-bold text-slate-600">
              {order.accepted_at
                ? `確定工場: ${order.factoryName || '（工場名未取得）'}`
                : '工場回答待ち'}
            </p>
          </li>
        ))}
      </ul>
      {status === 'conflict' ? (
        <p className="mt-3 text-sm font-black">
          複数日が別々の工場で確定しています。管理者へ連絡し、工場の調整を依頼してください。
        </p>
      ) : null}
    </section>
  );
}
