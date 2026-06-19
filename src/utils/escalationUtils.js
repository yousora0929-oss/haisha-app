import { getElapsedMinutesSinceEffectiveStart } from './dateUtils.js';
import { calculateDistance } from './geoUtils.js';
import { normalizeAllowedDeliveryAreas } from './deliveryAreas.js';
import {
  getOrderDeliveryAreaContext,
  factoryCoversDeliveryArea,
  rankFactoryIdsByDeliveryArea,
} from './deliveryAreaEscalation.js';
import { associationAssignedFactoryIds } from './associationFactoryAssignment.js';
import {
  formatEscalationStepLabel,
  getActiveEscalationStep,
  getEscalationStepsForAnchor,
  getNextEscalationThreshold,
} from './escalationSteps.js';

function orderCreatedAt(order) {
  return order?.createdAt ?? order?.created_at ?? null;
}

function orderProjectId(order) {
  const id = order?.project_id ?? order?.projectId;
  return id != null ? String(id).trim() : '';
}

/** 工場参照 ID を安全に文字列化（オブジェクト・undefined 混入を防ぐ） */
export function normalizeFactoryRefId(value) {
  if (value == null) return '';
  if (typeof value === 'object') {
    const nested = value.id ?? value.factory_id ?? value.factoryId;
    if (nested != null && nested !== value) return normalizeFactoryRefId(nested);
    return '';
  }
  const s = String(value).trim();
  if (!s || s === '[object Object]') return '';
  const lower = s.toLowerCase();
  if (lower === 'undefined' || lower === 'null') return '';
  return s;
}

function orderPreferredFactoryId(order) {
  return normalizeFactoryRefId(order?.preferred_factory_id ?? order?.preferredFactoryId);
}

/** ユーザーが第一希望工場を明示指定したか（スポットの自動補完は false） */
export function isUserSpecifiedPreferredFactory(order) {
  if (!order || typeof order !== 'object') return false;
  const od =
    order.order_data && typeof order.order_data === 'object' && !Array.isArray(order.order_data)
      ? order.order_data
      : order;
  if (order.preferred_factory_user_specified === true) return true;
  if (order.preferredFactoryUserSpecified === true) return true;
  if (od.preferred_factory_user_specified === true) return true;
  if (od.preferredFactoryUserSpecified === true) return true;
  const pid = orderProjectId(order);
  if (pid && orderPreferredFactoryId(order)) return true;
  return false;
}

function buildKnownFactoryIdSet(factories) {
  return new Set(
    (Array.isArray(factories) ? factories : [])
      .map((f) => (f?.id != null ? String(f.id).trim() : ''))
      .filter(Boolean),
  );
}

/** 第一希望工場をエリア外でもリスト先頭に置く（ユーザー明示指定時のみ） */
function applyPreferredFactoryVip(rankedIds, preferredId, knownFactoryIds, userSpecified) {
  const pref = userSpecified ? normalizeFactoryRefId(preferredId) : '';
  if (!pref || !knownFactoryIds.has(pref)) {
    return Array.isArray(rankedIds) ? [...rankedIds] : [];
  }
  const rest = (Array.isArray(rankedIds) ? rankedIds : []).filter((id) => String(id) !== pref);
  return [pref, ...rest];
}

/** エリア一致0件時: 第一希望 → 物件メイン → 全工場 */
function resolveEscalationEmptyFallback(order, projectById, knownFactoryIds) {
  const preferredId = orderPreferredFactoryId(order);
  if (preferredId && knownFactoryIds.has(preferredId)) return [preferredId];

  const pid = orderProjectId(order);
  const project = pid ? projectById?.[pid] : null;
  const mainId = normalizeFactoryRefId(project?.main_factory_id);
  if (mainId && knownFactoryIds.has(mainId)) return [mainId];

  return [...knownFactoryIds];
}

