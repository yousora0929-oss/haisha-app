/** 組合が商社欄へ自組織名を入れたときの送信ブロック用メッセージ */
export const COOPERATIVE_OWN_ORG_TRADER_ERROR =
  '商社欄に組合名を入力することはできません。商社を経由しない場合は空欄のままにしてください。';

/**
 * 商社名比較用の正規化（全角半角の空白除去・NFKC）。
 * @param {unknown} value
 */
export function normalizeTraderCompareKey(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, '');
}

/**
 * 組合ロールが商社欄へ自組織名（company_name）を入れたとき true。
 * agent / contractor では常に false（自社名入力は正常運用）。
 * @param {unknown} role
 * @param {unknown} traderName
 * @param {unknown} companyName
 */
export function isCooperativeOwnOrgTraderName(role, traderName, companyName) {
  if (String(role ?? '').trim() !== 'cooperative') return false;
  const traderKey = normalizeTraderCompareKey(traderName);
  const orgKey = normalizeTraderCompareKey(companyName);
  if (!traderKey || !orgKey) return false;
  return traderKey === orgKey;
}
