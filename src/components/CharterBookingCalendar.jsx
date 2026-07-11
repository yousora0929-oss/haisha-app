import React, { useMemo, useState } from 'react';
import { pad2, todayLocalISODate } from '../haishaConstants.js';
import { PlateCategoryBadge } from './PlateCategoryBadge.jsx';

/**
 * チャーター業者 — 確定済み予約の月間カレンダー
 */
export function CharterBookingCalendar({ bookings = [], loading = false, error = '' }) {
  const [currentMonth, setCurrentMonth] = useState(() => {
    const t = todayLocalISODate();
    const [y, m] = t.split('-').map(Number);
    return new Date(y, m - 1, 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => todayLocalISODate());

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

  const bookingsByDate = useMemo(() => {
    const map = {};
    for (const b of bookings || []) {
      if (!b.date) continue;
      if (!map[b.date]) map[b.date] = [];
      map[b.date].push(b);
    }
    return map;
  }, [bookings]);

  const selectedBookings = bookingsByDate[selectedDate] || [];
  const selectedLabel = String(selectedDate || '').replace(/-/g, '/');

  return (
    <section className="space-y-3 pb-8">
      <header>
        <p className="text-xs font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
          Booking Calendar
        </p>
        <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">予約カレンダー</h2>
        <p className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">
          確定済み（accepted）の応援案件を月間で確認できます
        </p>
      </header>

      {error ? (
        <p
          className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-700 dark:border-red-800 dark:bg-red-950/40 dark:text-red-300"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="rounded-2xl border-2 border-slate-200 bg-white p-2.5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
              月間予定
            </p>
            <h3 className="text-base font-black text-slate-900 dark:text-slate-100">{monthLabel}</h3>
          </div>
          <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-black text-white dark:bg-indigo-600">
            {selectedBookings.length}件
          </span>
        </div>

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
            const list = bookingsByDate[day] || [];
            const active = day === selectedDate;
            const d = new Date(`${day}T12:00:00`);
            const inMonth = day.startsWith(monthKey);
            return (
              <button
                key={day}
                type="button"
                onClick={() => setSelectedDate(day)}
                className={
                  'min-h-[3.6rem] rounded-lg border-2 p-1 text-left transition active:scale-[0.99] sm:min-h-[4.2rem] sm:p-1.5 ' +
                  (active
                    ? 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-200 dark:border-indigo-400 dark:bg-indigo-950/40'
                    : inMonth
                      ? 'border-slate-200 bg-white hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-900/40 dark:hover:bg-slate-900'
                      : 'border-slate-100 bg-slate-50 opacity-45 dark:border-slate-700 dark:bg-slate-900/20')
                }
              >
                <p className="text-xs font-black text-slate-500 dark:text-slate-400">{d.getDate()}</p>
                {list.length > 0 ? (
                  <span className="mt-1 inline-flex rounded-md bg-indigo-600 px-1.5 py-0.5 text-[10px] font-black text-white">
                    {list.length}件
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800">
        <p className="text-sm font-black text-slate-800 dark:text-slate-100">{selectedLabel}の予約</p>
        {loading ? (
          <p className="mt-2 text-sm font-bold text-slate-500 dark:text-slate-400">読み込み中…</p>
        ) : selectedBookings.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">この日の予約はありません</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {selectedBookings.map((b) => (
              <li
                key={b.responseId}
                className="rounded-lg border border-indigo-200 bg-indigo-50 p-2.5 dark:border-indigo-700 dark:bg-indigo-950/40"
              >
                <p className="text-sm font-black text-slate-900 dark:text-slate-100">🏭 {b.factoryName}</p>
                <p className="mt-1 text-xs font-bold text-slate-600 dark:text-slate-300">
                  {b.vehicleType === 'large' ? '大型' : '小型'} ／ {b.offeredCount}台
                </p>
                {b.assignedVehicles.length > 0 ? (
                  <ul className="mt-1 space-y-1">
                    {b.assignedVehicles.map((v, i) => (
                      <li
                        key={`${b.responseId}-${v.vehicle_id || i}`}
                        className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200"
                      >
                        <span>🚛</span>
                        <PlateCategoryBadge category={v.plate_category} />
                        <span>
                          {v.vehicle_number || '—'}
                          {v.door_number ? `（ドア${v.door_number}）` : ''}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-xs font-bold text-amber-700 dark:text-amber-300">車両未設定</p>
                )}
                {b.note ? (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">備考: {b.note}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
