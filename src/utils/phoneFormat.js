/** 日本の電話番号にハイフンを付与（確実に判定できる場合のみ）。
 *  判定不能・既にハイフン/記号入り・空文字はそのまま返す */
export function formatPhoneNumberJP(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return '';
  if (/[^0-9]/.test(s)) return s; // 既に区切りや記号がある場合は触らない
  // フリーダイヤル 0120: 10桁 → 4-3-3（携帯パターンより先に判定）
  if (/^0120\d{6}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 7)}-${s.slice(7)}`;
  // 0800: 11桁 → 4-3-4（080携帯と区別するため先に判定）
  if (/^0800\d{7}$/.test(s)) return `${s.slice(0, 4)}-${s.slice(4, 7)}-${s.slice(7)}`;
  // 携帯 070/080/090・IP電話 050: 11桁 → 3-4-4
  if (/^0[5789]0\d{8}$/.test(s)) return `${s.slice(0, 3)}-${s.slice(3, 7)}-${s.slice(7)}`;
  // 固定電話は市外局番の桁数が可変のため整形しない（誤区切り防止）
  return s;
}
