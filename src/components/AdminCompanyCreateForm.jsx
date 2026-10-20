import React, { useMemo, useState } from 'react';
import { generateInitialMemberPassword } from '../utils/generatePassword.js';
import { formatPhoneAsYouType, formatPhoneJP } from '../utils/phoneFormat.js';
import {
  buildCompanyCreatePayload,
  formatLoginCredentialCopy,
  suggestSimilarCompanies,
  validateCompanyCreateForm,
} from '../utils/companyCreateForm.js';

const fieldClass =
  'mt-1 min-h-[40px] w-full rounded border border-gray-200 bg-white px-2 py-1 text-sm outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-200';

function nextMemberKey() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `member-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextPassword(current) {
  let next = generateInitialMemberPassword();
  for (let i = 0; i < 8 && next === current; i += 1) {
    next = generateInitialMemberPassword();
  }
  return next;
}

function emptyMember() {
  return { key: nextMemberKey(), name: '', phone: '', login: false, password: '' };
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

export function CreatedLoginDialog({ rows, onClose }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState('');
  const list = Array.isArray(rows) ? rows : [];

  const handleCopyAll = async () => {
    const ok = await copyText(formatLoginCredentialCopy(list));
    setCopied(ok);
    setCopyError(ok ? '' : 'コピーに失敗しました');
    if (ok) window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="company-login-dialog-title"
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border-2 border-indigo-300 bg-white p-5 shadow-2xl"
      >
        <h3 id="company-login-dialog-title" className="text-lg font-black text-slate-900">
          ログイン情報
        </h3>
        <p className="mt-2 text-sm font-bold text-amber-800">
          この画面を閉じるとパスワードは再表示できません。担当者へ伝えてください
        </p>
        <ul className="mt-4 space-y-3">
          {list.map((row, index) => (
            <li
              key={`${row.name}-${row.phone}-${index}`}
              className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3"
            >
              <p className="text-xs font-bold text-slate-500">氏名</p>
              <p className="text-sm font-black text-slate-900">{row.name}</p>
              <p className="mt-2 text-xs font-bold text-slate-500">電話番号</p>
              <p className="font-mono text-sm text-slate-800">{formatPhoneJP(row.phone) || row.phone}</p>
              <p className="mt-2 text-xs font-bold text-slate-500">パスワード</p>
              <p className="font-mono text-2xl font-black tracking-wider text-indigo-700">{row.password}</p>
            </li>
          ))}
        </ul>
        {copyError ? <p className="mt-3 text-sm font-bold text-red-700">{copyError}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void handleCopyAll()}
            className="min-h-[44px] rounded-lg border-2 border-indigo-300 bg-indigo-50 px-4 text-sm font-black text-indigo-800 hover:bg-indigo-100"
          >
            {copied ? 'コピーしました' : 'すべてコピー'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="min-h-[44px] rounded-lg bg-indigo-600 px-4 text-sm font-black text-white hover:bg-indigo-700"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
}

export function AdminCompanyCreateForm({
  orgType,
  label,
  adminName = '',
  orgs = [],
  disabled = false,
  onCancel,
  onFocusOrganization,
  onSubmit,
}) {
  const [name, setName] = useState('');
  const [furigana, setFurigana] = useState('');
  const [companyPhone, setCompanyPhone] = useState('');
  const [isCounterCash, setIsCounterCash] = useState(false);
  const [isCreditEligible, setIsCreditEligible] = useState(false);
  const [members, setMembers] = useState([]);
  const [blacklistOpen, setBlacklistOpen] = useState(false);
  const [blacklistEnabled, setBlacklistEnabled] = useState(false);
  const [blacklistReason, setBlacklistReason] = useState('');
  const [error, setError] = useState('');
  const [existingOrgId, setExistingOrgId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const suggestions = useMemo(() => suggestSimilarCompanies(orgs, name, 5), [orgs, name]);
  const busy = disabled || submitting;

  const updateMember = (key, patch) => {
    setMembers((current) => current.map((member) => (member.key === key ? { ...member, ...patch } : member)));
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (busy) return;
    const form = {
      name,
      furigana,
      companyPhone,
      isCounterCash,
      isCreditEligible,
      members,
      blacklistEnabled,
      blacklistReason,
    };
    const validationError = validateCompanyCreateForm(form);
    if (validationError) {
      setError(validationError);
      setExistingOrgId('');
      return;
    }
    const payload = buildCompanyCreatePayload(form, { type: orgType, createdBy: adminName });
    const loginRows = members
      .filter((member) => member.login)
      .map((member) => ({
        name: String(member.name || '').trim(),
        phone: formatPhoneJP(member.phone) || String(member.phone || '').trim(),
        password: String(member.password || ''),
      }));
    setSubmitting(true);
    setError('');
    setExistingOrgId('');
    try {
      await onSubmit(payload, loginRows);
    } catch (err) {
      setError(err?.message || '登録に失敗しました');
      setExistingOrgId(String(err?.existingOrgId || '').trim());
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="w-full rounded-xl border-2 border-indigo-200 bg-indigo-50/50 p-4"
    >
      <p className="text-sm font-black text-indigo-900">{label}の新規登録</p>

      <section className="mt-4">
        <h3 className="text-xs font-black text-slate-700">会社</h3>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="block text-xs font-bold text-slate-600">
            社名（必須）
            <input
              id="company-create-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={busy}
              autoComplete="off"
              className={fieldClass}
            />
          </label>
          <label className="block text-xs font-bold text-slate-600">
            フリガナ
            <input
              value={furigana}
              onChange={(event) => setFurigana(event.target.value)}
              disabled={busy}
              autoComplete="off"
              className={fieldClass}
            />
          </label>
        </div>
        {suggestions.length > 0 ? (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2">
            <p className="text-[11px] font-bold text-amber-900">もしかして</p>
            <ul className="mt-1 space-y-1">
              {suggestions.map((org) => (
                <li key={org.id}>
                  <button
                    type="button"
                    onClick={() => onFocusOrganization?.(org.id)}
                    className="min-h-[40px] w-full rounded px-2 py-1 text-left text-sm font-bold text-slate-800 hover:bg-white"
                  >
                    {org.name}
                    {String(org.furigana || '').trim() ? (
                      <span className="ml-1 font-medium text-slate-500">（{org.furigana}）</span>
                    ) : null}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="mt-4">
        <h3 className="text-xs font-black text-slate-700">会社の電話</h3>
        <label className="mt-2 block max-w-sm text-xs font-bold text-slate-600">
          代表電話（任意）
          <input
            type="tel"
            value={companyPhone}
            onChange={(event) => setCompanyPhone(formatPhoneAsYouType(event.target.value))}
            disabled={busy}
            autoComplete="off"
            placeholder="例: 097-123-4567"
            className={fieldClass}
          />
        </label>
      </section>

      <section className="mt-4">
        <h3 className="text-xs font-black text-slate-700">区分</h3>
        <div className="mt-2 flex flex-col gap-2">
          <label className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={isCounterCash}
              disabled={busy}
              onChange={(event) => setIsCounterCash(event.target.checked)}
            />
            窓口現金
          </label>
          <label className="flex items-center gap-2 text-sm font-bold text-slate-800">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={isCreditEligible}
              disabled={busy}
              onChange={(event) => setIsCreditEligible(event.target.checked)}
            />
            掛売対象
          </label>
        </div>
        {isCounterCash && isCreditEligible ? (
          <p className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-900">
            掛売対象と窓口現金の両方がONです。意図どおりか確認してください（登録は可能です）。
          </p>
        ) : null}
      </section>

      <section className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-xs font-black text-slate-700">担当者</h3>
          <button
            type="button"
            disabled={busy}
            onClick={() => setMembers((current) => [...current, emptyMember()])}
            className="text-sm font-bold text-indigo-700 hover:underline disabled:opacity-60"
          >
            ＋担当者を追加
          </button>
        </div>
        {members.length === 0 ? (
          <p className="mt-2 text-xs text-slate-500">担当者は0人でも登録できます。</p>
        ) : null}
        <ul className="mt-2 space-y-3">
          {members.map((member, index) => (
            <li key={member.key} className="rounded-lg border border-slate-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-xs font-black text-slate-600">{index + 1}人目</p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMembers((current) => current.filter((row) => row.key !== member.key))}
                  className="text-sm text-red-600 hover:text-red-800 disabled:opacity-60"
                >
                  削除
                </button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block text-xs font-bold text-slate-600">
                  氏名（必須）
                  <input
                    value={member.name}
                    onChange={(event) => updateMember(member.key, { name: event.target.value })}
                    disabled={busy}
                    autoComplete="off"
                    className={fieldClass}
                  />
                </label>
                <label className="block text-xs font-bold text-slate-600">
                  電話
                  <input
                    type="tel"
                    value={member.phone}
                    onChange={(event) =>
                      updateMember(member.key, { phone: formatPhoneAsYouType(event.target.value) })
                    }
                    disabled={busy}
                    autoComplete="off"
                    className={fieldClass}
                  />
                </label>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm font-bold text-slate-800">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={member.login}
                  disabled={busy}
                  onChange={(event) => {
                    const login = event.target.checked;
                    updateMember(member.key, {
                      login,
                      password: login ? member.password || generateInitialMemberPassword() : '',
                    });
                  }}
                />
                ログインさせる
              </label>
              {member.login ? (
                <div className="mt-2">
                  <p className="text-xs font-bold text-slate-600">パスワード</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <input
                      readOnly
                      value={member.password}
                      spellCheck={false}
                      aria-label={`${index + 1}人目のパスワード`}
                      className="min-h-[40px] min-w-[8rem] flex-1 rounded border border-slate-200 bg-slate-50 px-2 font-mono text-lg font-black tracking-wider text-indigo-700"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => updateMember(member.key, { password: nextPassword(member.password) })}
                      className="min-h-[40px] rounded border border-indigo-300 bg-white px-3 text-sm font-bold text-indigo-800 hover:bg-indigo-50 disabled:opacity-60"
                    >
                      再生成
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-2 text-[11px] leading-relaxed text-slate-500">
                  電話番号は電話帳に登録されます（ログイン不可）
                </p>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-4 rounded-lg border border-slate-200 bg-white">
        <button
          type="button"
          aria-expanded={blacklistOpen}
          onClick={() => setBlacklistOpen((open) => !open)}
          className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-black text-slate-700"
        >
          <span aria-hidden="true">{blacklistOpen ? '▼' : '▶'}</span>
          ブラックリスト
        </button>
        {blacklistOpen ? (
          <div className="border-t border-slate-100 px-3 py-3">
            <label className="flex items-center gap-2 text-sm font-bold text-slate-800">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={blacklistEnabled}
                disabled={busy}
                onChange={(event) => setBlacklistEnabled(event.target.checked)}
              />
              ブラックリストに登録
            </label>
            <label className="mt-3 block text-xs font-bold text-slate-600">
              理由（任意）
              <textarea
                value={blacklistReason}
                onChange={(event) => setBlacklistReason(event.target.value)}
                disabled={busy}
                rows={2}
                className={`${fieldClass} min-h-[64px] resize-y`}
              />
            </label>
          </div>
        ) : null}
      </section>

      {error ? (
        <p role="alert" className="mt-3 text-sm font-bold text-red-700">
          {error}
          {existingOrgId ? (
            <button
              type="button"
              onClick={() => onFocusOrganization?.(existingOrgId)}
              className="ml-2 inline-flex min-h-[36px] items-center rounded border border-red-300 bg-white px-2 text-xs font-black text-red-800 hover:bg-red-50"
            >
              その会社を開く
            </button>
          ) : null}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={busy}
          className="min-h-[44px] rounded bg-indigo-600 px-4 text-sm font-black text-white hover:bg-indigo-500 disabled:opacity-60"
        >
          登録
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={onCancel}
          className="min-h-[44px] rounded px-4 text-sm text-gray-600 hover:text-gray-800 disabled:opacity-60"
        >
          キャンセル
        </button>
      </div>
    </form>
  );
}
