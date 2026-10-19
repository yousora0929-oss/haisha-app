import React, { useState } from 'react';
import * as db from '../haishaDb.js';

function formatJstDate(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const pick = (type) => parts.find((part) => part.type === type)?.value || '';
  const year = pick('year');
  const month = pick('month');
  const day = pick('day');
  if (!year || !month || !day) return '';
  return `${year}/${month}/${day}`;
}

export function OrganizationBlacklistControls({ organizationId, organizationName, entry, adminName, onChanged }) {
  const listed = Boolean(entry);
  const [mode, setMode] = useState('view');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const openAdd = () => {
    setReason('');
    setError('');
    setMode('add');
  };

  const openEdit = () => {
    setReason(String(entry?.reason || ''));
    setError('');
    setMode('edit');
  };

  const cancel = () => {
    setMode('view');
    setError('');
  };

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      if (mode === 'add') {
        await db.addOrganizationBlacklist({
          organizationId,
          reason,
          createdBy: adminName,
        });
      } else {
        await db.updateOrganizationBlacklist({ organizationId, reason });
      }
      setMode('view');
      await onChanged?.();
    } catch (err) {
      console.warn('[OrganizationBlacklistControls] save failed', err);
      setError(err?.message || 'ブラックリストを保存できませんでした');
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const name = String(organizationName || '').trim() || 'この会社';
    if (!window.confirm(`『${name}』のブラックリストを解除しますか？`)) return;
    setSaving(true);
    setError('');
    try {
      await db.removeOrganizationBlacklist(organizationId);
      setMode('view');
      await onChanged?.();
    } catch (err) {
      console.warn('[OrganizationBlacklistControls] delete failed', err);
      setError(err?.message || 'ブラックリストを解除できませんでした');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mt-2 rounded-lg border border-slate-200 bg-white p-3">
      <p className="text-xs font-black text-slate-600">ブラックリスト</p>
      {error ? <p className="mt-2 text-xs font-bold text-red-700">{error}</p> : null}
      {listed && mode === 'view' ? (
        <div className="mt-2 space-y-2">
          <p className="whitespace-pre-wrap text-sm font-bold text-slate-800">
            理由：{String(entry?.reason || '').trim() || '未入力'}
          </p>
          <p className="text-xs font-bold text-slate-500">
            登録：{String(entry?.created_by || '').trim() || '管理者'} {formatJstDate(entry?.created_at)}
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={openEdit}
              className="min-h-[44px] rounded border border-slate-300 px-3 text-xs font-black text-slate-800"
            >
              理由を編集
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={() => void remove()}
              className="min-h-[44px] rounded border border-red-300 px-3 text-xs font-black text-red-700"
            >
              解除
            </button>
          </div>
        </div>
      ) : null}
      {!listed && mode === 'view' ? (
        <button
          type="button"
          onClick={openAdd}
          className="mt-2 min-h-[44px] rounded border border-red-300 bg-red-50 px-3 text-xs font-black text-red-800"
        >
          ブラックリストに追加
        </button>
      ) : null}
      {mode === 'add' || mode === 'edit' ? (
        <div className="mt-2">
          <label className="block text-xs font-bold text-slate-600">
            理由（任意）
            <textarea
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={3}
              className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm font-bold text-slate-900"
            />
          </label>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void save()}
              className="min-h-[44px] rounded bg-red-600 px-3 text-xs font-black text-white disabled:opacity-60"
            >
              {saving ? '保存中…' : mode === 'add' ? '登録' : '保存'}
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={cancel}
              className="min-h-[44px] rounded border border-slate-300 px-3 text-xs font-black text-slate-700"
            >
              キャンセル
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
