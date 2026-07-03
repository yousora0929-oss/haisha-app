import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as db from '../haishaDb.js';
import { downloadOrgMembersExportCsv } from '../utils/adminCsvImport.js';

const emptyMember = () => ({
  companyName: '',
  furigana: '',
  managerName: '',
  phone: '',
  password: '',
});

function parseCsvRows(text) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const rows = [];
  for (const line of lines) {
    if (/organization_name/i.test(line)) continue;
    const parts = line.split(',');
    const orgName = (parts[0] ?? '').trim();
    if (!orgName) continue;
    rows.push({
      orgName,
      managerName: (parts[1] ?? '').trim(),
      phone: (parts[2] ?? '').trim(),
      password: (parts[3] ?? '').trim(),
    });
  }
  return rows;
}

function buildCsvPreview(rows, orgs) {
  const existingOrgNames = new Set(orgs.map((o) => o.name.trim()));
  const existingPhones = new Set(
    orgs
      .flatMap((o) => o.members || [])
      .map((m) => (m.phone_number ?? '').trim())
      .filter(Boolean),
  );

  const grouped = {};
  for (const row of rows) {
    const key = row.orgName;
    if (!grouped[key]) {
      grouped[key] = {
        orgName: key,
        orgIsNew: !existingOrgNames.has(key),
        members: [],
      };
    }
    const phoneConflict = row.phone !== '' && existingPhones.has(row.phone);
    grouped[key].members.push({ ...row, phoneConflict });
  }

  let importCount = 0;
  let skipCount = 0;
  for (const g of Object.values(grouped)) {
    for (const m of g.members) {
      if (m.phoneConflict) skipCount += 1;
      else importCount += 1;
    }
  }

  return { groups: Object.values(grouped), importCount, skipCount };
}

function memberToForm(member, orgName = '') {
  return {
    id: member.id,
    organizationId: member.organization_id ?? null,
    companyName: member.company_name || orgName || '',
    furigana: member.furigana ?? '',
    managerName: member.manager_name ?? '',
    phone: member.phone_number ?? '',
    password: member.login_password ?? '',
  };
}

function formatError(err, fallback = '処理に失敗しました') {
  return err?.message || err?.error_description || fallback;
}

