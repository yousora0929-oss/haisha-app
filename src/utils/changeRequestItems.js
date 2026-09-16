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

/** 却下キー（accepted に含まれないパッチキー）だけを抽出 */
export function pickDeclinedChangeRequestPatch(patch, acceptedKeys) {
  if (!isPlainPatch(patch)) return {};
  const acceptedSet = new Set((Array.isArray(acceptedKeys) ? acceptedKeys : []).map((key) => String(key)));
  const declinedKeys = Object.keys(patch).filter((key) => !acceptedSet.has(String(key)));
  return pickAcceptedChangeRequestPatch(patch, declinedKeys);
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

export function formatChangeRequestResolveChatBody({
  factoryName,
  acceptedItems,
  declinedItems,
  deferredApply = false,
}) {
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
  if (deferredApply && accepted.length && declined.length) {
    lines.push('一部対応不可のため、お客様の確認をお待ちしています。');
  } else if (accepted.length && declined.length) {
    lines.push('承諾した項目を注文へ反映しました。');
  } else if (accepted.length) {
    lines.push('変更依頼を承諾し、内容を反映しました。');
  } else {
    lines.push('変更依頼には対応できませんでした。');
  }
  return lines.join('\n');
}

export function isAwaitingCustomerChangeDecision(order) {
  return String(order?.change_request_customer_decision_status || '').trim() === 'awaiting_customer';
}

/** 客確認待ち→再依頼モーダルの案内文（「却下」は使わない） */
export const CUSTOMER_CHANGE_REQUEST_REREQUEST_NOTICE =
  'ご希望の条件ではご対応できません。お手数ですが再度変更をお願いします。';

/** CHANGE_REQUEST_ITEM_DEFS の id → OrderFullEditModal の editData フィールド名 */
export const CHANGE_REQUEST_FORM_FIELD_BY_ITEM_ID = {
  preferredDate: 'preferredDate',
  time: 'timeSlot',
  vehicle: 'vehicleType',
  quantity: 'quantityM3',
  unload: 'unloadDuration',
  mix: 'mixText',
  siteName: 'siteName',
  siteAddress: 'siteAddress',
  sitePhone: 'sitePhone',
  contractor: 'contractorCustomerId',
  has_test: 'hasTest',
  trader: 'agentOrganizationId',
  tradingAgent: 'tradingAgentCustomerId',
};

/** パッチキー群に対応するフォームフィールド名の Set */
export function changeRequestFormFieldsForKeys(patchKeys) {
  const keySet = new Set((Array.isArray(patchKeys) ? patchKeys : []).map((key) => String(key)));
  const fields = new Set();
  for (const def of CHANGE_REQUEST_ITEM_DEFS) {
    if (!def.keys.some((key) => keySet.has(key))) continue;
    const field = CHANGE_REQUEST_FORM_FIELD_BY_ITEM_ID[def.id];
    if (field) fields.add(field);
  }
  return fields;
}

/** フォーカス対象キーを、同じ項目に属する関連キーまで広げる */
export function expandChangeRequestKeys(patchKeys) {
  const keySet = new Set((Array.isArray(patchKeys) ? patchKeys : []).map((key) => String(key)));
  const out = new Set(keySet);
  for (const def of CHANGE_REQUEST_ITEM_DEFS) {
    if (!def.keys.some((key) => keySet.has(key))) continue;
    def.keys.forEach((key) => out.add(key));
  }
  return out;
}

/** パッチを許可キー（関連キー拡張後）だけに絞る */
export function filterPatchToChangeRequestKeys(patch, patchKeys) {
  if (!isPlainPatch(patch)) return {};
  const allow = expandChangeRequestKeys(patchKeys);
  const out = {};
  for (const [key, value] of Object.entries(patch)) {
    if (allow.has(String(key))) out[key] = value;
  }
  return out;
}

/** 2つのパッチが同じ変更内容か（項目ラベル単位の表示値で比較） */
export function changeRequestPatchesEqual(a, b) {
  const left = Object.fromEntries(
    listChangeRequestItems(isPlainPatch(a) ? a : {}).map((item) => [item.id, item.display]),
  );
  const right = Object.fromEntries(
    listChangeRequestItems(isPlainPatch(b) ? b : {}).map((item) => [item.id, item.display]),
  );
  const ids = new Set([...Object.keys(left), ...Object.keys(right)]);
  if (ids.size === 0) return true;
  for (const id of ids) {
    if (String(left[id] || '') !== String(right[id] || '')) return false;
  }
  return true;
}
