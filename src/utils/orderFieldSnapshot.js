/** 注文編集・変更依頼の楽観ロック用。updated_at は比べない。 */

function norm(value) {
  if (typeof value === 'boolean') return value ? '1' : '0';
  if (value == null) return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  const text = String(value).trim();
  if (text === '') return '';
  if (/^-?\d+(\.\d+)?$/.test(text)) return String(Number(text));
  return text;
}

function readRaw(order, key) {
  const source = order && typeof order === 'object' ? order : {};
  switch (key) {
    case 'preferredDate':
    case 'scheduleMatchDate':
      return source.delivery_date || source.preferredDate || source.preferred_date || source.scheduleMatchDate;
    case 'timeSlot':
    case 'timeSlotMinutes':
    case 'scheduleMatchMinutes':
      return source.scheduleMatchMinutes ?? source.timeSlotMinutes ?? source.timeSlot;
    case 'timeSlotLabel':
    case 'timePointLabel':
      return source.timePointLabel || source.timeSlotLabel;
    case 'quantityM3':
    case 'confirmedQuantityM3':
      return source.confirmedQuantityM3 ?? source.quantityM3;
    case 'mixText':
    case 'confirmedMixText':
      return source.confirmedMixText ?? source.mixText;
    case 'unloadDuration':
    case 'unloadDurationMinutes':
    case 'unloadDurationLabel':
      return source.unloadDurationLabel || source.unloadDurationMinutes || source.unloadDuration || source.unloadingTime;
    case 'vehicleType':
      return source.vehicleType || 'large';
    case 'vehicleLabel':
      return source.vehicleLabel;
    case 'has_test':
      return Boolean(source.has_test);
    case 'contractor_customer_id':
      return source.contractor_customer_id ?? source.contractorCustomerId;
    case 'agent_organization_id':
      return source.agent_organization_id ?? source.agentOrganizationId;
    case 'trading_agent_customer_id':
      return source.trading_agent_customer_id ?? source.tradingAgentCustomerId;
    case 'delivery_lat':
      return source.delivery_lat ?? source.deliveryLat;
    case 'delivery_lng':
      return source.delivery_lng ?? source.deliveryLng;
    default:
      return source[key];
  }
}

export const CUSTOMER_ORDER_EDIT_KEYS = [
  'preferredDate',
  'timeSlot',
  'timePointLabel',
  'vehicleType',
  'quantityM3',
  'unloadDuration',
  'mixText',
  'siteName',
  'siteAddress',
  'sitePhone',
  'has_test',
  'contractor_customer_id',
  'contractorName',
  'agent_organization_id',
  'traderName',
  'trading_agent_customer_id',
];

export const ADMIN_ORDER_EDIT_KEYS = [
  ...CUSTOMER_ORDER_EDIT_KEYS,
  'manager_name',
  'delivery_lat',
  'delivery_lng',
];

export function snapshotOrderFields(order, keys) {
  const snap = {};
  for (const key of Array.isArray(keys) ? keys : []) {
    const name = String(key || '').trim();
    if (!name) continue;
    snap[name] = norm(readRaw(order, name));
  }
  return snap;
}

function watchSnapshotKeys(openedSnapshot, keys) {
  return (Array.isArray(keys) && keys.length ? keys : Object.keys(openedSnapshot || {}))
    .map((key) => String(key || '').trim())
    .filter(Boolean);
}

/** 開いたときのスナップショットと最新注文で値が違う項目 */
export function listOrderFieldSnapshotConflicts(openedSnapshot, latestOrder, keys) {
  const opened = openedSnapshot && typeof openedSnapshot === 'object' ? openedSnapshot : {};
  return watchSnapshotKeys(opened, keys)
    .filter((key) => String(opened[key] ?? '') !== norm(readRaw(latestOrder, key)))
    .map((key) => ({
      key,
      base: String(opened[key] ?? ''),
      latest: norm(readRaw(latestOrder, key)),
    }));
}

/** 開いたときのスナップショットと、最新注文の同じ項目だけを比べる */
export function orderFieldSnapshotDiffers(openedSnapshot, latestOrder, keys) {
  return listOrderFieldSnapshotConflicts(openedSnapshot, latestOrder, keys).length > 0;
}
