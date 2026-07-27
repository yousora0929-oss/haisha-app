import React, { useCallback, useEffect, useState } from 'react';
import * as db from '../haishaDb.js';

const emptyDraft = () => ({ name: '', phone: '' });

function toEditRow(row) {
  return {
    id: String(row?.id || ''),
    name: String(row?.name || ''),
    phone: String(row?.phone_number || row?.phone || ''),
  };
}

/**
 * 業者ごとの現場担当者マスタ（複数行）編集UI。
 * AdminApp / DispatchApp 共通。
 */
export function SiteContactsEditor({
  customerId,
  disabled = false,
  title = '現場担当者（複数登録可）',
  description = '発注フォームの「現場担当者」サジェストに使います。代表担当者（manager_name）とは別です。',
  inputClassName = 'min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200',
}) {
  const [rows, setRows] = useState([]);
  const [draft, setDraft] = useState(emptyDraft);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
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
      const list = await db.listSiteContacts(cid);
      setRows((Array.isArray(list) ? list : []).map(toEditRow));
    } catch (e) {
      console.warn('[SiteContactsEditor] load failed', e);
      setError(e?.message || '現場担当者の取得に失敗しました');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [cid]);

  useEffect(() => {
    void load();
    setDraft(emptyDraft());
    setNotice('');
  }, [load]);

  const showNotice = (msg) => {
    setNotice(msg);
    window.setTimeout(() => setNotice(''), 3000);
  };

  const handleSaveRow = async (row) => {
    if (!cid || disabled) return;
    const name = String(row?.name ?? '').trim();
    const phone = String(row?.phone ?? '').trim();
    if (!name || !phone) {
      setError('名前と携帯電話は必須です');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await db.upsertSiteContact({
        id: row?.id || undefined,
        customerId: cid,
        name,
        phone,
      });
      await load();
      setDraft(emptyDraft());
      showNotice(row?.id ? '現場担当者を更新しました' : '現場担当者を追加しました');
    } catch (e) {
      console.error('[SiteContactsEditor] save failed', e);
      setError(e?.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!id || disabled) return;
    if (!window.confirm('この現場担当者を削除しますか？')) return;
    setSaving(true);
    setError('');
    try {
      await db.deleteSiteContact(id);
      await load();
      showNotice('削除しました');
    } catch (e) {
      console.error('[SiteContactsEditor] delete failed', e);
      setError(e?.message || '削除に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  if (!cid) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
        業者を選択すると現場担当者を登録できます。
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
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.length === 0 ? (
            <li className="text-xs text-slate-400">まだ登録がありません</li>
          ) : (
            rows.map((row) => (
              <li
                key={row.id}
                className="grid gap-2 rounded-lg border border-slate-100 bg-slate-50 p-2 sm:grid-cols-[1fr_1fr_auto] dark:border-slate-700 dark:bg-slate-800/60"
              >
                <input
                  type="text"
                  value={row.name}
                  disabled={disabled || saving}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, name: v } : r)));
                  }}
                  placeholder="氏名"
                  className={inputClassName}
                  aria-label="現場担当者名"
                />
                <input
                  type="tel"
                  value={row.phone}
                  disabled={disabled || saving}
                  onChange={(e) => {
                    const v = e.target.value;
                    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, phone: v } : r)));
                  }}
                  placeholder="携帯電話"
                  className={inputClassName}
                  aria-label="現場担当者の電話番号"
                />
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={disabled || saving}
                    onClick={() => void handleSaveRow(row)}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50"
                  >
                    保存
                  </button>
                  <button
                    type="button"
                    disabled={disabled || saving}
                    onClick={() => void handleDelete(row.id)}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    削除
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      )}

      <div className="mt-3 grid gap-2 rounded-lg border border-dashed border-indigo-200 bg-indigo-50/50 p-2 sm:grid-cols-[1fr_1fr_auto] dark:border-indigo-800 dark:bg-indigo-950/30">
        <input
          type="text"
          value={draft.name}
          disabled={disabled || saving}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          placeholder="新規：氏名"
          className={inputClassName}
          aria-label="新規現場担当者名"
        />
        <input
          type="tel"
          value={draft.phone}
          disabled={disabled || saving}
          onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
          placeholder="新規：携帯電話"
          className={inputClassName}
          aria-label="新規現場担当者の電話番号"
        />
        <button
          type="button"
          disabled={disabled || saving}
          onClick={() => void handleSaveRow(draft)}
          className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          ＋追加
        </button>
      </div>
    </div>
  );
}
