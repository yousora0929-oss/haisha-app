import React, { useCallback, useEffect, useState } from 'react';
import * as db from '../haishaDb.js';

function toEditRow(row) {
  return {
    id: String(row?.id || ''),
    name: String(row?.name || '').trim(),
    phone: String(row?.phone_number || '').trim(),
  };
}

export function CompanyMemberContactList({
  customerId,
  title = '担当者一覧',
  description = '同じ会社名で登録されている担当者の氏名・電話番号を編集できます。パスワードや権限は変更しません。',
}) {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const cid = String(customerId || '').trim();

  const load = useCallback(async () => {
    if (!cid) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const list = await db.fetchCompanyMemberSuggestions(cid);
      setRows((Array.isArray(list) ? list : []).map(toEditRow));
    } catch (e) {
      console.warn('[CompanyMemberContactList] load failed', e);
      setError(e?.message || '担当者一覧の取得に失敗しました');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [cid]);

  useEffect(() => {
    void load();
    setNotice('');
  }, [load]);

  const showNotice = (msg) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(''), 3000);
  };

  const handleSave = async (row) => {
    const id = String(row?.id || '').trim();
    const name = String(row?.name || '').trim();
    const phone = String(row?.phone || '').trim();
    if (!id) return;
    if (!name || !phone) {
      setError('氏名と電話番号は必須です');
      return;
    }
    setSavingId(id);
    setError('');
    try {
      await db.updateCompanyMemberContact({ id, name, phone });
      await load();
      showNotice('担当者情報を更新しました');
    } catch (e) {
      console.error('[CompanyMemberContactList] save failed', e);
      setError(e?.message || '更新に失敗しました');
    } finally {
      setSavingId('');
    }
  };

  if (!cid) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
        業者情報を確認できません。
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-600 dark:bg-slate-900">
      <p className="text-sm font-black text-slate-800 dark:text-slate-100">{title}</p>
      {description ? (
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">{description}</p>
      ) : null}
      {error ? (
        <p className="mt-2 rounded border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-bold text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs font-bold text-emerald-800" role="status">
          {notice}
        </p>
      ) : null}
      {loading ? (
        <p className="mt-3 text-xs text-slate-500">読み込み中…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-xs text-slate-400">同じ会社に登録された担当者がいません。</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => {
            const disabled = savingId === row.id;
            return (
              <li
                key={row.id}
                className="grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2 sm:grid-cols-[1fr_1fr_auto] dark:border-slate-700 dark:bg-slate-800/60"
              >
                <input
                  type="text"
                  value={row.name}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = e.target.value;
                    setRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, name: next } : item)));
                  }}
                  placeholder="氏名"
                  className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                />
                <input
                  type="tel"
                  value={row.phone}
                  disabled={disabled}
                  onChange={(e) => {
                    const next = e.target.value;
                    setRows((prev) => prev.map((item) => (item.id === row.id ? { ...item, phone: next } : item)));
                  }}
                  placeholder="電話番号"
                  className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200"
                />
                <div className="flex items-start">
                  <button
                    type="button"
                    disabled={disabled}
                    onClick={() => void handleSave(row)}
                    className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    保存
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
