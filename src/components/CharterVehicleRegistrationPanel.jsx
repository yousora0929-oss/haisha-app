import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as db from '../haishaDb.js';
import { downloadCharterVehicleCsvTemplate, parseCharterVehicleCsv } from '../utils/charterVehicleCsv.js';
import { plateCategoryLabel, vehicleTypeLabel } from '../utils/charterAssignedVehicles.js';

const inputClass =
  'min-h-[44px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200';

const btnBase =
  'min-h-[44px] rounded-xl border-2 px-4 py-2 text-sm font-bold transition';

function toggleClass(active) {
  return (
    btnBase +
    (active
      ? ' border-indigo-600 bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-300'
      : ' border-slate-200 bg-white text-slate-700 hover:bg-slate-50')
  );
}

function plateCategoryBadgeClass(category) {
  return category === 'private'
    ? 'bg-slate-100 text-slate-700 border-slate-300'
    : 'bg-emerald-100 text-emerald-900 border-emerald-300';
}

function emptyVehicleForm() {
  return {
    id: '',
    vehicle_type: 'large',
    plate_category: 'business',
    vehicle_number: '',
    door_number: '',
  };
}

/**
 * チャーター車両登録（工場・個人チャーター共通）
 * @param {{ ownerType: 'factory'|'charter_operator', ownerId: string, title?: string }} props
 */
