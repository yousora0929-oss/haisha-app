import { getElapsedMinutesSinceEffectiveStart } from './dateUtils.js';
import { calculateDistance } from './geoUtils.js';

function orderCreatedAt(order) {
  return order?.createdAt ?? order?.created_at ?? null;
}

function orderProjectId(order) {
  const id = order?.project_id ?? order?.projectId;
  return id != null ? String(id).trim() : '';
}

function orderPreferredFactoryId(order) {
  const id = order?.preferred_factory_id ?? order?.preferredFactoryId;
  return id != null ? String(id).trim() : '';
}

function orderFactoryId(order) {
  const a = order?.factory_site_id != null ? String(order.factory_site_id).trim() : '';
  if (a) return a;
  return order?.factorySiteId != null ? String(order.factorySiteId).trim() : '';
}

function addIdsToSet(target, ids) {
  for (const raw of ids) {
    const id = raw != null ? String(raw).trim() : '';
    if (id) target.add(id);
  }
}

function rejectedFactoryIdSet(order) {
  return new Set(
    (Array.isArray(order?.rejected_factory_ids) ? order.rejected_factory_ids : [])
      .map((x) => String(x).trim())
      .filter(Boolean),
  );
}

function getProjectEscalationIds(order, project) {
  const preferredId = orderPreferredFactoryId(order);
  const mainId = project?.main_factory_id != null ? String(project.main_factory_id) : '';
  return {
    preferredId,
    mainId,
    firstTargetId: preferredId || mainId,
  };
}

function isRelatedProjectFactory(order, project, factoryId) {
  const fid = String(factoryId || '').trim();
  if (!fid || !project) return false;
  const { preferredId, mainId } = getProjectEscalationIds(order, project);
  const subIds = Array.isArray(project.sub_factory_ids)
    ? project.sub_factory_ids.map((x) => String(x).trim()).filter(Boolean)
    : [];
  const relatedIds = new Set();
  addIdsToSet(relatedIds, [preferredId, mainId, ...subIds]);
  return relatedIds.has(fid);
}

export function getEffectiveEscalationMinutes(order, projectById, settings, holidays, now = new Date()) {
  const status = String(order?.status || '');
  if (status === 'accepted' || status === 'customer_cancelled') return null;
  const created = orderCreatedAt(order);
  if (!created) return 0;
  const minutes = getElapsedMinutesSinceEffectiveStart(created, settings, holidays, now);
  if (Boolean(order?.is_spot)) return minutes;

  const pid = orderProjectId(order);
  const project = pid ? projectById?.[pid] : null;
  if (!project) return minutes;

  const { firstTargetId } = getProjectEscalationIds(order, project);
  if (!firstTargetId) return minutes;

  const rejected = rejectedFactoryIdSet(order);
  if (rejected.has(firstTargetId) && minutes < 15) return 15;
  return minutes;
}

/** 現場座標（物件マスタ優先、なければ delivery / order_data） */
export function getOrderSiteCoords(order, projectById) {
  const pid = orderProjectId(order);
  if (pid && projectById[pid]) {
    const p = projectById[pid];
    if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
      return { lat: p.lat, lng: p.lng };
    }
  }
  const lat =
    order?.delivery_lat ?? order?.deliveryLat ?? order?.siteLat ?? order?.site_lat ?? order?.lat;
  const lng =
    order?.delivery_lng ?? order?.deliveryLng ?? order?.siteLng ?? order?.site_lng ?? order?.lng;
  const la = Number(lat);
  const ln = Number(lng);
  if (Number.isFinite(la) && Number.isFinite(ln)) return { lat: la, lng: ln };
  return null;
}

/** 距離の近い順に工場 ID を並べる */
export function rankFactoryIdsByDistance(siteCoords, factories) {
  const list = Array.isArray(factories) ? factories : [];
  return list
    .map((f) => {
      const id = f?.id != null ? String(f.id) : '';
      if (!id) return null;
      const dist = siteCoords
        ? calculateDistance(siteCoords.lat, siteCoords.lng, f.latitude, f.longitude)
        : Infinity;
      return { id, dist };
    })
    .filter(Boolean)
    .sort((a, b) => a.dist - b.dist || a.id.localeCompare(b.id))
    .map((x) => x.id);
}

