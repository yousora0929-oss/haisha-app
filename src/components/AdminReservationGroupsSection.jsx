import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as db from '../haishaDb.js';
import { reservationGroupStatusLabel } from '../utils/reservationGroup.js';

const STATUS_BADGE = {
  pending: 'border-amber-300 bg-amber-50 text-amber-950',
  matched: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  conflict: 'border-rose-500 bg-rose-100 text-rose-950',
};

export function AdminReservationGroupsSection({ factories = [] }) {
  const [groups, setGroups] = useState([]);
  const [ordersByGroup, setOrdersByGroup] = useState({});
  const [customersById, setCustomersById] = useState({});
  const [projectsById, setProjectsById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const factoryNameById = useMemo(
    () => Object.fromEntries((factories || []).filter((f) => f?.id).map((f) => [String(f.id), f.name])),
    [factories],
  );

  const load = useCallback(async () => {
    setError('');
    try {
      const [groupRows, customerRows, projectRows] = await Promise.all([
        db.fetchReservationGroups(),
        db.fetchCustomers().catch(() => []),
        db.fetchProjects().catch(() => []),
      ]);
      const ids = groupRows.map((g) => g.id);
      const orderRows = ids.length ? await db.fetchReservationGroupOrders(ids, factoryNameById) : [];
      const grouped = {};
      for (const order of orderRows) {
        const gid = order.reservation_group_id;
        if (!grouped[gid]) grouped[gid] = [];
        grouped[gid].push(order);
      }
      setGroups(groupRows);
      setOrdersByGroup(grouped);
      setCustomersById(
        Object.fromEntries((customerRows || []).filter((c) => c?.id).map((c) => [String(c.id), c])),
      );
      setProjectsById(
        Object.fromEntries((projectRows || []).filter((p) => p?.id).map((p) => [String(p.id), p])),
      );
    } catch (err) {
      console.error(err);
      setError(err?.message || '予約グループの取得に失敗しました。');
    } finally {
      setLoading(false);
    }
  }, [factoryNameById]);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedGroups = useMemo(() => {
    const rank = (status) => (status === 'conflict' ? 0 : status === 'pending' ? 1 : 2);
    return [...groups].sort((a, b) => {
      const ra = rank(a.status);
      const rb = rank(b.status);
      if (ra !== rb) return ra - rb;
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });
  }, [groups]);

  const conflictCount = groups.filter((g) => g.status === 'conflict').length;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">予約グループ</h2>
          <p className="mt-1 text-xs text-slate-500">
            3日間予約の状態です。別工場で確定したグループは「要調整」として先頭に出ます。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="min-h-[40px] rounded-lg border-2 border-slate-300 bg-white px-3 text-sm font-black text-slate-700"
        >
          再読み込み
        </button>
      </div>

      {conflictCount > 0 ? (
        <div className="cl-alert-warning-panel mt-4 rounded-xl border-2 border-rose-500 bg-rose-50 p-4">
          <p className="text-base font-black text-rose-950">要調整が {conflictCount} 件あります</p>
          <p className="mt-1 text-xs font-bold text-rose-900">
            3件が別々の工場で確定しています。電話などで工場を調整してください。
          </p>
        </div>
      ) : null}

      {error ? (
        <p className="mt-4 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      {loading ? <p className="mt-4 text-sm text-slate-500">読み込み中…</p> : null}

      {!loading && sortedGroups.length === 0 ? (
        <p className="mt-4 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">
          予約グループはまだありません
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {sortedGroups.map((group) => {
            const orders = ordersByGroup[group.id] || [];
            const status = group.status || 'pending';
            const customer = customersById[group.customer_id];
            const project = projectsById[group.project_id];
            return (
              <li
                key={group.id}
                className={
                  'rounded-2xl border-2 p-4 ' +
                  (status === 'conflict'
                    ? 'border-rose-500 bg-rose-50'
                    : status === 'matched'
                      ? 'border-emerald-200 bg-emerald-50/60'
                      : 'border-slate-200 bg-slate-50')
                }
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-black text-slate-900">
                      {project?.name || orders[0]?.siteName || '物件未設定'}
                    </p>
                    <p className="mt-0.5 text-xs font-bold text-slate-600">
                      {customer?.company_name || customer?.name || group.customer_id || '発注者未設定'}
                    </p>
                    <p className="mt-1 font-mono text-[11px] text-slate-500">{group.id}</p>
                  </div>
                  <span
                    className={
                      'inline-flex rounded-full border px-3 py-1 text-xs font-black ' +
                      (STATUS_BADGE[status] || STATUS_BADGE.pending)
                    }
                  >
                    {status === 'conflict' ? '要調整' : reservationGroupStatusLabel(status)}
                  </span>
                </div>
                <p className="mt-2 text-xs font-bold text-slate-600">
                  同一工場必須: {group.same_factory_required ? 'オン' : 'オフ'}
                </p>
                <ul className="mt-3 space-y-1.5">
                  {orders.map((order) => (
                    <li
                      key={order.id}
                      className="rounded-lg border border-white bg-white px-3 py-2 text-sm text-slate-800"
                    >
                      <span className="font-black">
                        {order.preferredDate || '日付未設定'}
                        {order.timeSlotLabel ? ` ${order.timeSlotLabel}` : ''}
                      </span>
                      <span className="mt-0.5 block text-xs font-bold text-slate-600">
                        {order.accepted_at
                          ? `確定工場: ${order.factoryName || order.factory_site_id || '—'}`
                          : `未確定（第一希望: ${order.preferredFactoryName || '指定なし'}）`}
                        {order.quantityM3 !== '' && order.quantityM3 != null
                          ? ` · ${order.quantityM3} m³`
                          : ''}
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