export function CharterVehicleRegistrationPanel({ ownerType, ownerId, title = '車両登録' }) {
  const [vehicles, setVehicles] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [form, setForm] = useState(emptyVehicleForm);
  const [csvPreview, setCsvPreview] = useState(null);
  const csvInputRef = useRef(null);

  const summary = useMemo(() => {
    const large = vehicles.filter((v) => v.vehicle_type === 'large').length;
    const small = vehicles.filter((v) => v.vehicle_type === 'small').length;
    return { large, small, total: large + small };
  }, [vehicles]);

  const loadVehicles = useCallback(async () => {
    const oid = String(ownerId || '').trim();
    if (!oid) {
      setVehicles([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const rows = await db.fetchCharterVehicles(ownerType, oid);
      setVehicles(Array.isArray(rows) ? rows : []);
    } catch (err) {
      setError(err?.message || '車両一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [ownerType, ownerId]);

  useEffect(() => {
    void loadVehicles();
  }, [loadVehicles]);

  const resetForm = () => {
    setForm(emptyVehicleForm());
  };

  const handleEdit = (vehicle) => {
    setForm({
      id: vehicle.id,
      vehicle_type: vehicle.vehicle_type === 'small' ? 'small' : 'large',
      plate_category: vehicle.plate_category === 'private' ? 'private' : 'business',
      vehicle_number: vehicle.vehicle_number || '',
      door_number: vehicle.door_number || '',
    });
    setError('');
    setNotice('');
  };

  const handleSave = async (e) => {
    e?.preventDefault?.();
    const oid = String(ownerId || '').trim();
    if (!oid) {
      setError('オーナーIDが未設定です');
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await db.saveCharterVehicle({
        id: form.id || undefined,
        owner_type: ownerType,
        owner_id: oid,
        vehicle_type: form.vehicle_type,
        plate_category: form.plate_category,
        vehicle_number: form.vehicle_number,
        door_number: form.door_number,
      });
      await loadVehicles();
      resetForm();
      setNotice(form.id ? '車両を更新しました' : '車両を登録しました');
      window.setTimeout(() => setNotice(''), 3000);
    } catch (err) {
      setError(err?.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (vehicle) => {
    if (!vehicle?.id) return;
    const ok = window.confirm('この車両を削除しますか？');
    if (!ok) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      await db.deleteCharterVehicle(vehicle.id);
      if (form.id === vehicle.id) resetForm();
      await loadVehicles();
      setNotice('車両を削除しました');
      window.setTimeout(() => setNotice(''), 3000);
    } catch (err) {
      setError(err?.message || '削除に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleCsvFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setNotice('');
    setCsvPreview(null);
    try {
      const text = await file.text();
      const result = parseCharterVehicleCsv(text);
      if (result.errors.length > 0) {
        setError(result.errors.join('\n'));
        return;
      }
      if (!result.rows.length) {
        setError('登録するデータ行がありません');
        return;
      }
      setCsvPreview(result);
    } catch (err) {
      setError(err?.message || 'CSVの読み込みに失敗しました');
    }
  };

  const handleCsvRegister = async () => {
    const oid = String(ownerId || '').trim();
    if (!oid || !csvPreview?.rows?.length) return;
    setSaving(true);
    setError('');
    setNotice('');
    try {
      const inserted = await db.bulkInsertCharterVehicles(ownerType, oid, csvPreview.rows);
      setCsvPreview(null);
      await loadVehicles();
      setNotice(`${inserted.length}件の車両を一括登録しました`);
      window.setTimeout(() => setNotice(''), 3000);
    } catch (err) {
      setError(err?.message || '一括登録に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      {title ? <h2 className="text-lg font-black text-slate-900">{title}</h2> : null}
      <p className={title ? 'mt-1 text-sm font-medium text-slate-600' : 'text-sm font-medium text-slate-600'}>
        チャーター供給用の車両を1台ずつ登録します（大型/小型、ナンバー種別、車両ナンバー、ドアナンバー）。
      </p>

      {notice ? <p className="mt-3 text-sm font-bold text-emerald-700">{notice}</p> : null}
      {error ? <p className="mt-3 whitespace-pre-line text-sm font-bold text-red-700">{error}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => csvInputRef.current?.click()}
          disabled={saving}
          className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-sm font-black text-indigo-800 hover:bg-indigo-100 disabled:opacity-60"
        >
          CSVで一括登録
        </button>
        <button
          type="button"
          onClick={downloadCharterVehicleCsvTemplate}
          className="text-sm font-bold text-indigo-600 hover:underline"
        >
          サンプルCSVをダウンロード
        </button>
        <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void handleCsvFile(e)} />
      </div>

      {csvPreview ? (
        <div className="mt-3 rounded-xl border border-indigo-200 bg-indigo-50 p-3">
          <p className="text-sm font-black text-indigo-900">{csvPreview.rows.length}件を登録します</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleCsvRegister()}
              disabled={saving}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? '登録中...' : '登録する'}
            </button>
            <button
              type="button"
              onClick={() => setCsvPreview(null)}
              disabled={saving}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : null}

      <form onSubmit={(e) => void handleSave(e)} className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-black text-slate-800">{form.id ? '車両を編集' : '新規車両を登録'}</p>

        <div className="mt-3 flex flex-col gap-2">
          <span className="text-xs font-bold text-slate-600">車両タイプ</span>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, vehicle_type: 'large' }))}
              aria-pressed={form.vehicle_type === 'large'}
              className={toggleClass(form.vehicle_type === 'large')}
            >
              大型
            </button>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, vehicle_type: 'small' }))}
              aria-pressed={form.vehicle_type === 'small'}
              className={toggleClass(form.vehicle_type === 'small')}
            >
              小型
            </button>
          </div>
        </div>

        <div className="mt-3">
          <label className="text-sm font-black text-slate-700">ナンバー種別</label>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, plate_category: 'business' }))}
              aria-pressed={form.plate_category === 'business'}
              className={toggleClass(form.plate_category === 'business')}
            >
              事業用（緑）
            </button>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, plate_category: 'private' }))}
              aria-pressed={form.plate_category === 'private'}
              className={toggleClass(form.plate_category === 'private')}
            >
              自家用（白）
            </button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-bold text-slate-600">
            車両ナンバー
            <input
              type="text"
              value={form.vehicle_number}
              onChange={(e) => setForm((f) => ({ ...f, vehicle_number: e.target.value }))}
              className={`${inputClass} mt-1`}
              placeholder="例: 大分800あ1234"
            />
          </label>
          <label className="block text-xs font-bold text-slate-600">
            ドアナンバー
            <input
              type="text"
              value={form.door_number}
              onChange={(e) => setForm((f) => ({ ...f, door_number: e.target.value }))}
              className={`${inputClass} mt-1`}
              placeholder="例: 12"
            />
          </label>
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="submit"
            disabled={saving}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {saving ? '保存中...' : form.id ? '更新' : '登録'}
          </button>
          {form.id ? (
            <button
              type="button"
              onClick={resetForm}
              disabled={saving}
              className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              新規入力に切替
            </button>
          ) : null}
        </div>
      </form>

      <div className="mt-6">
        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
          <p className="text-sm font-black text-slate-700">
            現在登録台数：大型 {summary.large}台 ／ 小型 {summary.small}台 ／ 合計 {summary.total}台
          </p>
        </div>

        <h3 className="mt-4 text-sm font-black text-slate-800">登録済み車両</h3>
        {loading && vehicles.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">読み込み中…</p>
        ) : null}
        {!loading && vehicles.length === 0 ? (
          <p className="mt-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-center text-sm text-slate-500">
            登録された車両はありません
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {vehicles.map((vehicle) => (
              <li
                key={vehicle.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3 py-3"
              >
                <div className="min-w-0 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-black text-slate-900">{vehicleTypeLabel(vehicle.vehicle_type)}</p>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-black ${plateCategoryBadgeClass(vehicle.plate_category)}`}
                    >
                      {plateCategoryLabel(vehicle.plate_category)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs font-medium text-slate-600">
                    車両ナンバー: {vehicle.vehicle_number || '—'} / ドア: {vehicle.door_number || '—'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => handleEdit(vehicle)}
                    disabled={saving}
                    className="text-sm font-bold text-indigo-600 hover:underline disabled:opacity-60"
                  >
                    編集
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(vehicle)}
                    disabled={saving}
                    className="text-sm font-bold text-red-600 hover:underline disabled:opacity-60"
                  >
                    削除
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
