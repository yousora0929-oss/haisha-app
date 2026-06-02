import {
  combineDeliveryAddress,
  extractProjectAddressFields,
  normalizeAllowedDeliveryAreas,
  splitDeliveryAddress,
} from './deliveryAreas.js';

function normalizeAreaText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

/** 町名比較用: 空白除去・NFKC・「大字」等の接頭辞除去 */
const TOWN_NAME_PREFIXES = ['大字', '小字', '字'];

export function normalizeTownNameForMatch(value) {
  let s = normalizeAreaText(value);
  if (!s) return '';
  if (typeof s.normalize === 'function') {
    s = s.normalize('NFKC');
  }
  s = s.replace(/[\s\u3000]+/g, '');
  let prev = '';
  while (s !== prev) {
    prev = s;
    for (const prefix of TOWN_NAME_PREFIXES) {
      if (s.startsWith(prefix)) {
        s = s.slice(prefix.length);
        break;
      }
    }
  }
  return s;
}

/** 注文町名と工場登録町名が双方向部分一致するか */
function townNamesPartiallyMatch(orderTown, factoryTown) {
  const a = normalizeTownNameForMatch(orderTown);
  const b = normalizeTownNameForMatch(factoryTown);
  if (!a || !b) return false;
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  if (shorter.length < 2) return false;
  return a.includes(b) || b.includes(a);
}

function extractTownSegmentFromFactoryArea(factoryArea, deliveryArea) {
  const faNorm = normalizeTownNameForMatch(factoryArea);
  const cityNorm = normalizeTownNameForMatch(deliveryArea);
  if (!faNorm) return '';
  if (cityNorm && faNorm.startsWith(cityNorm)) {
    const remainder = faNorm.slice(cityNorm.length);
    return remainder || faNorm;
  }
  return faNorm;
}

function formatTownCompareLog(orderTown, factoryTown, matched) {
  const a = normalizeTownNameForMatch(orderTown);
  const b = normalizeTownNameForMatch(factoryTown);
  return `Comparing: "${a}" with "${b}" -> ${matched ? 'true' : 'false'}`;
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
  const fa = normalizeTownNameForMatch(factoryArea);
  const city = normalizeTownNameForMatch(deliveryArea);
  return Boolean(city && fa === city);
}

/** 工場エリアが指定町名をカバーするか（部分一致・正規化対応） */
function factoryAreaMatchesTown(factoryArea, deliveryArea, town, debugSink = null) {
  const fa = normalizeAreaText(factoryArea);
  const city = normalizeAreaText(deliveryArea);
  const t = normalizeAreaText(town);
  const emit = (matched, reason, factoryTownCandidate = '') => {
    const candidate = factoryTownCandidate || extractTownSegmentFromFactoryArea(fa, city) || fa;
    const comparing = formatTownCompareLog(t, candidate, matched);
    if (debugSink) {
      debugSink.push({
        factoryArea: fa,
        orderTown: t,
        factoryTownCandidate: candidate,
        comparing,
        matched,
        reason,
      });
    }
    return matched;
  };

  if (!fa || !t) return emit(false, 'empty_input');

  const tNorm = normalizeTownNameForMatch(t);
  const faNorm = normalizeTownNameForMatch(fa);
  const faTownNorm = extractTownSegmentFromFactoryArea(fa, city);
  const combinedNorm = normalizeTownNameForMatch(combineDeliveryAddress(city, t));

  if (tNorm === faNorm || tNorm === faTownNorm) {
    return emit(true, 'exact_normalized', faTownNorm || faNorm);
  }
  if (faNorm === combinedNorm) {
    return emit(true, 'exact_combined', faNorm);
  }

  if (city && faNorm.startsWith(normalizeTownNameForMatch(city))) {
    const remainder = normalizeTownNameForMatch(fa.slice(city.length));
    if (remainder && townNamesPartiallyMatch(t, remainder)) {
      return emit(true, 'city_prefix_partial', remainder);
    }
  }

  if (townNamesPartiallyMatch(t, faTownNorm)) {
    return emit(true, 'partial_town_segment', faTownNorm);
  }
  if (faTownNorm !== faNorm && townNamesPartiallyMatch(t, faNorm)) {
    return emit(true, 'partial_full_factory_area', faNorm);
  }

  return emit(false, 'no_match', faTownNorm || faNorm);
}

/** 市町村のみの注文向け（町名未指定） */
function factoryAreaMatchesMunicipality(factoryArea, deliveryArea) {
  const fa = normalizeTownNameForMatch(factoryArea);
  const city = normalizeTownNameForMatch(deliveryArea);
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
  const normalizedFactoryArea = normalizeTownNameForMatch(factoryArea);
  if (!normalizedFactoryArea) return false;

  return candidates.some((candidate) => {
    if (!candidate) return false;
    const normalizedCandidate = normalizeTownNameForMatch(candidate);
    if (!normalizedCandidate) return false;
    if (normalizedCandidate === normalizedFactoryArea) return true;
    return townNamesPartiallyMatch(normalizedCandidate, normalizedFactoryArea);
  });
}

