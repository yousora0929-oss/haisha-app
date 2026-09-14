/** 変更依頼パッチを、工場が項目ごとに判断できる単位へまとめる */

export const CHANGE_REQUEST_ITEM_DEFS = [
  { id: 'preferredDate', label: '希望日', keys: ['preferredDate', 'scheduleMatchDate'] },
  {
    id: 'time',
    label: '希望時刻',
    keys: ['timeSlot', 'timeSlotMinutes', 'timeSlotLabel', 'timePointLabel', 'scheduleMatchMinutes'],
  },
  { id: 'vehicle', label: '車種', keys: ['vehicleType', 'vehicleLabel'] },
  { id: 'quantity', label: '数量', keys: ['quantityM3', 'confirmedQuantityM3'] },
  {
    id: 'unload',
    label: '荷卸し時間',
    keys: ['unloadDuration', 'unloadDurationMinutes', 'unloadDurationLabel'],
  },
  { id: 'mix', label: '配合', keys: ['mixText', 'confirmedMixText'] },
  { id: 'siteName', label: '現場名', keys: ['siteName'] },
  { id: 'siteAddress', label: '現場住所', keys: ['siteAddress'] },
  { id: 'sitePhone', label: '電話番号', keys: ['sitePhone'] },
  { id: 'contractor', label: '業者名', keys: ['contractorName', 'contractor_customer_id'] },
  { id: 'has_test', label: '試験体', keys: ['has_test'] },
  {
    id: 'trader',
    label: '商社',
    keys: ['agent_organization_id', 'traderName', 'trading_company_name', 'projectTradingCompanyName'],
  },
  { id: 'tradingAgent', label: '商社担当者', keys: ['trading_agent_customer_id'] },
];

function isPlainPatch(patch) {
  return Boolean(patch && typeof patch === 'object' && !Array.isArray(patch));
}

function vehicleTypeLabel(value) {
  const s = String(value || '').trim();
  if (s === 'large') return '大型';
  if (s === 'small') return '小型';
  return s;
}

function formatPatchValue(key, patch) {
  if (!isPlainPatch(patch) || !Object.prototype.hasOwnProperty.call(patch, key)) return '';
  const value = patch[key];
  if (key === 'has_test') return value ? 'あり' : 'なし';
  if (key === 'vehicleType') return vehicleTypeLabel(value) || String(value ?? '');
  if (key === 'quantityM3' || key === 'confirmedQuantityM3') {
    const s = value == null ? '' : String(value).trim();
    return s ? `${s}m³` : '';
  }
  if (key === 'agent_organization_id') {
    const name = String(patch.traderName || patch.trading_company_name || '').trim();
    if (name) return name;
  }
  if (value == null) return '';
  return String(value).trim();
}

function displayForItem(def, patch) {
  const preferredKeys = {
    preferredDate: ['preferredDate'],
    time: ['timePointLabel', 'timeSlotLabel', 'timeSlot'],
    vehicle: ['vehicleLabel', 'vehicleType'],
    quantity: ['quantityM3'],
    unload: ['unloadDurationLabel', 'unloadDurationMinutes', 'unloadDuration'],
    mix: ['mixText'],
    siteName: ['siteName'],
    siteAddress: ['siteAddress'],
    sitePhone: ['sitePhone'],
    contractor: ['contractorName'],
    has_test: ['has_test'],
    trader: ['traderName', 'trading_company_name', 'agent_organization_id'],
    tradingAgent: ['trading_agent_customer_id'],
  };
  const keys = preferredKeys[def.id] || def.keys;
  for (const key of keys) {
    const text = formatPatchValue(key, patch);
    if (text) return text;
  }
  return '（未設定）';
}

export function listChangeRequestItems(patch) {
  if (!isPlainPatch(patch)) return [];
  const used = new Set();
  const items = [];
  for (const def of CHANGE_REQUEST_ITEM_DEFS) {
    const keys = def.keys.filter((key) => Object.prototype.hasOwnProperty.call(patch, key));
    if (!keys.length) continue;
    keys.forEach((key) => used.add(key));
    items.push({
      id: def.id,
      label: def.label,
      keys,
      display: displayForItem(def, patch),
    });
  }
  for (const key of Object.keys(patch)) {
    if (used.has(key)) continue;
    items.push({
      id: `other:${key}`,
      label: key,
      keys: [key],
      display: formatPatchValue(key, patch) || '（未設定）',
    });
  }
  return items;
}

export function pickAcceptedChangeRequestPatch(patch, acceptedKeys) {
  if (!isPlainPatch(patch)) return {};
  const allow = new Set(
    (Array.isArray(acceptedKeys) ? acceptedKeys : Object.keys(patch)).map((key) => String(key)),
  );
  const out = {};
  for (const [key, value] of Object.entries(patch)) {
    if (allow.has(key)) out[key] = value;
  }
  if (Object.prototype.hasOwnProperty.call(out, 'quantityM3')) {
    out.confirmedQuantityM3 = out.quantityM3;
  }
  if (Object.prototype.hasOwnProperty.call(out, 'mixText')) {
    out.confirmedMixText = out.mixText;
  }
  return out;
}

export function splitChangeRequestDecisions(patch, acceptedKeys) {
  const acceptedSet = new Set((Array.isArray(acceptedKeys) ? acceptedKeys : []).map((key) => String(key)));
  const accepted = [];
  const declined = [];
  for (const item of listChangeRequestItems(patch)) {
    const hit = item.keys.some((key) => acceptedSet.has(key));
    if (hit) accepted.push(item);
    else declined.push(item);
  }
  return { accepted, declined };
}

export function formatChangeRequestItemLine(item) {
  const label = String(item?.label || '').trim() || '項目';
  const display = String(item?.display || '').trim();
  return display ? `${label}（${display}）` : label;
}

export function formatChangeRequestResolveChatBody({ factoryName, acceptedItems, declinedItems }) {
  const factoryLabel = String(factoryName || '').trim() || '工場';
  const accepted = Array.isArray(acceptedItems) ? acceptedItems : [];
  const declined = Array.isArray(declinedItems) ? declinedItems : [];
  const lines = [`【変更依頼への回答】${factoryLabel}`];
  if (accepted.length) {
    lines.push(`承諾した項目: ${accepted.map(formatChangeRequestItemLine).join('、')}`);
  }
  if (declined.length) {
    lines.push(`対応不可の項目: ${declined.map(formatChangeRequestItemLine).join('、')}`);
  }
  if (accepted.length && declined.length) {
    lines.push('承諾した項目を注文へ反映しました。');
  } else if (accepted.length) {
    lines.push('変更依頼を承諾し、内容を反映しました。');
  } else {
    lines.push('変更依頼には対応できませんでした。');
  }
  return lines.join('\n');
}