export function enrichOrderWithProject(order, projectById) {
  if (!order || typeof order !== 'object') return order;
  const pid = orderProjectId(order);
  const p = pid ? projectById[pid] : null;
  if (!p) return order;
  const tc = (p.trading_company_name || p.trading_company || '').trim();
  const ct = (p.contractor || '').trim();
  return {
    ...order,
    projectTradingCompany: tc,
    projectTradingCompanyName: tc,
    trading_company_name: order.trading_company_name || tc,
    projectContractor: ct,
    displayTraderName: tc || order.traderName,
    displayContractorName: ct || order.contractorName,
  };
}

/**
 * @param {object} order
 * @param {string} factoryId
 * @param {{
 *   projectById: Record<string, object>,
 *   topNByOrderId: Map<string, { top3: string[], top6: string[] }>,
 *   settings: object,
 *   holidays: Array,
 *   now: Date,
 *   allFactoryIds: string[],
 * }} ctx
 */
export function isOrderVisibleToFactory(order, factoryId, ctx) {
  const fid = String(factoryId || '').trim();
  if (!fid || !order) return false;

  const assigned = orderFactoryId(order);
  const status = order?.status != null ? String(order.status) : '';
  if (status === 'deleted') return false;
  const isSpot = Boolean(order.is_spot);
  const pid = orderProjectId(order);
  const project = !isSpot && pid ? ctx.projectById[pid] : null;

  if (status === 'accepted') {
    if (!assigned) return false;
    if (!isSpot) return assigned === fid || isRelatedProjectFactory(order, project, fid);
    return true;
  }
  if (assigned && assigned === fid) return true;
  if (assigned && assigned !== fid) return false;

  const created = orderCreatedAt(order);
  if (!created) return false;

  const preferredId = orderPreferredFactoryId(order);
  const ranked = ctx.topNByOrderId.get(order.id) || { top3: [], top6: [] };
  const { top3, top6 } = ranked;
  const allIds = ctx.allFactoryIds || [];

  const effectiveMinutes = getEffectiveEscalationMinutes(order, ctx.projectById, ctx.settings, ctx.holidays, ctx.now);

  if (effectiveMinutes >= 45) {
    return allIds.length === 0 ? true : allIds.includes(fid);
  }

  if (project) {
    const { mainId } = getProjectEscalationIds(order, project);
    const subIds = Array.isArray(project.sub_factory_ids)
      ? project.sub_factory_ids.map((x) => String(x)).filter(Boolean)
      : [];

    const set15 = new Set();
    addIdsToSet(set15, [preferredId, mainId, ...subIds]);

    const set30 = new Set(set15);
    addIdsToSet(set30, top3);

    if (effectiveMinutes >= 30) return set30.has(fid);
    if (effectiveMinutes >= 15) return set15.has(fid);

    const tier0 = preferredId || mainId;
    return Boolean(tier0) && fid === tier0;
  }

  if (effectiveMinutes >= 30) return top6.includes(fid);

  if (effectiveMinutes >= 15) {
    const set = new Set();
    addIdsToSet(set, [preferredId, ...top3]);
    return set.has(fid);
  }

  if (preferredId) return fid === preferredId;
  return top3.includes(fid);
}

/**
 * @param {object[]} orders
 * @param {object[]} factories
 * @param {object[]} projects
 * @param {object} settings
 * @param {Array} holidays
 * @param {Date} [now]
 */
export function buildEscalationContext(orders, factories, projects, settings, holidays, now = new Date()) {
  const projectById = Object.fromEntries(
    (projects || []).filter((p) => p && p.id).map((p) => [String(p.id), p]),
  );
  const allFactoryIds = (factories || [])
    .map((f) => (f?.id != null ? String(f.id) : ''))
    .filter(Boolean);
  const topNByOrderId = new Map();
  for (const o of orders || []) {
    if (!o?.id) continue;
    const site = getOrderSiteCoords(o, projectById);
    const ranked = rankFactoryIdsByDistance(site, factories);
    topNByOrderId.set(o.id, { top3: ranked.slice(0, 3), top6: ranked.slice(0, 6) });
  }
  return {
    projectById,
    topNByOrderId,
    settings: settings || {},
    holidays: holidays || [],
    now,
    factories,
    allFactoryIds,
  };
}

export function filterOrdersForFactory(orders, factoryId, ctx) {
  return (orders || [])
    .map((o) => enrichOrderWithProject(o, ctx.projectById))
    .filter((o) => isOrderVisibleToFactory(o, factoryId, ctx));
}
