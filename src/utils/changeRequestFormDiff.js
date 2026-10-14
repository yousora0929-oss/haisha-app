import {
  CHANGE_REQUEST_FORM_FIELD_BY_ITEM_ID,
  CHANGE_REQUEST_ITEM_DEFS,
  expandChangeRequestKeys,
} from './changeRequestItems.js';
import { CUSTOMER_ORDER_EDIT_KEYS, snapshotOrderFields } from './orderFieldSnapshot.js';

/** 変更依頼フォームで比較する入力欄 */
export const CHANGE_REQUEST_FORM_FIELDS = [
  'preferredDate',
  'timeSlot',
  'vehicleType',
  'quantityM3',
  'unloadDuration',
  'mixText',
  'siteName',
  'siteAddress',
  'sitePhone',
  'hasTest',
  'contractorCustomerId',
  'contractorName',
  'agentOrganizationId',
  'traderName',
  'tradingAgentCustomerId',
];

const FORM_FIELD_ITEM_IDS = {
  preferredDate: ['preferredDate'],
  timeSlot: ['time'],
  vehicleType: ['vehicle'],
  quantityM3: ['quantity'],
  unloadDuration: ['unload'],
  mixText: ['mix'],
  siteName: ['siteName'],
  siteAddress: ['siteAddress'],
  sitePhone: ['sitePhone'],
  hasTest: ['has_test'],
  contractorCustomerId: ['contractor'],
  contractorName: ['contractor'],
  agentOrganizationId: ['trader'],
  traderName: ['trader'],
  tradingAgentCustomerId: ['tradingAgent'],
};

const FORM_FIELD_SNAPSHOT_KEY = {
  preferredDate: 'preferredDate',
  timeSlot: 'timeSlot',
  vehicleType: 'vehicleType',
  quantityM3: 'quantityM3',
  unloadDuration: 'unloadDuration',
  mixText: 'mixText',
  siteName: 'siteName',
  siteAddress: 'siteAddress',
  sitePhone: 'sitePhone',
  contractorCustomerId: 'contractor_customer_id',
  contractorName: 'contractorName',
  agentOrganizationId: 'agent_organization_id',
  traderName: 'traderName',
  tradingAgentCustomerId: 'trading_agent_customer_id',
};

function blankText(value) {
  if (value == null) return '';
  return String(value).trim();
}

/** null / undefined / 空文字は同じ未入力として扱う */
export function changeRequestValuesEqual(before, after) {
  return blankText(before) === blankText(after);
}

function formFieldEdited(field, initial, current) {
  if (field === 'hasTest') return Boolean(initial?.hasTest) !== Boolean(current?.hasTest);
  return !changeRequestValuesEqual(initial?.[field], current?.[field]);
}

export function editedChangeRequestFormFields(initial, current) {
  return CHANGE_REQUEST_FORM_FIELDS.filter((field) => formFieldEdited(field, initial, current));
}

function itemIdsForEditedFields(editedFields) {
  const fields = new Set(editedFields || []);
  const ids = new Set();
  for (const [itemId, formField] of Object.entries(CHANGE_REQUEST_FORM_FIELD_BY_ITEM_ID)) {
    if (fields.has(formField)) ids.add(itemId);
  }
  if (fields.has('contractorName')) ids.add('contractor');
  if (fields.has('traderName')) ids.add('trader');
  return ids;
}

/** ユーザーが編集したフォーム欄に対応するパッチキーだけを残す */
export function filterChangeRequestPatchToEditedFields(patch, editedFields) {
  const itemIds = itemIdsForEditedFields(editedFields);
  const allowed = new Set();
  for (const def of CHANGE_REQUEST_ITEM_DEFS) {
    if (!itemIds.has(def.id)) continue;
    def.keys.forEach((key) => allowed.add(key));
  }
  const out = {};
  for (const [key, value] of Object.entries(patch && typeof patch === 'object' ? patch : {})) {
    if (allowed.has(key)) out[key] = value;
  }
  return out;
}

export function changeRequestLabelsForKeys(keys) {
  const set = new Set((Array.isArray(keys) ? keys : []).map((key) => String(key || '')));
  const labels = [];
  for (const def of CHANGE_REQUEST_ITEM_DEFS) {
    if (def.keys.some((key) => set.has(key))) labels.push(def.label);
  }
  return labels;
}

function itemKeysForFormField(field) {
  const ids = new Set(FORM_FIELD_ITEM_IDS[field] || []);
  const keys = [];
  for (const def of CHANGE_REQUEST_ITEM_DEFS) {
    if (!ids.has(def.id)) continue;
    def.keys.forEach((key) => keys.push(key));
  }
  return keys;
}

function labelForFormField(field) {
  const ids = new Set(FORM_FIELD_ITEM_IDS[field] || []);
  const def = CHANGE_REQUEST_ITEM_DEFS.find((item) => ids.has(item.id));
  return def?.label || field;
}

function currentMatchesLatest(field, currentForm, latestSnap) {
  if (field === 'hasTest') {
    return (currentForm?.hasTest ? '1' : '0') === String(latestSnap?.has_test ?? '');
  }
  const snapKey = FORM_FIELD_SNAPSHOT_KEY[field];
  if (!snapKey) return false;
  return changeRequestValuesEqual(currentForm?.[field], latestSnap?.[snapKey]);
}

/**
 * 「最新の内容を読み込む」用。
 * base は現スナップショットの元注文、mine は現在の入力、latest は再取得した注文。
 * 未編集は latest を採用し、編集済みで latest が base と同じ欄は入力を残す。
 * 編集済みで latest が base とも入力とも違う欄だけを競合にする。
 */
export function classifyChangeRequestReload({ baseOrder, initialForm, currentForm, latestOrder }) {
  const edited = editedChangeRequestFormFields(initialForm, currentForm);
  const editedSet = new Set(edited);
  const watchKeys = [...expandChangeRequestKeys([...CUSTOMER_ORDER_EDIT_KEYS])];
  const baseSnap = snapshotOrderFields(baseOrder || {}, watchKeys);
  const latestSnap = snapshotOrderFields(latestOrder || {}, watchKeys);
  const hasBase = Boolean(baseOrder && typeof baseOrder === 'object');
  const adoptFields = [];
  const keepFields = [];
  const conflicts = [];

  for (const field of CHANGE_REQUEST_FORM_FIELDS) {
    if (!editedSet.has(field)) {
      adoptFields.push(field);
      continue;
    }
    keepFields.push(field);
    if (!hasBase) continue;
    const changedKeys = itemKeysForFormField(field).filter(
      (key) => String(baseSnap[key] ?? '') !== String(latestSnap[key] ?? ''),
    );
    if (!changedKeys.length) continue;
    if (currentMatchesLatest(field, currentForm, latestSnap)) continue;
    conflicts.push({
      field,
      label: labelForFormField(field),
      keys: changedKeys.map((key) => ({
        key,
        base: baseSnap[key] ?? '',
        latest: latestSnap[key] ?? '',
      })),
    });
  }

  return { edited, adoptFields, keepFields, conflicts };
}
