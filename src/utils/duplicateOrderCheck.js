import {
  CUSTOMER_ORDER_DISPATCH_WAITING_LABEL,
  CUSTOMER_ORDER_REJECTED_LABEL,
} from './customerStatusLabels.js';
import { formatYmdWithWeekday } from './orderGrouping.js';

/** 顧客画面の進行中グループと同じ、年を省いた曜日つき日付（例: 10/15㈬） */
export function formatDuplicateOrderDateLabel(value) {
  const full = formatYmdWithWeekday(value);
  if (!full) return '';
  const slash = full.indexOf('/');
  return slash >= 0 ? full.slice(slash + 1) : full;
}

export function formatDuplicateOrderTimeLabel(value) {
  const time = String(value ?? '').trim();
  return time || '時刻未定';
}

export const DUPLICATE_ORDER_RELATION_LABELS = {
  self: 'あなたの注文',
  same_company: '同じ会社の別の方の注文',
  cooperative: '組合の代理発注',
  agent: '商社の代理発注',
  other_contractor: '別の業者の注文',
};

/**
 * 受注済み（accepted / confirmed、または工場名あり）は「受注済み（工場名）」。
 * それ以外は顧客画面の既存ラベル。
 */
export function duplicateOrderStatusLabel(status, factoryName) {
  const factory = String(factoryName ?? '').trim();
  const st = String(status ?? '').trim();
  if (factory || st === 'accepted' || st === 'confirmed') {
    return factory ? `受注済み（${factory}）` : '受注済み';
  }
  if (st === 'pending' || st === '') return '回答待ち';
  if (st === 'pending_association') return '組合承認待ち';
  if (st === 'rejected') return CUSTOMER_ORDER_REJECTED_LABEL;
  if (st === 'customer_cancelled') return 'お客様都合キャンセル';
  if (st === 'cancelled' || st === 'deleted') return 'キャンセル';
  if (st === 'completed' || st === 'complete' || st === 'done' || st === 'delivered') return '完了';
  if (st === 'awaiting_admin_followup') return '要フォロー';
  if (st === 'hold' || st === 'factory_hold') return '保留対応中';
  return st || CUSTOMER_ORDER_DISPATCH_WAITING_LABEL;
}

export function duplicateOrderRelationLabel(relation) {
  const key = String(relation ?? '').trim();
  return DUPLICATE_ORDER_RELATION_LABELS[key] || '';
}

function formatDuplicateQuantity(value) {
  if (value == null || String(value).trim() === '') return '—';
  const raw = String(value).trim();
  const n = Number(raw);
  if (!Number.isFinite(n)) return `${raw}m³`;
  const text = Number.isInteger(n) ? String(n) : String(n);
  return `${text}m³`;
}

/** 例: 10/15㈬ 8:00　18-8-20BB　3m³　受注済み（工場）　（組合の代理発注） */
export function formatDuplicateOrderLine(row) {
  const date = formatDuplicateOrderDateLabel(row?.pour_date ?? row?.pourDate);
  const time = formatDuplicateOrderTimeLabel(row?.time_label ?? row?.timeLabel);
  const mix = String(row?.mix ?? '').trim() || '—';
  const qty = formatDuplicateQuantity(row?.quantity_m3 ?? row?.quantityM3);
  const status = duplicateOrderStatusLabel(row?.status, row?.factory_name ?? row?.factoryName);
  const relation = duplicateOrderRelationLabel(row?.relation);
  const head = [date, time].filter(Boolean).join(' ');
  const line = [head, mix, qty, status].filter(Boolean).join('　');
  return relation ? `${line}　（${relation}）` : line;
}

export function duplicateWarningLevel(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return null;
  if (list.some((row) => String(row?.level || '').trim() === 'strong')) return 'strong';
  return 'notice';
}

export function duplicateProceedBlocked(rows, acknowledged) {
  return duplicateWarningLevel(rows) === 'strong' && !acknowledged;
}

function rowPourDate(row) {
  return String(row?.pour_date ?? row?.pourDate ?? '').trim().slice(0, 10);
}

/** 打設日ごとにまとめる。日付見出しは顧客画面の曜日つき表示。 */
export function groupDuplicateRowsByDate(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const groups = [];
  const indexByDate = new Map();
  list.forEach((row, index) => {
    const date = rowPourDate(row);
    const key = date || `unknown-${index}`;
    let group = indexByDate.get(key);
    if (!group) {
      group = {
        key,
        date,
        label: formatDuplicateOrderDateLabel(date) || '日付未定',
        rows: [],
      };
      indexByDate.set(key, group);
      groups.push(group);
    }
    group.rows.push(row);
  });
  return groups;
}

