/** サジェスト用 — マスタ配列のリアルタイム絞り込み */
import { resolveProjectTradingCompanyName } from './projectTradingCompany.js';
import { normalizeSuggestSearchText } from './normalizeSuggestSearchText.js';

export function getTextMatchRank(text, queryLower) {
  const t = normalizeSuggestSearchText(text);
  const q = normalizeSuggestSearchText(queryLower);
  if (!q) return 0;
  if (!t) return 2;
  if (t.startsWith(q)) return 0;
  if (t.includes(q)) return 1;
  return 2;
}

export function getItemMatchRank(item, query, getSearchTexts) {
  const q = normalizeSuggestSearchText(query);
  if (!q) return 0;
  const texts = getSearchTexts(item);
  let best = 2;
  for (const text of texts) {
    const r = getTextMatchRank(text, q);
    if (r < best) best = r;
  }
  return best;
}

export function filterSuggestItems(items, query, getSearchTexts, limit = 80) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const q = normalizeSuggestSearchText(query);
  if (!q) return list.slice(0, limit);
  // 同ランク時は入力配列の順序を維持（利用頻度順などを呼び出し側で渡せるようにする）
  const indexByItem = new Map(list.map((item, i) => [item, i]));
  return list
    .filter((item) => getItemMatchRank(item, q, getSearchTexts) < 2)
    .sort((a, b) => {
      const ra = getItemMatchRank(a, q, getSearchTexts);
      const rb = getItemMatchRank(b, q, getSearchTexts);
      if (ra !== rb) return ra - rb;
      return (indexByItem.get(a) ?? 0) - (indexByItem.get(b) ?? 0);
    })
    .slice(0, limit);
}

/**
 * 顧客マスタを利用頻度の降順で並べる。同数は company_name → furigana の昇順。
 * 利用実績 0 件は頻度上位の後ろに続ける（除外しない）。
 * @param {object[]} items
 * @param {Record<string, number>} usageCounts
 */
export function sortCustomersByUsageFrequency(items, usageCounts) {
  const list = Array.isArray(items) ? [...items] : [];
  const usage = usageCounts && typeof usageCounts === 'object' ? usageCounts : {};
  return list.sort((a, b) => {
    const ca = Number(usage[String(a?.id)] || 0);
    const cb = Number(usage[String(b?.id)] || 0);
    if (ca !== cb) return cb - ca;
    const nameA = String(a?.company_name || a?.name || '').trim();
    const nameB = String(b?.company_name || b?.name || '').trim();
    const byName = nameA.localeCompare(nameB, 'ja', { sensitivity: 'base' });
    if (byName !== 0) return byName;
    const furiA = String(a?.furigana || '').trim();
    const furiB = String(b?.furigana || '').trim();
    return furiA.localeCompare(furiB, 'ja', { sensitivity: 'base' });
  });
}

export function organizationSuggestTexts(organization) {
  return [organization?.name, organization?.furigana, organization?.id];
}

export function customerSuggestTexts(customer) {
  return [
    customer?.company_name,
    customer?.name,
    customer?.furigana,
    customer?.manager_name,
    customer?.phone_number,
    customer?.id,
  ];
}

export function projectSuggestTexts(project) {
  const trader = resolveProjectTradingCompanyName(project);
  return [
    project?.name,
    project?.address,
    trader,
    project?.sub_contractor_name,
    project?.id,
  ];
}
