import {
  combineDeliveryAddress,
  extractProjectAddressFields,
  normalizeAllowedDeliveryAreas,
  splitDeliveryAddress,
} from './deliveryAreas.js';

function normalizeAreaText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function readOrderString(order, keys) {
  if (!order || typeof order !== 'object') return '';
  for (const key of keys) {
    const value = order[key];
    if (value != null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return '';
}

/** 注文・物件から市町村・住所テキストを抽出（地図待ち・手動入力・地図ピン共通） */
export function getOrderDeliveryAreaContext(order, projectById = {}, globalAllowedAreas = []) {
  if (!order) {
    return { deliveryArea: '', addressDetail: '', fullAddress: '', locationPending: false };
  }

  const pid = order.project_id ?? order.projectId;
  const project = pid != null ? projectById[String(pid)] : null;
  const locationPending = Boolean(order.is_location_pending ?? order.isLocationPending);
  const areas = normalizeAllowedDeliveryAreas(globalAllowedAreas);

  const orderDeliveryArea = readOrderString(order, [
    'delivery_area',
    'deliveryArea',
    'city',
    'municipality',
  ]);
  const orderAddressDetail = readOrderString(order, [
    'site_address_detail',
    'siteAddressDetail',
    'town_address',
    'townAddress',
    'town',
    'manualAddress',
  ]);
  const orderSiteAddress = readOrderString(order, ['siteAddress', 'site_address']);

  let deliveryArea = orderDeliveryArea;
  let addressDetail = orderAddressDetail;

  if (!deliveryArea && !addressDetail && !locationPending && project) {
    const fromProject = extractProjectAddressFields(project, areas);
    if (!deliveryArea) deliveryArea = fromProject.deliveryArea;
    if (!addressDetail) addressDetail = fromProject.siteAddressDetail;
  }

  let fullAddress =
    orderSiteAddress || combineDeliveryAddress(deliveryArea, addressDetail);

  if (fullAddress && (!deliveryArea || !addressDetail)) {
    const split = splitDeliveryAddress(fullAddress, areas);
    if (!deliveryArea && split.deliveryArea) deliveryArea = split.deliveryArea;
    if (!addressDetail && split.addressDetail) addressDetail = split.addressDetail;
  }

  if (deliveryArea && fullAddress && !addressDetail && fullAddress.length > deliveryArea.length) {
    const rest = fullAddress.startsWith(deliveryArea)
      ? fullAddress.slice(deliveryArea.length).trim()
      : fullAddress.replace(deliveryArea, '').trim();
    if (rest) addressDetail = rest;
  }

  if (deliveryArea && addressDetail && addressDetail.startsWith(deliveryArea)) {
    addressDetail = addressDetail.slice(deliveryArea.length).trim();
  }

  fullAddress = orderSiteAddress || combineDeliveryAddress(deliveryArea, addressDetail);

  return {
    deliveryArea: normalizeAreaText(deliveryArea),
    addressDetail: normalizeAreaText(addressDetail),
    fullAddress: normalizeAreaText(fullAddress),
    locationPending,
  };
}

function factoryAllowedAreas(factory, globalAllowedAreas) {
  const raw =
    factory?.allowed_delivery_areas ??
    factory?.allowedDeliveryAreas ??
    factory?.raw?.allowed_delivery_areas;
  const list = normalizeAllowedDeliveryAreas(raw);
  if (list.length) return list;
  return normalizeAllowedDeliveryAreas(globalAllowedAreas);
}

function buildAddressMatchCandidates(deliveryArea, addressDetail, addressText) {
  const area = normalizeAreaText(deliveryArea);
  const detail = normalizeAreaText(addressDetail);
  const text = normalizeAreaText(addressText);
  const combined = normalizeAreaText(combineDeliveryAddress(area, detail));
  return [...new Set([text, combined, detail, area].filter(Boolean))];
}

function areaStringsMatch(factoryArea, candidates) {
  const normalizedFactoryArea = normalizeAreaText(factoryArea);
  if (!normalizedFactoryArea) return false;

  return candidates.some((candidate) => {
    if (!candidate) return false;
    if (candidate === normalizedFactoryArea) return true;
    if (candidate.startsWith(normalizedFactoryArea) || normalizedFactoryArea.startsWith(candidate)) {
      return true;
    }
    if (candidate.includes(normalizedFactoryArea) || normalizedFactoryArea.includes(candidate)) {
      return true;
    }
    return false;
  });
}

/** 工場が当該市町村・町名・住所エリアをカバーするか */
export function factoryCoversDeliveryArea(
  factory,
  deliveryArea,
  addressText,
  globalAllowedAreas,
  addressDetail = '',
) {
  const areas = factoryAllowedAreas(factory, globalAllowedAreas);
  if (!areas.length) return true;

  const candidates = buildAddressMatchCandidates(deliveryArea, addressDetail, addressText);
  if (!candidates.length) return false;

  return areas.some((factoryArea) => areaStringsMatch(factoryArea, candidates));
}

/**
 * 座標なし（地図待ち等）向け: エリアに合う工場 ID を優先順で返す
 */
export function rankFactoryIdsByDeliveryArea(order, projectById, factories, globalAllowedAreas) {
  const list = Array.isArray(factories) ? factories : [];
  const { deliveryArea, addressDetail, fullAddress } = getOrderDeliveryAreaContext(
    order,
    projectById,
    globalAllowedAreas,
  );
  const text = fullAddress || combineDeliveryAddress(deliveryArea, addressDetail) || deliveryArea;

  const pid = order?.project_id ?? order?.projectId;
  const project = pid != null ? projectById[String(pid)] : null;
  const preferred = new Set();
  if (project?.main_factory_id) preferred.add(String(project.main_factory_id));
  if (Array.isArray(project?.sub_factory_ids)) {
    for (const id of project.sub_factory_ids) {
      if (id) preferred.add(String(id));
    }
  }
  const orderPreferred = order?.preferred_factory_id ?? order?.preferredFactoryId;
  if (orderPreferred) preferred.add(String(orderPreferred));

  const matching = [];
  const fallback = [];

  for (const f of list) {
    const id = f?.id != null ? String(f.id) : '';
    if (!id) continue;
    if (factoryCoversDeliveryArea(f, deliveryArea, text, globalAllowedAreas, addressDetail)) {
      matching.push(id);
    } else {
      fallback.push(id);
    }
  }

  const pool = matching.length ? matching : fallback.length ? fallback : list.map((f) => String(f.id)).filter(Boolean);

  const preferredInPool = pool.filter((id) => preferred.has(id));
  const rest = pool.filter((id) => !preferred.has(id));
  return [...preferredInPool, ...rest];
}
