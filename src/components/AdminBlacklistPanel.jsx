import React, { useEffect, useMemo, useState } from 'react';
import * as db from '../haishaDb.js';
import { formatPhoneAsYouType } from '../utils/phoneFormat.js';
import { phoneDirectoryErrorMessage, unwrapCreatedOrganization } from '../utils/phoneDirectory.js';

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

export function organizationTypeLabel(type) {
  if (type === 'contractor') return '業者';
  if (type === 'agent') return '商社';
  return '';
}

/** 社名の部分一致。登録済みは候補に残し、選択不可フラグを付ける。 */
export function filterOrganizationCandidates(organizations, query, blacklistById = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  return (organizations || [])
    .filter((org) => org && (org.type === 'agent' || org.type === 'contractor'))
    .filter((org) => {
      const name = String(org.name || '').toLowerCase();
      const furigana = String(org.furigana || '').toLowerCase();
      return name.includes(q) || (furigana && furigana.includes(q));
    })
    .slice(0, 12)
    .map((org) => ({
      id: String(org.id),
      name: String(org.name || ''),
      type: String(org.type || ''),
      listed: Boolean(blacklistById[String(org.id)]),
    }));
}

const textButtonClass = 'h-8 shrink-0 px-1 text-xs font-bold hover:underline disabled:opacity-50';

export function isDuplicatePhoneError(err) {
  const msg = [err?.message, err?.details, err?.hint].map((value) => String(value || '')).join('\n');
  return msg.includes('duplicate phone');
}

/**
 * 新規作成 → ブラックリスト追加 → 電話番号、の順。
 * 会社作成後にブラックリストが失敗しても会社は消さない。
 */
export async function submitBlacklistAdd({
  selection,
  reason = '',
  phone = '',
  createdBy = '',
  blacklistById = {},
  createOrganization,
  addBlacklist,
  registerPhone,
} = {}) {
  const result = {
    status: 'ok',
    organizationId: '',
    notice: '',
    error: '',
    phoneWarning: '',
    createdCompany: false,
  };
  const listed = (organizationId) => Boolean(blacklistById[String(organizationId || '')]);
  let organizationId = String(selection?.id || '');
  let createdCompany = false;

  if (selection?.isNew) {
    const created = unwrapCreatedOrganization(
      await createOrganization({ name: selection.name, type: selection.type || 'contractor' }),
    );
    if (!created.organizationId) {
      result.status = 'failed';
      result.error = '会社を作成できませんでした';
      return result;
    }
    organizationId = created.organizationId;
    createdCompany = created.created === true;
    result.organizationId = organizationId;
    result.createdCompany = createdCompany;
    if (!created.created) {
      result.notice = `既存の『${selection.name}』に登録します`;
      if (listed(organizationId)) {
        result.status = 'stopped';
        result.error = '登録済みです';
        return result;
      }
    }
  } else {
    result.organizationId = organizationId;
    if (!organizationId || selection?.listed || listed(organizationId)) {
      result.status = 'stopped';
      result.error = '登録済みです';
      return result;
    }
  }

  try {
    await addBlacklist({ organizationId, reason, createdBy });
  } catch (err) {
    result.status = 'failed';
    result.error = createdCompany
      ? '会社は作成しましたが、ブラックリスト登録に失敗しました'
      : String(err?.message || '').trim() || 'ブラックリストに追加できませんでした';
    return result;
  }

  const trimmedPhone = String(phone || '').trim();
  if (trimmedPhone) {
    try {
      await registerPhone({ organizationId, phone: trimmedPhone, label: '代表' });
    } catch (err) {
      if (!isDuplicatePhoneError(err)) {
        result.phoneWarning = `電話番号は登録できませんでした：${phoneDirectoryErrorMessage(err)}`;
      }
    }
  }
  return result;
}

