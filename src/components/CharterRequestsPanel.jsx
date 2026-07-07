import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as db from '../haishaDb.js';
import { formatAssignedVehicleBadge } from '../utils/charterAssignedVehicles.js';
import { todayLocalISODate } from '../haishaConstants.js';

const inputClass =
  'min-h-[44px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200';

const btnBase =
  'min-h-[44px] rounded-xl border-2 px-4 py-2 text-sm font-bold transition';

const STATUS_META = {
  open: {
    label: '募集中',
    className:
      'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-700',
  },
  matched: {
    label: '確定済み',
    className:
      'bg-indigo-100 text-indigo-900 border-indigo-300 dark:bg-indigo-950 dark:text-indigo-200 dark:border-indigo-700',
  },
  closed: {
    label: '終了',
    className:
      'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600',
  },
  cancelled: {
    label: '取消',
    className: 'bg-red-100 text-red-900 border-red-300 dark:bg-red-950 dark:text-red-200 dark:border-red-700',
  },
};

const RESPONSE_STATUS_META = {
  offered: {
    label: '応答中',
    className:
      'bg-emerald-100 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-200 dark:border-emerald-700',
  },
  accepted: {
    label: '✅ 確定',
    className:
      'bg-indigo-100 text-indigo-900 border-indigo-300 dark:bg-indigo-950 dark:text-indigo-200 dark:border-indigo-700',
  },
  rejected: {
    label: '見送り',
    className:
      'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600',
  },
  withdrawn: {
    label: '取り下げ',
    className:
      'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600',
  },
};

const RESPONDER_TYPE_LABEL = {
  factory: '工場',
  charter_operator: 'チャーター業者',
};

function vehicleTypeLabel(type) {
  return type === 'small' ? '小型' : '大型';
}

function emptyRequestForm(today) {
  return {
    request_date: today,
    vehicle_type: 'large',
    desired_count: '1',
    note: '',
  };
}

