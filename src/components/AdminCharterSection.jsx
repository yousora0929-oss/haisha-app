import React, { useCallback, useEffect, useState } from 'react';
import * as db from '../haishaDb.js';
import { PlateCategoryBadge } from './PlateCategoryBadge.jsx';

const inputClass =
  'min-h-[40px] w-full rounded-lg border-2 border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

function formatError(err, fallback = '処理に失敗しました') {
  return err?.message || err?.error_description || fallback;
}

function formatCreatedAt(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return d.toLocaleDateString('ja-JP', { year: 'numeric', month: 'short', day: 'numeric' });
}

async function copyText(text) {
  const value = String(text || '');
  if (!value) return false;
  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const el = document.createElement('textarea');
    el.value = value;
    el.setAttribute('readonly', '');
    el.style.position = 'fixed';
    el.style.left = '-9999px';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch {
    return false;
  }
}

function CredentialsDialog({ title, loginId, password, onClose }) {
  const [copied, setCopied] = useState('');

  const handleCopy = async (kind, value) => {
    const ok = await copyText(value);
    setCopied(ok ? kind : '');
    if (ok) window.setTimeout(() => setCopied(''), 2000);
  };

  const both = `ログインID: ${loginId}\n初期パスワード: ${password}`;

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="charter-credentials-title"
        className="w-full max-w-lg rounded-2xl border-2 border-indigo-300 bg-white p-5 shadow-2xl dark:border-indigo-700 dark:bg-slate-900"
      >
        <h3 id="charter-credentials-title" className="text-lg font-black text-slate-900 dark:text-slate-100">
          {title}
        </h3>
        <p className="mt-2 text-sm font-bold text-amber-800 dark:text-amber-300">
          ※この情報は今しか表示されません。控えてから閉じてください。
        </p>
        <dl className="mt-4 space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-600 dark:bg-slate-800/60">
          <div>
            <dt className="text-xs font-bold text-slate-500">ログインID</dt>
            <dd className="mt-1 break-all font-mono text-sm font-black text-slate-900 dark:text-slate-100">{loginId}</dd>
            <button
              type="button"
              onClick={() => void handleCopy('id', loginId)}
              className="mt-1 text-xs font-bold text-indigo-700 hover:underline dark:text-indigo-300"
            >
              {copied === 'id' ? 'コピーしました' : 'IDをコピー'}
            </button>
          </div>
          <div>
            <dt className="text-xs font-bold text-slate-500">初期パスワード</dt>
            <dd className="mt-1 font-mono text-2xl font-black tracking-wider text-indigo-700 dark:text-indigo-300">
              {password}
            </dd>
            <button
              type="button"
              onClick={() => void handleCopy('password', password)}
              className="mt-1 text-xs font-bold text-indigo-700 hover:underline dark:text-indigo-300"
            >
              {copied === 'password' ? 'コピーしました' : 'パスワードをコピー'}
            </button>
          </div>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleCopy('both', both)}
            className="min-h-[44px] rounded-lg border-2 border-indigo-300 bg-indigo-50 px-4 text-sm font-black text-indigo-800 hover:bg-indigo-100 dark:border-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-200"
          >
            {copied === 'both' ? 'コピーしました' : 'IDとパスワードをまとめてコピー'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-sm font-black text-white hover:bg-indigo-700"
          >
            控えました（閉じる）
          </button>
        </div>
      </div>
    </div>
  );
}