export function AdminBlacklistPanel({
  adminName = '',
  blacklistById = {},
  onChanged,
  onFocusOrganization,
  organizations = null,
}) {
  const [open, setOpen] = useState(false);
  const [directory, setDirectory] = useState(() => (Array.isArray(organizations) ? organizations : []));
  const [directoryError, setDirectoryError] = useState('');
  const [reasonOpenId, setReasonOpenId] = useState('');
  const [editingId, setEditingId] = useState('');
  const [editReason, setEditReason] = useState('');
  const [savingId, setSavingId] = useState('');
  const [rowError, setRowError] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [addQuery, setAddQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const [addReason, setAddReason] = useState('');
  const [addPhone, setAddPhone] = useState('');
  const [addError, setAddError] = useState('');
  const [addNotice, setAddNotice] = useState('');
  const [addPhoneWarning, setAddPhoneWarning] = useState('');
  const [adding, setAdding] = useState(false);
  const [directoryVersion, setDirectoryVersion] = useState(0);

  useEffect(() => {
    if (Array.isArray(organizations)) {
      setDirectory(organizations);
      return undefined;
    }
    let cancelled = false;
    db.fetchOrganizations()
      .then((rows) => {
        if (cancelled) return;
        setDirectory((rows || []).filter((org) => org.type === 'agent' || org.type === 'contractor'));
        setDirectoryError('');
      })
      .catch((err) => {
        console.warn('[AdminBlacklistPanel] organization fetch failed', err);
        if (!cancelled) setDirectoryError('会社一覧を読み込めませんでした');
      });
    return () => {
      cancelled = true;
    };
  }, [organizations, directoryVersion]);

  const rows = useMemo(() => {
    const byId = new Map((directory || []).map((org) => [String(org.id), org]));
    return Object.values(blacklistById || {})
      .filter((entry) => entry?.organization_id)
      .map((entry) => {
        const org = byId.get(String(entry.organization_id));
        return {
          id: String(entry.organization_id),
          name: org?.name || '（不明な会社）',
          type: org?.type || '',
          reason: String(entry.reason || '').trim(),
          createdAt: entry.created_at,
          createdBy: String(entry.created_by || '').trim() || '管理者',
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }, [blacklistById, directory]);

  const candidates = useMemo(
    () => filterOrganizationCandidates(directory, addQuery, blacklistById),
    [directory, addQuery, blacklistById],
  );

  const openAdd = () => {
    setAddQuery('');
    setSelected(null);
    setAddReason('');
    setAddPhone('');
    setAddError('');
    setAddNotice('');
    setAddPhoneWarning('');
    setAddOpen(true);
  };

  const closeAdd = () => {
    if (adding) return;
    setAddOpen(false);
  };

  const saveReason = async (organizationId) => {
    setSavingId(organizationId);
    setRowError('');
    try {
      await db.updateOrganizationBlacklist({ organizationId, reason: editReason });
      setEditingId('');
      await onChanged?.();
    } catch (err) {
      console.warn('[AdminBlacklistPanel] update failed', err);
      setRowError(err?.message || '理由を保存できませんでした');
    } finally {
      setSavingId('');
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`『${row.name}』のブラックリストを解除しますか？`)) return;
    setSavingId(row.id);
    setRowError('');
    try {
      await db.removeOrganizationBlacklist(row.id);
      if (editingId === row.id) setEditingId('');
      await onChanged?.();
    } catch (err) {
      console.warn('[AdminBlacklistPanel] delete failed', err);
      setRowError(err?.message || 'ブラックリストを解除できませんでした');
    } finally {
      setSavingId('');
    }
  };

  const reloadLists = async () => {
    setDirectoryVersion((current) => current + 1);
    await onChanged?.();
  };

  const add = async () => {
    if (!selected || selected.listed) return;
    if (!selected.isNew && !selected.id) return;
    setAdding(true);
    setAddError('');
    setAddNotice('');
    setAddPhoneWarning('');
    try {
      const result = await submitBlacklistAdd({
        selection: selected,
        reason: addReason,
        phone: addPhone,
        createdBy: adminName,
        blacklistById,
        createOrganization: (input) => db.createOrganizationForPhone(input),
        addBlacklist: (input) => db.addOrganizationBlacklist(input),
        registerPhone: (input) => db.registerContactPhone(input),
      });
      if (result.notice) setAddNotice(result.notice);
      if (result.phoneWarning) setAddPhoneWarning(result.phoneWarning);
      if (result.error) setAddError(result.error);
      if (result.status === 'ok' || result.createdCompany) {
        setOpen(true);
        await reloadLists();
      }
      if (result.status === 'ok' && !result.notice && !result.phoneWarning) {
        setAddOpen(false);
      }
    } catch (err) {
      console.warn('[AdminBlacklistPanel] insert failed', err);
      setAddError(err?.message || 'ブラックリストに追加できませんでした');
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <div className="inline-flex h-8 items-center rounded border border-slate-300 bg-white">
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          className="inline-flex h-full items-center gap-1 px-2 text-xs font-bold hover:bg-slate-50"
          aria-expanded={open}
        >
          <span className="text-slate-400">{open ? '▼' : '▶'}</span>
          <span className={rows.length > 0 ? 'text-red-700' : 'text-slate-800'}>
            ブラックリスト（{rows.length}件）
          </span>
        </button>
        <button type="button" onClick={openAdd} className="h-full shrink-0 border-l border-slate-300 px-2 text-xs font-bold text-indigo-700 hover:bg-slate-50 disabled:opacity-50">
          ＋追加
        </button>
      </div>
      {open ? (
        <div className="basis-full rounded-lg border border-slate-200 bg-white">
          {directoryError ? <p className="px-3 py-2 text-xs font-bold text-red-700">{directoryError}</p> : null}
          {rowError ? <p className="px-3 py-2 text-xs font-bold text-red-700">{rowError}</p> : null}
          {rows.length === 0 ? (
            <p className="px-3 py-2 text-xs font-bold text-slate-500">登録なし</p>
          ) : (
            <ul>
              {rows.map((row) => {
                const typeLabel = organizationTypeLabel(row.type);
                const reasonShown = row.reason || '未入力';
                const editing = editingId === row.id;
                return (
                  <li key={row.id} className="border-t border-slate-100 px-3 py-1 first:border-t-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onFocusOrganization?.(row.id)}
                        className="h-8 max-w-[12rem] truncate text-left text-xs font-bold text-slate-900 hover:underline"
                      >
                        {row.name}
                      </button>
                      {typeLabel ? (
                        <span className="shrink-0 rounded-full border border-slate-300 bg-slate-50 px-2 text-[11px] font-bold text-slate-700">
                          {typeLabel}
                        </span>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => setReasonOpenId((current) => (current === row.id ? '' : row.id))}
                        className="h-8 min-w-0 flex-1 truncate text-left text-xs font-bold text-slate-600"
                        title={reasonShown}
                      >
                        {reasonShown}
                      </button>
                      <span className="shrink-0 text-[11px] font-bold text-slate-500">{formatJstDate(row.createdAt)}</span>
                      <span className="max-w-[6rem] shrink-0 truncate text-[11px] font-bold text-slate-500">
                        {row.createdBy}
                      </span>
                      <button
                        type="button"
                        disabled={savingId === row.id}
                        onClick={() => {
                          setEditReason(row.reason);
                          setEditingId(row.id);
                          setRowError('');
                        }}
                        className={textButtonClass + ' text-indigo-700'}
                      >
                        理由を編集
                      </button>
                      <button
                        type="button"
                        disabled={savingId === row.id}
                        onClick={() => void remove(row)}
                        className={textButtonClass + ' text-red-600'}
                      >
                        解除
                      </button>
                    </div>
                    {reasonOpenId === row.id && !editing ? (
                      <p className="whitespace-pre-wrap pb-1 text-xs font-bold text-slate-700">{reasonShown}</p>
                    ) : null}
                    {editing ? (
                      <div className="pb-2">
                        <textarea
                          value={editReason}
                          onChange={(event) => setEditReason(event.target.value)}
                          rows={3}
                          className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-xs font-bold text-slate-900"
                        />
                        <div className="mt-1 flex gap-2">
                          <button
                            type="button"
                            disabled={savingId === row.id}
                            onClick={() => void saveReason(row.id)}
                            className={textButtonClass + ' text-indigo-700'}
                          >
                            {savingId === row.id ? '保存中…' : '保存'}
                          </button>
                          <button
                            type="button"
                            disabled={savingId === row.id}
                            onClick={() => setEditingId('')}
                            className={textButtonClass + ' text-slate-600'}
                          >
                            キャンセル
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}

      {addOpen ? (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 px-4 py-16" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="ブラックリストに追加"
            className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-4 shadow-lg"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-black text-slate-900">ブラックリストに追加</h3>
              <button type="button" onClick={closeAdd} className={textButtonClass + ' text-slate-600'}>
                閉じる
              </button>
            </div>
            {addNotice ? <p className="mt-2 text-xs font-bold text-amber-800">{addNotice}</p> : null}
            {addError ? <p className="mt-2 text-xs font-bold text-red-700">{addError}</p> : null}
            {addPhoneWarning ? <p className="mt-2 text-xs font-bold text-red-700">{addPhoneWarning}</p> : null}
            <label className="mt-3 block text-xs font-bold text-slate-600">
              社名
              <input
                type="text"
                value={selected ? selected.name : addQuery}
                onChange={(event) => {
                  setSelected(null);
                  setAddQuery(event.target.value);
                  setAddNotice('');
                  setAddError('');
                  setAddPhoneWarning('');
                }}
                className="mt-1 h-8 w-full rounded-lg border border-slate-300 px-2 text-sm font-bold text-slate-900"
                placeholder="社名の一部"
              />
            </label>
            {!selected && addQuery.trim() ? (
              <ul className="mt-2 max-h-48 overflow-y-auto rounded-lg border border-slate-200">
                {candidates.length === 0 ? (
                  <li className="px-2 py-2 text-xs font-bold text-slate-500">該当する会社がありません</li>
                ) : (
                  candidates.map((candidate) => (
                    <li key={candidate.id} className="border-t border-slate-100 first:border-t-0">
                      <button
                        type="button"
                        disabled={candidate.listed}
                        onClick={() => setSelected(candidate)}
                        className="flex h-8 w-full items-center gap-2 px-2 text-left text-xs font-bold text-slate-900 disabled:text-slate-400"
                      >
                        <span className="min-w-0 flex-1 truncate">{candidate.name}</span>
                        {organizationTypeLabel(candidate.type) ? (
                          <span className="shrink-0 rounded-full border border-slate-300 px-2 text-[11px] text-slate-600">
                            {organizationTypeLabel(candidate.type)}
                          </span>
                        ) : null}
                        {candidate.listed ? <span className="shrink-0 text-[11px] text-slate-500">登録済み</span> : null}
                      </button>
                    </li>
                  ))
                )}
                <li className="border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() =>
                      setSelected({ isNew: true, name: addQuery.trim(), type: 'contractor' })
                    }
                    className="flex h-8 w-full items-center px-2 text-left text-xs font-bold text-indigo-700"
                  >
                    『{addQuery.trim()}』を新しい会社として登録
                  </button>
                </li>
              </ul>
            ) : null}
            {selected?.isNew ? (
              <div className="mt-3">
                <p className="text-xs font-bold text-slate-600">種別</p>
                <div className="mt-1 flex gap-2">
                  {[
                    ['contractor', '業者'],
                    ['agent', '商社'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setSelected((current) => (current ? { ...current, type: value } : current))}
                      className={
                        'h-8 rounded border px-2 text-xs font-bold ' +
                        (selected.type === value
                          ? 'border-indigo-600 text-indigo-800'
                          : 'border-slate-300 text-slate-600')
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {selected ? (
              <>
                <label className="mt-3 block text-xs font-bold text-slate-600">
                  理由（任意）
                  <textarea
                    value={addReason}
                    onChange={(event) => setAddReason(event.target.value)}
                    rows={3}
                    className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1 text-sm font-bold text-slate-900"
                  />
                </label>
                <label className="mt-3 block text-xs font-bold text-slate-600">
                  電話番号（任意）
                  <input
                    type="tel"
                    value={addPhone}
                    onChange={(event) => setAddPhone(formatPhoneAsYouType(event.target.value))}
                    className="mt-1 h-8 w-full rounded-lg border border-slate-300 px-2 text-sm font-bold text-slate-900"
                    placeholder="097-000-0000"
                  />
                </label>
              </>
            ) : null}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" onClick={closeAdd} className={textButtonClass + ' text-slate-600'}>
                キャンセル
              </button>
              <button
                type="button"
                disabled={!selected || selected.listed || adding || (!selected.isNew && !selected.id)}
                onClick={() => void add()}
                className={textButtonClass + ' text-indigo-700'}
              >
                {adding ? '追加中…' : '追加'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
