import React, { useCallback, useEffect, useState } from 'react';
import * as db from '../haishaDb.js';

function formatError(err, fallback = '処理に失敗しました') {
  return err?.message || err?.error_description || fallback;
}

/**
 * trading_companies マスタ（商社名）
 * 担当者は organizations(type=agent) のメンバー管理に一本化
 */
export function AdminTradingCompaniesSection() {
  const [companies, setCompanies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await db.fetchTradingCompanies();
      setCompanies(rows || []);
    } catch (e) {
      console.error('[AdminTradingCompaniesSection] load failed', e);
      setError(formatError(e, '商社マスタの取得に失敗しました'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = (company) => {
    setShowNewForm(false);
    setEditingId(String(company.id));
    setEditName(String(company.name || ''));
    setNotice('');
    setError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingId) return;
    setSaving(true);
    setError('');
    try {
      await db.updateTradingCompany(editingId, { name: editName });
      setNotice('商社を更新しました');
      cancelEdit();
      await load();
    } catch (err) {
      console.error(err);
      setError(formatError(err, '商社の更新に失敗しました'));
    } finally {
      setSaving(false);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await db.insertTradingCompany({ name: newName });
      setNotice('商社を追加しました');
      setShowNewForm(false);
      setNewName('');
      await load();
    } catch (err) {
      console.error(err);
      setError(formatError(err, '商社の追加に失敗しました'));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (company) => {
    if (!company?.id) return;
    if (!window.confirm(`「${company.name}」を削除しますか？`)) return;
    setError('');
    try {
      await db.deleteTradingCompany(company.id);
      if (String(editingId) === String(company.id)) cancelEdit();
      setNotice('商社を削除しました');
      await load();
    } catch (err) {
      console.error(err);
      setError(formatError(err, '商社の削除に失敗しました'));
    }
  };

  const fieldClass =
    'min-h-[40px] w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-medium text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200';

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900">商社マスタ（名称）</h2>
          <p className="mt-1 text-xs text-slate-500">
            trading_companies · 担当者は上の「商社」組織管理で登録してください
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            cancelEdit();
            setShowNewForm(true);
            setNotice('');
            setError('');
          }}
          className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-sm font-black text-white hover:bg-indigo-700"
        >
          ＋ 商社を追加
        </button>
      </div>

      {notice ? (
        <p className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800" role="status">
          {notice}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      {showNewForm ? (
        <form onSubmit={handleCreate} className="mt-4 space-y-3 rounded-xl border-2 border-indigo-200 bg-indigo-50/40 p-4">
          <h3 className="text-sm font-black text-slate-900">商社を追加</h3>
          <div>
            <label className="text-xs font-bold text-slate-600" htmlFor="tc-new-name">
              商社名
            </label>
            <input
              id="tc-new-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className={'mt-1 ' + fieldClass}
              required
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="submit"
              disabled={saving}
              className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-60"
            >
              {saving ? '保存中…' : '追加する'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowNewForm(false);
                setNewName('');
              }}
              className="min-h-[44px] rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700"
            >
              キャンセル
            </button>
          </div>
        </form>
      ) : null}

      {loading ? <p className="mt-4 text-sm text-slate-500">読み込み中…</p> : null}
      {!loading && companies.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
          登録された商社はありません。
        </p>
      ) : null}

      {!loading && companies.length > 0 ? (
        <ul className="mt-4 space-y-3">
          {companies.map((company) => {
            const isEditing = String(editingId) === String(company.id);
            return (
              <li key={company.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                {isEditing ? (
                  <form onSubmit={handleSaveEdit} className="space-y-3">
                    <div>
                      <label className="text-xs font-bold text-slate-600" htmlFor={`tc-edit-name-${company.id}`}>
                        商社名
                      </label>
                      <input
                        id={`tc-edit-name-${company.id}`}
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className={'mt-1 ' + fieldClass}
                        required
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        disabled={saving}
                        className="min-h-[40px] rounded-lg bg-indigo-600 px-4 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-60"
                      >
                        {saving ? '保存中…' : '保存'}
                      </button>
                      <button
                        type="button"
                        onClick={cancelEdit}
                        className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700"
                      >
                        キャンセル
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="font-black text-slate-900">{company.name}</p>
                    <div className="flex flex-wrap gap-1">
                      <button
                        type="button"
                        onClick={() => startEdit(company)}
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-bold hover:bg-slate-50"
                      >
                        編集
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDelete(company)}
                        className="rounded border border-red-300 bg-red-50 px-2 py-1 text-xs font-bold text-red-800 hover:bg-red-100"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
