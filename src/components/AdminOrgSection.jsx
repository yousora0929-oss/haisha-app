import React, { useCallback, useEffect, useState } from 'react';
import * as db from '../haishaDb.js';

const emptyMember = () => ({
  companyName: '',
  managerName: '',
  phone: '',
  password: '',
});

function memberToForm(member) {
  return {
    id: member.id,
    companyName: member.company_name ?? '',
    managerName: member.manager_name ?? '',
    phone: member.phone_number ?? '',
    password: member.login_password ?? '',
  };
}

function formatError(err, fallback = '処理に失敗しました') {
  return err?.message || err?.error_description || fallback;
}

/**
 * 商社 / 組合の組織・担当者管理（管理画面タブ共通）
 */
export function AdminOrgSection({ orgType, label }) {
  const [orgs, setOrgs] = useState([]);
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [editingOrg, setEditingOrg] = useState(null);
  const [showNewOrgForm, setShowNewOrgForm] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [editingMember, setEditingMember] = useState(null);
  const [addingMemberId, setAddingMemberId] = useState(null);
  const [newMember, setNewMember] = useState(emptyMember);
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  const loadOrgs = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await db.fetchOrganizationsWithMembers(orgType);
      setOrgs(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(formatError(e, `${label}一覧の取得に失敗しました`));
    } finally {
      setLoading(false);
    }
  }, [orgType, label]);

  useEffect(() => {
    void loadOrgs();
  }, [loadOrgs]);

  const showNotice = (message) => {
    setNotice(message);
    window.setTimeout(() => setNotice(''), 3000);
  };

  const toggleExpand = (orgId) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(orgId)) next.delete(orgId);
      else next.add(orgId);
      return next;
    });
  };

  const handleAddOrg = async () => {
    const name = String(newOrgName || '').trim();
    if (!name) {
      setError('組織名を入力してください');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const created = await db.createOrganization(name, orgType);
      setOrgs((prev) => [...prev, { ...created, members: [] }]);
      setNewOrgName('');
      setShowNewOrgForm(false);
      setExpandedIds((prev) => new Set(prev).add(created.id));
      showNotice(`${label}を登録しました`);
    } catch (e) {
      setError(formatError(e, '登録に失敗しました'));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveOrg = async () => {
    if (!editingOrg?.id) return;
    const name = String(editingOrg.name || '').trim();
    if (!name) {
      setError('組織名を入力してください');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await db.updateOrganization(editingOrg.id, name);
      setOrgs((prev) =>
        prev.map((o) => (o.id === editingOrg.id ? { ...o, name } : o)),
      );
      setEditingOrg(null);
      showNotice('組織名を更新しました');
    } catch (e) {
      setError(formatError(e, '更新に失敗しました'));
    } finally {
      setLoading(false);
    }
  };

  const handleAddMember = async (organizationId) => {
    setLoading(true);
    setError('');
    try {
      const created = await db.createOrgMember({
        organizationId,
        role: orgType,
        companyName: newMember.companyName,
        managerName: newMember.managerName,
        phone: newMember.phone,
        password: newMember.password,
      });
      setOrgs((prev) =>
        prev.map((o) =>
          o.id === organizationId
            ? { ...o, members: [...(o.members || []), created] }
            : o,
        ),
      );
      setAddingMemberId(null);
      setNewMember(emptyMember());
      showNotice('担当者を登録しました');
    } catch (e) {
      setError(formatError(e, '担当者の登録に失敗しました'));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveMember = async () => {
    if (!editingMember?.id) return;
    setLoading(true);
    setError('');
    try {
      await db.updateOrgMember(editingMember.id, {
        companyName: editingMember.companyName,
        managerName: editingMember.managerName,
        phone: editingMember.phone,
        password: editingMember.password,
      });
      setOrgs((prev) =>
        prev.map((o) => ({
          ...o,
          members: (o.members || []).map((m) =>
            m.id === editingMember.id
              ? {
                  ...m,
                  company_name: editingMember.companyName?.trim() ?? null,
                  manager_name: editingMember.managerName?.trim() ?? null,
                  phone_number: editingMember.phone?.trim() ?? null,
                  login_password: editingMember.password?.trim() ?? null,
                }
              : m,
          ),
        })),
      );
      setEditingMember(null);
      showNotice('担当者を更新しました');
    } catch (e) {
      setError(formatError(e, '担当者の更新に失敗しました'));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteMember = async (organizationId, member) => {
    const name = member.manager_name || member.company_name || '担当者';
    if (!window.confirm(`「${name}」を削除しますか？`)) return;
    setLoading(true);
    setError('');
    try {
      await db.deleteOrgMember(member.id);
      setOrgs((prev) =>
        prev.map((o) =>
          o.id === organizationId
            ? { ...o, members: (o.members || []).filter((m) => m.id !== member.id) }
            : o,
        ),
      );
      if (editingMember?.id === member.id) setEditingMember(null);
      showNotice('担当者を削除しました');
    } catch (e) {
      setError(formatError(e, '担当者の削除に失敗しました'));
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'rounded border border-gray-200 px-2 py-1 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200';

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {!showNewOrgForm ? (
          <button
            type="button"
            onClick={() => {
              setShowNewOrgForm(true);
              setNewOrgName('');
              setError('');
            }}
            disabled={loading}
            className="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-500 disabled:opacity-60"
          >
            ＋ {label}を追加
          </button>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={newOrgName}
              onChange={(e) => setNewOrgName(e.target.value)}
              placeholder="組織名"
              className={inputClass}
              disabled={loading}
            />
            <button
              type="button"
              onClick={() => void handleAddOrg()}
              disabled={loading}
              className="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-500 disabled:opacity-60"
            >
              登録
            </button>
            <button
              type="button"
              onClick={() => {
                setShowNewOrgForm(false);
                setNewOrgName('');
              }}
              disabled={loading}
              className="text-sm text-gray-600 hover:text-gray-800"
            >
              キャンセル
            </button>
          </div>
        )}
      </div>

      {notice ? <p className="text-green-600 text-sm mt-2">{notice}</p> : null}
      {error ? <p className="text-red-600 text-sm mt-2">{error}</p> : null}
      {loading && orgs.length === 0 ? (
        <p className="text-sm text-gray-500">読み込み中…</p>
      ) : null}

      {orgs.map((org) => {
        const expanded = expandedIds.has(org.id);
        const isEditingOrg = editingOrg?.id === org.id;
        const isAddingMember = addingMemberId === org.id;

        return (
          <div
            key={org.id}
            className="border border-gray-200 rounded-lg p-4 mb-3 bg-white"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleExpand(org.id)}
                  className="text-gray-500 cursor-pointer shrink-0"
                  aria-expanded={expanded}
                >
                  {expanded ? '▼' : '▶'}
                </button>
                {isEditingOrg ? (
                  <input
                    type="text"
                    value={editingOrg.name}
                    onChange={(e) =>
                      setEditingOrg((cur) => (cur ? { ...cur, name: e.target.value } : cur))
                    }
                    className={`${inputClass} min-w-[12rem] flex-1`}
                    disabled={loading}
                  />
                ) : (
                  <span className="font-semibold text-slate-900 truncate">{org.name}</span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {isEditingOrg ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void handleSaveOrg()}
                      disabled={loading}
                      className="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-500 disabled:opacity-60"
                    >
                      保存
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingOrg(null)}
                      disabled={loading}
                      className="text-sm text-gray-600 hover:text-gray-800"
                    >
                      キャンセル
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingOrg({ id: org.id, name: org.name });
                      setError('');
                    }}
                    disabled={loading}
                    className="text-sm text-indigo-600 hover:underline"
                  >
                    編集
                  </button>
                )}
              </div>
            </div>

            {expanded ? (
              <div className="mt-4 pl-6">
                <p className="text-xs font-bold text-gray-500 mb-2">担当者:</p>

                {(org.members || []).length === 0 && !isAddingMember ? (
                  <p className="text-sm text-gray-400 mb-2">担当者が登録されていません</p>
                ) : null}

                {(org.members || []).map((member) => {
                  const isEditing = editingMember?.id === member.id;
                  if (isEditing) {
                    return (
                      <div
                        key={member.id}
                        className="mb-3 rounded border border-indigo-100 bg-indigo-50 p-3 text-sm"
                      >
                        <div className="grid gap-2 sm:grid-cols-2">
                          <label className="block text-xs text-gray-600">
                            会社名
                            <input
                              type="text"
                              value={editingMember.companyName}
                              onChange={(e) =>
                                setEditingMember((cur) =>
                                  cur ? { ...cur, companyName: e.target.value } : cur,
                                )
                              }
                              className={`${inputClass} mt-1 w-full`}
                            />
                          </label>
                          <label className="block text-xs text-gray-600">
                            担当者名
                            <input
                              type="text"
                              value={editingMember.managerName}
                              onChange={(e) =>
                                setEditingMember((cur) =>
                                  cur ? { ...cur, managerName: e.target.value } : cur,
                                )
                              }
                              className={`${inputClass} mt-1 w-full`}
                            />
                          </label>
                          <label className="block text-xs text-gray-600">
                            電話番号
                            <input
                              type="tel"
                              value={editingMember.phone}
                              onChange={(e) =>
                                setEditingMember((cur) =>
                                  cur ? { ...cur, phone: e.target.value } : cur,
                                )
                              }
                              className={`${inputClass} mt-1 w-full`}
                            />
                          </label>
                          <label className="block text-xs text-gray-600">
                            パスワード
                            <input
                              type="text"
                              value={editingMember.password}
                              onChange={(e) =>
                                setEditingMember((cur) =>
                                  cur ? { ...cur, password: e.target.value } : cur,
                                )
                              }
                              className={`${inputClass} mt-1 w-full`}
                            />
                          </label>
                        </div>
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            onClick={() => void handleSaveMember()}
                            disabled={loading}
                            className="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-500 disabled:opacity-60"
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingMember(null)}
                            disabled={loading}
                            className="text-sm text-gray-600 hover:text-gray-800"
                          >
                            キャンセル
                          </button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={member.id}
                      className="flex flex-wrap items-center gap-3 py-2 border-b border-gray-100 text-sm"
                    >
                      <span className="min-w-[5rem] font-medium">
                        {member.manager_name || '—'}
                      </span>
                      <span className="min-w-[6rem] text-gray-700">
                        {member.company_name || '—'}
                      </span>
                      <span className="min-w-[7rem] text-gray-600">
                        {member.phone_number || '—'}
                      </span>
                      <div className="ml-auto flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMember(memberToForm(member));
                            setAddingMemberId(null);
                            setError('');
                          }}
                          disabled={loading}
                          className="text-sm text-indigo-600 hover:underline"
                        >
                          編集
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeleteMember(org.id, member)}
                          disabled={loading}
                          className="text-red-500 hover:text-red-700 text-sm"
                        >
                          削除
                        </button>
                      </div>
                    </div>
                  );
                })}

                {isAddingMember ? (
                  <div className="mt-3 rounded border border-indigo-100 bg-indigo-50 p-3 text-sm">
                    <div className="grid gap-2 sm:grid-cols-2">
                      <label className="block text-xs text-gray-600">
                        会社名
                        <input
                          type="text"
                          value={newMember.companyName}
                          onChange={(e) =>
                            setNewMember((m) => ({ ...m, companyName: e.target.value }))
                          }
                          className={`${inputClass} mt-1 w-full`}
                        />
                      </label>
                      <label className="block text-xs text-gray-600">
                        担当者名
                        <input
                          type="text"
                          value={newMember.managerName}
                          onChange={(e) =>
                            setNewMember((m) => ({ ...m, managerName: e.target.value }))
                          }
                          className={`${inputClass} mt-1 w-full`}
                        />
                      </label>
                      <label className="block text-xs text-gray-600">
                        電話番号
                        <input
                          type="tel"
                          value={newMember.phone}
                          onChange={(e) =>
                            setNewMember((m) => ({ ...m, phone: e.target.value }))
                          }
                          className={`${inputClass} mt-1 w-full`}
                        />
                      </label>
                      <label className="block text-xs text-gray-600">
                        パスワード
                        <input
                          type="text"
                          value={newMember.password}
                          onChange={(e) =>
                            setNewMember((m) => ({ ...m, password: e.target.value }))
                          }
                          className={`${inputClass} mt-1 w-full`}
                        />
                      </label>
                    </div>
                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() => void handleAddMember(org.id)}
                        disabled={loading}
                        className="bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-500 disabled:opacity-60"
                      >
                        登録
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setAddingMemberId(null);
                          setNewMember(emptyMember());
                        }}
                        disabled={loading}
                        className="text-sm text-gray-600 hover:text-gray-800"
                      >
                        キャンセル
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setAddingMemberId(org.id);
                      setNewMember(emptyMember());
                      setEditingMember(null);
                      setError('');
                    }}
                    disabled={loading}
                    className="text-indigo-600 text-sm hover:underline mt-2"
                  >
                    ＋ 担当者を追加
                  </button>
                )}
              </div>
            ) : null}
          </div>
        );
      })}

      {!loading && orgs.length === 0 ? (
        <p className="text-sm text-gray-500">{label}が登録されていません</p>
      ) : null}
    </section>
  );
}
