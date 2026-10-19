/** 変更依頼パッチを、工場が項目ごとに判断できる単位へまとめる */
import { formatPhoneJP } from './phoneFormat.js';

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
  if (key === 'sitePhone') return formatPhoneJP(value);
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
  return '（空欄にする）';
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
      display: formatPatchValue(key, patch) || '（空欄にする）',
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

/** 予定変更タブと同じ。例: 10/15（水） */
export function formatChangeRequestDateLabel(value) {
  const raw = String(value || '').trim().slice(0, 10);
  const matched = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(raw);
  if (!matched) return raw || '—';
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return raw;
  }
  const weeks = ['日', '月', '火', '水', '木', '金', '土'];
  return `${month}/${day}（${weeks[date.getDay()]}）`;
}

function formatChangeRequestClock(source) {
  const point = String(source?.timePointLabel || '').trim();
  if (point) return point;
  const slot = String(source?.timeSlotLabel || '').trim();
  if (slot && !slot.includes('〜')) return slot;
  const minutes = source?.scheduleMatchMinutes ?? source?.timeSlotMinutes ?? source?.timeSlot;
  const parsed = parseInt(minutes, 10);
  if (minutes != null && String(minutes).trim() !== '' && Number.isFinite(parsed)) {
    return `${Math.floor(parsed / 60)}:${String(parsed % 60).padStart(2, '0')}`;
  }
  if (slot.includes('〜')) return slot.split('〜')[0].trim();
  return '—';
}

/** 承諾・対応不可の項目を、差分行と同じ呼び方で1つにまとめる */
export function formatChangeRequestAnswerFragment(item) {
  const id = String(item?.id || '');
  const display = String(item?.display || '').trim();
  if (id === 'preferredDate') {
    const date = display ? formatChangeRequestDateLabel(display) : '（空欄にする）';
    return `打設日 ${date}`;
  }
  if (id === 'time') return `時刻 ${display || '（空欄にする）'}`;
  const labels = {
    vehicle: '車種',
    quantity: '数量',
    unload: '荷卸し時間',
    mix: '配合',
    siteName: '現場名',
    siteAddress: '現場住所',
    sitePhone: '電話番号',
    contractor: '業者名',
    has_test: '試験体',
    trader: '商社',
    tradingAgent: '商社担当者',
  };
  const label = labels[id] || String(item?.label || '').trim() || '項目';
  return `${label} ${display || '（空欄にする）'}`;
}

function joinAnswerFragments(items) {
  const text = (Array.isArray(items) ? items : []).map(formatChangeRequestAnswerFragment).filter(Boolean);
  return text.join('、');
}

/** 回答後も残っている打設日・時刻・配合 */
export function formatUnchangedOrderSummary(order) {
  const source = order && typeof order === 'object' ? order : {};
  const date = formatChangeRequestDateLabel(source.delivery_date || source.preferredDate || source.preferred_date);
  const time = formatChangeRequestClock(source);
  const mix = String(source.confirmedMixText || source.mixText || '').trim() || '—';
  return `打設日 ${date}、時刻 ${time}、配合 ${mix}`;
}

export function classifyChangeRequestAnswer(acceptedCount, declinedCount) {
  const accepted = Number(acceptedCount) || 0;
  const declined = Number(declinedCount) || 0;
  if (accepted > 0 && declined === 0) return 'accepted';
  if (accepted > 0 && declined > 0) return 'partial';
  return 'declined';
}

function resolutionKeys(order) {
  const resolution =
    order?.change_request_resolution &&
    typeof order.change_request_resolution === 'object' &&
    !Array.isArray(order.change_request_resolution)
      ? order.change_request_resolution
      : null;
  const accepted = Array.isArray(resolution?.accepted_keys) ? resolution.accepted_keys : [];
  const declined = Array.isArray(resolution?.declined_keys) ? resolution.declined_keys : [];
  return { accepted, declined };
}

/** 客確認待ちの注文を、保存済みの accepted_keys / declined_keys で分ける。全承諾は待ち状態に残らない。 */
export function classifyStoredChangeRequestAnswer(order) {
  if (!isAwaitingCustomerChangeDecision(order)) return null;
  const { accepted, declined } = resolutionKeys(order);
  if (accepted.length === 0 && declined.length === 0) return 'declined';
  return classifyChangeRequestAnswer(accepted.length, declined.length);
}

export function changeRequestAnswerBadge(order) {
  const kind = classifyStoredChangeRequestAnswer(order);
  if (kind === 'partial') {
    return {
      kind,
      label: '⚠️ 一部のみ変更を承りました',
      className: 'border-amber-500 bg-amber-50 text-amber-950 dark:border-amber-400 dark:bg-amber-950/40 dark:text-amber-100',
    };
  }
  if (kind === 'declined') {
    return {
      kind,
      label: '❌ 変更に対応できませんでした',
      className: 'border-red-500 bg-red-50 text-red-800 dark:border-red-400 dark:bg-red-950/40 dark:text-red-100',
    };
  }
  return null;
}

export function changeRequestAnswerToneFromMessage(body) {
  const text = String(body || '').trim();
  if (text.startsWith('✅ 変更を承りました')) return 'accepted';
  if (text.startsWith('⚠️ 一部のみ変更を承りました')) return 'partial';
  if (text.startsWith('❌ 変更に対応できませんでした')) return 'declined';
  return null;
}

export const CHANGE_REQUEST_ANSWER_CONTACT_LINE =
  'ご相談はこのチャット、または電話でお知らせください。';

export function formatChangeRequestResolveChatBody({
  factoryName,
  acceptedItems,
  declinedItems,
  order = null,
}) {
  const factoryLabel = String(factoryName || '').trim() || '工場';
  const accepted = Array.isArray(acceptedItems) ? acceptedItems : [];
  const declined = Array.isArray(declinedItems) ? declinedItems : [];
  const kind = classifyChangeRequestAnswer(accepted.length, declined.length);
  const acceptedText = joinAnswerFragments(accepted);
  const declinedText = joinAnswerFragments(declined);
  if (kind === 'accepted') {
    return [
      `✅ 変更を承りました（${factoryLabel}）`,
      `変更後の内容：${acceptedText || '—'}`,
    ].join('\n');
  }
  if (kind === 'partial') {
    return [
      `⚠️ 一部のみ変更を承りました（${factoryLabel}）`,
      `承諾した変更：${acceptedText || '—'}`,
      `対応できなかった変更：${declinedText || '—'}（元の内容のままです）`,
      CHANGE_REQUEST_ANSWER_CONTACT_LINE,
    ].join('\n');
  }
  return [
    `❌ 変更に対応できませんでした（${factoryLabel}）`,
    `対応できなかった変更：${declinedText || '—'}`,
    `ご注文は元の内容のままです：${formatUnchangedOrderSummary(order)}`,
    CHANGE_REQUEST_ANSWER_CONTACT_LINE,
  ].join('\n');
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
