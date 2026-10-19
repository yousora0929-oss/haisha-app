import React, { useState } from 'react';
import * as db from '../haishaDb.js';
import {
  PHONE_DIRECTORY_LABELS,
  contactActorLabel,
  formatPhoneDirectoryDate,
  phoneDirectoryErrorMessage,
} from '../utils/phoneDirectory.js';

const fieldClass =
  'mt-1 min-h-[40px] w-full rounded-lg border border-slate-300 px-2 text-sm font-bold text-slate-900';

function emptyForm() {
  return { phone: '', label: '代表', personName: '', note: '' };
}

export function OrganizationContactPhones({ organizationId, phones, factoryNameById, onChanged }) {
  const [form, setForm] = useState(null);
  const [editingId, setEditingId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const list = Array.isArray(phones) ? phones : [];

  const startCreate = () => {
    setEditingId('');
    setForm(emptyForm());
    setError('');
  };

  const startEdit = (phone) => {
    setEditingId(phone.id);
    setForm({
      phone: phone.phone,
      label: PHONE_DIRECTORY_LABELS.includes(phone.label) ? phone.label : 'その他',
      personName: phone.personName,
      note: phone.note,
    });
    setError('');
  };

  const save = async () => {
    const phone = String(form?.phone || '').trim();
    if (!phone) {
      setError('電話番号を入力してください');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (editingId) {
        await db.updateContactPhone({
          id: editingId,
          phone,
          label: form.label,
          personName: form.personName,
          note: form.note,
        });
      } else {
        await db.registerContactPhone({
          organizationId,
          phone,
          label: form.label,
          personName: form.personName,
          note: form.note,
        });
      }
      setForm(null);
      setEditingId('');
      await onChanged?.();
    } catch (err) {
      console.warn('[OrganizationContactPhones] save failed', err);
      setError(phoneDirectoryErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (phone) => {
    if (!window.confirm(`${phone.phone || 'この番号'} を削除しますか？`)) return;
    setError('');
    try {
      await db.deleteContactPhone(phone.id);
      await onChanged?.();
    } catch (err) {
      console.warn('[OrganizationContactPhones] delete failed', err);
      setError(phoneDirectoryErrorMessage(err));
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-black text-slate-600">電話番号</p>
        {!form ? (
          <button
            type="button"
            onClick={startCreate}
            className="min-h-[36px] rounded border border-sky-400 bg-white px-2 text-xs font-black text-sky-800"
          >
            番号を追加
          </button>
        ) : null}
      </div>
      {error ? <p className="mt-2 text-xs font-bold text-red-700">{error}</p> : null}
      {list.length === 0 && !form ? (
        <p className="mt-2 text-xs font-bold text-slate-400">番号未登録</p>
      ) : (
        <ul className="mt-2 space-y-2">
          {list.map((phone) => (
            <li key={phone.id} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm">
              <p className="font-black text-slate-900">
                {phone.label ? <span className="mr-2">{phone.label}</span> : null}
                <span className="font-mono">{phone.phone}</span>
                {phone.personName ? <span className="ml-2 font-bold">{phone.personName}</span> : null}
              </p>
              {phone.note ? <p className="mt-1 text-xs font-bold text-slate-600">メモ：{phone.note}</p> : null}
              <p className="mt-1 text-xs font-bold text-slate-500">
                登録：{contactActorLabel(phone.registeredByFactoryId, factoryNameById)}{' '}
                {formatPhoneDirectoryDate(phone.registeredAt)}
              </p>
              {phone.updatedAt ? (
                <p className="text-xs font-bold text-slate-500">
                  更新：{contactActorLabel(phone.updatedByFactoryId, factoryNameById)}{' '}
                  {formatPhoneDirectoryDate(phone.updatedAt)}
                </p>
              ) : null}
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => startEdit(phone)}
                  className="min-h-[36px] rounded border border-slate-300 px-3 text-xs font-black text-slate-800"
                >
                  修正
                </button>
                <button
                  type="button"
                  onClick={() => void remove(phone)}
                  className="min-h-[36px] rounded border border-red-300 px-3 text-xs font-black text-red-700"
                >
                  削除
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {form ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <label className="text-xs font-bold text-slate-600">
            電話番号
            <input
              type="text"
              value={form.phone}
              onChange={(event) => setForm((current) => ({ ...current, phone: event.target.value }))}
              className={fieldClass}
            />
          </label>
          <label className="text-xs font-bold text-slate-600">
            ラベル
            <select
              value={form.label}
              onChange={(event) => setForm((current) => ({ ...current, label: event.target.value }))}
              className={fieldClass}
            >
              {PHONE_DIRECTORY_LABELS.map((label) => (
                <option key={label} value={label}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold text-slate-600">
            担当者
            <input
              type="text"
              value={form.personName}
              onChange={(event) => setForm((current) => ({ ...current, personName: event.target.value }))}
              className={fieldClass}
            />
          </label>
          <label className="text-xs font-bold text-slate-600">
            メモ
            <input
              type="text"
              value={form.note}
              onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
              className={fieldClass}
            />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="min-h-[40px] rounded bg-sky-600 px-3 text-xs font-black text-white disabled:opacity-60"
            >
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                setForm(null);
                setEditingId('');
              }}
              className="min-h-[40px] rounded border border-slate-300 px-3 text-xs font-black text-slate-700"
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
