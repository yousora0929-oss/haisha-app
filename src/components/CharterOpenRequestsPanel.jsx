import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as db from '../haishaDb.js';
import {
  buildAssignedVehicleSnapshot,
  canWithdrawCharterResponse,
  sortVehiclesForRequest,
  vehicleTypeLabel,
} from '../utils/charterAssignedVehicles.js';
import { PlateCategoryBadge } from './PlateCategoryBadge.jsx';

const inputClass =
  'min-h-[44px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200';

const RESPONSE_STATUS_META = {
  offered: { label: '応答中', className: 'bg-emerald-100 text-emerald-800 border-emerald-200' },
  accepted: { label: '✅ 確定しました', className: 'bg-indigo-100 text-indigo-800 border-indigo-200' },
  rejected: { label: '今回は見送りとなりました', className: 'bg-slate-100 text-slate-700 border-slate-200' },
  withdrawn: { label: '取り下げ', className: 'bg-slate-100 text-slate-700 border-slate-200' },
};

function emptyRespondForm() {
  return { offered_count: '1', message: '', selectedVehicleIds: [] };
}

function snapshotsFromSelection(vehicles, selectedIds) {
  const idSet = new Set(selectedIds);
  return vehicles
    .filter((v) => idSet.has(v.id))
    .map((v) => buildAssignedVehicleSnapshot(v))
    .filter(Boolean);
}

function assignedVehicleIds(assignedVehicles) {
  return (assignedVehicles || []).map((v) => v.vehicle_id).filter(Boolean);
}

function CharterVehiclePicker({ vehicles, request, selectedIds, onToggle, disabled }) {
  const sorted = useMemo(
    () => sortVehiclesForRequest(vehicles, request?.vehicle_type),
    [vehicles, request?.vehicle_type],
  );

  if (!sorted.length) {
    return <p className="mt-2 text-xs font-medium text-slate-500">登録済みの車両がありません（未選択でも送信できます）</p>;
  }

  return (
    <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
      {sorted.map((vehicle) => {
        const checked = selectedIds.includes(vehicle.id);
        return (
          <li key={vehicle.id}>
            <label className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-white">
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => onToggle(vehicle.id)}
                className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600"
              />
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <PlateCategoryBadge category={vehicle.plate_category} />
                <span className="text-xs font-medium text-slate-800 sm:text-sm">
                  {vehicleTypeLabel(vehicle.vehicle_type)} {vehicle.vehicle_number || '—'}
                  {vehicle.door_number ? `（ドア${vehicle.door_number}）` : ''}
                </span>
              </span>
            </label>
          </li>
        );
      })}
    </ul>
  );
}

function AssignedVehicleBadges({ assignedVehicles }) {
  const list = assignedVehicles || [];
  if (!list.length) {
    return <p className="mt-1 text-xs font-bold text-amber-700">車両未設定（応答者に確認してください）</p>;
  }
  return (
    <div className="mt-1 flex flex-col gap-1.5">
      {list.map((v, i) => (
        <div
          key={`${v.vehicle_id || i}-${v.vehicle_number}`}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5"
        >
          <PlateCategoryBadge category={v.plate_category} />
          <span className="text-sm font-bold text-slate-800">
            {vehicleTypeLabel(v.vehicle_type)} {v.vehicle_number || '—'}
            {v.door_number ? `（ドア${v.door_number}）` : ''}
          </span>
        </div>
      ))}
    </div>
  );
}

