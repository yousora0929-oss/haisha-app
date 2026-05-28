/** Google ドキュメント等の内部ID（クリップボードゴミ） */
export function isGoogleInternalGarbage(value) {
  const s = String(value || '').trim();
  if (!s) return false;
  if (/^kix[\da-z]*::/i.test(s)) return true;
  if (/^gid:/i.test(s)) return true;
  if (/^eid:/i.test(s)) return true;
  if (/^[^:]+::[a-z0-9_-]+$/i.test(s) && !s.includes('.')) return true;
  return false;
}

/** 物件専用発注URL用の新規 UUID トークンを生成 */
export function generateSiteOrderUrlToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/** 書き込み用 url_token（未指定・不正時は新規 UUID） */
export function resolveUrlTokenForInsert(payload) {
  const existing = String(payload?.url_token ?? '').trim();
  if (isValidSiteOrderUrlToken(existing)) return existing;
  return generateSiteOrderUrlToken();
}

/** 現場専用発注URL用トークン（projects.url_token / customers.url_token） */
export function isValidSiteOrderUrlToken(token) {
  const s = String(token || '').trim();
  if (!s || isGoogleInternalGarbage(s)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s)) return true;
  if (/^[a-z0-9][a-z0-9_-]{3,127}$/i.test(s)) return true;
  return false;
}

export function isValidExternalUrl(raw) {
  const s = String(raw || '').trim();
  if (!s || isGoogleInternalGarbage(s)) return false;
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
    if (!u.hostname || !u.hostname.includes('.')) return false;
    return true;
  } catch {
    return false;
  }
}

export function normalizeExternalUrl(raw) {
  const s = String(raw || '').trim();
  if (!isValidExternalUrl(s)) return '';
  try {
    const u = new URL(/^https?:\/\//i.test(s) ? s : `https://${s}`);
    return u.href;
  } catch {
    return '';
  }
}

export function externalUrlValidationMessage(raw) {
  const s = String(raw || '').trim();
  if (!s) return 'URLが登録されていません';
  if (isGoogleInternalGarbage(s)) {
    return 'URLが不正です（Googleの内部IDが登録されている可能性があります。Drive/スプレッドシートの共有リンクを登録してください）';
  }
  if (!isValidExternalUrl(s)) return 'URLの形式が正しくありません（https:// で始まる共有リンクを登録してください）';
  return '';
}
