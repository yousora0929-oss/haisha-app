/** サジェスト用 — マスタ配列のリアルタイム絞り込み */
import { resolveProjectTradingCompanyName } from './projectTradingCompany.js';

export function getTextMatchRank(text, queryLower) {
  const t = String(text ?? '').trim().toLowerCase();
  const q = String(queryLower ?? '').trim().toLowerCase();
  if (!q) return 0;
  if (!t) return 2;
  if (t.startsWith(q)) return 0;
  if (t.includes(q)) return 1;
  return 2;
}

export function getItemMatchRank(item, query, getSearchTexts) {
  const q = String(query ?? '').trim().toLowerCase();
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
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return list.slice(0, limit);
  return list
    .filter((item) => getItemMatchRank(item, q, getSearchTexts) < 2)
    .sort((a, b) => {
      const ra = getItemMatchRank(a, q, getSearchTexts);
      const rb = getItemMatchRank(b, q, getSearchTexts);
      if (ra !== rb) return ra - rb;
      const la = String(getSearchTexts(a)[0] ?? '');
      const lb = String(getSearchTexts(b)[0] ?? '');
      return la.localeCompare(lb, 'ja', { sensitivity: 'base' });
    })
    .slice(0, limit);
}

export function customerSuggestTexts(customer) {
  return [
    customer?.company_name,
    customer?.name,
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
