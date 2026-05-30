import { associationAssignedFactoryIds } from './associationFactoryAssignment.js';
import { filterOrdersForFactory, isOrderVisibleToFactory } from './escalationUtils.js';

function orderStatus(order) {
  return String(order?.status || 'pending').trim();
}

function isRejectedByFactory(order, factoryId) {
  const fid = String(factoryId || '').trim();
  if (!fid || !order) return false;
  const ids = Array.isArray(order.rejected_factory_ids) ? order.rejected_factory_ids : [];
  return ids.map((x) => String(x).trim()).includes(fid);
}

function isPendingForFactoryNotify(order, factoryId) {
  if (!order?.id) return false;
  if (orderStatus(order) !== 'pending') return false;
  if (isRejectedByFactory(order, factoryId)) return false;
  return true;
}

function reassignmentTimestamp(order) {
  const raw = order?.association_reassigned_at ?? order?.associationReassignedAt;
  return raw != null ? String(raw).trim() : '';
}

function preferredFactoryId(order) {
  return String(order?.preferred_factory_id ?? order?.preferredFactoryId ?? '').trim();
}

function orderWasReassignedToFactory(prev, next, factoryId) {
  if (!prev || !next?.id) return false;
  const fid = String(factoryId || '').trim();
  if (!fid) return false;

  const reAt = reassignmentTimestamp(next);
  const prevReAt = reassignmentTimestamp(prev);
  if (reAt && reAt !== prevReAt) return true;

  if (orderStatus(prev) === 'accepted' && orderStatus(next) === 'pending') return true;

  const pref = preferredFactoryId(next);
  const prevPref = preferredFactoryId(prev);
  if (pref === fid && pref !== prevPref) return true;

  const nextPool = associationAssignedFactoryIds(next);
  const prevPool = associationAssignedFactoryIds(prev);
  if (nextPool.join('|') !== prevPool.join('|') && nextPool.includes(fid)) return true;

  return false;
}

/**
 * 再フェッチ前後の注文一覧から、当該工場へ通知すべき pending 注文 ID を返す
 * @returns {{ notifyOrderIds: Set<string>, reassignNotifyOrderIds: Set<string> }}
 */
export function detectFactoryNotifyOrderIds(prevOrders, nextOrders, factoryId, ctx) {
  const fid = String(factoryId || '').trim();
  const notifyOrderIds = new Set();
  const reassignNotifyOrderIds = new Set();
  if (!fid || !ctx) return { notifyOrderIds, reassignNotifyOrderIds };

  const prevList = Array.isArray(prevOrders) ? prevOrders : [];
  const nextList = Array.isArray(nextOrders) ? nextOrders : [];
  const prevById = new Map(prevList.filter((o) => o?.id).map((o) => [String(o.id), o]));

  const prevVisible = new Set(
    filterOrdersForFactory(prevList, fid, ctx)
      .filter((o) => isPendingForFactoryNotify(o, fid))
      .map((o) => String(o.id)),
  );

  for (const order of filterOrdersForFactory(nextList, fid, ctx)) {
    if (!isPendingForFactoryNotify(order, fid)) continue;
    const id = String(order.id);
    const prev = prevById.get(id);

    if (!prevVisible.has(id)) {
      notifyOrderIds.add(id);
      continue;
    }
    if (prev && orderWasReassignedToFactory(prev, order, fid)) {
      notifyOrderIds.add(id);
      reassignNotifyOrderIds.add(id);
    }
  }

  return { notifyOrderIds, reassignNotifyOrderIds };
}

/**
 * Realtime payload（UPDATE）から通知対象を推定（old が不完全でも new 側で補完）
 */
export function analyzeFactoryOrderRealtimePayload(payload, factoryId, ctx) {
  const fid = String(factoryId || '').trim();
  const result = { notifyOrderIds: new Set(), reassignNotifyOrderIds: new Set(), refetch: true };
  if (!fid || !ctx || !payload) return result;

  const eventType = String(payload.eventType || payload.event || '').toUpperCase();
  if (eventType !== 'UPDATE' && eventType !== 'INSERT') return result;

  const newRow = payload.new && typeof payload.new === 'object' ? payload.new : null;
  const oldRow = payload.old && typeof payload.old === 'object' ? payload.old : null;
  if (!newRow?.id) return result;

  const orderId = String(newRow.id);
  const nowVisible = isOrderVisibleToFactory(newRow, fid, ctx);
  const wasVisible = oldRow?.id ? isOrderVisibleToFactory(oldRow, fid, ctx) : false;

  if (nowVisible && isPendingForFactoryNotify(newRow, fid)) {
    if (!wasVisible || eventType === 'INSERT') {
      result.notifyOrderIds.add(orderId);
    } else if (orderWasReassignedToFactory(oldRow, newRow, fid)) {
      result.notifyOrderIds.add(orderId);
      result.reassignNotifyOrderIds.add(orderId);
    }
  }

  result.removedFromFactory = wasVisible && !nowVisible;
  return result;
}