/**
 * 商社 / 組合 / 業者の組織・担当者管理（管理画面タブ共通）
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
  const [csvPanelOpen, setCsvPanelOpen] = useState(false);
  const [csvText, setCsvText] = useState('');
  const [csvPreview, setCsvPreview] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const csvFileInputRef = useRef(null);

  const filteredOrgs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter((org) => {
      if (String(org.name || '').toLowerCase().includes(q)) return true;
      return (org.members || []).some((m) => {
        const text = [m.furigana, m.manager_name, m.phone_number, m.company_name]
          .map((v) => String(v || ''))
          .join(' ')
          .toLowerCase();
        return text.includes(q);
      });
    });
  }, [orgs, searchQuery]);

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
      const org = orgs.find((o) => o.id === editingOrg.id);
      if (org?.members?.length) {
        await Promise.all(
          org.members.map((m) =>
            db.updateOrgMember(m.id, {
              organizationId: org.id,
              companyName: name,
              furigana: m.furigana ?? '',
              managerName: m.manager_name ?? '',
              phone: m.phone_number ?? '',
              password: m.login_password ?? '',
            }),
          ),
        );
      }
      setOrgs((prev) =>
        prev.map((o) =>
          o.id === editingOrg.id
            ? {
                ...o,
                name,
                members: (o.members || []).map((m) => ({ ...m, company_name: name })),
              }
            : o,
        ),
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
    const org = orgs.find((o) => o.id === organizationId);
    setLoading(true);
    setError('');
    try {
      const created = await db.createOrgMember({
        organizationId,
        role: orgType,
        managerName: newMember.managerName,
        furigana: newMember.furigana,
        phone: newMember.phone,
        password: newMember.password,
        companyName: org?.name ?? '',
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
    const parentOrg = orgs.find((o) =>
      (o.members || []).some((m) => m.id === editingMember.id),
    );
    const companyName = parentOrg?.name ?? editingMember.companyName ?? '';
    setLoading(true);
    setError('');
    try {
      await db.updateOrgMember(editingMember.id, {
        organizationId: parentOrg?.id ?? editingMember.organizationId,
        companyName,
        furigana: editingMember.furigana,
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
                  company_name: companyName.trim() || null,
                  furigana: editingMember.furigana?.trim() ?? null,
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

  const handleDeleteOrg = async (org) => {
    const memberCount = (org.members || []).length;
    const msg =
      memberCount > 0
        ? `「${org.name}」を削除します。\n所属する担当者 ${memberCount} 件も同時に削除されます。\nよろしいですか？`
        : `「${org.name}」を削除します。よろしいですか？`;
    if (!window.confirm(msg)) return;
    setLoading(true);
    setError('');
    try {
      await db.deleteOrganizationWithMembers(org.id);
      setOrgs((prev) => prev.filter((o) => o.id !== org.id));
      if (editingOrg?.id === org.id) setEditingOrg(null);
      if (addingMemberId === org.id) setAddingMemberId(null);
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(org.id);
        return next;
      });
      showNotice(`「${org.name}」を削除しました`);
    } catch (e) {
      setError(formatError(e, '組織の削除に失敗しました'));
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

  const handleCsvFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setCsvText(String(reader.result ?? ''));
      setCsvPreview(null);
      setError('');
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleCsvPreview = () => {
    const rows = parseCsvRows(csvText);
    if (!rows.length) {
      setError('有効なCSV行がありません');
      setCsvPreview(null);
      return;
    }
    setCsvPreview(buildCsvPreview(rows, orgs));
    setError('');
  };

  const handleCsvImport = async () => {
    if (!csvPreview?.groups?.length) return;
    const toImport = [];
    for (const g of csvPreview.groups) {
      for (const m of g.members) {
        if (!m.phoneConflict) {
          toImport.push({
            orgName: m.orgName,
            managerName: m.managerName,
            phone: m.phone,
            password: m.password,
          });
        }
      }
    }
    if (!toImport.length) {
      setError('インポート対象がありません');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { created, skipped } = await db.bulkImportOrgMembers(
        toImport,
        orgType,
        orgs,
        orgs.flatMap((o) => o.members || []),
      );
      const rows = await db.fetchOrganizationsWithMembers(orgType);
      setOrgs(Array.isArray(rows) ? rows : []);
      setCsvPanelOpen(false);
      setCsvText('');
      setCsvPreview(null);
      showNotice(`${created}件登録しました（${skipped}件スキップ）`);
    } catch (e) {
      setError(formatError(e, 'CSVインポートに失敗しました'));
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'rounded border border-gray-200 px-2 py-1 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200';

  return (
    <section>
      <div className="mb-4">
        <button
          type="button"
          onClick={() => {
            setCsvPanelOpen((open) => !open);
            if (csvPanelOpen) {
              setCsvPreview(null);
            }
          }}
          className="text-sm font-medium text-indigo-700 hover:text-indigo-900"
        >
          📥 CSVで一括登録 {csvPanelOpen ? '▲' : '▼'}
        </button>

        {csvPanelOpen ? (
          <div className="border border-dashed border-indigo-300 rounded-lg p-4 mb-4 bg-indigo-50 mt-3">
            <p className="text-sm font-bold text-indigo-900">📥 CSVで一括登録</p>
            <p className="mt-2 text-xs text-slate-600">
              フォーマット:
              <br />
              <code className="text-xs">organization_name,manager_name,phone_number,password</code>
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                ref={csvFileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleCsvFileChange}
              />
              <button
                type="button"
                onClick={() => csvFileInputRef.current?.click()}
                disabled={loading}
                className="rounded border border-indigo-300 bg-white px-3 py-1 text-sm text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
              >
                CSVファイルを選択
              </button>
              <span className="text-xs text-slate-500">or テキスト貼り付け:</span>
            </div>

            <textarea
              value={csvText}
              onChange={(e) => {
                setCsvText(e.target.value);
                setCsvPreview(null);
              }}
              rows={6}
              placeholder="organization_name,manager_name,phone_number,password"
              className="mt-2 w-full rounded border border-gray-200 bg-white p-2 text-sm font-mono outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200"
              disabled={loading}
            />

            <button
              type="button"
              onClick={handleCsvPreview}
              disabled={loading || !csvText.trim()}
              className="mt-3 bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-500 disabled:opacity-60"
            >
              プレビュー確認
            </button>

            {csvPreview ? (
              <div className="mt-4">
                <p className="text-xs font-bold text-slate-600 mb-2">▼ プレビュー結果</p>
                <div className="space-y-3">
                  {csvPreview.groups.map((group) => (
                    <div key={group.orgName}>
                      <p
                        className={
                          group.orgIsNew
                            ? 'text-green-700 font-medium'
                            : 'text-blue-700 font-medium'
                        }
                      >
                        {group.orgIsNew ? '🆕' : '➕'} {group.orgName}
                        {group.orgIsNew ? '（新規組織）' : '（既存組織）'}
                      </p>
                      <ul className="mt-1 space-y-0.5 pl-4">
                        {group.members.map((m, idx) => (
                          <li
                            key={`${group.orgName}-${m.phone}-${m.managerName}-${idx}`}
                            className={
                              m.phoneConflict
                                ? 'text-yellow-600 text-sm'
                                : 'text-green-600 text-sm'
                            }
                          >
                            {m.phoneConflict ? '⚠️' : '✅'}{' '}
                            {m.managerName || '—'} {m.phone || '—'}{' '}
                            {m.phoneConflict
                              ? '→ 電話番号重複・スキップ'
                              : group.orgIsNew
                                ? '→ 新規登録'
                                : '→ 追加登録'}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-sm text-slate-700">
                  新規登録: {csvPreview.importCount}件 / スキップ: {csvPreview.skipCount}件
                </p>
                <button
                  type="button"
                  onClick={() => void handleCsvImport()}
                  disabled={loading || csvPreview.importCount === 0}
                  className="mt-3 bg-indigo-600 text-white px-3 py-1 rounded text-sm hover:bg-indigo-500 disabled:opacity-60"
                >
                  この内容でインポート
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => {
            const prefix = orgType === 'contractor' ? 'contractors' : orgType;
            downloadOrgMembersExportCsv(orgs, prefix);
            showNotice(`${orgs.flatMap((o) => o.members || []).length}件をCSVでダウンロードしました`);
          }}
          disabled={loading || orgs.length === 0}
          className="rounded border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
        >
          CSVダウンロード
        </button>
      </div>

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

      {!loading && orgs.length > 0 ? (
        <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <label className="text-xs font-black text-slate-600" htmlFor={`org-search-${orgType}`}>
            {label}検索
          </label>
          <input
            id={`org-search-${orgType}`}
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-200 bg-white px-3 text-sm font-bold text-slate-900 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200"
            placeholder="会社名・フリガナ・担当者名・電話番号で検索"
          />
        </div>
      ) : null}

      {filteredOrgs.map((org) => {
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
                  <>
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
                    <button
                      type="button"
                      onClick={() => void handleDeleteOrg(org)}
                      disabled={loading}
                      className="text-red-500 hover:text-red-700 text-sm"
                    >
                      削除
                    </button>
                  </>
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
                          <p className="text-xs text-gray-600 sm:col-span-2">
                            会社名（組織名）: <span className="font-medium">{org.name}</span>
                          </p>
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
                          {orgType === 'contractor' ? (
                            <label className="block text-xs text-gray-600">
                              フリガナ
                              <input
                                type="text"
                                value={editingMember.furigana}
                                onChange={(e) =>
                                  setEditingMember((cur) =>
                                    cur ? { ...cur, furigana: e.target.value } : cur,
                                  )
                                }
                                className={`${inputClass} mt-1 w-full`}
                              />
                            </label>
                          ) : null}
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
                      {orgType === 'contractor' && member.furigana?.trim() ? (
                        <span className="min-w-[5rem] text-gray-500 text-xs">
                          {member.furigana}
                        </span>
                      ) : null}
                      <span className="min-w-[6rem] text-gray-700">
                        {member.company_name || org.name || '—'}
                      </span>
                      <span className="min-w-[7rem] text-gray-600">
                        {member.phone_number || '—'}
                      </span>
                      <div className="ml-auto flex gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingMember(memberToForm(member, org.name));
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
                    <p className="mb-2 text-xs text-gray-600">
                      会社名（組織名）: <span className="font-medium">{org.name}</span>
                    </p>
                    <div className="grid gap-2 sm:grid-cols-2">
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
                      {orgType === 'contractor' ? (
                        <label className="block text-xs text-gray-600">
                          フリガナ
                          <input
                            type="text"
                            value={newMember.furigana}
                            onChange={(e) =>
                              setNewMember((m) => ({ ...m, furigana: e.target.value }))
                            }
                            className={`${inputClass} mt-1 w-full`}
                          />
                        </label>
                      ) : null}
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

      {!loading && orgs.length > 0 && filteredOrgs.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
          検索条件に一致する{label}はありません。
        </p>
      ) : null}

      {!loading && orgs.length === 0 ? (
        <p className="text-sm text-gray-500">{label}が登録されていません</p>
      ) : null}
    </section>
  );
}
