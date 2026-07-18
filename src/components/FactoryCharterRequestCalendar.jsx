import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as db from '../haishaDb.js';
import { pad2, todayLocalISODate } from '../haishaConstants.js';
import { vehicleTypeLabel } from '../utils/charterAssignedVehicles.js';

const STATUS_LABEL = {
  open: '募集中',
  matched: '確定済み',
  cancelled: '取消',
  closed: '終了',
};

function requestStatusLabel(status) {
  const key = String(status || '').trim();
  return STATUS_LABEL[key] || key || '—';
}

function requestBadgeClass(req) {
  if (req?.status === 'matched') return 'bg-emerald-500 text-white';
  if ((req?.acceptedTotal || 0) > 0) return 'bg-amber-400 text-white';
  return 'bg-slate-300 text-slate-700 dark:bg-slate-600 dark:text-slate-100';
}

/**
 * 工場 — 自工場が出したチャーター募集の進捗カレンダー
 */
export function FactoryCharterRequestCalendar({ factoryId }) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const t = todayLocalISODate();
    const [y, m] = t.split('-').map(Number);
    return new Date(y, m - 1, 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => todayLocalISODate());
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const fid = String(factoryId || '').trim();
    if (!fid) {
      setRequests([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const rows = await db.fetchCharterRequestsWithProgress(fid);
      setRequests(Array.isArray(rows) ? rows : []);
    } catch (err) {
      console.warn('[FactoryCharterRequestCalendar] load failed', err);
      setError(err?.message || 'チャーター募集の取得に失敗しました');
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [factoryId]);

  useEffect(() => {
    void load();
  }, [load]);

  const days = useMemo(() => {
    const base = currentMonth instanceof Date && !Number.isNaN(currentMonth.getTime()) ? currentMonth : new Date();
    const first = new Date(base.getFullYear(), base.getMonth(), 1);
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
    });
  }, [currentMonth]);

  const monthLabel = useMemo(() => {
    const base = currentMonth instanceof Date && !Number.isNaN(currentMonth.getTime()) ? currentMonth : new Date();
    return `${base.getFullYear()}年${base.getMonth() + 1}月`;
  }, [currentMonth]);

  const monthKey = useMemo(() => {
    const base = currentMonth instanceof Date && !Number.isNaN(currentMonth.getTime()) ? currentMonth : new Date();
    return `${base.getFullYear()}-${pad2(base.getMonth() + 1)}`;
  }, [currentMonth]);

  const requestsByDate = useMemo(() => {
    const map = {};
    for (const req of requests || []) {
      const day = String(req.request_date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      if (!map[day]) map[day] = [];
      map[day].push(req);
    }
    return map;
  }, [requests]);

  const selectedRequests = requestsByDate[selectedDate] || [];
  const selectedLabel = String(selectedDate || '').replace(/-/g, '/');

  return (
    <section className="grid gap-2 lg:grid-cols-[1.35fr_0.9fr]">
      <div className="rounded-2xl border-2 border-slate-200 bg-white p-2.5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              Charter Requests
            </p>
            <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">チャーター募集カレンダー</h2>
          </div>
          <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-black text-white dark:bg-indigo-600">
            {selectedRequests.length}件
          </span>
        </div>

        {error ? (
          <p
            className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-2 flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1.5 dark:border-slate-600 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={() => {
              const next = new Date(currentMonth);
              next.setMonth(next.getMonth() - 1);
              setCurrentMonth(next);
            }}
            className="min-h-[36px] rounded-lg border-2 border-slate-300 bg-white px-2.5 text-xs font-black text-slate-700 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            ◀ 前月
          </button>
          <p className="text-base font-black text-slate-900 dark:text-slate-100">{monthLabel}</p>
          <button
            type="button"
            onClick={() => {
              const next = new Date(currentMonth);
              next.setMonth(next.getMonth() + 1);
              setCurrentMonth(next);
            }}
            className="min-h-[36px] rounded-lg border-2 border-slate-300 bg-white px-2.5 text-xs font-black text-slate-700 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            次月 ▶
          </button>
        </div>

        <div className="mt-2 grid grid-cols-7 gap-1 text-center text-[11px] font-black text-slate-500 dark:text-slate-400">
          {['日', '月', '火', '水', '木', '金', '土'].map((d) => (
            <div key={d} className="rounded-lg bg-slate-100 py-1 dark:bg-slate-900">
              {d}
            </div>
          ))}
        </div>

        <div className="mt-1.5 grid grid-cols-7 gap-1">
          {days.map((day) => {
            const list = requestsByDate[day] || [];
            const active = day === selectedDate;
            const d = new Date(`${day}T12:00:00`);
            const inMonth = day.startsWith(monthKey);
            return (
              <button
                key={day}
                type="button"
                onClick={() => setSelectedDate(day)}
                className={
                  'min-h-[4.8rem] rounded-lg border-2 p-1 text-left transition active:scale-[0.99] sm:min-h-[5.5rem] sm:p-1.5 ' +
                  (active
                    ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-200 dark:border-indigo-400 dark:bg-indigo-950/40'
                    : inMonth
                      ? 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900/40 dark:hover:bg-slate-900'
                      : 'border-slate-100 bg-slate-50 opacity-45 dark:border-slate-700 dark:bg-slate-900/20')
                }
              >
                <p className="text-xs font-black text-slate-500 dark:text-slate-400">{d.getDate()}</p>
                <div className="mt-1 space-y-0.5">
                  {list.slice(0, 3).map((req) => (
                    <span
                      key={req.id}
                      className={'block truncate rounded-full px-1.5 py-0.5 text-center text-[10px] font-black ' + requestBadgeClass(req)}
                    >
                      {req.acceptedTotal}/{req.desired_count}
                    </span>
                  ))}
                  {list.length > 3 ? (
                    <span className="block text-[11px] font-black text-indigo-700 dark:text-indigo-300">
                      +{list.length - 3}件
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <aside className="rounded-2xl border-2 border-slate-200 bg-white p-2.5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <p className="text-xs font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">選択日の募集</p>
        <h3 className="text-base font-black text-slate-900 dark:text-slate-100">{selectedLabel}</h3>
        {loading ? (
          <p className="mt-2 text-sm font-bold text-slate-500 dark:text-slate-400">読み込み中…</p>
        ) : selectedRequests.length === 0 ? (
          <p className="mt-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-5 text-center text-sm font-bold text-slate-500 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-400">
            この日の募集はありません
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {selectedRequests.map((req) => (
              <li
                key={req.id}
                className="rounded-xl border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-600 dark:bg-slate-900/50"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-black text-slate-900 dark:text-slate-100">
                    {vehicleTypeLabel(req.vehicle_type)}
                  </p>
                  <span className={'rounded-full px-2 py-0.5 text-[10px] font-black ' + requestBadgeClass(req)}>
                    {req.acceptedTotal}/{req.desired_count}
                  </span>
                </div>
                <p className="mt-1 text-xs font-bold text-slate-600 dark:text-slate-300">
                  希望 {req.desired_count}台 ／ 確定 {req.acceptedTotal}台 ／ {requestStatusLabel(req.status)}
                </p>
                {req.note ? (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">備考: {req.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </aside>
    </section>
  );
}
