import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as db from '../haishaDb.js';
import { downloadOrgMembersExportCsv } from '../utils/adminCsvImport.js';
import { generateInitialMemberPassword } from '../utils/generatePassword.js';
import { formatPhoneNumberJP } from '../utils/phoneFormat.js';
import { normalizeSuggestSearchText } from '../utils/normalizeSuggestSearchText.js';

const emptyMember = () => ({
  companyName: '',
  furigana: '',
  managerName: '',
  phone: '',
  password: '',
  canImportSchedule: false,
});

const newMemberWithGeneratedPassword = () => ({
  ...emptyMember(),
  password: generateInitialMemberPassword(),
});

function formatContractorLabel(customer) {
  const company = String(customer?.company_name || customer?.name || '').trim();
  const manager = String(customer?.manager_name || '').trim();
  if (company && manager) return `${company}（${manager}）`;
  return company || manager || '—';
}

function ContractorLinksChecklist({
  contractors,
  selectedIds,
  onToggle,
  filterText,
  onFilterChange,
  inputClass,
}) {
  const selectedCount = selectedIds.size;
  const filtered = useMemo(() => {
    const q = normalizeSuggestSearchText(filterText);
    const list = Array.isArray(contractors) ? contractors : [];
    if (!q) return list;
    return list.filter((c) => {
      const texts = [c.company_name, c.name, c.furigana, c.manager_name, c.phone_number];
      return texts.some((t) => normalizeSuggestSearchText(t).includes(q));
    });
  }, [contractors, filterText]);

  return (
    <div className="mt-3 rounded border border-slate-200 bg-white p-3 sm:col-span-2">
      <p className="text-xs font-bold text-slate-700">
        取引業者（{selectedCount}件選択中）
      </p>
      <input
        type="text"
        value={filterText}
        onChange={(e) => onFilterChange(e.target.value)}
        placeholder="会社名・フリガナ・担当者名で絞り込み"
        className={`${inputClass} mt-2 w-full`}
      />
      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto overscroll-contain rounded border border-slate-100 bg-slate-50 p-2">
        {filtered.length === 0 ? (
          <li className="px-1 py-2 text-xs text-slate-500">該当する業者がありません</li>
        ) : (
          filtered.map((c) => {
            const id = String(c.id);
            const checked = selectedIds.has(id);
            const label = formatContractorLabel(c);
            return (
              <li key={id}>
                <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 hover:bg-white">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(id)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600"
                  />
                  <span className="text-xs font-medium text-slate-800">{label}</span>
                </label>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

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
      // 5列目は任意のフリガナ（旧4列フォーマットとの後方互換のため末尾に追加）
      furigana: (parts[4] ?? '').trim(),
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
    canImportSchedule: Boolean(member.can_import_schedule),
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
  const [newOrgFurigana, setNewOrgFurigana] = useState('');
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
  const [contractors, setContractors] = useState([]);
  const [linkCountByAgentId, setLinkCountByAgentId] = useState({});
  const [selectedLinkContractorIds, setSelectedLinkContractorIds] = useState(() => new Set());
  const [initialLinkContractorIds, setInitialLinkContractorIds] = useState(() => new Set());
  const [contractorListFilter, setContractorListFilter] = useState('');
  const csvFileInputRef = useRef(null);

  const isAgentOrg = orgType === 'agent';

  const filteredOrgs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return orgs;
    return orgs.filter((org) => {
      if (String(org.name || '').toLowerCase().includes(q)) return true;
      if (String(org.furigana || '').toLowerCase().includes(q)) return true;
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
      const list = Array.isArray(rows) ? rows : [];
      setOrgs(list);

      if (orgType === 'agent') {
        const [allCustomers, links] = await Promise.all([
          db.fetchCustomers(),
          db.fetchAgentContractorLinksByAgentIds(
            list.flatMap((o) => (o.members || []).map((m) => m.id)),
          ),
        ]);
        const contractorList = (allCustomers || [])
          .filter((c) => (c.role ?? 'contractor') === 'contractor')
          .slice()
          .sort((a, b) =>
            String(a.company_name || a.name || '').localeCompare(
              String(b.company_name || b.name || ''),
              'ja',
            ),
          );
        setContractors(contractorList);
        const counts = {};
        for (const link of links || []) {
          const aid = String(link.agent_customer_id || '');
          if (!aid) continue;
          counts[aid] = (counts[aid] || 0) + 1;
        }
        setLinkCountByAgentId(counts);
      } else {
        setContractors([]);
        setLinkCountByAgentId({});
      }
    } catch (e) {
      setError(formatError(e, `${label}一覧の取得に失敗しました`));
    } finally {
      setLoading(false);
    }
  }, [orgType, label]);

  const toggleLinkContractor = useCallback((contractorId) => {
    const id = String(contractorId || '').trim();
    if (!id) return;
    setSelectedLinkContractorIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const resetMemberLinkState = useCallback(() => {
    setSelectedLinkContractorIds(new Set());
    setInitialLinkContractorIds(new Set());
    setContractorListFilter('');
  }, []);

  const beginEditMember = useCallback(
    async (member, orgName) => {
      setEditingMember(memberToForm(member, orgName));
      setAddingMemberId(null);
      setError('');
      setContractorListFilter('');
      if (orgType !== 'agent') {
        resetMemberLinkState();
        return;
      }
      try {
        const links = await db.fetchAgentContractorLinksByAgentIds([member.id]);
        const ids = new Set((links || []).map((l) => String(l.contractor_customer_id)));
        setSelectedLinkContractorIds(ids);
        setInitialLinkContractorIds(new Set(ids));
      } catch (e) {
        setSelectedLinkContractorIds(new Set());
        setInitialLinkContractorIds(new Set());
        setError(formatError(e, '取引業者の取得に失敗しました'));
      }
    },
    [orgType, resetMemberLinkState],
  );

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
      const created = await db.createOrganization(name, orgType, {
        furigana: newOrgFurigana,
      });
      setOrgs((prev) => [...prev, { ...created, members: [] }]);
      setNewOrgName('');
      setNewOrgFurigana('');
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
      // 組織名・フリガナのみ同期し、種別や所属組合は現在値を維持する。
      await db.updateOrganization(editingOrg.id, {
        name,
        furigana: editingOrg.furigana,
      });
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
                furigana: String(editingOrg.furigana || '').trim() || null,
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
        canImportSchedule: newMember.canImportSchedule,
      });
      let linkError = null;
      if (isAgentOrg && selectedLinkContractorIds.size > 0) {
        try {
          await db.syncAgentContractorLinks(created.id, [...selectedLinkContractorIds]);
          setLinkCountByAgentId((prev) => ({
            ...prev,
            [String(created.id)]: selectedLinkContractorIds.size,
          }));
        } catch (e) {
          linkError = e;
        }
      }
      setOrgs((prev) =>
        prev.map((o) =>
          o.id === organizationId
            ? { ...o, members: [...(o.members || []), created] }
            : o,
        ),
      );
      setAddingMemberId(null);
      setNewMember(emptyMember());
      resetMemberLinkState();
      if (linkError) {
        setError(
          '担当者は保存されましたが、取引業者の更新に失敗しました: ' +
            formatError(linkError, '不明なエラー'),
        );
      } else {
        showNotice('担当者を登録しました');
      }
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
        canImportSchedule: editingMember.canImportSchedule,
      });
      let linkError = null;
      if (isAgentOrg) {
        const nextIds = [...selectedLinkContractorIds];
        const prevIds = initialLinkContractorIds;
        const changed =
          nextIds.length !== prevIds.size || nextIds.some((id) => !prevIds.has(id));
        if (changed) {
          try {
            await db.syncAgentContractorLinks(editingMember.id, nextIds);
            setLinkCountByAgentId((prev) => ({
              ...prev,
              [String(editingMember.id)]: nextIds.length,
            }));
          } catch (e) {
            linkError = e;
          }
        }
      }
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
                  can_import_schedule: Boolean(editingMember.canImportSchedule),
                }
              : m,
          ),
        })),
      );
      setEditingMember(null);
      resetMemberLinkState();
      if (linkError) {
        setError(
          '担当者は保存されましたが、取引業者の更新に失敗しました: ' +
            formatError(linkError, '不明なエラー'),
        );
      } else {
        showNotice('担当者を更新しました');
      }
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
      setLinkCountByAgentId((prev) => {
        const next = { ...prev };
        delete next[String(member.id)];
        return next;
      });
      if (editingMember?.id === member.id) {
        setEditingMember(null);
        resetMemberLinkState();
      }
      showNotice(`「${name}」を削除しました`);
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
            furigana: m.furigana,
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
              <code className="text-xs">organization_name,manager_name,phone_number,password,furigana</code>
              <br />
              <span className="text-[11px] text-slate-500">
                furigana（フリガナ）列は任意です。無い・空のCSVも従来どおり取り込めます。
              </span>
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
              placeholder="organization_name,manager_name,phone_number,password,furigana"
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
                            {m.managerName || '—'}
                            {m.furigana ? `（${m.furigana}）` : ''} {m.phone || '—'}{' '}
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
              setNewOrgFurigana('');
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
            <input
              type="text"
              value={newOrgFurigana}
              onChange={(e) => setNewOrgFurigana(e.target.value)}
              placeholder="フリガナ（任意）"
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
                setNewOrgFurigana('');
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
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
                    <input
                      type="text"
                      value={editingOrg.name}
                      onChange={(e) =>
                        setEditingOrg((cur) => (cur ? { ...cur, name: e.target.value } : cur))
                      }
                      placeholder="組織名"
                      className={`${inputClass} min-w-[12rem] flex-1`}
                      disabled={loading}
                    />
                    <input
                      type="text"
                      value={editingOrg.furigana ?? ''}
                      onChange={(e) =>
                        setEditingOrg((cur) => (cur ? { ...cur, furigana: e.target.value } : cur))
                      }
                      placeholder="フリガナ（任意）"
                      className={`${inputClass} min-w-[10rem] flex-1`}
                      disabled={loading}
                    />
                  </div>
                ) : (
                  <span className="font-semibold text-slate-900 truncate">
                    {org.name}
                    {org.furigana?.trim() ? (
                      <span className="ml-2 text-sm font-normal text-slate-500">（{org.furigana}）</span>
                    ) : null}
                  </span>
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
                        setEditingOrg({ id: org.id, name: org.name, furigana: org.furigana ?? '' });
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
                              placeholder={
                                isAgentOrg
                                  ? '空欄の場合は会社の代表窓口として登録されます'
                                  : undefined
                              }
                              className={`${inputClass} mt-1 w-full`}
                            />
                            {isAgentOrg ? (
                              <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">
                                空欄の場合は会社の代表窓口として登録されます
                              </span>
                            ) : null}
                          </label>
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
                          <label className="flex items-start gap-2 text-xs font-bold text-slate-700 sm:col-span-2">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4"
                              checked={Boolean(editingMember.canImportSchedule)}
                              onChange={(e) =>
                                setEditingMember((cur) =>
                                  cur ? { ...cur, canImportSchedule: e.target.checked } : cur,
                                )
                              }
                            />
                            <span>
                              スケジュール取込を許可する
                              <span className="mt-0.5 block font-medium text-slate-500">
                                ON のとき DispatchApp に「スケジュール取込」タブが表示されます
                              </span>
                            </span>
                          </label>
                          {isAgentOrg ? (
                            <ContractorLinksChecklist
                              contractors={contractors}
                              selectedIds={selectedLinkContractorIds}
                              onToggle={toggleLinkContractor}
                              filterText={contractorListFilter}
                              onFilterChange={setContractorListFilter}
                              inputClass={inputClass}
                            />
                          ) : null}
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
                            onClick={() => {
                              setEditingMember(null);
                              resetMemberLinkState();
                            }}
                            disabled={loading}
                            className="text-sm text-gray-600 hover:text-gray-800"
                          >
                            キャンセル
                          </button>
                        </div>
                      </div>
                    );
                  }

                  const linkCount = linkCountByAgentId[String(member.id)] || 0;
                  return (
                    <div
                      key={member.id}
                      className="flex flex-wrap items-center gap-3 py-2 border-b border-gray-100 text-sm"
                    >
                      <span className="flex min-w-[5rem] flex-wrap items-center gap-1.5 font-medium">
                        {member.manager_name?.trim() ? (
                          member.manager_name
                        ) : isAgentOrg ? (
                          <>
                            <span className="text-slate-500">—</span>
                            <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[11px] font-bold text-slate-600">
                              代表窓口
                            </span>
                          </>
                        ) : (
                          '—'
                        )}
                      </span>
                      {member.furigana?.trim() ? (
                        <span className="min-w-[5rem] text-gray-500 text-xs">
                          {member.furigana}
                        </span>
                      ) : null}
                      <span className="min-w-[6rem] text-gray-700">
                        {member.company_name || org.name || '—'}
                      </span>
                      <span className="min-w-[7rem] text-gray-600">
                        {member.phone_number ? formatPhoneNumberJP(member.phone_number) : '—'}
                      </span>
                      {isAgentOrg ? (
                        <span
                          className={
                            linkCount > 0
                              ? 'rounded-full bg-indigo-100 px-2 py-0.5 text-[11px] font-bold text-indigo-800'
                              : 'rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500'
                          }
                        >
                          {linkCount > 0 ? `取引業者 ${linkCount}` : '未設定'}
                        </span>
                      ) : null}
                      <div className="ml-auto flex gap-2">
                        <button
                          type="button"
                          onClick={() => void beginEditMember(member, org.name)}
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
                          placeholder={
                            isAgentOrg
                              ? '空欄の場合は会社の代表窓口として登録されます'
                              : undefined
                          }
                          className={`${inputClass} mt-1 w-full`}
                        />
                        {isAgentOrg ? (
                          <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">
                            空欄の場合は会社の代表窓口として登録されます
                          </span>
                        ) : null}
                      </label>
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
                        <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">
                          自動生成されています。先方の希望があれば書き換えてください。
                        </span>
                      </label>
                      <label className="flex items-start gap-2 text-xs font-bold text-slate-700 sm:col-span-2">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4"
                          checked={Boolean(newMember.canImportSchedule)}
                          onChange={(e) =>
                            setNewMember((m) => ({ ...m, canImportSchedule: e.target.checked }))
                          }
                        />
                        <span>
                          スケジュール取込を許可する
                          <span className="mt-0.5 block font-medium text-slate-500">
                            ON のとき DispatchApp に「スケジュール取込」タブが表示されます
                          </span>
                        </span>
                      </label>
                      {isAgentOrg ? (
                        <ContractorLinksChecklist
                          contractors={contractors}
                          selectedIds={selectedLinkContractorIds}
                          onToggle={toggleLinkContractor}
                          filterText={contractorListFilter}
                          onFilterChange={setContractorListFilter}
                          inputClass={inputClass}
                        />
                      ) : null}
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
                          resetMemberLinkState();
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
                      setNewMember(newMemberWithGeneratedPassword());
                      setEditingMember(null);
                      resetMemberLinkState();
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