export function CharterOpenRequestsPanel({
  responderType,
  responderId,
  title = '募集案件',
  description = '通知対象として登録されている工場からのチャーター募集に応答できます。',
  excludeOwnFactoryId = '',
  onResponsesChanged,
}) {
  const rid = String(responderId || '').trim();
  const ownerType = responderType === 'charter_operator' ? 'charter_operator' : 'factory';
  const [requests, setRequests] = useState([]);
  const [myResponses, setMyResponses] = useState([]);
  const [ownerVehicles, setOwnerVehicles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [respondingId, setRespondingId] = useState('');
  const [editingVehiclesResponseId, setEditingVehiclesResponseId] = useState('');
  const [form, setForm] = useState(emptyRespondForm);
  const [vehicleEditIds, setVehicleEditIds] = useState([]);

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
      setOwnerVehicles([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [openRows, responseRows, vehicles] = await Promise.all([
        db.fetchOpenCharterRequestsForResponder(responderType, rid),
        db.fetchMyCharterResponses(responderType, rid),
        db.fetchCharterVehicles(ownerType, rid),
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
      setOwnerVehicles(Array.isArray(vehicles) ? vehicles : []);
      onResponsesChanged?.();
    } catch (err) {
      setError(err?.message || '募集一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [responderType, rid, ownerType, onResponsesChanged]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const toggleFormVehicle = (vehicleId) => {
    setForm((f) => {
      const set = new Set(f.selectedVehicleIds);
      if (set.has(vehicleId)) set.delete(vehicleId);
      else set.add(vehicleId);
      return { ...f, selectedVehicleIds: [...set] };
    });
  };

  const toggleEditVehicle = (vehicleId) => {
    setVehicleEditIds((ids) => {
      const set = new Set(ids);
      if (set.has(vehicleId)) set.delete(vehicleId);
      else set.add(vehicleId);
      return [...set];
    });
  };

  const openRespondForm = (request) => {
    const existing = responseByRequestId.get(request.id);
    setRespondingId(request.id);
    setEditingVehiclesResponseId('');
    setForm({
      offered_count: String(existing?.offered_count || 1),
      message: String(existing?.message || ''),
      selectedVehicleIds: assignedVehicleIds(existing?.assigned_vehicles),
    });
    setError('');
    setNotice('');
  };

  const closeRespondForm = () => {
    setRespondingId('');
    setForm(emptyRespondForm());
  };

  const openVehicleEdit = (response) => {
    setEditingVehiclesResponseId(response.id);
    setRespondingId('');
    setVehicleEditIds(assignedVehicleIds(response.assigned_vehicles));
    setError('');
    setNotice('');
  };

  const closeVehicleEdit = () => {
    setEditingVehiclesResponseId('');
    setVehicleEditIds([]);
  };

  const handleSubmitResponse = async (e, request) => {
    e.preventDefault();
    if (!request?.id) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const assignedVehicles = snapshotsFromSelection(ownerVehicles, form.selectedVehicleIds);
      await db.submitCharterResponse({
        requestId: request.id,
        responderType,
        responderId: rid,
        offeredCount: form.offered_count,
        message: form.message,
        assignedVehicles,
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

  const handleSaveVehicles = async (response, request) => {
    if (!response?.id) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const assignedVehicles = snapshotsFromSelection(ownerVehicles, vehicleEditIds);
      await db.updateCharterResponseVehicles(response.id, assignedVehicles);
      closeVehicleEdit();
      await loadData();
      setNotice('割り当て車両を更新しました');
      window.setTimeout(() => setNotice(''), 3000);
    } catch (err) {
      setError(err?.message || '割り当て車両の更新に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleWithdraw = async (response, request) => {
    if (!response?.id || response.status !== 'offered') return;
    if (!canWithdrawCharterResponse(request?.request_date)) return;
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
            const isVehicleEditOpen = editingVehiclesResponseId === myResponse?.id;
            const withdrawAllowed = canWithdrawCharterResponse(request.request_date);

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
                        {myResponse?.status === 'offered' ||
                        myResponse?.status === 'accepted' ||
                        myResponse?.status === 'rejected' ? (
                          <span className="text-xs font-bold text-slate-600">
                            提供 {myResponse.offered_count}台
                            {myResponse.message?.trim() && myResponse.status === 'offered'
                              ? ` — ${myResponse.message}`
                              : ''}
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    {myResponse && myResponse.status !== 'withdrawn' ? (
                      <AssignedVehicleBadges assignedVehicles={myResponse.assigned_vehicles} />
                    ) : null}
                    {myResponse?.status === 'offered' && !withdrawAllowed ? (
                      <p className="mt-1 text-xs font-bold text-amber-700">
                        募集日の3日前を過ぎているため取り下げできません
                      </p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    {myResponse?.status === 'offered' ? (
                      <button
                        type="button"
                        onClick={() => void handleWithdraw(myResponse, request)}
                        disabled={saving || !withdrawAllowed}
                        className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-black text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        取り下げ
                      </button>
                    ) : null}
                    {myResponse && myResponse.status !== 'withdrawn' ? (
                      <button
                        type="button"
                        onClick={() => openVehicleEdit(myResponse)}
                        disabled={saving}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        割り当て車両を編集
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
                    <div className="mt-3">
                      <p className="text-xs font-black text-slate-800">
                        どの車両を割り当てますか？（あとで設定してもOKです）
                      </p>
                      <CharterVehiclePicker
                        vehicles={ownerVehicles}
                        request={request}
                        selectedIds={form.selectedVehicleIds}
                        onToggle={toggleFormVehicle}
                        disabled={saving}
                      />
                    </div>
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

                {isVehicleEditOpen && myResponse ? (
                  <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
                    <p className="text-xs font-black text-slate-800">割り当て車両を編集</p>
                    <CharterVehiclePicker
                      vehicles={ownerVehicles}
                      request={request}
                      selectedIds={vehicleEditIds}
                      onToggle={toggleEditVehicle}
                      disabled={saving}
                    />
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => void handleSaveVehicles(myResponse, request)}
                        disabled={saving}
                        className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-60"
                      >
                        {saving ? '保存中...' : '保存'}
                      </button>
                      <button
                        type="button"
                        onClick={closeVehicleEdit}
                        disabled={saving}
                        className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
