import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as db from '../haishaDb.js';

const inputClass =
  'min-h-[44px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200';

const RESPONSE_STATUS_META = {
  offered: { label: '応答中', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  accepted: { label: '✅ 確定しました', className: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  rejected: { label: '今回は見送りとなりました', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  withdrawn: { label: '取り下げ', className: 'bg-slate-100 text-slate-700 border-slate-200' },
};

function vehicleTypeLabel(type) {
  return type === 'small' ? '小型' : '大型';
}

function emptyRespondForm() {
  return { offered_count: '1', message: '' };
}

export function CharterOpenRequestsPanel({
  responderType,
  responderId,
  title = '募集案件',
  description = '通知対象として登録されている工場からのチャーター募集に応答できます。',
  excludeOwnFactoryId = '',
}) {
  const rid = String(responderId || '').trim();
  const [requests, setRequests] = useState([]);
  const [myResponses, setMyResponses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [respondingId, setRespondingId] = useState('');
  const [form, setForm] = useState(emptyRespondForm);

  const responseByRequestId = useMemo(() => {
    const map = new Map();
    for (const row of myResponses) {
      if (row?.request_id) map.set(row.request_id, row);
    }
    return map;
  }, [myResponses]);

  const visibleRequests = useMemo(() => {
    const exclude = String(excludeOwnFactoryId || '').trim();
    if (!exclude || responderType !== 'factory') return requests;
    return requests.filter((r) => r.requesting_factory_id !== exclude);
  }, [requests, excludeOwnFactoryId, responderType]);

  const loadData = useCallback(async () => {
    if (!rid) {
      setRequests([]);
      setMyResponses([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [openRows, responseRows] = await Promise.all([
        db.fetchOpenCharterRequestsForResponder(responderType, rid),
        db.fetchMyCharterResponses(responderType, rid),
      ]);
      const openList = Array.isArray(openRows) ? openRows : [];
      const responses = Array.isArray(responseRows) ? responseRows : [];
      const terminalRequestIds = [
        ...new Set(
          responses
            .filter((r) => r.status === 'accepted' || r.status === 'rejected')
            .map((r) => r.request_id)
            .filter((id) => id && !openList.some((req) => req.id === id)),
        ),
      ];
      const closedRows = terminalRequestIds.length
        ? await db.fetchCharterRequestsByIds(terminalRequestIds)
        : [];
      setRequests([...openList, ...closedRows]);
      setMyResponses(responses);
    } catch (err) {
      setError(err?.message || '募集一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [responderType, rid]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openRespondForm = (request) => {
    const existing = responseByRequestId.get(request.id);
    setRespondingId(request.id);
    setForm({
      offered_count: String(existing?.offered_count || 1),
      message: String(existing?.message || ''),
    });
    setError('');
    setNotice('');
  };

  const closeRespondForm = () => {
    setRespondingId('');
    setForm(emptyRespondForm());
  };

  const handleSubmitResponse = async (e, request) => {
    e.preventDefault();
    if (!request?.id) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await db.submitCharterResponse({
        requestId: request.id,
        responderType,
        responderId: rid,
        offeredCount: form.offered_count,
        message: form.message,
      });
      closeRespondForm();
      await loadData();
      setNotice('応答を送信しました');
      window.setTimeout(() => setNotice(''), 3000);
    } catch (err) {
      setError(err?.message || '応答の送信に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleWithdraw = async (response) => {
    if (!response?.id || response.status !== 'offered') return;
    const ok = window.confirm('この応答を取り下げますか？');
    if (!ok) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await db.withdrawCharterResponse(response.id);
      await loadData();
      setNotice('応答を取り下げました');
      window.setTimeout(() => setNotice(''), 3000);
    } catch (err) {
      setError(err?.message || '取り下げに失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <h2 className="text-lg font-black text-slate-900">{title}</h2>
      <p className="mt-1 text-sm font-medium text-slate-600">{description}</p>

      {notice ? <p className="mt-3 text-sm font-bold text-emerald-700">{notice}</p> : null}
      {error ? <p className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}

      {loading && visibleRequests.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500">読み込み中…</p>
      ) : null}
      {!loading && visibleRequests.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
          現在、応答可能な募集はありません
        </p>
      ) : (
        <ul className="mt-4 space-y-3">
          {visibleRequests.map((request) => {
            const myResponse = responseByRequestId.get(request.id);
            const statusMeta = myResponse
              ? RESPONSE_STATUS_META[myResponse.status] || {
                  label: myResponse.status,
                  className: 'bg-slate-100 text-slate-700 border-slate-200',
                }
              : null;
            const isFormOpen = respondingId === request.id;

            return (
              <li key={request.id} className="rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 text-sm">
                    <p className="font-black text-slate-900">
                      {request.requesting_factory_name || request.requesting_factory_id}
                    </p>
                    <p className="mt-1 font-bold text-slate-800">
                      {request.request_date.replace(/-/g, '/')} ・ {vehicleTypeLabel(request.vehicle_type)} ・{' '}
                      {request.desired_count}台希望
                    </p>
                    {request.note?.trim() ? (
                      <p className="mt-1 text-xs font-medium text-slate-600">備考: {request.note}</p>
                    ) : null}
                    {statusMeta ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[11px] font-black ${statusMeta.className}`}
                        >
                          {statusMeta.label}
                        </span>
                        {myResponse?.status === 'offered' ? (
                          <span className="text-xs font-bold text-slate-600">
                            提供 {myResponse.offered_count}台
                            {myResponse.message?.trim() ? ` — ${myResponse.message}` : ''}
                          </span>
                        ) : myResponse?.status === 'accepted' || myResponse?.status === 'rejected' ? (
                          <span className="text-xs font-bold text-slate-600">
                            提供 {myResponse.offered_count}台
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {myResponse?.status === 'offered' ? (
                      <button
                        type="button"
                        onClick={() => void handleWithdraw(myResponse)}
                        disabled={saving}
                        className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-black text-red-700 hover:bg-red-50 disabled:opacity-60"
                      >
                        取り下げ
                      </button>
                    ) : null}
                    {!myResponse || myResponse.status === 'withdrawn' ? (
                      <button
                        type="button"
                        onClick={() => openRespondForm(request)}
                        disabled={saving}
                        className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-60"
                      >
                        応答する
                      </button>
                    ) : myResponse.status === 'offered' ? (
                      <button
                        type="button"
                        onClick={() => openRespondForm(request)}
                        disabled={saving}
                        className="rounded-lg border border-indigo-300 bg-white px-3 py-2 text-xs font-black text-indigo-700 hover:bg-indigo-50 disabled:opacity-60"
                      >
                        応答を変更
                      </button>
                    ) : null}
                  </div>
                </div>

                {isFormOpen ? (
                  <form
                    onSubmit={(e) => void handleSubmitResponse(e, request)}
                    className="mt-3 rounded-lg border border-indigo-200 bg-white p-3"
                  >
                    <p className="text-xs font-black text-slate-800">応答内容</p>
                    <div className="mt-2 grid gap-3 sm:grid-cols-2">
                      <label className="block text-xs font-bold text-slate-600">
                        提供可能台数
                        <input
                          type="number"
                          min={1}
                          value={form.offered_count}
                          onChange={(e) => setForm((f) => ({ ...f, offered_count: e.target.value }))}
                          className={`${inputClass} mt-1`}
                          required
                        />
                      </label>
                    </div>
                    <label className="mt-2 block text-xs font-bold text-slate-600">
                      メッセージ（任意）
                      <textarea
                        value={form.message}
                        onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                        rows={2}
                        className={`${inputClass} mt-1 min-h-[72px] resize-y`}
                        placeholder="到着可能時間など"
                      />
                    </label>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={saving}
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-60"
                      >
                        {saving ? '送信中...' : '送信'}
                      </button>
                      <button
                        type="button"
                        onClick={closeRespondForm}
                        disabled={saving}
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        キャンセル
                      </button>
                    </div>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
