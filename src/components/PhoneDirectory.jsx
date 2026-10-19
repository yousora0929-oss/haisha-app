import React, { useEffect, useMemo, useState } from 'react';
import * as db from '../haishaDb.js';
import {
  PHONE_DIRECTORY_LABELS,
  formatPhoneDirectoryDate,
  groupPhoneDirectoryRows,
  isPhoneDirectoryQuery,
  organizationTypeLabel,
  phoneDirectoryErrorMessage,
  unwrapCreatedOrganization,
} from '../utils/phoneDirectory.js';
import { formatPhoneAsYouType, formatPhoneJP } from '../utils/phoneFormat.js';

const fieldClass =
  'mt-1 min-h-[44px] w-full rounded-xl border-2 border-slate-300 bg-white px-3 text-base font-semibold text-slate-900 outline-none focus:border-sky-500';

function emptyPhoneForm(phone = '') {
  return { phone: formatPhoneAsYouType(phone), label: '代表', personName: '', note: '' };
}

function PhoneFormFields({ form, onChange, keypad }) {
  return (
    <div className="grid gap-3">
      <label className="text-xs font-black text-slate-600">
        電話番号
        <input
          type="text"
          inputMode={keypad ? 'numeric' : 'text'}
          value={form.phone}
          onChange={(event) => onChange({ ...form, phone: formatPhoneAsYouType(event.target.value) })}
          className={fieldClass}
          autoComplete="off"
        />
      </label>
      <label className="text-xs font-black text-slate-600">
        ラベル
        <select
          value={form.label}
          onChange={(event) => onChange({ ...form, label: event.target.value })}
          className={fieldClass}
        >
          {PHONE_DIRECTORY_LABELS.map((label) => (
            <option key={label} value={label}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs font-black text-slate-600">
        担当者名
        <input
          type="text"
          value={form.personName}
          onChange={(event) => onChange({ ...form, personName: event.target.value })}
          className={fieldClass}
        />
      </label>
      <label className="text-xs font-black text-slate-600">
        メモ
        <input
          type="text"
          value={form.note}
          onChange={(event) => onChange({ ...form, note: event.target.value })}
          className={fieldClass}
        />
      </label>
    </div>
  );
}

export function PhoneDirectory({ onClose }) {
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const [keypad, setKeypad] = useState(false);
  const [rows, setRows] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [step, setStep] = useState('search');
  const [formMode, setFormMode] = useState('create');
  const [editingId, setEditingId] = useState('');
  const [selectedOrg, setSelectedOrg] = useState(null);
  const [form, setForm] = useState(emptyPhoneForm);
  const [saving, setSaving] = useState(false);
  const [companyQuery, setCompanyQuery] = useState('');
  const [debouncedCompanyQuery, setDebouncedCompanyQuery] = useState('');
  const [companyRows, setCompanyRows] = useState([]);
  const [companySearching, setCompanySearching] = useState(false);
  const [newOrgType, setNewOrgType] = useState('contractor');
  const [existingNotice, setExistingNotice] = useState('');
  const [formReturnStep, setFormReturnStep] = useState('search');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(String(query || '').trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedCompanyQuery(String(companyQuery || '').trim()), 300);
    return () => window.clearTimeout(timer);
  }, [companyQuery]);

  useEffect(() => {
    if (!debouncedQuery) {
      setRows([]);
      setSearching(false);
      return undefined;
    }
    let cancelled = false;
    setSearching(true);
    setError('');
    db.searchPhoneDirectory(debouncedQuery, 30)
      .then((list) => {
        if (!cancelled) setRows(Array.isArray(list) ? list : []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[PhoneDirectory] search failed', err);
        setRows([]);
        setError(phoneDirectoryErrorMessage(err, '検索に失敗しました'));
      })
      .finally(() => {
        if (!cancelled) setSearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedQuery, reloadToken]);

  useEffect(() => {
    if (step !== 'company' || !debouncedCompanyQuery) {
      setCompanyRows([]);
      setCompanySearching(false);
      return undefined;
    }
    let cancelled = false;
    setCompanySearching(true);
    db.searchPhoneDirectory(debouncedCompanyQuery, 30)
      .then((list) => {
        if (!cancelled) setCompanyRows(Array.isArray(list) ? list : []);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('[PhoneDirectory] company search failed', err);
        setCompanyRows([]);
        setError(phoneDirectoryErrorMessage(err, '会社の検索に失敗しました'));
      })
      .finally(() => {
        if (!cancelled) setCompanySearching(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedCompanyQuery, step]);

  const groups = useMemo(() => groupPhoneDirectoryRows(rows), [rows]);
  const companyGroups = useMemo(() => groupPhoneDirectoryRows(companyRows), [companyRows]);
  const showRegisterButton =
    step === 'search' &&
    !searching &&
    !error &&
    debouncedQuery &&
    isPhoneDirectoryQuery(debouncedQuery) &&
    rows.length === 0;

  const returnToSearch = (nextQuery) => {
    setStep('search');
    setExistingNotice('');
    setSaving(false);
    if (nextQuery != null) setQuery(nextQuery);
    setReloadToken((token) => token + 1);
  };

  const startAdd = (org, phoneValue = '', notice = '', returnStep = 'search') => {
    setSelectedOrg(org);
    setFormMode('create');
    setEditingId('');
    setForm(emptyPhoneForm(phoneValue));
    setExistingNotice(notice);
    setFormReturnStep(returnStep);
    setError('');
    setStep('form');
  };

  const startEdit = (row) => {
    setSelectedOrg({
      id: row.organization_id,
      name: row.organization_name,
      type: row.organization_type,
    });
    setFormMode('edit');
    setEditingId(String(row.contact_phone_id || ''));
    setForm({
      phone: formatPhoneJP(row.phone_display || ''),
      label: PHONE_DIRECTORY_LABELS.includes(row.label) ? row.label : 'その他',
      personName: String(row.person_name || ''),
      note: String(row.note || ''),
    });
    setError('');
    setStep('form');
  };

  const openCompanyStep = (phoneValue) => {
    setCompanyQuery('');
    setCompanyRows([]);
    setNewOrgType('contractor');
    setForm(emptyPhoneForm(phoneValue));
    setSelectedOrg(null);
    setExistingNotice('');
    setError('');
    setStep('company');
  };

  const chooseCompany = (group) => {
    startAdd(
      { id: group.organizationId, name: group.organizationName, type: group.organizationType },
      form.phone,
      '',
      'company',
    );
  };

  const createCompany = async () => {
    const name = String(companyQuery || '').trim();
    if (!name) {
      setError('社名を入力してください');
      return;
    }
    const typeLabel = organizationTypeLabel(newOrgType) || '業者';
    const ok = window.confirm(
      `『${name}』を${typeLabel}として新規作成します。管理者の業者・商社管理にも表示されます`,
    );
    if (!ok) return;
    setSaving(true);
    setError('');
    try {
      const created = unwrapCreatedOrganization(
        await db.createOrganizationForPhone({ name, type: newOrgType }),
      );
      if (!created.organizationId) throw new Error('会社を作成できませんでした');
      startAdd(
        { id: created.organizationId, name, type: newOrgType },
        form.phone,
        created.created ? '' : `既存の『${name}』に登録します`,
        'company',
      );
    } catch (err) {
      console.warn('[PhoneDirectory] create organization failed', err);
      setError(phoneDirectoryErrorMessage(err, '会社を作成できませんでした'));
    } finally {
      setSaving(false);
    }
  };

  const savePhone = async () => {
    const phone = String(form.phone || '').trim();
    if (!phone) {
      setError('電話番号を入力してください');
      return;
    }
    setSaving(true);
    setError('');
    try {
      if (formMode === 'edit') {
        await db.updateContactPhone({
          id: editingId,
          phone,
          label: form.label,
          personName: form.personName,
          note: form.note,
        });
      } else {
        await db.registerContactPhone({
          organizationId: selectedOrg?.id,
          phone,
          label: form.label,
          personName: form.personName,
          note: form.note,
        });
      }
      returnToSearch(phone);
    } catch (err) {
      console.warn('[PhoneDirectory] save failed', err);
      setError(phoneDirectoryErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const removePhone = async (row) => {
    const label = formatPhoneJP(row.phone_display || '') || 'この番号';
    if (!window.confirm(`${label} を削除しますか？`)) return;
    setError('');
    try {
      await db.deleteContactPhone(row.contact_phone_id);
      setReloadToken((token) => token + 1);
    } catch (err) {
      console.warn('[PhoneDirectory] delete failed', err);
      setError(phoneDirectoryErrorMessage(err));
    }
  };

  return (
    <div className="flex max-h-[85vh] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-base font-black text-slate-900">電話帳</h2>
          <p className="mt-1 text-xs text-slate-500">社名、または電話番号の一部で探せます</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="min-h-[44px] rounded-lg px-3 text-sm font-bold text-slate-600 hover:bg-slate-100"
        >
          閉じる
        </button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {error ? (
          <p className="rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800" role="alert">
            {error}
          </p>
        ) : null}

        {step === 'search' ? (
          <>
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-black text-slate-600">検索</p>
              <button
                type="button"
                onClick={() => setKeypad((current) => !current)}
                className={
                  'min-h-[44px] rounded-xl border-2 px-3 text-sm font-black ' +
                  (keypad
                    ? 'border-sky-600 bg-sky-600 text-white'
                    : 'border-slate-300 bg-white text-slate-800')
                }
              >
                数字キーパッド
              </button>
            </div>
            <input
              type="text"
              inputMode={keypad ? 'numeric' : 'text'}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="社名 または 電話番号"
              className={fieldClass + ' mt-0'}
              autoComplete="off"
            />
            {searching ? <p className="text-xs font-bold text-slate-400">検索中…</p> : null}
            {showRegisterButton ? (
              <button
                type="button"
                onClick={() => openCompanyStep(debouncedQuery)}
                className="min-h-[44px] w-full rounded-xl border-2 border-sky-600 bg-sky-600 px-3 text-sm font-black text-white"
              >
                この番号を登録
              </button>
            ) : null}
            {!searching && debouncedQuery && !isPhoneDirectoryQuery(debouncedQuery) && groups.length === 0 && !error ? (
              <p className="text-sm font-bold text-slate-500">該当する会社がありません</p>
            ) : null}
            <ul className="space-y-3">
              {groups.map((group) => (
                <li key={group.key} className="rounded-2xl border-2 border-slate-200 p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-base font-black text-slate-900">{group.organizationName}</p>
                    {organizationTypeLabel(group.organizationType) ? (
                      <span className="rounded-full border border-indigo-300 bg-indigo-50 px-2 py-0.5 text-xs font-black text-indigo-800">
                        {organizationTypeLabel(group.organizationType)}
                      </span>
                    ) : null}
                    {group.orgCreatedByFactoryId ? (
                      <span className="rounded-full border border-amber-400 bg-amber-50 px-2 py-0.5 text-xs font-black text-amber-900">
                        工場登録
                      </span>
                    ) : null}
                  </div>
                  <ul className="mt-2 space-y-2">
                    {group.rows.map((row, index) => {
                      const source = String(row.source || '');
                      const key = String(row.contact_phone_id || row.customer_id || `${group.key}-${index}`);
                      return (
                        <li key={key} className="rounded-xl bg-slate-50 px-3 py-2">
                          {source === 'organization' ? (
                            <p className="text-sm font-bold text-slate-500">番号未登録</p>
                          ) : source === 'account' ? (
                            <>
                              <p className="text-sm font-black text-slate-900">
                                <span className="mr-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs">アカウント</span>
                                <span className="font-mono">{formatPhoneJP(row.phone_display || '')}</span>
                                {row.person_name ? <span className="ml-2">{row.person_name}</span> : null}
                              </p>
                            </>
                          ) : (
                            <>
                              <p className="text-sm font-black text-slate-900">
                                {row.label ? <span className="mr-2">{row.label}</span> : null}
                                <span className="font-mono">{formatPhoneJP(row.phone_display || '')}</span>
                                {row.person_name ? <span className="ml-2 font-bold">{row.person_name}</span> : null}
                              </p>
                              <p className="mt-1 text-xs font-bold text-slate-500">
                                登録：{row.registered_by_factory_name || '—'}{' '}
                                {formatPhoneDirectoryDate(row.registered_at)}
                              </p>
                            </>
                          )}
                          {row.can_edit && source !== 'account' && source !== 'organization' ? (
                            <div className="mt-2 flex gap-2">
                              <button
                                type="button"
                                onClick={() => startEdit(row)}
                                className="min-h-[44px] flex-1 rounded-xl border-2 border-slate-300 bg-white text-sm font-black text-slate-800"
                              >
                                修正
                              </button>
                              <button
                                type="button"
                                onClick={() => void removePhone(row)}
                                className="min-h-[44px] flex-1 rounded-xl border-2 border-red-300 bg-white text-sm font-black text-red-700"
                              >
                                削除
                              </button>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                  {group.organizationId ? (
                    <button
                      type="button"
                      onClick={() =>
                        startAdd({
                          id: group.organizationId,
                          name: group.organizationName,
                          type: group.organizationType,
                        })
                      }
                      className="mt-2 min-h-[44px] w-full rounded-xl border-2 border-sky-400 bg-sky-50 text-sm font-black text-sky-900"
                    >
                      この会社に番号を追加
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          </>
        ) : null}

        {step === 'company' ? (
          <div className="space-y-3">
            <p className="text-sm font-black text-slate-800">会社を選ぶ</p>
            {form.phone ? (
              <p className="text-xs font-bold text-slate-500">登録する番号：{form.phone}</p>
            ) : null}
            <label className="block text-xs font-black text-slate-600">
              社名
              <input
                type="text"
                value={companyQuery}
                onChange={(event) => setCompanyQuery(event.target.value)}
                className={fieldClass}
              />
            </label>
            {companySearching ? <p className="text-xs font-bold text-slate-400">検索中…</p> : null}
            <ul className="space-y-2">
              {companyGroups.map((group) => (
                <li key={group.key}>
                  <button
                    type="button"
                    onClick={() => chooseCompany(group)}
                    className="min-h-[44px] w-full rounded-xl border-2 border-slate-200 bg-slate-50 px-3 text-left text-sm font-black text-slate-900"
                  >
                    {group.organizationName}
                    {organizationTypeLabel(group.organizationType)
                      ? `（${organizationTypeLabel(group.organizationType)}）`
                      : ''}
                  </button>
                </li>
              ))}
            </ul>
            {debouncedCompanyQuery && !companySearching && companyGroups.length === 0 ? (
              <div className="rounded-2xl border-2 border-dashed border-slate-300 p-3">
                <p className="text-sm font-black text-slate-800">新しい会社を作る</p>
                <div className="mt-2 flex gap-2">
                  {[
                    ['contractor', '業者'],
                    ['agent', '商社'],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setNewOrgType(value)}
                      className={
                        'min-h-[44px] flex-1 rounded-xl border-2 text-sm font-black ' +
                        (newOrgType === value
                          ? 'border-sky-600 bg-sky-600 text-white'
                          : 'border-slate-300 bg-white text-slate-800')
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void createCompany()}
                  className="mt-3 min-h-[44px] w-full rounded-xl bg-indigo-600 text-sm font-black text-white disabled:opacity-60"
                >
                  {saving ? '作成中…' : `「${companyQuery.trim()}」を作成`}
                </button>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setStep('search')}
              className="min-h-[44px] w-full rounded-xl border-2 border-slate-300 text-sm font-black text-slate-700"
            >
              検索に戻る
            </button>
          </div>
        ) : null}

        {step === 'form' ? (
          <div className="space-y-3">
            <p className="text-sm font-black text-slate-900">
              {formMode === 'edit' ? '電話番号を修正' : '番号を登録'}
            </p>
            <p className="text-xs font-bold text-slate-500">{selectedOrg?.name}</p>
            {existingNotice ? (
              <p className="rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-bold text-amber-950">
                {existingNotice}
              </p>
            ) : null}
            <PhoneFormFields form={form} onChange={setForm} keypad={keypad} />
            <div className="flex gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={() => setStep(formMode === 'edit' ? 'search' : formReturnStep)}
                className="min-h-[44px] flex-1 rounded-xl border-2 border-slate-300 text-sm font-black text-slate-700"
              >
                戻る
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void savePhone()}
                className="min-h-[44px] flex-1 rounded-xl bg-sky-600 text-sm font-black text-white disabled:opacity-60"
              >
                {saving ? '保存中…' : '保存'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
