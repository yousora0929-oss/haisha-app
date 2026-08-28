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

/**
 * 注文に紐づく物件を project_id のみで解決する（customer_id は使わない）。
 * 代理発注では customer_id が組合・商社になるため、カタログ側のフォールバックとして
 * fetchOrdersWithChat が付けた linkedProject も同じ ID なら採用する。
 * @param {object|null|undefined} order
 * @param {Record<string, object>|Map<string, object>|null|undefined} projectById
 */
export function resolveOrderLinkedProject(order, projectById = {}) {
  const pid = String(order?.project_id ?? order?.projectId ?? '').trim();
  if (!pid) return null;
  let fromMap = null;
  if (projectById && typeof projectById.get === 'function') {
    fromMap = projectById.get(pid) || null;
  } else if (projectById && typeof projectById === 'object') {
    fromMap = projectById[pid] || null;
  }
  if (fromMap) return fromMap;
  const linked = order?.linkedProject;
  if (linked && String(linked.id || '').trim() === pid) return linked;
  return null;
}

/**
 * 物件マスタの現場担当者リスト（projects.site_contacts）を1行表示用に整形。
 * 未登録・空なら ''（呼び出し側で行ごと非表示）。
 * @param {object|null|undefined} project
 * @param {{ formatPhone?: (phone: string) => string }} [opts]
 */
export function formatProjectSiteContactsLabel(project, { formatPhone } = {}) {
  const list = Array.isArray(project?.site_contacts) ? project.site_contacts : [];
  const fmt =
    typeof formatPhone === 'function' ? formatPhone : (phone) => String(phone || '').trim();
  const parts = [];
  for (const c of list) {
    if (!c || typeof c !== 'object') continue;
    const name = String(c.name || '').trim();
    const phone = fmt(String(c.phone || '').trim());
    if (!name && !phone) continue;
    parts.push(name && phone ? `${name}（${phone}）` : name || phone);
  }
  return parts.join('、');
}

function lookupCustomerById(customerById, id) {
  const key = String(id || '').trim();
  if (!key) return null;
  if (customerById && typeof customerById.get === 'function') {
    return customerById.get(key) || null;
  }
  if (customerById && typeof customerById === 'object') {
    return customerById[key] || null;
  }
  return null;
}

/**
 * 経由商社（orders.trading_agent_customer_id）の連絡先を1行表示用に整形。
 * 未設定、または customers から解決できないときは ''。
 * @param {object|null|undefined} order
 * @param {Record<string, object>|Map<string, object>|null|undefined} customerById
 * @param {{ formatPhone?: (phone: string) => string }} [opts]
 */
export function formatTradingAgentContactLabel(order, customerById, { formatPhone } = {}) {
  const id = String(
    order?.trading_agent_customer_id ?? order?.tradingAgentCustomerId ?? '',
  ).trim();
  if (!id) return '';
  const customer =
    order?.tradingAgentCustomer &&
    String(order.tradingAgentCustomer.id || '').trim() === id
      ? order.tradingAgentCustomer
      : lookupCustomerById(customerById, id);
  if (!customer) return '';
  const company = String(customer.company_name || customer.name || '').trim();
  const manager = String(customer.manager_name || '').trim();
  const phoneRaw = String(customer.phone_number || customer.phone || '').trim();
  const fmt =
    typeof formatPhone === 'function' ? formatPhone : (phone) => String(phone || '').trim();
  const phone = fmt(phoneRaw);
  if (company && manager && phone) return `${company} ${manager}（${phone}）`;
  if (company && manager) return `${company} ${manager}`;
  if (company && phone) return `${company}（${phone}）`;
  if (manager && phone) return `${manager}（${phone}）`;
  return company || manager || phone;
}
