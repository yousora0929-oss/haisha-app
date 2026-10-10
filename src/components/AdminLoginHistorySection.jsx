import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as db from '../haishaDb.js';
import { formatPhoneNumberJP } from '../utils/phoneFormat.js';

const LOCK_WINDOW_MS = 15 * 60 * 1000;
const LOCK_FAILURE_THRESHOLD = 5;

function formatAttemptedAt(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

function lockedPhoneSet(rows, now = Date.now()) {
  const counts = new Map();
  for (const row of rows || []) {
    if (row?.success === true) continue;
    if (row?.cleared_at) continue;
    const phone = String(row?.phone || '').trim();
    if (!phone) continue;
    const at = Date.parse(row?.attempted_at);
    if (!Number.isFinite(at)) continue;
    if (at > now + 5000 || now - at > LOCK_WINDOW_MS) continue;
    counts.set(phone, (counts.get(phone) || 0) + 1);
  }
  const locked = new Set();
  for (const [phone, count] of counts) {
    if (count >= LOCK_FAILURE_THRESHOLD) locked.add(phone);
  }
  return locked;
}

function isRecentLockFailure(row, lockedPhones, now = Date.now()) {
  if (row?.success === true || row?.cleared_at) return false;
  const phone = String(row?.phone || '').trim();
  if (!phone || !lockedPhones.has(phone)) return false;
  const at = Date.parse(row?.attempted_at);
  if (!Number.isFinite(at)) return false;
  return at <= now + 5000 && now - at <= LOCK_WINDOW_MS;
}

export function AdminLoginHistorySection() {
  const [rows, setRows] = useState([]);
  const [onlyFailures, setOnlyFailures] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [clearingPhone, setClearingPhone] = useState('');

  const load = useCallback(async (failuresOnly) => {
    setLoading(true);
    setError('');
    try {
      const list = await db.adminListLoginAttempts({ limit: 200, onlyFailures: failuresOnly });
      setRows(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error(err);
      setError(err?.message || 'ログイン履歴の取得に失敗しました。');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(onlyFailures);
  }, [load, onlyFailures]);

  const lockedPhones = useMemo(() => lockedPhoneSet(rows), [rows]);
  const now = Date.now();

  const handleClear = async (phone) => {
    const value = String(phone || '').trim();
    if (!value || clearingPhone) return;
    setClearingPhone(value);
    setError('');
    try {
      const count = await db.adminClearLoginLock(value);
      setToast(
        count > 0
          ? `${count}件のログインロックを解除しました。`
          : '解除対象のロックはありませんでした。',
      );
      window.setTimeout(() => setToast(''), 4000);
      await load(onlyFailures);
    } catch (err) {
      console.error(err);
      setError(err?.message || 'ロック解除に失敗しました。');
    } finally {
      setClearingPhone('');
    }
  };

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900 dark:text-slate-100">ログイン履歴</h2>
          <p className="mt-1 text-xs font-medium text-slate-500">
            直近200件。日時は日本時間です。15分以内の失敗が5回以上の電話番号は強調されます。
          </p>
        </div>
        <label className="inline-flex min-h-[44px] items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            checked={onlyFailures}
            onChange={(e) => setOnlyFailures(e.target.checked)}
            className="h-4 w-4"
          />
          失敗のみ
        </label>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800" role="alert">
          {error}
        </p>
      ) : null}
      {toast ? (
        <p
          className="fixed bottom-6 left-1/2 z-50 w-[min(92vw,28rem)] -translate-x-1/2 rounded-2xl border-2 border-emerald-600 bg-white px-4 py-3 text-center text-sm font-black text-emerald-900 shadow-2xl"
          role="status"
        >
          {toast}
        </p>
      ) : null}

      <div className="mt-4 overflow-x-auto">
        <table className="min-w-[880px] w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-xs font-black text-slate-500 dark:border-slate-600">
              <th className="px-2 py-2">日時</th>
              <th className="px-2 py-2">電話番号</th>
              <th className="px-2 py-2">会社名</th>
              <th className="px-2 py-2">担当者</th>
              <th className="px-2 py-2">IP</th>
              <th className="px-2 py-2">結果</th>
              <th className="px-2 py-2">解除</th>
              <th className="px-2 py-2" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="px-2 py-6 text-center text-sm font-bold text-slate-500">
                  読み込み中…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-2 py-6 text-center text-sm font-bold text-slate-500">
                  履歴はありません。
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const phone = String(row?.phone || '').trim();
                const highlighted = isRecentLockFailure(row, lockedPhones, now);
                const key = `${row?.attempted_at || ''}-${phone}-${index}`;
                return (
                  <tr
                    key={key}
                    className={
                      'border-b border-slate-100 dark:border-slate-700 ' +
                      (highlighted ? 'bg-amber-100 dark:bg-amber-950/50' : '')
                    }
                  >
                    <td className="whitespace-nowrap px-2 py-2 font-medium text-slate-800 dark:text-slate-100">
                      {formatAttemptedAt(row?.attempted_at)}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 font-mono text-slate-800 dark:text-slate-100">
                      {phone ? formatPhoneNumberJP(phone) || phone : '—'}
                    </td>
                    <td className="px-2 py-2 font-bold text-slate-800 dark:text-slate-100">
                      {String(row?.company_name || '').trim() || '—'}
                    </td>
                    <td className="px-2 py-2 text-slate-700 dark:text-slate-200">
                      {String(row?.manager_name || '').trim() || '—'}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 font-mono text-xs text-slate-600 dark:text-slate-300">
                      {String(row?.ip || '').trim() || '—'}
                    </td>
                    <td className="px-2 py-2">
                      {row?.success === true ? (
                        <span className="font-black text-emerald-700">成功</span>
                      ) : (
                        <span className="font-black text-red-700">失敗</span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-2 py-2 text-slate-600 dark:text-slate-300">
                      {row?.cleared_at ? '解除済み' : '—'}
                    </td>
                    <td className="px-2 py-2">
                      {highlighted ? (
                        <button
                          type="button"
                          disabled={Boolean(clearingPhone)}
                          onClick={() => void handleClear(phone)}
                          className="min-h-[36px] rounded-lg border-2 border-amber-700 bg-white px-3 text-xs font-black text-amber-900 hover:bg-amber-50 disabled:opacity-50"
                        >
                          {clearingPhone === phone ? '解除中…' : 'ロック解除'}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
