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

/** 工場マスタ固有の allowed_delivery_areas（グローバル設定へのフォールバックなし） */
export function getFactorySpecificAreas(factory) {
  const raw =
    factory?.allowed_delivery_areas ??
    factory?.allowedDeliveryAreas ??
    factory?.raw?.allowed_delivery_areas;
  return normalizeAllowedDeliveryAreas(raw);
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

function resolveEffectiveTown(deliveryArea, addressDetail, addressText, globalAllowedAreas) {
  const town = normalizeAreaText(addressDetail);
  if (town) return town;

  const city = normalizeAreaText(deliveryArea);
  const text = normalizeAreaText(addressText);
  if (!text) return '';

  if (city && text !== city && text.startsWith(city)) {
    return normalizeAreaText(text.slice(city.length));
  }

  const split = splitDeliveryAddress(text, globalAllowedAreas);
  return normalizeAreaText(split.addressDetail);
}

/** 工場エリア文字列が市町村名のみか（町名指定注文には不適合） */
function isMunicipalityOnlyFactoryArea(factoryArea, deliveryArea) {
  const fa = normalizeAreaText(factoryArea);
  const city = normalizeAreaText(deliveryArea);
  return Boolean(city && fa === city);
}

/** 工場エリアが指定町名をカバーするか（厳格） */
function factoryAreaMatchesTown(factoryArea, deliveryArea, town) {
  const fa = normalizeAreaText(factoryArea);
  const city = normalizeAreaText(deliveryArea);
  const t = normalizeAreaText(town);
  if (!fa || !t) return false;

  if (isMunicipalityOnlyFactoryArea(fa, city)) return false;
  if (fa === t) return true;

  const combined = normalizeAreaText(combineDeliveryAddress(city, t));
  if (fa === combined) return true;

  if (city && fa.startsWith(city)) {
    const remainder = normalizeAreaText(fa.slice(city.length));
    if (remainder === t || remainder.startsWith(t) || t.startsWith(remainder)) {
      return true;
    }
  }

  if (fa.includes(t) && fa !== city) return true;

  return false;
}

/** 市町村のみの注文向け（町名未指定） */
function factoryAreaMatchesMunicipality(factoryArea, deliveryArea) {
  const fa = normalizeAreaText(factoryArea);
  const city = normalizeAreaText(deliveryArea);
  if (!city || !fa) return false;
  return fa === city || fa.startsWith(city) || city.startsWith(fa);
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

/**
 * 工場が当該市町村・町名・住所エリアをカバーするか
 * 町名が指定されている場合は工場側にその町名が明示されている工場のみ true
 */
export function factoryCoversDeliveryArea(
  factory,
  deliveryArea,
  addressText,
  globalAllowedAreas,
  addressDetail = '',
) {
  const factoryAreas = getFactorySpecificAreas(factory);
  const city = normalizeAreaText(deliveryArea);
  const effectiveTown = resolveEffectiveTown(city, addressDetail, addressText, globalAllowedAreas);

  if (effectiveTown) {
    if (!factoryAreas.length) return false;
    return factoryAreas.some((fa) => factoryAreaMatchesTown(fa, city, effectiveTown));
  }

  if (city) {
    if (factoryAreas.length) {
      return factoryAreas.some((fa) => factoryAreaMatchesMunicipality(fa, city));
    }
    const globalAreas = normalizeAllowedDeliveryAreas(globalAllowedAreas);
    if (!globalAreas.length) return true;
    return globalAreas.some((fa) => factoryAreaMatchesMunicipality(fa, city));
  }

  const candidates = buildAddressMatchCandidates(deliveryArea, addressDetail, addressText);
  if (!candidates.length) return false;

  const areas = factoryAreas.length ? factoryAreas : normalizeAllowedDeliveryAreas(globalAllowedAreas);
  if (!areas.length) return true;
  return areas.some((fa) => areaStringsMatch(fa, candidates));
}

function logEscalationDebug({
  deliveryArea,
  addressDetail,
  effectiveTown,
  factories,
  globalAllowedAreas,
  matching,
  fallback,
  pool,
}) {
  if (typeof console === 'undefined' || typeof console.log !== 'function') return;

  const text = combineDeliveryAddress(deliveryArea, addressDetail) || deliveryArea;
  const factoryAreas = (Array.isArray(factories) ? factories : []).map((f) => {
    const specific = getFactorySpecificAreas(f);
    const covers = factoryCoversDeliveryArea(f, deliveryArea, text, globalAllowedAreas, addressDetail);
    return {
      id: f?.id,
      name: f?.name,
      areas: specific,
      result: covers,
    };
  });

  console.log('【Escalation Debug】', {
    判定対象の市町村: deliveryArea,
    判定対象の町名: effectiveTown || addressDetail,
    各工場の設定: factoryAreas,
    マッチした工場ID: matching,
    フォールバック工場ID: fallback,
    結果: pool,
  });
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
  const effectiveTown = resolveEffectiveTown(deliveryArea, addressDetail, text, globalAllowedAreas);
  const strictTownFilter = Boolean(effectiveTown);

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
  const preferredId = orderPreferred != null ? String(orderPreferred).trim() : '';
  if (preferredId && preferredId !== '[object Object]') preferred.add(preferredId);

  const matching = [];
  const fallback = [];
  const knownFactoryIds = new Set(list.map((f) => (f?.id != null ? String(f.id) : '')).filter(Boolean));

  for (const f of list) {
    const id = f?.id != null ? String(f.id) : '';
    if (!id) continue;
    if (factoryCoversDeliveryArea(f, deliveryArea, text, globalAllowedAreas, addressDetail)) {
      matching.push(id);
    } else if (!strictTownFilter) {
      fallback.push(id);
    }
  }

  let pool = matching.length
    ? matching
    : strictTownFilter
      ? []
      : fallback.length
        ? fallback
        : list.map((f) => String(f.id)).filter(Boolean);

  // エリア一致0件でも第一希望・物件メイン・全工場へフォールバック
  if (!pool.length && knownFactoryIds.size > 0) {
    if (preferredId && knownFactoryIds.has(preferredId)) {
      pool = [preferredId];
    } else if (project?.main_factory_id && knownFactoryIds.has(String(project.main_factory_id))) {
      pool = [String(project.main_factory_id)];
    } else {
      pool = [...knownFactoryIds];
    }
  }

  // VIP: 第一希望はエリア外でも先頭に必ず含める
  if (preferredId && knownFactoryIds.has(preferredId)) {
    pool = [preferredId, ...pool.filter((id) => id !== preferredId)];
  }

  logEscalationDebug({
    deliveryArea,
    addressDetail,
    effectiveTown,
    factories: list,
    globalAllowedAreas,
    matching,
    fallback,
    pool,
  });

  const preferredInPool = pool.filter((id) => preferred.has(id));
  const rest = pool.filter((id) => !preferred.has(id));
  return [...preferredInPool, ...rest];
}
