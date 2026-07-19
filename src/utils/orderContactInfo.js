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
