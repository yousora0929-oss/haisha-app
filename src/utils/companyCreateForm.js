import { stripLegalFormCompletely } from './csvImport.js';
import { isSamePhone } from './phoneFormat.js';
import { normalizeSuggestSearchText } from './normalizeSuggestSearchText.js';

function detailText(err) {
  return String(err?.details ?? '').trim();
}

function messageText(err) {
  return String(err?.message || '').trim();
}

/**
 * RPC `admin_create_company_with_contacts` の error.message / error.details を表示文言にする。
 * @returns {{ text: string, existingOrgId: string }}
 */
export function mapCompanyCreateError(err) {
  const message = messageText(err);
  const details = detailText(err);
  const codes = [
    'login phone duplicated in form',
    'login phone required',
    'login phone in use',
    'company name required',
    'company exists',
    'member name required',
    'invalid phone',
    'weak password',
    'not authorized',
  ];
  const code = codes.find((item) => message === item || message.includes(item)) || '';

  if (code === 'company exists') {
    return { text: '同じ名前の会社がすでにあります', existingOrgId: details };
  }
  if (code === 'company name required') {
    return { text: '社名を入力してください', existingOrgId: '' };
  }
  if (code === 'member name required') {
    return { text: `${details}人目の担当者の氏名を入力してください`, existingOrgId: '' };
  }
  if (code === 'invalid phone') {
    const target = details === 'company' ? '代表電話' : `${details}人目`;
    return { text: `${target}：電話番号は0から始まる10〜11桁`, existingOrgId: '' };
  }
  if (code === 'login phone required') {
    return { text: `ログインさせる場合は電話番号が必要です（${details}人目）`, existingOrgId: '' };
  }
  if (code === 'weak password') {
    return { text: `パスワードの生成に失敗しました。再生成してください（${details}人目）`, existingOrgId: '' };
  }
  if (code === 'login phone in use') {
    return {
      text: `この電話番号は別のアカウントでログインに使われています（${details}人目）`,
      existingOrgId: '',
    };
  }
  if (code === 'login phone duplicated in form') {
    return { text: '同じログイン番号が2人に入力されています', existingOrgId: '' };
  }
  if (code === 'not authorized') {
    return { text: '権限がありません', existingOrgId: '' };
  }
  return { text: message || '登録に失敗しました', existingOrgId: '' };
}

/** 送信前の画面側チェック。問題なければ空文字。 */
export function validateCompanyCreateForm(form) {
  const name = String(form?.name || '').trim();
  if (!name) return '社名を入力してください';

  const members = Array.isArray(form?.members) ? form.members : [];
  const loginPhones = [];
  for (let index = 0; index < members.length; index += 1) {
    const member = members[index] || {};
    const memberName = String(member.name || '').trim();
    const nth = index + 1;
    if (!memberName) return `${nth}人目の担当者の氏名を入力してください`;
    if (!member.login) continue;
    const phone = String(member.phone || '').trim();
    if (!phone) return `ログインさせる場合は電話番号が必要です（${nth}人目）`;
    if (!String(member.password || '').trim()) {
      return `パスワードの生成に失敗しました。再生成してください（${nth}人目）`;
    }
    if (loginPhones.some((existing) => isSamePhone(existing, phone))) {
      return '同じログイン番号が2人に入力されています';
    }
    loginPhones.push(phone);
  }
  return '';
}

/** RPC に渡す jsonb。ログインしない担当者のパスワードは含めない。 */
export function buildCompanyCreatePayload(form, { type, createdBy } = {}) {
  const members = (Array.isArray(form?.members) ? form.members : []).map((member) => {
    const row = {
      name: String(member?.name || '').trim(),
      phone: String(member?.phone || '').trim(),
      login: Boolean(member?.login),
    };
    if (row.login) row.password = String(member?.password || '').trim();
    return row;
  });
  return {
    type,
    name: String(form?.name || '').trim(),
    furigana: String(form?.furigana || '').trim(),
    company_phone: String(form?.companyPhone || '').trim(),
    is_counter_cash: Boolean(form?.isCounterCash),
    is_credit_eligible: Boolean(form?.isCreditEligible),
    members,
    blacklist: {
      enabled: Boolean(form?.blacklistEnabled),
      reason: String(form?.blacklistReason || '').trim(),
    },
    created_by: String(createdBy || '').trim(),
  };
}

function includesText(haystack, needle) {
  if (!needle || !haystack) return false;
  return haystack.includes(needle);
}

/** 入力中の社名に部分一致する既存会社。最大 limit 件。 */
export function suggestSimilarCompanies(orgs, query, limit = 5) {
  const raw = normalizeSuggestSearchText(query);
  if (!raw) return [];
  const key = normalizeSuggestSearchText(stripLegalFormCompletely(query));
  const hits = [];
  const cap = Number.isFinite(Number(limit)) ? Number(limit) : 5;
  for (const org of orgs || []) {
    const name = normalizeSuggestSearchText(org?.name);
    const furigana = normalizeSuggestSearchText(org?.furigana);
    const nameKey = normalizeSuggestSearchText(stripLegalFormCompletely(org?.name));
    const furiganaKey = normalizeSuggestSearchText(stripLegalFormCompletely(org?.furigana));
    const matched =
      includesText(name, raw) ||
      includesText(furigana, raw) ||
      (name.length >= 2 && includesText(raw, name)) ||
      (key.length >= 2 &&
        (includesText(nameKey, key) ||
          includesText(furiganaKey, key) ||
          (nameKey.length >= 2 && includesText(key, nameKey))));
    if (!matched) continue;
    hits.push(org);
    if (hits.length >= cap) break;
  }
  return hits;
}

/** ログイン情報ダイアログの「すべてコピー」用。 */
export function formatLoginCredentialCopy(rows) {
  return (Array.isArray(rows) ? rows : [])
    .map((row) => `${String(row?.name || '').trim()} ${String(row?.phone || '').trim()} ${String(row?.password || '')}`)
    .join('\n');
}
