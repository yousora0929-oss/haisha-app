/** サジェスト用 — マスタ配列のリアルタイム絞り込み */

export function filterSuggestItems(items, query, getSearchTexts, limit = 80) {
  const list = Array.isArray(items) ? items.filter(Boolean) : [];
  const q = String(query ?? '').trim().toLowerCase();
  if (!q) return list.slice(0, limit);
  return list
    .filter((item) => {
      const texts = getSearchTexts(item);
      return texts.some((t) => String(t ?? '').toLowerCase().includes(q));
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
  return [
    project?.name,
    project?.address,
    project?.trading_company_name,
    project?.trading_company,
    project?.sub_contractor_name,
    project?.id,
  ];
}