/** 工場エリア判定の詳細（デバッグ用） */
export function evaluateFactoryDeliveryAreaCoverage(
  factory,
  deliveryArea,
  addressText,
  globalAllowedAreas,
  addressDetail = '',
) {
  const factoryAreas = getFactorySpecificAreas(factory);
  const city = normalizeAreaText(deliveryArea);
  const effectiveTown = resolveEffectiveTown(city, addressDetail, addressText, globalAllowedAreas);
  const comparisons = [];

  if (effectiveTown) {
    if (!factoryAreas.length) {
      return {
        covers: false,
        mode: 'town_strict',
        effectiveTown,
        comparisons: [
          {
            matched: false,
            reason: 'factory_areas_empty',
            comparing: `工場 "${factory?.name || factory?.id || ''}" に町名レベルの allowed_delivery_areas が未設定`,
          },
        ],
      };
    }
    let covers = false;
    for (const fa of factoryAreas) {
      const sink = [];
      const townMatched = factoryAreaMatchesTown(fa, city, effectiveTown, sink);
      const muniMatched = factoryAreaMatchesMunicipality(fa, city);
      comparisons.push(...sink);
      if (muniMatched && !townMatched) {
        comparisons.push({
          factoryArea: fa,
          orderTown: normalizeTownNameForMatch(effectiveTown),
          factoryTownCandidate: normalizeTownNameForMatch(fa),
          comparing: `市町村マッチ（町名指定中）: "${normalizeTownNameForMatch(city)}" vs "${normalizeTownNameForMatch(fa)}" -> true`,
          matched: true,
          reason: 'municipality_match_in_town_mode',
        });
      }
      if (townMatched || muniMatched) covers = true;
    }
    return { covers, mode: 'town_strict', effectiveTown, comparisons };
  }

  if (city) {
    if (factoryAreas.length) {
      const municipalityMatches = factoryAreas.map((fa) => {
        const matched = factoryAreaMatchesMunicipality(fa, city);
        return {
          factoryArea: fa,
          matched,
          comparing: `市町村マッチ: "${normalizeTownNameForMatch(city)}" vs "${normalizeTownNameForMatch(fa)}" -> ${matched}`,
          reason: matched ? 'municipality_match' : 'municipality_no_match',
        };
      });
      comparisons.push(...municipalityMatches);
      return {
        covers: municipalityMatches.some((row) => row.matched),
        mode: 'municipality',
        effectiveTown: '',
        comparisons,
      };
    }
    // グローバル設定へのフォールバックは使わず、factory.allowed_delivery_areas のみで判定
    return {
      covers: false,
      mode: 'municipality_factory_areas_empty',
      effectiveTown: '',
      comparisons: [],
    };
  }

  const candidates = buildAddressMatchCandidates(deliveryArea, addressDetail, addressText);
  if (!candidates.length) {
    return { covers: false, mode: 'address_candidates_empty', effectiveTown: '', comparisons: [] };
  }

  if (!factoryAreas.length) {
    // グローバル設定へのフォールバックは使わず、factory.allowed_delivery_areas のみで判定
    return { covers: false, mode: 'address_factory_areas_empty', effectiveTown: '', comparisons: [] };
  }
  const areas = factoryAreas;
  const addressMatches = areas.map((fa) => {
    const matched = areaStringsMatch(fa, candidates);
    const candidate = candidates.find((c) => areaStringsMatch(fa, [c])) || candidates[0];
    return {
      factoryArea: fa,
      matched,
      comparing: formatTownCompareLog(candidate, fa, matched),
      reason: matched ? 'address_partial_match' : 'address_no_match',
    };
  });
  return {
    covers: addressMatches.some((row) => row.matched),
    mode: 'address_fallback',
    effectiveTown: '',
    comparisons: addressMatches,
  };
}

export function factoryCoversDeliveryArea(
  factory,
  deliveryArea,
  addressText,
  globalAllowedAreas,
  addressDetail = '',
) {
  return evaluateFactoryDeliveryAreaCoverage(
    factory,
    deliveryArea,
    addressText,
    globalAllowedAreas,
    addressDetail,
  ).covers;
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
  const factoryDetails = (Array.isArray(factories) ? factories : []).map((f) => {
    const specific = getFactorySpecificAreas(f);
    const evaluation = evaluateFactoryDeliveryAreaCoverage(
      f,
      deliveryArea,
      text,
      globalAllowedAreas,
      addressDetail,
    );
    return {
      id: f?.id,
      name: f?.name,
      areas: specific,
      result: evaluation.covers,
      mode: evaluation.mode,
      comparisons: evaluation.comparisons,
    };
  });

  console.log('【Escalation Debug】', {
    判定対象の市町村: deliveryArea,
    判定対象の町名: effectiveTown || addressDetail,
    正規化町名: effectiveTown ? normalizeTownNameForMatch(effectiveTown) : '',
    各工場の判定詳細: factoryDetails,
    マッチした工場ID: matching,
    フォールバック工場ID: fallback,
    結果: pool,
  });

  for (const row of factoryDetails) {
    const verdict = row.result ? '通過' : '除外';
    console.log(
      `【Escalation Debug】工場 "${row.name || row.id}" -> ${verdict}`,
      row.comparisons?.length ? row.comparisons : '（比較なし）',
    );
  }
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

  for (const f of list) {
    const id = f?.id != null ? String(f.id) : '';
    if (!id) continue;
    if (factoryCoversDeliveryArea(f, deliveryArea, text, globalAllowedAreas, addressDetail)) {
      matching.push(id);
    }
  }
  const pool = matching;

  logEscalationDebug({
    deliveryArea,
    addressDetail,
    effectiveTown,
    factories: list,
    globalAllowedAreas,
    matching,
    fallback: [],
    pool,
  });

  const preferredInPool = pool.filter((id) => preferred.has(id));
  const rest = pool.filter((id) => !preferred.has(id));
  return [...preferredInPool, ...rest];
}