function FactoryOverviewPanel() {
  const [overview, setOverview] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [expandedFactoryId, setExpandedFactoryId] = useState('');
  const [vehiclesByFactory, setVehiclesByFactory] = useState({});
  const [vehiclesLoadingId, setVehiclesLoadingId] = useState('');
  const [vehiclesErrorByFactory, setVehiclesErrorByFactory] = useState({});

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await db.fetchFactoryCharterOverview();
      setOverview(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(formatError(e, '工場チャーター状況の取得に失敗しました'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleFactoryDetail = async (factoryId) => {
    const fid = String(factoryId || '').trim();
    if (!fid) return;
    if (expandedFactoryId === fid) {
      setExpandedFactoryId('');
      return;
    }
    setExpandedFactoryId(fid);
    setVehiclesLoadingId(fid);
    setVehiclesErrorByFactory((prev) => {
      const next = { ...prev };
      delete next[fid];
      return next;
    });
    try {
      const rows = await db.fetchCharterVehicles('factory', fid);
      setVehiclesByFactory((prev) => ({ ...prev, [fid]: Array.isArray(rows) ? rows : [] }));
    } catch (err) {
      console.warn('[AdminCharterSection] 車両一覧の取得に失敗', err);
      setVehiclesErrorByFactory((prev) => ({
        ...prev,
        [fid]: '車両情報の取得に失敗しました',
      }));
      setVehiclesByFactory((prev) => ({ ...prev, [fid]: [] }));
    } finally {
      setVehiclesLoadingId('');
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
          各工場の車両登録・通知優先リストの設定状況（読み取り専用）
        </p>
        <button
          type="button"
          onClick={() => void load()}
          disabled={loading}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          再読込
        </button>
      </div>
      {error ? <p className="mb-3 text-sm font-bold text-red-700">{error}</p> : null}
      {loading && overview.length === 0 ? (
        <p className="text-sm text-slate-500">読み込み中…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-600">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs font-black uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                <th className="px-3 py-2">工場名</th>
                <th className="px-3 py-2">車両登録数</th>
                <th className="px-3 py-2">通知優先リスト件数</th>
                <th className="px-3 py-2">詳細</th>
              </tr>
            </thead>
            <tbody>
              {overview.map((row) => {
                const expanded = expandedFactoryId === row.factoryId;
                const vehicles = vehiclesByFactory[row.factoryId] || [];
                const vehiclesLoading = vehiclesLoadingId === row.factoryId;
                const vehiclesError = vehiclesErrorByFactory[row.factoryId] || '';
                return (
                  <React.Fragment key={row.factoryId}>
                    <tr className="border-t border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
                      <td className="px-3 py-2.5 font-bold text-slate-900 dark:text-slate-100">{row.factoryName}</td>
                      <td className="px-3 py-2.5 font-semibold text-slate-800 dark:text-slate-200">
                        {row.vehicleCount}台
                      </td>
                      <td className="px-3 py-2.5 font-semibold text-slate-800 dark:text-slate-200">
                        {row.notificationTargetCount}件
                        {row.notificationTargetCount === 0 ? (
                          <span className="ml-2 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-black text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                            未設定
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5">
                        <button
                          type="button"
                          onClick={() => void toggleFactoryDetail(row.factoryId)}
                          className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-black text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
                        >
                          {expanded ? '▼ 閉じる' : '▶ 詳細'}
                        </button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr className="border-t border-slate-100 bg-slate-50 dark:border-slate-800 dark:bg-slate-950/40">
                        <td colSpan={4} className="px-3 py-3">
                          <p className="text-xs font-black text-slate-600 dark:text-slate-300">登録車両</p>
                          {vehiclesLoading ? (
                            <p className="mt-2 text-sm text-slate-500">読み込み中…</p>
                          ) : vehiclesError ? (
                            <p className="mt-2 text-sm font-bold text-amber-700 dark:text-amber-300">
                              {vehiclesError}
                            </p>
                          ) : vehicles.length === 0 ? (
                            <p className="mt-2 text-sm text-slate-500">登録車両はありません</p>
                          ) : (
                            <ul className="mt-2 space-y-1">
                              {vehicles.map((v) => (
                                <li
                                  key={v.id}
                                  className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm dark:border-slate-600 dark:bg-slate-900"
                                >
                                  <PlateCategoryBadge category={v.plate_category} />
                                  <span className="font-bold text-slate-800 dark:text-slate-100">
                                    {v.vehicle_type === 'large' ? '大型' : '小型'} {v.vehicle_number || '—'}
                                    {v.door_number ? `（ドア${v.door_number}）` : ''}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    ) : null}
                  </React.Fragment>
                );
              })}
              {overview.length === 0 && !loading ? (
                <tr>
                  <td colSpan={4} className="px-3 py-8 text-center text-sm text-slate-500">
                    工場がありません
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function emptyOperatorForm() {
  return { companyName: '', contactName: '', phone: '' };
}

function CharterOperatorsPanel() {
  const [operators, setOperators] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [showNewForm, setShowNewForm] = useState(false);
  const [newForm, setNewForm] = useState(emptyOperatorForm);
  const [editingId, setEditingId] = useState('');
  const [editForm, setEditForm] = useState(emptyOperatorForm);
  const [credentials, setCredentials] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await db.fetchCharterOperators();
      setOperators(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(formatError(e, 'チャーター業者一覧の取得に失敗しました'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const showNotice = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3000);
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const created = await db.createCharterOperator(newForm);
      setOperators((prev) => [created, ...prev]);
      setNewForm(emptyOperatorForm());
      setShowNewForm(false);
      setCredentials({
        title: '新規登録完了 — ログイン情報を控えてください',
        loginId: created.id,
        password: created.login_password,
      });
      showNotice('チャーター業者を登録しました');
    } catch (err) {
      setError(formatError(err, '登録に失敗しました'));
    } finally {
      setLoading(false);
    }
  };

  const startEdit = (op) => {
    setEditingId(op.id);
    setEditForm({
      companyName: op.company_name || '',
      contactName: op.contact_name || '',
      phone: op.phone || '',
    });
    setError('');
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editingId) return;
    setLoading(true);
    setError('');
    try {
      const updated = await db.updateCharterOperator(editingId, editForm);
      setOperators((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)));
      setEditingId('');
      showNotice('更新しました');
    } catch (err) {
      setError(formatError(err, '更新に失敗しました'));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleStatus = async (op) => {
    const next = op.status === 'active' ? 'suspended' : 'active';
    const label = next === 'suspended' ? '停止' : '再開';
    if (!window.confirm(`「${op.company_name}」を${label}しますか？`)) return;
    setLoading(true);
    setError('');
    try {
      const updated = await db.setCharterOperatorStatus(op.id, next);
      setOperators((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)));
      showNotice(`${label}しました`);
    } catch (err) {
      setError(formatError(err, `${label}に失敗しました`));
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (op) => {
    if (!window.confirm(`「${op.company_name}」のパスワードを再発行しますか？\n旧パスワードは使えなくなります。`)) {
      return;
    }
    setLoading(true);
    setError('');
    try {
      const updated = await db.resetCharterOperatorPassword(op.id);
      setOperators((prev) => prev.map((o) => (o.id === updated.id ? { ...o, ...updated } : o)));
      setCredentials({
        title: 'パスワード再発行 — 新しいパスワードを控えてください',
        loginId: updated.id,
        password: updated.login_password,
      });
      showNotice('パスワードを再発行しました');
    } catch (err) {
      setError(formatError(err, 'パスワード再発行に失敗しました'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
          チャーター業者の登録・停止・パスワード再発行
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          >
            再読込
          </button>
          <button
            type="button"
            onClick={() => {
              setShowNewForm((v) => !v);
              setError('');
            }}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-black text-white hover:bg-indigo-700"
          >
            {showNewForm ? '登録フォームを閉じる' : '＋ 新規登録'}
          </button>
        </div>
      </div>

      {notice ? <p className="mb-3 text-sm font-bold text-emerald-700">{notice}</p> : null}
      {error ? <p className="mb-3 text-sm font-bold text-red-700">{error}</p> : null}

      {showNewForm ? (
        <form
          onSubmit={(e) => void handleCreate(e)}
          className="mb-4 rounded-xl border-2 border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-800 dark:bg-indigo-950/30"
        >
          <p className="text-sm font-black text-indigo-900 dark:text-indigo-200">新規チャーター業者登録</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
              会社名 *
              <input
                required
                value={newForm.companyName}
                onChange={(e) => setNewForm((f) => ({ ...f, companyName: e.target.value }))}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
              担当者名
              <input
                value={newForm.contactName}
                onChange={(e) => setNewForm((f) => ({ ...f, contactName: e.target.value }))}
                className={`${inputClass} mt-1`}
              />
            </label>
            <label className="block text-xs font-bold text-slate-600 dark:text-slate-300">
              電話番号
              <input
                value={newForm.phone}
                onChange={(e) => setNewForm((f) => ({ ...f, phone: e.target.value }))}
                className={`${inputClass} mt-1`}
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="mt-3 min-h-[44px] rounded-lg bg-indigo-600 px-4 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            登録する
          </button>
        </form>
      ) : null}

      {loading && operators.length === 0 ? (
        <p className="text-sm text-slate-500">読み込み中…</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-600">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-100 text-xs font-black uppercase tracking-wide text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              <tr>
                <th className="px-3 py-2">会社名</th>
                <th className="px-3 py-2">担当者</th>
                <th className="px-3 py-2">電話</th>
                <th className="px-3 py-2">ステータス</th>
                <th className="px-3 py-2">登録日</th>
                <th className="px-3 py-2">操作</th>
              </tr>
            </thead>
            <tbody>
              {operators.map((op) => {
                const isEditing = editingId === op.id;
                return (
                  <tr
                    key={op.id}
                    className="border-t border-slate-200 bg-white align-top dark:border-slate-700 dark:bg-slate-900"
                  >
                    {isEditing ? (
                      <td colSpan={6} className="px-3 py-3">
                        <form onSubmit={(e) => void handleSaveEdit(e)} className="grid gap-3 sm:grid-cols-4">
                          <label className="block text-xs font-bold text-slate-600">
                            会社名
                            <input
                              required
                              value={editForm.companyName}
                              onChange={(e) => setEditForm((f) => ({ ...f, companyName: e.target.value }))}
                              className={`${inputClass} mt-1`}
                            />
                          </label>
                          <label className="block text-xs font-bold text-slate-600">
                            担当者
                            <input
                              value={editForm.contactName}
                              onChange={(e) => setEditForm((f) => ({ ...f, contactName: e.target.value }))}
                              className={`${inputClass} mt-1`}
                            />
                          </label>
                          <label className="block text-xs font-bold text-slate-600">
                            電話
                            <input
                              value={editForm.phone}
                              onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                              className={`${inputClass} mt-1`}
                            />
                          </label>
                          <div className="flex items-end gap-2">
                            <button
                              type="submit"
                              disabled={loading}
                              className="min-h-[40px] rounded-lg bg-indigo-600 px-3 text-xs font-black text-white hover:bg-indigo-700 disabled:opacity-60"
                            >
                              保存
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId('')}
                              className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-black text-slate-700 hover:bg-slate-50"
                            >
                              取消
                            </button>
                          </div>
                        </form>
                        <p className="mt-2 break-all text-[11px] font-medium text-slate-500">ID: {op.id}</p>
                      </td>
                    ) : (
                      <>
                        <td className="px-3 py-2.5">
                          <p className="font-bold text-slate-900 dark:text-slate-100">{op.company_name}</p>
                          <p className="mt-0.5 break-all text-[10px] font-medium text-slate-400">{op.id}</p>
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-slate-800 dark:text-slate-200">
                          {op.contact_name || '—'}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-slate-800 dark:text-slate-200">
                          {op.phone || '—'}
                        </td>
                        <td className="px-3 py-2.5">
                          {op.status === 'active' ? (
                            <span className="rounded-full border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-black text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
                              稼働中
                            </span>
                          ) : (
                            <span className="rounded-full border border-slate-300 bg-slate-100 px-2 py-0.5 text-xs font-black text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
                              停止中
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2.5 font-semibold text-slate-700 dark:text-slate-300">
                          {formatCreatedAt(op.created_at)}
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1.5">
                            <button
                              type="button"
                              onClick={() => startEdit(op)}
                              disabled={loading}
                              className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-black text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                            >
                              編集
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleToggleStatus(op)}
                              disabled={loading}
                              className={
                                'rounded border px-2 py-1 text-xs font-black disabled:opacity-60 ' +
                                (op.status === 'active'
                                  ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                                  : 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100')
                              }
                            >
                              {op.status === 'active' ? '停止' : '再開'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleResetPassword(op)}
                              disabled={loading}
                              className="rounded border border-indigo-300 bg-indigo-50 px-2 py-1 text-xs font-black text-indigo-800 hover:bg-indigo-100 disabled:opacity-60"
                            >
                              パスワード再発行
                            </button>
                          </div>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              {operators.length === 0 && !loading ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-sm text-slate-500">
                    登録されたチャーター業者はありません
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      )}

      {credentials ? (
        <CredentialsDialog
          title={credentials.title}
          loginId={credentials.loginId}
          password={credentials.password}
          onClose={() => setCredentials(null)}
        />
      ) : null}
    </div>
  );
}

export function AdminCharterSection() {
  const [subTab, setSubTab] = useState('factories');

  return (
    <section className="rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-6">
      <header className="mb-4">
        <h2 className="text-xl font-black text-slate-900 dark:text-slate-100">チャーター業務</h2>
        <p className="mt-1 text-sm font-medium text-slate-600 dark:text-slate-300">
          工場のチャーター設定状況の確認と、チャーター業者の管理
        </p>
      </header>

      <div className="mb-4 flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
        {[
          ['factories', '🏭 工場'],
          ['operators', '👤 チャーター業者'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setSubTab(id)}
            className={
              'min-h-[40px] flex-1 rounded-lg px-3 text-sm font-black transition ' +
              (subTab === id
                ? 'bg-indigo-600 text-white shadow ring-2 ring-indigo-200'
                : 'text-slate-500 hover:bg-white hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-700')
            }
          >
            {label}
          </button>
        ))}
      </div>

      {subTab === 'factories' ? <FactoryOverviewPanel /> : <CharterOperatorsPanel />}
    </section>
  );
}
