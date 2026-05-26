import {
  combineDeliveryAddress,
  normalizeAllowedDeliveryAreas,
  splitDeliveryAddress,
} from './deliveryAreas.js';

/** 注文・物件から市町村・住所テキストを抽出 */
export function getOrderDeliveryAreaContext(order, projectById = {}) {
  if (!order) {
    return { deliveryArea: '', addressDetail: '', fullAddress: '', locationPending: false };
  }
  const pid = order.project_id ?? order.projectId;
  const project = pid != null ? projectById[String(pid)] : null;

  const deliveryArea = String(
    order.delivery_area ?? order.deliveryArea ?? project?.delivery_area ?? '',
  ).trim();
  const addressDetail = String(
    order.site_address_detail ?? order.siteAddressDetail ?? project?.site_address ?? '',
  ).trim();
  const siteAddress = String(order.siteAddress ?? order.site_address ?? '').trim();
  const fullAddress =
    siteAddress || combineDeliveryAddress(deliveryArea, addressDetail);

  const locationPending = Boolean(order.is_location_pending ?? order.isLocationPending);

  if (!deliveryArea && fullAddress) {
    const split = splitDeliveryAddress(fullAddress, normalizeAllowedDeliveryAreas([]));
    return {
      deliveryArea: split.deliveryArea,
      addressDetail: split.addressDetail || addressDetail,
      fullAddress,
      locationPending,
    };
  }

  return { deliveryArea, addressDetail, fullAddress, locationPending };
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

/** 工場が当該市町村・住所エリアをカバーするか */
export function factoryCoversDeliveryArea(factory, deliveryArea, addressText, globalAllowedAreas) {
  const areas = factoryAllowedAreas(factory, globalAllowedAreas);
  if (!areas.length) return true;

  const area = String(deliveryArea || '').trim();
  const text = String(addressText || '').trim();

  if (area && areas.some((a) => area === a || area.startsWith(a) || a.startsWith(area))) {
    return true;
  }
  if (text && areas.some((a) => text.includes(a))) {
    return true;
  }
  return !area && !text;
}

/**
 * 座標なし（地図待ち等）向け: エリアに合う工場 ID を優先順で返す
 */
export function rankFactoryIdsByDeliveryArea(order, projectById, factories, globalAllowedAreas) {
  const list = Array.isArray(factories) ? factories : [];
  const { deliveryArea, fullAddress } = getOrderDeliveryAreaContext(order, projectById);
  const text = fullAddress || deliveryArea;

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
    if (factoryCoversDeliveryArea(f, deliveryArea, text, globalAllowedAreas)) {
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
