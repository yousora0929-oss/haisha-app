const ACCEPTED_STATUSES = new Set(['accepted', 'confirmed']);
const REJECTED_STATUSES = new Set(['rejected', 'cancelled']);

function effectiveStatus(order) {
  const od =
    order?.order_data && typeof order.order_data === 'object' && !Array.isArray(order.order_data)
      ? order.order_data
      : null;
  const frs = String(
    order?.factoryResponseStatus ??
      order?.factory_response_status ??
      od?.factoryResponseStatus ??
      '',
  ).trim();
  if (frs) return frs;
  const st = String(order?.status ?? od?.status ?? '').trim();
  return st || 'pending';
}

function isPendingLike(status) {
  const s = String(status || '').trim();
  return !s || s === 'pending' || s === 'pending_association';
}

function isAcceptedLike(status) {
  return ACCEPTED_STATUSES.has(String(status || '').trim());
}

function isRejectedLike(status) {
  return REJECTED_STATUSES.has(String(status || '').trim());
}

function orderSiteLabel(order) {
  return (
    String(order?.siteName ?? order?.projectName ?? order?.site_name ?? order?.project_name ?? '').trim() ||
    String(order?.id || '').trim()
  );
}

function factorySiteId(order) {
  const od =
    order?.order_data && typeof order.order_data === 'object' && !Array.isArray(order.order_data)
      ? order.order_data
      : null;
  return String(
    order?.factory_site_id ?? order?.factorySiteId ?? od?.factory_site_id ?? od?.factorySiteId ?? '',
  ).trim();
}

function preferredFactoryId(order) {
  const od =
    order?.order_data && typeof order.order_data === 'object' && !Array.isArray(order.order_data)
      ? order.order_data
      : null;
  return String(
    order?.preferred_factory_id ??
      order?.preferredFactoryId ??
      od?.preferred_factory_id ??
      od?.preferredFactoryId ??
      '',
  ).trim();
}

/** 工場受注: pending 系 → accepted / confirmed */
export function orderFactoryWasAccepted(prev, next) {
  if (!prev?.id || !next?.id) return false;
  const prevStatus = effectiveStatus(prev);
  const nextStatus = effectiveStatus(next);
  return isPendingLike(prevStatus) && isAcceptedLike(nextStatus);
}

/** 全社対応不可: pending 系 → rejected / cancelled */
export function orderFactoryWasRejected(prev, next) {
  if (!prev?.id || !next?.id) return false;
  const prevStatus = effectiveStatus(prev);
  const nextStatus = effectiveStatus(next);
  if (String(nextStatus) === 'customer_cancelled') return false;
  return isPendingLike(prevStatus) && isRejectedLike(nextStatus);
}

/** 管理者による手配先変更 */
export function orderFactoryAssignmentChanged(prev, next) {
  if (!prev?.id || !next?.id) return false;
  if (factorySiteId(prev) !== factorySiteId(next)) return true;
  if (preferredFactoryId(prev) !== preferredFactoryId(next)) return true;
  return false;
}

function buildPrevMap(prevOrders) {
  return new Map(
    (Array.isArray(prevOrders) ? prevOrders : [])
      .filter((o) => o?.id)
      .map((o) => [String(o.id), o]),
  );
}

/**
 * 再フェッチ前後からカスタマー向け通知イベントを検出
 * @returns {{ factoryAccepted: boolean, factoryRejected: boolean, factoryReassigned: boolean, acceptedSiteLabels: string[], rejectedSiteLabels: string[] }}
 */
export function detectCustomerOrderNotifications(prevOrders, nextOrders, isRelevantOrder) {
  const result = {
    factoryAccepted: false,
    factoryRejected: false,
    factoryReassigned: false,
    acceptedSiteLabels: [],
    rejectedSiteLabels: [],
  };
  const isRelevant = typeof isRelevantOrder === 'function' ? isRelevantOrder : () => true;
  const prevById = buildPrevMap(prevOrders);
  const nextList = (Array.isArray(nextOrders) ? nextOrders : []).filter(isRelevant);

  for (const next of nextList) {
    const prev = prevById.get(String(next.id));
    if (!prev) continue;
    if (orderFactoryWasAccepted(prev, next)) {
      result.factoryAccepted = true;
      const site = orderSiteLabel(next);
      if (site) result.acceptedSiteLabels.push(site);
    } else if (orderFactoryWasRejected(prev, next)) {
      result.factoryRejected = true;
      const site = orderSiteLabel(next);
      if (site) result.rejectedSiteLabels.push(site);
    } else if (orderFactoryAssignmentChanged(prev, next)) {
      result.factoryReassigned = true;
    }
  }

  return result;
}

/**
 * Realtime UPDATE/INSERT ペイロードから通知イベントを推定
 * @param {(row: object) => object|null} [normalizeRow]
 */
export function analyzeCustomerOrderRealtimePayload(payload, isRelevantOrder, normalizeRow) {
  const result = {
    factoryAccepted: false,
    factoryRejected: false,
    factoryReassigned: false,
    acceptedSiteLabels: [],
    rejectedSiteLabels: [],
    refetch: true,
  };
  const isRelevant = typeof isRelevantOrder === 'function' ? isRelevantOrder : () => true;
  const normalize = typeof normalizeRow === 'function' ? normalizeRow : (row) => row;
  if (!payload) return result;

  const eventType = String(payload.eventType || payload.event || '').toUpperCase();
  if (eventType !== 'UPDATE' && eventType !== 'INSERT') return result;

  const newRow = normalize(payload.new && typeof payload.new === 'object' ? payload.new : null);
  const oldRow = payload.old && typeof payload.old === 'object' ? normalize(payload.old) : null;
  if (!newRow?.id || !isRelevant(newRow)) return result;

  if (eventType === 'INSERT') return result;

  if (!oldRow?.id) return result;

  if (orderFactoryWasAccepted(oldRow, newRow)) {
    result.factoryAccepted = true;
    const site = orderSiteLabel(newRow);
    if (site) result.acceptedSiteLabels.push(site);
  } else if (orderFactoryWasRejected(oldRow, newRow)) {
    result.factoryRejected = true;
    const site = orderSiteLabel(newRow);
    if (site) result.rejectedSiteLabels.push(site);
  } else if (orderFactoryAssignmentChanged(oldRow, newRow)) {
    result.factoryReassigned = true;
  }

  return result;
}
