import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as db from '../haishaDb.js';
import { pad2, todayLocalISODate } from '../haishaConstants.js';
import { vehicleTypeLabel } from '../utils/charterAssignedVehicles.js';
import { PlateCategoryBadge } from './PlateCategoryBadge.jsx';

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

function dayBorrowBadgeClass(requests) {
  const list = requests || [];
  if (!list.length) return 'bg-slate-300 text-slate-700 dark:bg-slate-600 dark:text-slate-100';
  const totalAccepted = list.reduce((sum, r) => sum + (r.acceptedTotal || 0), 0);
  const totalDesired = list.reduce((sum, r) => sum + (r.desired_count || 0), 0);
  const allMatched = list.every((r) => r.status === 'matched');
  if (allMatched || (totalDesired > 0 && totalAccepted >= totalDesired)) {
    return 'bg-emerald-500 text-white';
  }
  if (totalAccepted > 0) return 'bg-amber-400 text-white';
  return 'bg-slate-300 text-slate-700 dark:bg-slate-600 dark:text-slate-100';
}

function pastToneBadgeClass(baseClass, isPast) {
  if (!isPast) return baseClass;
  if (baseClass.includes('emerald')) return 'bg-emerald-300 text-emerald-950 dark:bg-emerald-800 dark:text-emerald-100';
  if (baseClass.includes('amber')) return 'bg-amber-200 text-amber-900 dark:bg-amber-800 dark:text-amber-100';
  if (baseClass.includes('sky')) return 'bg-sky-300 text-sky-950 dark:bg-sky-800 dark:text-sky-100';
  return 'bg-slate-300 text-slate-600 dark:bg-slate-600 dark:text-slate-200';
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
  const [lendBookings, setLendBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    const fid = String(factoryId || '').trim();
    if (!fid) {
      setRequests([]);
      setLendBookings([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [borrowRows, lendRows] = await Promise.all([
        db.fetchCharterRequestsWithProgress(fid),
        db.fetchFactoryCharterLendBookings(fid),
      ]);
      setRequests(Array.isArray(borrowRows) ? borrowRows : []);
      setLendBookings(Array.isArray(lendRows) ? lendRows : []);
    } catch (err) {
      console.warn('[FactoryCharterRequestCalendar] load failed', err);
      setError(err?.message || 'チャーター募集の取得に失敗しました');
      setRequests([]);
      setLendBookings([]);
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

  const lendCountByDate = useMemo(() => {
    const map = {};
    for (const b of lendBookings || []) {
      const day = String(b.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      map[day] = (map[day] || 0) + (b.offeredCount || 0);
    }
    return map;
  }, [lendBookings]);

  const lendBookingsByDate = useMemo(() => {
    const map = {};
    for (const b of lendBookings || []) {
      const day = String(b.date || '').slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
      if (!map[day]) map[day] = [];
      map[day].push(b);
    }
    return map;
  }, [lendBookings]);

  const selectedRequests = requestsByDate[selectedDate] || [];
  const selectedLendBookings = lendBookingsByDate[selectedDate] || [];
  const selectedLabel = String(selectedDate || '').replace(/-/g, '/');
  const todayDateOnly = todayLocalISODate();
  const selectedDateIsPast = Boolean(selectedDate && selectedDate < todayDateOnly);

  const selectedDayCount = selectedRequests.length + selectedLendBookings.length;

  return (
    <section className="grid min-h-0 gap-2 lg:h-full lg:grid-cols-[minmax(0,1.35fr)_minmax(0,0.9fr)] lg:grid-rows-1">
      <div className="flex min-h-[22rem] flex-col rounded-2xl border-2 border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-800 lg:min-h-0">
        <div className="shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              Charter Requests
            </p>
            <h2 className="text-base font-black leading-tight text-slate-900 dark:text-slate-100 sm:text-lg">
              チャーター募集カレンダー
            </h2>
          </div>
          <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-[11px] font-black text-white dark:bg-indigo-600">
            {selectedDayCount}件
          </span>
        </div>

        {error ? (
          <p
            className="mt-1.5 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-bold text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] font-bold leading-snug text-slate-600 dark:text-slate-300">
          <span className="inline-flex items-center gap-1">
            <span className="rounded-full bg-emerald-500 px-1.5 py-0.5 text-[10px] font-black text-white">借</span>
            ＝借りる（確定/希望）
          </span>
          <span className="text-slate-400 dark:text-slate-500">／</span>
          <span className="inline-flex items-center gap-1">
            <span className="rounded-full bg-sky-600 px-1.5 py-0.5 text-[10px] font-black text-white dark:bg-sky-500">
              貸
            </span>
            ＝他工場へ貸す確定台数
          </span>
        </div>

        <div className="mt-1.5 flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 p-1 dark:border-slate-600 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={() => {
              const next = new Date(currentMonth);
              next.setMonth(next.getMonth() - 1);
              setCurrentMonth(next);
            }}
            className="min-h-[32px] rounded-lg border-2 border-slate-300 bg-white px-2 text-xs font-black text-slate-700 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            ◀ 前月
          </button>
          <p className="text-sm font-black text-slate-900 dark:text-slate-100 sm:text-base">{monthLabel}</p>
          <button
            type="button"
            onClick={() => {
              const next = new Date(currentMonth);
              next.setMonth(next.getMonth() + 1);
              setCurrentMonth(next);
            }}
            className="min-h-[32px] rounded-lg border-2 border-slate-300 bg-white px-2 text-xs font-black text-slate-700 shadow-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            次月 ▶
          </button>
        </div>

        <div className="mt-1.5 grid grid-cols-7 gap-0.5 text-center text-[10px] font-black text-slate-500 dark:text-slate-400">
          {['日', '月', '火', '水', '木', '金', '土'].map((d) => (
            <div key={d} className="rounded-md bg-slate-100 py-0.5 dark:bg-slate-900">
              {d}
            </div>
          ))}
        </div>
        </div>

        <div className="mt-1 grid min-h-0 flex-1 grid-cols-7 grid-rows-6 gap-0.5">
          {days.map((day) => {
            const borrowList = requestsByDate[day] || [];
            const lendTotal = lendCountByDate[day] || 0;
            const hasBorrow = borrowList.length > 0;
            const hasLend = lendTotal > 0;
            const active = day === selectedDate;
            const d = new Date(`${day}T12:00:00`);
            const inMonth = day.startsWith(monthKey);
            const isPast = day < todayDateOnly;
            const borrowAccepted = borrowList.reduce((sum, r) => sum + (r.acceptedTotal || 0), 0);
            const borrowDesired = borrowList.reduce((sum, r) => sum + (r.desired_count || 0), 0);
            const borrowClass = pastToneBadgeClass(dayBorrowBadgeClass(borrowList), isPast);
            const lendClass = pastToneBadgeClass('bg-sky-600 text-white dark:bg-sky-500', isPast);
            return (
              <button
                key={day}
                type="button"
                onClick={() => setSelectedDate(day)}
                className={
                  'flex h-full min-h-0 flex-col overflow-hidden rounded-lg border-2 p-0.5 text-left transition active:scale-[0.99] sm:p-1 ' +
                  (isPast
                    ? active
                      ? 'border-slate-400 bg-slate-100 text-slate-400 ring-2 ring-slate-300 dark:border-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      : inMonth
                        ? 'border-slate-200 bg-slate-100 text-slate-400 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-400'
                        : 'border-slate-100 bg-slate-50 opacity-45 dark:border-slate-700 dark:bg-slate-900/20'
                    : active
                      ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-200 dark:border-indigo-400 dark:bg-indigo-950/40'
                      : inMonth
                        ? 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900/40 dark:hover:bg-slate-900'
                        : 'border-slate-100 bg-slate-50 opacity-45 dark:border-slate-700 dark:bg-slate-900/20')
                }
              >
                <p
                  className={
                    isPast
                      ? 'shrink-0 text-[11px] font-black leading-none text-slate-400 dark:text-slate-500'
                      : 'shrink-0 text-[11px] font-black leading-none text-slate-500 dark:text-slate-400'
                  }
                >
                  {d.getDate()}
                </p>
                <div className="mt-0.5 flex min-h-0 flex-1 flex-col gap-0.5 overflow-hidden">
                  {hasBorrow ? (
                    <span
                      className={'block truncate rounded-full px-1 py-0.5 text-center text-[9px] font-black leading-tight ' + borrowClass}
                    >
                      借 {borrowAccepted}/{borrowDesired}
                    </span>
                  ) : null}
                  {hasLend ? (
                    <span
                      className={'block truncate rounded-full px-1 py-0.5 text-center text-[9px] font-black leading-tight ' + lendClass}
                    >
                      貸 {lendTotal}
                    </span>
                  ) : null}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-white p-2 shadow-sm dark:border-slate-700 dark:bg-slate-800 lg:max-h-full">
        <div className="shrink-0">
          <p className="text-[10px] font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">選択日の詳細</p>
          <h3 className="text-sm font-black leading-tight text-slate-900 dark:text-slate-100 sm:text-base">{selectedLabel}</h3>
        </div>

        <div className="mt-1.5 min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain pr-0.5">
          <div>
            <p className="text-xs font-black text-slate-700 dark:text-slate-200">借りる（自分の募集）</p>
            {loading ? (
              <p className="mt-1.5 text-sm font-bold text-slate-500 dark:text-slate-400">読み込み中…</p>
            ) : selectedRequests.length === 0 ? (
              <p className="mt-1.5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-center text-sm font-bold text-slate-500 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-400">
                なし
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {selectedRequests.map((req) => (
                  <li
                    key={req.id}
                    className={
                      'rounded-xl border p-2 ' +
                      (selectedDateIsPast
                        ? 'border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-900/50'
                        : 'border-slate-200 bg-slate-50 dark:border-slate-600 dark:bg-slate-900/50')
                    }
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-black text-slate-900 dark:text-slate-100">
                        {vehicleTypeLabel(req.vehicle_type)}
                      </p>
                      <span className={'rounded-full px-2 py-0.5 text-[10px] font-black ' + requestBadgeClass(req)}>
                        借 {req.acceptedTotal}/{req.desired_count}
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
          </div>

          <div>
            <p className="text-xs font-black text-slate-700 dark:text-slate-200">貸す（他工場への応援）</p>
            {loading ? (
              <p className="mt-1.5 text-sm font-bold text-slate-500 dark:text-slate-400">読み込み中…</p>
            ) : selectedLendBookings.length === 0 ? (
              <p className="mt-1.5 rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-2.5 text-center text-sm font-bold text-slate-500 dark:border-slate-600 dark:bg-slate-900/40 dark:text-slate-400">
                なし
              </p>
            ) : (
              <ul className="mt-1.5 space-y-1.5">
                {selectedLendBookings.map((b) => (
                  <li
                    key={b.responseId}
                    className={
                      'rounded-xl border p-2 ' +
                      (selectedDateIsPast
                        ? 'border-sky-200 bg-sky-50/60 dark:border-sky-800 dark:bg-sky-950/30'
                        : 'border-sky-200 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/40')
                    }
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-black text-slate-900 dark:text-slate-100">🏭 {b.factoryName}</p>
                      <span className="rounded-full bg-sky-600 px-2 py-0.5 text-[10px] font-black text-white dark:bg-sky-500">
                        貸 {b.offeredCount}台
                      </span>
                    </div>
                    <p className="mt-1 text-xs font-bold text-slate-600 dark:text-slate-300">
                      {vehicleTypeLabel(b.vehicleType)} ／ {b.offeredCount}台
                    </p>
                    {b.assignedVehicles.length > 0 ? (
                      <ul className="mt-1.5 space-y-1">
                        {b.assignedVehicles.map((v, i) => (
                          <li
                            key={`${b.responseId}-${v.vehicle_id || i}`}
                            className="flex flex-wrap items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2 py-1 dark:border-slate-600 dark:bg-slate-900/60"
                          >
                            <PlateCategoryBadge category={v.plate_category} />
                            <span className="text-xs font-bold text-slate-800 dark:text-slate-100">
                              {vehicleTypeLabel(v.vehicle_type)} {v.vehicle_number || '—'}
                              {v.door_number ? `（ドア${v.door_number}）` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-1 text-xs font-bold text-amber-700 dark:text-amber-300">車両未設定</p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </aside>
    </section>
  );
}
