/**
 * サジェスト検索用のテキスト正規化。
 * - NFKC: 半角カナ→全角カナ、全角英数字→半角
 * - ひらがな→カタカナ（U+3041〜U+3096 に +0x60）
 * - 英字小文字化、前後空白除去
 * 選択確定（厳密一致）には使わないこと。
 */
export function normalizeSuggestSearchText(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  let s = raw.normalize('NFKC');
  let out = '';
  for (const ch of s) {
    const code = ch.codePointAt(0);
    if (code >= 0x3041 && code <= 0x3096) {
      out += String.fromCodePoint(code + 0x60);
    } else {
      out += ch;
    }
  }
  return out.toLowerCase();
}
