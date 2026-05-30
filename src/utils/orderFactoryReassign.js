/** 手配先変更時に配車待ちへ差し戻す必要があるか */
export function shouldResetOrderStatusOnFactoryReassign(order) {
  if (!order) return false;
  const st = String(order.status || '').trim();
  const frs = String(order.factoryResponseStatus || '').trim();
  if (st === 'customer_cancelled' || st === 'deleted' || st === 'completed') return false;
  if (st === 'accepted' || st === 'confirmed') return true;
  if (frs === 'accepted' || frs === 'confirmed') return true;
  if (order.factoryResponseLocked === true) return true;
  const fid = order.factory_site_id ?? order.factorySiteId;
  return fid != null && String(fid).trim() !== '';
}

export function canAdminReassignOrderFactories(order) {
  if (!order) return false;
  const st = String(order.status || '').trim();
  return st !== 'deleted' && st !== 'customer_cancelled' && st !== 'pending_association';
}

export function formatFactoryAssignmentSummary(factoryIds, factoryNameById = {}) {
  const ids = Array.isArray(factoryIds) ? factoryIds.filter(Boolean) : [];
  if (!ids.length) return '—';
  return ids.map((id) => factoryNameById[id] || id).join('、');
}