function finalizeEscalationRank(rankedIds, order, projectById, factories) {
  const knownFactoryIds = buildKnownFactoryIdSet(factories);
  let result = (Array.isArray(rankedIds) ? rankedIds : [])
    .map((id) => String(id).trim())
    .filter((id) => knownFactoryIds.has(id));

  if (!result.length && knownFactoryIds.size > 0) {
    result = resolveEscalationEmptyFallback(order, projectById, knownFactoryIds);
  }

  return applyPreferredFactoryVip(
    result,
    orderPreferredFactoryId(order),
    knownFactoryIds,
    isUserSpecifiedPreferredFactory(order),
  );
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

function resolveEscalationAnchorFactoryId(order, project, ranked) {
  const preferredId = isUserSpecifiedPreferredFactory(order) ? orderPreferredFactoryId(order) : '';
  if (preferredId) return preferredId;
  const mainId = normalizeFactoryRefId(project?.main_factory_id);
  if (mainId) return mainId;
  return ranked?.[0] || '';
}

function isOrderVisibleByEscalationSteps(order, factoryId, ctx, project, ranked, effectiveMinutes) {
  const anchorId = resolveEscalationAnchorFactoryId(order, project, ranked);
  const steps = getEscalationStepsForAnchor(anchorId, ctx.escalationStepsByFactoryId);
  const active = getActiveEscalationStep(steps, effectiveMinutes);
  const count = Math.max(1, Number(active.target_factory_count) || 1);
  const rejected = rejectedFactoryIdSet(order);
  const eligible = (Array.isArray(ranked) ? ranked : []).filter(
    (id) => !rejected.has(String(id || '').trim()),
  );
  const visibleIds = eligible.slice(0, count);
  if (!visibleIds.length) return false;
  return visibleIds.includes(String(factoryId || '').trim());
}

export function getOrderEscalationStepInfo(order, ctx) {
  const pid = orderProjectId(order);
  const project = pid ? ctx?.projectById?.[pid] : null;
  const ranked = ctx?.areaFactoryIdsByOrder?.get(order?.id) || [];
  const effectiveMinutes = getEffectiveEscalationMinutes(
    order,
    ctx?.projectById,
    ctx?.settings,
    ctx?.holidays,
    ctx?.now,
  );
  const anchorId = resolveEscalationAnchorFactoryId(order, project, ranked);
  const steps = getEscalationStepsForAnchor(anchorId, ctx?.escalationStepsByFactoryId);
  const active = getActiveEscalationStep(steps, effectiveMinutes);
  const nextThreshold = getNextEscalationThreshold(steps, effectiveMinutes);
  return {
    anchorId,
    steps,
    active,
    nextThreshold,
    effectiveMinutes,
    label: formatEscalationStepLabel(active, nextThreshold, effectiveMinutes),
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
  if (Boolean(order?.is_spot)) {
    const rejected = rejectedFactoryIdSet(order);
    if (rejected.size > 0 && minutes < 15) return 15;
    return minutes;
  }

  const pid = orderProjectId(order);
  const project = pid ? projectById?.[pid] : null;
  if (!project) return minutes;

  const { firstTargetId } = getProjectEscalationIds(order, project);
  if (!firstTargetId) return minutes;

  const rejected = rejectedFactoryIdSet(order);
  if (rejected.has(firstTargetId) && minutes < 15) return 15;
  return minutes;
}

/** 現場座標（物件マスタ優先、なければ delivery / 代表地点 / order_data） */
export function getOrderSiteCoords(order, projectById) {
  const pid = orderProjectId(order);
  const locationPending = Boolean(order?.is_location_pending ?? order?.isLocationPending);

  if (!locationPending && pid && projectById?.[pid]) {
    const p = projectById[pid];
    if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
      return { lat: p.lat, lng: p.lng };
    }
  }

  const lat =
    order?.delivery_lat ??
    order?.deliveryLat ??
    order?.representative_lat ??
    order?.representativeLat ??
    order?.rough_lat ??
    order?.roughLat ??
    order?.siteLat ??
    order?.site_lat ??
    order?.lat;
  const lng =
    order?.delivery_lng ??
    order?.deliveryLng ??
    order?.representative_lng ??
    order?.representativeLng ??
    order?.rough_lng ??
    order?.roughLng ??
    order?.siteLng ??
    order?.site_lng ??
    order?.lng;
  const la = Number(lat);
  const ln = Number(lng);
  if (Number.isFinite(la) && Number.isFinite(ln)) return { lat: la, lng: ln };

  if (pid && projectById[pid]) {
    const p = projectById[pid];
    if (Number.isFinite(p.lat) && Number.isFinite(p.lng)) {
      return { lat: p.lat, lng: p.lng };
    }
  }

  return null;
}

/**
 * エスカレーション判定モード
 * 1. 有効な座標あり（地図ピン or 地図待ちの代表地点）→ DISTANCE_BASED
 * 2. 座標なし → AREA_BASED（住所テキスト）
 */
function resolveEscalationRankMode(order, projectById, globalAllowedAreas) {
  const locationPending = Boolean(order?.is_location_pending ?? order?.isLocationPending);
  const siteCoords = getOrderSiteCoords(order, projectById);

  if (siteCoords) {
    return {
      mode: 'DISTANCE_BASED',
      reason: locationPending ? 'location_pending_representative_coordinates' : 'pinned_coordinates',
      siteCoords,
      locationPending,
    };
  }

  const addrCtx = getOrderDeliveryAreaContext(order, projectById, globalAllowedAreas);
  if (locationPending || addrCtx.deliveryArea || addrCtx.fullAddress || addrCtx.addressDetail) {
    return {
      mode: 'AREA_BASED',
      reason: locationPending ? 'location_pending_no_coordinates' : 'no_coordinates_address_fallback',
      locationPending,
    };
  }

  return {
    mode: 'DISTANCE_BASED',
    reason: 'no_coordinates_no_address_all_factories',
    siteCoords: null,
    locationPending,
  };
}

/** 注文ごとのエスカレーション対象工場 ID（距離 or 市町村ベース） */
export function rankFactoryIdsForOrder(order, projectById, factories, globalAllowedAreas) {
  const addrCtx = getOrderDeliveryAreaContext(order, projectById, globalAllowedAreas);
  const rankMode = resolveEscalationRankMode(order, projectById, globalAllowedAreas);
  const siteCoords = rankMode.siteCoords ?? getOrderSiteCoords(order, projectById);

  if (typeof console !== 'undefined' && typeof console.log === 'function') {
    console.log('【Escalation Debug】rankFactoryIdsForOrder', {
      Mode: rankMode.mode,
      modeReason: rankMode.reason,
      判定対象の市町村: addrCtx.deliveryArea,
      判定対象の町名: addrCtx.addressDetail,
      地図待ち: addrCtx.locationPending,
      代表座標距離判定: rankMode.reason === 'location_pending_representative_coordinates',
      地図ピン座標: siteCoords || null,
      第一希望工場: orderPreferredFactoryId(order) || null,
    });
  }

  let ranked;
  if (rankMode.mode === 'AREA_BASED') {
    ranked = rankFactoryIdsByDeliveryArea(order, projectById, factories, globalAllowedAreas);
  } else {
    ranked = rankFactoryIdsByDistance(order, projectById, siteCoords, factories, globalAllowedAreas);
  }

  const finalized = finalizeEscalationRank(ranked, order, projectById, factories);

  if (typeof console !== 'undefined' && typeof console.log === 'function') {
    console.log('【Escalation Debug】rankFactoryIdsForOrder 結果', {
      Mode: rankMode.mode,
      第一希望工場: orderPreferredFactoryId(order) || null,
      公開候補数: finalized.length,
      公開候補: finalized,
    });
  }

  return finalized;
}

/** 距離の近い順に工場 ID を並べる */
export function rankFactoryIdsByDistance(order, projectById, siteCoords, factories, globalAllowedAreas) {
  const list = Array.isArray(factories) ? factories : [];
  const addrCtx = getOrderDeliveryAreaContext(order, projectById, globalAllowedAreas);
  const hasAddress =
    Boolean(addrCtx.deliveryArea) || Boolean(addrCtx.addressDetail) || Boolean(addrCtx.fullAddress);

  const deliveryArea = addrCtx.deliveryArea;
  const addressDetail = addrCtx.addressDetail;
  const addressText = addrCtx.fullAddress || addrCtx.deliveryArea || '';

  // 「allowed_delivery_areas に含まれる工場だけ」を配達可能プールにする
  const eligible = hasAddress
    ? list.filter((f) => factoryCoversDeliveryArea(f, deliveryArea, addressText, globalAllowedAreas, addressDetail))
    : list;

  // 空になった場合は安全のため全体へフォールバック（VIP/空配列回避は finalizeEscalationRank 側でも行う）
  const eligibleWithFallback = eligible.length ? eligible : list;

  const rankedWithDist = eligibleWithFallback
    .map((f) => {
      const id = f?.id != null ? String(f.id) : '';
      if (!id) return null;
      const dist = siteCoords
        ? calculateDistance(siteCoords.lat, siteCoords.lng, f.latitude, f.longitude)
        : Infinity;
      return { id, dist };
    })
    .filter(Boolean)
    .sort((a, b) => a.dist - b.dist || a.id.localeCompare(b.id));

  const ids = rankedWithDist.map((x) => x.id);

  if (typeof console !== 'undefined' && typeof console.log === 'function') {
    console.log('【Escalation Debug】DISTANCE eligible', {
      判定対象の市町村: deliveryArea,
      判定対象の町名: addressDetail,
      許容プール数: eligible.length,
      許容プールフォールバック: eligible.length === 0,
      距離順: rankedWithDist.map((x) => ({ id: x.id, km: Number.isFinite(x.dist) ? Number(x.dist.toFixed(3)) : x.dist })),
    });
  }

  return ids;
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
  if (status === 'pending_association') return false;

  // 相談中はエスカレーションを停止し、相談している工場のみに表示する
  const consultStatus = String(order?.factory_consult_status ?? order?.factoryConsultStatus ?? '').trim();
  if (consultStatus === 'consulting' && status !== 'accepted') {
    const consultBy = normalizeFactoryRefId(
      order?.factory_consult_by_factory_id ?? order?.factoryConsultByFactoryId,
    );
    return Boolean(consultBy) && fid === consultBy;
  }

  const associationPool = associationAssignedFactoryIds(order);
  if (associationPool.length > 0 && status === 'pending') {
    return associationPool.includes(fid);
  }

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

  const preferredId = orderPreferredFactoryId(order);
  const ranked = ctx.areaFactoryIdsByOrder?.get(order.id) || [];
  const areaIds = ranked.length ? ranked : ctx.allFactoryIds || [];
  const effectiveMinutes = getEffectiveEscalationMinutes(order, ctx.projectById, ctx.settings, ctx.holidays, ctx.now);

  return isOrderVisibleByEscalationSteps(order, fid, ctx, project, areaIds, effectiveMinutes);
}

/**
 * @param {object[]} orders
 * @param {object[]} factories
 * @param {object[]} projects
 * @param {object} settings
 * @param {Array} holidays
 * @param {Date} [now]
 */
export function buildEscalationContext(
  orders,
  factories,
  projects,
  settings,
  holidays,
  now = new Date(),
  escalationStepsByFactoryId = {},
) {
  const projectById = Object.fromEntries(
    (projects || []).filter((p) => p && p.id).map((p) => [String(p.id), p]),
  );
  const globalAllowedAreas = normalizeAllowedDeliveryAreas(settings?.allowed_delivery_areas);
  const allFactoryIds = (factories || [])
    .map((f) => (f?.id != null ? String(f.id) : ''))
    .filter(Boolean);
  const topNByOrderId = new Map();
  const areaFactoryIdsByOrder = new Map();
  for (const o of orders || []) {
    if (!o?.id) continue;
    const ranked = rankFactoryIdsForOrder(o, projectById, factories, globalAllowedAreas);
    topNByOrderId.set(o.id, { top3: ranked.slice(0, 3), top6: ranked.slice(0, 6) });
    areaFactoryIdsByOrder.set(o.id, ranked);
  }
  return {
    projectById,
    topNByOrderId,
    areaFactoryIdsByOrder,
    settings: settings || {},
    holidays: holidays || [],
    now,
    factories,
    allFactoryIds,
    globalAllowedAreas,
    escalationStepsByFactoryId:
      escalationStepsByFactoryId && typeof escalationStepsByFactoryId === 'object'
        ? escalationStepsByFactoryId
        : {},
  };
}

export function filterOrdersForFactory(orders, factoryId, ctx) {
  return (orders || [])
    .map((o) => enrichOrderWithProject(o, ctx.projectById))
    .filter((o) => isOrderVisibleToFactory(o, factoryId, ctx));
}

/** 管理画面用: 現時点で当該注文を閲覧できる工場 ID 一覧 */
export function getVisibleFactoryIdsForOrder(order, ctx) {
  const status = order?.status != null ? String(order.status) : '';
  if (status === 'deleted' || status === 'pending_association') return [];
  const ids = ctx?.allFactoryIds || [];
  return ids.filter((fid) => isOrderVisibleToFactory(order, fid, ctx));
}
