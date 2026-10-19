import { AsYouType, parsePhoneNumberFromString } from 'libphonenumber-js/min';

function toHalfWidth(value) {
  return String(value ?? '')
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ');
}

/** 比較・検索用。全角を半角にし、数字以外を除く。 */
export function phoneDigits(value) {
  return toHalfWidth(value).replace(/\D/g, '');
}

/**
 * 表示用。日本の電話番号として解釈できればハイフン付き。
 * 英字IDなど解釈できない値は入力をそのまま返す。空は ''。
 */
export function formatPhoneJP(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const half = toHalfWidth(raw).trim();
  if (/[A-Za-z]/.test(half)) return raw;
  let parsed = null;
  try {
    parsed = parsePhoneNumberFromString(half, 'JP');
  } catch {
    parsed = null;
  }
  if (!parsed || !parsed.isValid()) return raw;
  const national = parsed.formatNational();
  const nationalDigits = national.replace(/\D/g, '');
  const inputDigits = half.replace(/\D/g, '');
  if (!half.startsWith('+') && nationalDigits !== inputDigits) return raw;
  return national;
}

/** 既存呼び出し向け。formatPhoneJP と同じ。 */
export function formatPhoneNumberJP(value) {
  return formatPhoneJP(value);
}

/** どちらかが空なら false。数字列が一致すれば true。 */
export function isSamePhone(a, b) {
  const left = phoneDigits(a);
  const right = phoneDigits(b);
  if (!left || !right) return false;
  return left === right;
}

/** 入力中の自動ハイフン。英字を含む値はそのまま返す。 */
export function formatPhoneAsYouType(value) {
  const raw = String(value ?? '');
  if (!raw) return '';
  const half = toHalfWidth(raw);
  if (/[A-Za-z]/.test(half)) return raw;
  return new AsYouType('JP').input(half);
}
