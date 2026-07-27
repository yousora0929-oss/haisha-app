/**
 * 業者（会社）選択UI向け: 同一 company_name の customers 行を1件に集約する。
 * 代表は会社内で最も早い created_at（同時刻は id 昇順）に固定し、
 * 選択のたびに別担当者行が代表にならないようにする（履歴・集計の分断防止）。
 *
 * 担当者個人を選ぶUI（ログインアカウント管理・リンクチェックリスト等）には使わない。
 *
 * @param {Array<object|null|undefined>|null|undefined} customers
 * @returns {object[]}
 */
export function dedupeCustomersByCompany(customers) {
  const list = Array.isArray(customers) ? customers : [];
  const byCompany = new Map();
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const key = String(c.company_name || c.name || '').trim();
    if (!key) continue;
    const existing = byCompany.get(key);
    if (!existing) {
      byCompany.set(key, c);
      continue;
    }
    const existingTime = existing.created_at ? new Date(existing.created_at).getTime() : Infinity;
    const currentTime = c.created_at ? new Date(c.created_at).getTime() : Infinity;
    if (
      currentTime < existingTime ||
      (currentTime === existingTime && String(c.id) < String(existing.id))
    ) {
      byCompany.set(key, c);
    }
  }
  return Array.from(byCompany.values());
}
