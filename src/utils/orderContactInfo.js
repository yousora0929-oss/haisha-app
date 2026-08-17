/** 現場担当者名（カスタマーがフォーム入力した値）。order_data由来を最優先 */
export function resolveSiteContactName(order) {
  // siteContactName / site_contact_name は order_data 由来。
  // normalizeOrderRow が orderedBy に ordered_by（ログイン担当者）を先に入れる場合があるため、
  // 専用フィールドを最優先する（表示層のみ・正規化ロジックは変更しない）。
  for (const c of [
    order?.siteContactName,
    order?.site_contact_name,
    order?.orderedBy,
    order?.ordered_by,
  ]) {
    const s = String(c ?? '').trim();
    if (s) return s;
  }
  return '';
}

/**
 * 業者マスタの代表担当者名（customers.manager_name）。
 * 個別注文の発注担当者（ordered_by / orderedBy）や現場担当者にはフォールバックしない。
 * 未登録時は fallback（デフォルト「担当者」）。
 *
 * @param {object|null|undefined} order
 * @param {{ customer?: object|null, fallback?: string }} [opts]
 *   customer: orders.customer_id に対応する customers 行（order に manager_name が無いときの供給源）
 */
export function resolveOrderContactPersonName(order, { customer = null, fallback = '担当者' } = {}) {
  return (
    String(
      order?.manager_name ??
        customer?.manager_name ??
        order?.contact_person ??
        order?.contactPerson ??
        '',
    ).trim() || fallback
  );
}

/** 発注担当者名（ログイン/代理発注者） */
export function resolveOrdererName(order) {
  return String(order?.ordered_by ?? '').trim();
}

/** 現場連絡先電話番号 */
export function resolveSitePhone(order) {
  for (const c of [order?.sitePhone, order?.site_phone, order?.phone]) {
    const s = String(c ?? '').trim();
    if (s) return s;
  }
  return '';
}