function orderPourDate(order) {
  const raw = String(
    order?.preferredDate || order?.scheduleMatchDate || order?.preferred_date || order?.delivery_date || '',
  ).trim();
  const date = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '';
}

function orderProjectId(order) {
  const id = String(order?.project_id || order?.projectId || '').trim();
  return id || null;
}

/** 物件が無いときだけ現場住所。無ければ現場名。 */
export function duplicateOrderSiteKey(order) {
  if (orderProjectId(order)) return null;
  const address = String(order?.siteAddress || order?.site_address || '').trim();
  if (address) return address;
  const name = String(order?.siteName || order?.site_name || '').trim();
  return name || null;
}

function orderMix(order) {
  return String(order?.mixText || order?.confirmedMixText || '').trim();
}

function orderTimeLabel(order) {
  return String(order?.timePointLabel || order?.timeSlotLabel || '').trim();
}

/**
 * カートの全日分を、物件・現場・配合・時刻が同じ組ごとに1回の RPC 引数へまとめる。
 * @param {object[]} orders
 * @param {{ excludeOrderId?: string|null, contractorCustomerId?: string|null }} [options]
 */
function orderContractorCustomerId(order, fallback) {
  const fromOrder = String(order?.contractor_customer_id || order?.contractorCustomerId || '').trim();
  if (fromOrder) return fromOrder;
  const fromFallback = String(fallback || '').trim();
  return fromFallback || null;
}

export function buildDuplicateOrderQueries(orders, options = {}) {
  const excludeOrderId = String(options.excludeOrderId || '').trim() || null;
  const proxyOrder = Object.prototype.hasOwnProperty.call(options, 'contractorCustomerId');
  const contractorFallback =
    !proxyOrder || options.contractorCustomerId == null || String(options.contractorCustomerId).trim() === ''
      ? null
      : String(options.contractorCustomerId).trim();

  const groups = new Map();
  for (const order of Array.isArray(orders) ? orders : []) {
    const date = orderPourDate(order);
    if (!date) continue;
    const projectId = orderProjectId(order);
    const siteKey = duplicateOrderSiteKey(order);
    const mix = orderMix(order);
    const timeLabel = orderTimeLabel(order);
    const contractorCustomerId = proxyOrder ? orderContractorCustomerId(order, contractorFallback) : null;
    const key = [projectId || '', siteKey || '', mix, timeLabel, contractorCustomerId || ''].join('\u0000');
    let group = groups.get(key);
    if (!group) {
      group = {
        projectId,
        siteKey,
        dates: [],
        mix,
        timeLabel,
        contractorCustomerId,
        excludeOrderId,
      };
      groups.set(key, group);
    }
    if (!group.dates.includes(date)) group.dates.push(date);
  }
  return [...groups.values()];
}

/**
 * @param {(query: object) => Promise<object[]>} check
 * @param {object[]} orders
 * @param {{ excludeOrderId?: string|null, contractorCustomerId?: string|null }} [options]
 */
export async function fetchDuplicateOrderWarnings(check, orders, options) {
  const queries = buildDuplicateOrderQueries(orders, options);
  if (!queries.length || typeof check !== 'function') return [];
  const chunks = await Promise.all(queries.map((query) => check(query)));
  return chunks.flatMap((rows) => (Array.isArray(rows) ? rows : []));
}

const INACTIVE_MONITOR_STATUSES = new Set([
  'cancelled',
  'customer_cancelled',
  'deleted',
  'rejected',
]);

export function isActiveOrderForDuplicateMonitor(order) {
  const status = String(order?.status || 'pending').trim() || 'pending';
  return !INACTIVE_MONITOR_STATUSES.has(status);
}

export function duplicateMonitorKey(order) {
  const projectId = String(order?.project_id || order?.projectId || '').trim();
  const date = orderPourDate(order);
  if (!projectId || !date) return '';
  return `${projectId}|${date}`;
}

/** 同じ物件・同じ打設日に有効な注文が2件以上あるキー */
export function collectDuplicateMonitorKeys(orders) {
  const counts = new Map();
  for (const order of Array.isArray(orders) ? orders : []) {
    if (!isActiveOrderForDuplicateMonitor(order)) continue;
    const key = duplicateMonitorKey(order);
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  const flagged = new Set();
  for (const [key, count] of counts) {
    if (count >= 2) flagged.add(key);
  }
  return flagged;
}