export function CharterRequestsPanel({ factoryId, factories = [] }) {
  const today = todayLocalISODate();
  const [requests, setRequests] = useState([]);
  const [responsesByRequest, setResponsesByRequest] = useState({});
  const [progressByRequest, setProgressByRequest] = useState({});
  const [charterOperatorNames, setCharterOperatorNames] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState(() => emptyRequestForm(today));

  const loadRequests = useCallback(async () => {
    const fid = String(factoryId || '').trim();
    if (!fid) {
      setRequests([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const rows = await db.fetchCharterRequests(fid);
      const list = Array.isArray(rows) ? rows : [];
      setRequests(list);

      const responseEntries = await Promise.all(
        list.map(async (request) => {
          const [responses, progress] = await Promise.all([
            db.fetchCharterResponsesForRequest(request.id),
            db.fetchCharterRequestProgress(request.id),
          ]);
          return [request.id, { responses, progress }];
        }),
      );
      setResponsesByRequest(
        Object.fromEntries(responseEntries.map(([id, { responses }]) => [id, responses])),
      );
      setProgressByRequest(
        Object.fromEntries(responseEntries.map(([id, { progress }]) => [id, progress])),
      );

      const charterIds = new Set();
      for (const [, { responses }] of responseEntries) {
        for (const r of responses || []) {
          if (r.responder_type === 'charter_operator') charterIds.add(r.responder_id);
        }
      }
      if (charterIds.size > 0) {
        const names = await db.fetchCharterOperatorCompanyNames([...charterIds]);
        setCharterOperatorNames(names);
      } else {
        setCharterOperatorNames({});
      }
    } catch (err) {
      setError(err?.message || '募集一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [factoryId]);

  const factoryNameById = useMemo(() => {
    const map = {};
    for (const f of factories || []) {
      if (f?.id) map[String(f.id)] = String(f.name || f.id);
    }
    return map;
  }, [factories]);

  const responderDisplayName = (response) => {
    if (!response) return '—';
    if (response.responder_type === 'factory') {
      return factoryNameById[response.responder_id] || response.responder_id;
    }
    return charterOperatorNames[response.responder_id] || response.responder_id;
  };

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const fid = String(factoryId || '').trim();
    if (!fid) {
      setError('工場IDが未設定です');
      return;
    }
    const requestDate = String(form.request_date || '').trim();
    if (requestDate < today) {
      setError('日付は当日以降を選択してください');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await db.saveCharterRequest({
        requesting_factory_id: fid,
        request_date: requestDate,
        vehicle_type: form.vehicle_type,
        desired_count: form.desired_count,
        note: form.note,
      });
      setForm(emptyRequestForm(today));
      await loadRequests();
      setNotice('募集を登録しました');
      window.setTimeout(() => setNotice(''), 3000);
    } catch (err) {
      setError(err?.message || '募集の登録に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = async (request) => {
    if (!request?.id || request.status !== 'open') return;
    const ok = window.confirm('この募集を取り消しますか？');
    if (!ok) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await db.cancelCharterRequest(request.id);
      await loadRequests();
      setNotice('募集を取り消しました');
      window.setTimeout(() => setNotice(''), 3000);
    } catch (err) {
      setError(err?.message || '取消に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleConfirm = async (response, request) => {
    if (!response?.id || !request?.id || request.status !== 'open' || response.status !== 'offered') return;
    const name = responderDisplayName(response);
    const progress = progressByRequest[request.id] || {
      acceptedTotal: 0,
      desiredCount: request.desired_count,
      remaining: request.desired_count,
    };
    const offeredCount = Number(response.offered_count) || 0;
    const nextTotal = progress.acceptedTotal + offeredCount;
    const desiredCount = progress.desiredCount || request.desired_count;
    const detail =
      nextTotal >= desiredCount
        ? 'これで希望台数に達します。残りの応答は自動的に見送りになります。'
        : `確定後: ${nextTotal} / ${desiredCount} 台（残り${Math.max(0, desiredCount - nextTotal)}台）`;
    const ok = window.confirm(`${name} の応答（${offeredCount}台）を確定しますか？\n${detail}`);
    if (!ok) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const result = await db.confirmCharterResponse(response.id);
      await loadRequests();
      const fullyMatched = result?.fully_matched === true;
      setNotice(fullyMatched ? '希望台数に達しました' : '応答を確定しました');
      window.setTimeout(() => setNotice(''), 3000);
    } catch (err) {
      setError(err?.message || '確定に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-lg font-black text-slate-900">チャーター募集</h2>
      <p className="mt-1 text-sm font-medium text-slate-600">
        出荷過多日などに、外部チャーター車両の協力を募集します。登録すると通知優先リストの対象へプッシュ通知が届きます。
      </p>

      {notice ? <p className="mt-3 text-sm font-bold text-emerald-700">{notice}</p> : null}
      {error ? <p className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}

      <form onSubmit={(e) => void handleSubmit(e)} className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-black text-slate-800">新規募集</p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-bold text-slate-600">
            日付
            <input
              type="date"
              min={today}
              value={form.request_date}
              onChange={(e) => setForm((f) => ({ ...f, request_date: e.target.value }))}
              className={`${inputClass} mt-1`}
              required
            />
          </label>
          <label className="block text-xs font-bold text-slate-600">
            希望台数
            <input
              type="number"
              min={1}
              value={form.desired_count}
              onChange={(e) => setForm((f) => ({ ...f, desired_count: e.target.value }))}
              className={`${inputClass} mt-1`}
              required
            />
          </label>
        </div>

        <div className="mt-3 flex flex-col gap-2">
          <span className="text-xs font-bold text-slate-600">車両タイプ</span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, vehicle_type: 'large' }))}
              aria-pressed={form.vehicle_type === 'large'}
              className={
                btnBase +
                (form.vehicle_type === 'large'
                  ? ' border-indigo-600 bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-300'
                  : ' border-slate-200 bg-white text-slate-700 hover:bg-slate-50')
              }
            >
              大型
            </button>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, vehicle_type: 'small' }))}
              aria-pressed={form.vehicle_type === 'small'}
              className={
                btnBase +
                (form.vehicle_type === 'small'
                  ? ' border-indigo-600 bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-300'
                  : ' border-slate-200 bg-white text-slate-700 hover:bg-slate-50')
              }
            >
              小型
            </button>
          </div>
        </div>

        <label className="mt-3 block text-xs font-bold text-slate-600">
          備考（任意）
          <textarea
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            rows={3}
            className={`${inputClass} mt-1 min-h-[88px] resize-y`}
            placeholder="現場の入り方など"
          />
        </label>

        <button
          type="submit"
          disabled={saving}
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-60"
        >
          {saving ? '送信中...' : '募集を出す'}
        </button>
      </form>

      <div className="mt-6">
        <h3 className="text-base font-black text-slate-800 dark:text-slate-100 sm:text-lg">自分の募集一覧</h3>
        {loading && requests.length === 0 ? (
          <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400">読み込み中…</p>
        ) : null}
        {!loading && requests.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-sm font-medium text-slate-500 dark:border-slate-600 dark:bg-slate-800/50 dark:text-slate-400">
            募集はまだありません
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {requests.map((request) => {
              const status = STATUS_META[request.status] || {
                label: request.status || '—',
                className:
                  'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600',
              };
              const progress = progressByRequest[request.id] || {
                acceptedTotal: 0,
                desiredCount: request.desired_count,
                remaining: request.desired_count,
              };
              const { acceptedTotal, desiredCount } = progress;
              const showProgress = request.status === 'open' || request.status === 'matched';
              return (
                <li
                  key={request.id}
                  className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-4 dark:border-slate-700 dark:bg-slate-900"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <p className="text-base font-black leading-snug text-slate-900 dark:text-slate-100 sm:text-lg">
                        {request.request_date.replace(/-/g, '/')} ・ {vehicleTypeLabel(request.vehicle_type)} ・{' '}
                        {request.desired_count}台
                      </p>
                      <span
                        className={`shrink-0 rounded-full border px-3 py-1 text-sm font-black sm:text-base ${status.className}`}
                      >
                        {status.label}
                      </span>
                    </div>
                    {request.note?.trim() ? (
                      <p className="mt-2 text-sm font-medium leading-relaxed text-slate-600 dark:text-slate-300 sm:text-base">
                        備考: {request.note}
                      </p>
                    ) : null}
                    {showProgress ? (
                      <p className="mt-2 text-sm font-black text-slate-700 dark:text-slate-300 sm:text-base">
                        確定 {acceptedTotal} / 希望 {desiredCount} 台
                        {acceptedTotal < desiredCount
                          ? `（残り${desiredCount - acceptedTotal}台）`
                          : ''}
                      </p>
                    ) : null}
                    {(responsesByRequest[request.id] || []).length > 0 ? (
                      <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-600 dark:bg-slate-800/60">
                        <p className="text-sm font-black text-slate-800 dark:text-slate-200">応答一覧</p>
                        <ul className="mt-2 space-y-2">
                          {(responsesByRequest[request.id] || []).map((response) => {
                            const rStatus = RESPONSE_STATUS_META[response.status] || {
                              label: response.status,
                              className:
                                'bg-slate-100 text-slate-800 border-slate-300 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-600',
                            };
                            return (
                              <li
                                key={response.id}
                                className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 sm:text-base"
                              >
                                <span className="font-bold text-slate-900 dark:text-slate-100">
                                  {responderDisplayName(response)}
                                </span>
                                <span className="text-slate-500 dark:text-slate-400">
                                  ({RESPONDER_TYPE_LABEL[response.responder_type] || response.responder_type})
                                </span>
                                <span>{response.offered_count}台</span>
                                <span
                                  className={`rounded-full border px-2.5 py-0.5 text-sm font-black ${rStatus.className}`}
                                >
                                  {rStatus.label}
                                </span>
                                {response.message?.trim() ? (
                                  <span className="text-slate-600 dark:text-slate-400">— {response.message}</span>
                                ) : null}
                                {(response.assigned_vehicles || []).length > 0 ? (
                                  <span className="flex flex-wrap gap-1">
                                    {(response.assigned_vehicles || []).map((v, i) => (
                                      <span
                                        key={`${response.id}-${v.vehicle_id || i}`}
                                        className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-bold text-slate-700 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-200"
                                      >
                                        {formatAssignedVehicleBadge(v)}
                                      </span>
                                    ))}
                                  </span>
                                ) : (
                                  <span className="text-slate-500 dark:text-slate-400">車両未設定</span>
                                )}
                                {request.status === 'open' && response.status === 'offered' ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleConfirm(response, request)}
                                    disabled={saving}
                                    className="min-h-[44px] rounded-lg bg-indigo-600 px-3 py-2 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-60 sm:text-base"
                                  >
                                    この業者に決定
                                  </button>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    ) : request.status === 'open' ? (
                      <p className="mt-2 text-sm font-medium text-slate-500 dark:text-slate-400 sm:text-base">応答はまだありません</p>
                    ) : null}
                  </div>
                  {request.status === 'open' ? (
                    <button
                      type="button"
                      onClick={() => void handleCancel(request)}
                      disabled={saving}
                      className="min-h-[44px] shrink-0 px-2 text-base font-bold text-red-600 hover:underline disabled:opacity-60 dark:text-red-400"
                    >
                      取消
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
