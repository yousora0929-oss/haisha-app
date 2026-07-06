import { TIME_SLOTS } from '../haishaConstants.js';
import {
  combineDeliveryAddress,
  getDeliveryAreaValidationMessage,
  normalizeAllowedDeliveryAreas,
} from './deliveryAreas.js';
import { looksLikeUrlText, sanitizeSiteNameValue } from './siteNameDisplay.js';
import { normalizeFactoryRefId } from './escalationUtils.js';
import { resolveProjectTradingCompanyName } from './projectTradingCompany.js';

/** 物件マスタから工場ID（main_factory_id）を抽出 */
export function resolveFactoryIdFromProject(project) {
  if (!project || typeof project !== 'object') return '';
  return (
    normalizeFactoryRefId(
      project.main_factory_id ?? project.mainFactoryId ?? project.factory_id ?? project.factoryId,
    ) || ''
  );
}

/** selectedProjectId から物件オブジェクトを確実に特定 */
export function resolveTargetProject(context) {
  const selectedProject = context?.selectedProject;
  const selectedProjectId = String(context?.selectedProjectId || '').trim();
  if (selectedProject && selectedProject.id != null) {
    const projectId = String(selectedProject.id).trim();
    if (!selectedProjectId || projectId === selectedProjectId) return selectedProject;
  }
  if (!selectedProjectId) return null;
  const pools = [
    ...(Array.isArray(context?.filteredProjects) ? context.filteredProjects : []),
    ...(Array.isArray(context?.projects) ? context.projects : []),
  ];
  const seen = new Set();
  for (const p of pools) {
    if (!p?.id) continue;
    const id = String(p.id).trim();
    if (seen.has(id)) continue;
    seen.add(id);
    if (id === selectedProjectId) return p;
  }
  return null;
}

/** 発注ペイロード用の工場ID（フォームで明示指定された場合のみ） */
export function resolveOrderPreferredFactoryId(context) {
  return normalizeFactoryRefId(context?.preferredFactoryId) || '';
}

/**
 * INSERT 前に preferred_factory_id を正規化する。
 * スポットはユーザー明示指定のみ保持（自動補完しない）。RLS は spot + 配達エリアで公開。
 */
export function ensureOrderPreferredFactoryForInsert(order) {
  if (!order || typeof order !== 'object') return order;
  const existing = normalizeFactoryRefId(order.preferred_factory_id ?? order.preferredFactoryId);
  const userSpecified = Boolean(
    order.preferred_factory_user_specified ??
      order.preferredFactoryUserSpecified ??
      order.order_data?.preferred_factory_user_specified ??
      order.order_data?.preferredFactoryUserSpecified,
  );
  if (!existing) return order;
  return {
    ...order,
    preferred_factory_id: existing,
    preferredFactoryId: existing,
    preferred_factory_user_specified: userSpecified,
    preferredFactoryUserSpecified: userSpecified,
  };
}

const UNLOAD_LABELS = {
  '15': '15分',
  '30': '30分（標準）',
  '45': '45分',
  '60': '60分（手押し車など時間要）',
  '95_plus': '95分以上（要相談）',
};

function unloadDurationLabel(value) {
  return UNLOAD_LABELS[String(value || '')] || UNLOAD_LABELS['30'];
}

/** 配合文字列から呼び強度・スランプ・粗骨材を抽出（例: 21-15-20N） */
export function parseMixSpec(mixText) {
  const m = String(mixText || '').trim().match(/^(\d+)-(\d+)-(\d+)([A-Za-z]+)?$/);
  if (!m) return null;
  return {
    strength: m[1],
    slump: m[2],
    aggregate: m[3],
    cement: m[4] ? String(m[4]).toUpperCase() : '',
    mixText: String(mixText || '').trim(),
  };
}

/** 履歴注文から新規発注フォームへ流し込む初期値 */
export function extractOrderFormDefaultsFromHistory(row) {
  const item = row?.source && typeof row.source === 'object' ? row.source : row && typeof row === 'object' ? row : {};
  const projectId = String(item.project_id ?? item.projectId ?? row?.project_id ?? '').trim();
  const isSpot = item.is_spot === true || !projectId;
  const mixRaw = String(item.confirmedMixText ?? item.mixText ?? row?.mix ?? '').trim();
  const mixParts = parseMixSpec(mixRaw);
  const prefFid = normalizeFactoryRefId(
    item.preferred_factory_id ??
      item.preferredFactoryId ??
      item.main_factory_id ??
      item.mainFactoryId ??
      '',
  );

  let deliveryArea = String(item.delivery_area ?? item.deliveryArea ?? '').trim();
  let siteAddressDetail = String(item.site_address_detail ?? item.siteAddressDetail ?? '').trim();
  if (!deliveryArea && !siteAddressDetail && item.siteAddress) {
    const parts = String(item.siteAddress).split(/\s+/);
    if (parts.length > 1) {
      deliveryArea = parts[0];
      siteAddressDetail = parts.slice(1).join(' ');
    } else {
      siteAddressDetail = String(item.siteAddress).trim();
    }
  }

  return {
    isSpot,
    projectId,
    preferredFactoryId: prefFid,
    quantityM3: String(item.confirmedQuantityM3 ?? item.quantityM3 ?? row?.quantityM3 ?? '').trim(),
    mixText: mixRaw,
    strength: mixParts?.strength ?? '',
    slump: mixParts?.slump ?? '',
    aggregate: mixParts?.aggregate ?? '',
    traderName: String(
      item.traderName ?? item.trading_company_name ?? item.projectTradingCompanyName ?? '',
    ).trim(),
    contractorName: String(item.contractorName ?? item.customerName ?? item.customer_name ?? row?.contractor ?? '').trim(),
    siteName: sanitizeSiteNameValue(item.siteName ?? item.projectName ?? item.project_name ?? row?.site ?? ''),
    sitePhone: String(item.sitePhone ?? item.phone ?? row?.phone ?? '').trim(),
    siteContactName: String(
      item.siteContactName ?? item.site_contact_name ?? item.orderedBy ?? item.ordered_by ?? row?.orderedBy ?? '',
    ).trim(),
    orderPlacerName: String(
      item.orderPlacerName ?? item.order_placer_name ?? item.ordered_by ?? row?.orderedBy ?? '',
    ).trim(),
    orderedBy: String(
      item.siteContactName ?? item.site_contact_name ?? item.orderedBy ?? item.ordered_by ?? row?.orderedBy ?? '',
    ).trim(),
    vehicleType: item.vehicleType === 'small' || item.vehicle === '小型' ? 'small' : 'large',
    unloadDuration: String(item.unloadDuration ?? item.unloadDurationMinutes ?? item.unloadingTime ?? '30').trim(),
    hasTest: Boolean(item.has_test ?? item.hasTest),
    deliveryLat: item.delivery_lat ?? item.deliveryLat ?? '',
    deliveryLng: item.delivery_lng ?? item.deliveryLng ?? '',
    isLocationPending: Boolean(item.is_location_pending ?? item.isLocationPending),
    deliveryArea,
    siteAddressDetail,
    siteAddress: String(item.siteAddress ?? row?.siteAddress ?? '').trim(),
  };
}

function parseOptionalCoord(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** スポット注文の delivery 座標（地図ピン or 地図待ちの代表地点） */
export function resolveSpotDeliveryCoords(context) {
  const isSpot = context?.orderKind === 'spot';
  if (!isSpot) return { lat: null, lng: null, isRepresentative: false };

  const locationPending = Boolean(context.isLocationPending);
  if (!locationPending) {
    const lat = parseOptionalCoord(context.deliveryLat);
    const lng = parseOptionalCoord(context.deliveryLng);
    return { lat, lng, isRepresentative: false };
  }

  const lat = parseOptionalCoord(
    context.representativeLat ?? context.representative_lat ?? context.roughLat ?? context.rough_lat,
  );
  const lng = parseOptionalCoord(
    context.representativeLng ?? context.representative_lng ?? context.roughLng ?? context.rough_lng,
  );
  return { lat, lng, isRepresentative: Boolean(lat != null && lng != null) };
}

/** フォーム入力からエスカレーション判定用の住所フィールドを正規化 */
export function buildEscalationAddressFields(context) {
  const deliveryAreaTrim = String(context.deliveryArea || '').trim();
  const addressDetailTrim = String(
    context.siteAddressDetail ?? context.town ?? context.townAddress ?? context.town_address ?? '',
  ).trim();
  const fullAddress =
    String(context.siteAddress || '').trim() ||
    combineDeliveryAddress(deliveryAreaTrim, addressDetailTrim);

  return {
    delivery_area: deliveryAreaTrim || null,
    deliveryArea: deliveryAreaTrim || null,
    site_address_detail: addressDetailTrim || null,
    siteAddressDetail: addressDetailTrim || null,
    siteAddress: fullAddress,
    site_address: fullAddress,
  };
}

/** 発注フォーム state からエスカレーション判定用の注文オブジェクトを組み立てる */
export function buildEscalationOrderFromFormContext(context) {
  const isSpot = context.orderKind === 'spot';
  const locationPending = Boolean(context.isLocationPending);
  const addressFields = buildEscalationAddressFields(context);
  const spotLat = parseFloat(String(context.deliveryLat ?? '').trim());
  const spotLng = parseFloat(String(context.deliveryLng ?? '').trim());
  const representativeCoords = resolveSpotDeliveryCoords(context);
  const hasPinnedCoords =
    !locationPending && Number.isFinite(spotLat) && Number.isFinite(spotLng);
  const hasRepresentativeCoords =
    locationPending &&
    representativeCoords.lat != null &&
    representativeCoords.lng != null;
  const escalationLat = hasPinnedCoords
    ? spotLat
    : hasRepresentativeCoords
      ? representativeCoords.lat
      : null;
  const escalationLng = hasPinnedCoords
    ? spotLng
    : hasRepresentativeCoords
      ? representativeCoords.lng
      : null;

  return {
    is_spot: isSpot,
    is_location_pending: locationPending,
    isLocationPending: locationPending,
    project_id: !isSpot && context.selectedProjectId ? String(context.selectedProjectId) : null,
    projectId: !isSpot && context.selectedProjectId ? String(context.selectedProjectId) : null,
    preferred_factory_id: resolveOrderPreferredFactoryId(context) || null,
    preferredFactoryId: resolveOrderPreferredFactoryId(context) || null,
    delivery_lat: isSpot && escalationLat != null ? escalationLat : null,
    delivery_lng: isSpot && escalationLng != null ? escalationLng : null,
    representative_lat: hasRepresentativeCoords ? representativeCoords.lat : null,
    representative_lng: hasRepresentativeCoords ? representativeCoords.lng : null,
    representativeLat: hasRepresentativeCoords ? representativeCoords.lat : null,
    representativeLng: hasRepresentativeCoords ? representativeCoords.lng : null,
    ...addressFields,
  };
}

/**
 * 共通フォーム入力 + 1つの納入日から発注用 order オブジェクトを組み立てる
 */
export function buildDispatchOrderForDate(preferredDate, context) {
  const date = String(preferredDate || '').trim();
  const slot = String(context.timeSlot || '').trim();
  const slotMeta = TIME_SLOTS.find((s) => s.value === slot);
  const slotLabel = slotMeta?.label ?? '';
  const timeMinutes = parseInt(slot, 10);
  const qtyTrim = String(context.quantityM3 ?? '').trim();
  const mixText = String(context.mixText ?? '').trim();

  const {
    orderKind,
    currentCustomerId,
    currentCustomer,
    selectedProject,
    selectedProjectId,
    preferredFactoryId,
    factories,
    traderName,
    contractorName,
    siteName,
    siteAddress,
    sitePhone,
    orderPlacerName,
    siteContactName,
    vehicleType,
    unloadDuration,
    hasTest,
    deliveryLat,
    deliveryLng,
    isLocationPending,
    contractorCustomerId,
    agentOrganizationId,
    isAgentOrCooperative,
  } = context;

  const isSpot = orderKind === 'spot';
  const locationPending = Boolean(isLocationPending);
  const nameTrim = sanitizeSiteNameValue(siteName);
  const addressFields = buildEscalationAddressFields(context);
  const deliveryAreaTrim = String(addressFields.deliveryArea || '').trim();
  const addressDetailTrim = String(addressFields.siteAddressDetail || '').trim();
  const addrTrim = String(addressFields.siteAddress || '').trim();
  const projectName = sanitizeSiteNameValue(selectedProject?.name);
  const addrForName = looksLikeUrlText(addrTrim) ? '' : addrTrim;
  const resolvedSiteName =
    !isSpot && projectName ? nameTrim || projectName : nameTrim || addrForName;

  const targetProject = !isSpot ? resolveTargetProject(context) : null;
  const prefFid = resolveOrderPreferredFactoryId({
    ...context,
    selectedProject: targetProject ?? selectedProject,
  });
  const mainFactoryId = !isSpot ? resolveFactoryIdFromProject(targetProject) || prefFid : '';
  const preferredFactoryName =
    prefFid && (Array.isArray(factories) ? factories : []).find((f) => f && String(f.id) === prefFid)?.name?.trim();

  const spotLat =
    isSpot && !locationPending ? parseFloat(String(deliveryLat).trim()) : Number.NaN;
  const spotLng =
    isSpot && !locationPending ? parseFloat(String(deliveryLng).trim()) : Number.NaN;
  const representativeCoords = resolveSpotDeliveryCoords(context);
  const deliveryLatValue = locationPending
    ? representativeCoords.lat
    : isSpot && Number.isFinite(spotLat)
      ? spotLat
      : null;
  const deliveryLngValue = locationPending
    ? representativeCoords.lng
    : isSpot && Number.isFinite(spotLng)
      ? spotLng
      : null;

  const resolvedOrderPlacerName = String(
    orderPlacerName ?? currentCustomer?.manager_name ?? '',
  ).trim();
  const resolvedSiteContactName = String(siteContactName ?? '').trim();

  const projectTraderName = selectedProject ? resolveProjectTradingCompanyName(selectedProject) : '';
  const resolvedTraderName = projectTraderName || String(traderName || '').trim();

  return {
    createdAt: new Date().toISOString(),
    is_spot: isSpot,
    customer_id: currentCustomerId || null,
    customerName: currentCustomer?.company_name || currentCustomer?.name || '',
    phone_number: currentCustomer?.phone_number || '',
    customerPhone: currentCustomer?.phone_number || '',
    trading_company_name: resolvedTraderName,
    projectTradingCompanyName: resolvedTraderName,
    ordered_by: resolvedOrderPlacerName,
    orderedBy: resolvedSiteContactName,
    order_placer_name: resolvedOrderPlacerName,
    orderPlacerName: resolvedOrderPlacerName,
    site_contact_name: resolvedSiteContactName,
    siteContactName: resolvedSiteContactName,
    project_id: !isSpot && selectedProjectId ? String(selectedProjectId) : null,
    projectName: targetProject?.name || selectedProject?.name || '',
    delivery_lat: deliveryLatValue,
    delivery_lng: deliveryLngValue,
    deliveryLat: deliveryLatValue,
    deliveryLng: deliveryLngValue,
    representative_lat: locationPending ? representativeCoords.lat : null,
    representative_lng: locationPending ? representativeCoords.lng : null,
    representativeLat: locationPending ? representativeCoords.lat : null,
    representativeLng: locationPending ? representativeCoords.lng : null,
    rough_lat: locationPending ? representativeCoords.lat : null,
    rough_lng: locationPending ? representativeCoords.lng : null,
    preferred_factory_id: prefFid || null,
    preferredFactoryId: prefFid || null,
    preferred_factory_user_specified: Boolean(prefFid),
    preferredFactoryUserSpecified: Boolean(prefFid),
    main_factory_id: mainFactoryId || null,
    mainFactoryId: mainFactoryId || null,
    preferredFactoryName: preferredFactoryName || '',
    preferredDate: date,
    timeSlot: slot,
    timeSlotMinutes: Number.isFinite(timeMinutes) ? timeMinutes : null,
    timeSlotLabel: slotLabel,
    timePointLabel: slotLabel,
    scheduleMatchDate: date,
    scheduleMatchMinutes: Number.isFinite(timeMinutes) ? timeMinutes : null,
    vehicleType,
    vehicleLabel: vehicleType === 'large' ? '大型' : '小型',
    quantityM3: qtyTrim,
    unloadDuration,
    unloadDurationMinutes: unloadDuration,
    unloadDurationLabel: unloadDurationLabel(unloadDuration),
    traderName: String(traderName || '').trim(),
    contractorName: String(contractorName || '').trim(),
    mixText,
    siteName: resolvedSiteName,
    siteAddress: addrTrim,
    site_address: addrTrim,
    ...addressFields,
    sitePhone: String(sitePhone || '').trim(),
    has_test: Boolean(hasTest),
    is_location_pending: locationPending,
    isLocationPending: locationPending,
    contractor_customer_id: isAgentOrCooperative && !isSpot ? contractorCustomerId || null : null,
    agent_organization_id: isAgentOrCooperative && !isSpot ? agentOrganizationId || null : null,
  };
}

function validateDeliveryArea(context) {
  const areas = normalizeAllowedDeliveryAreas(context.allowedDeliveryAreas);
  if (!areas.length) return [];
  const full = combineDeliveryAddress(context.deliveryArea, context.siteAddressDetail ?? context.siteAddress);
  const msg = getDeliveryAreaValidationMessage(full, areas);
  return msg ? [msg] : [];
}

/** 市町村プルダウンと町名・地名（地図待ちでも必須） */
function validateMunicipalityAndTownName(context) {
  const missing = [];
  const area = String(context.deliveryArea || '').trim();
  const town = String(context.siteAddressDetail ?? '').trim();
  if (!area) missing.push('納入エリア（市町村）');
  if (!town) missing.push('町名・地名');
  missing.push(...validateDeliveryArea(context));
  return missing;
}

/** 複数日一括発注フォームのバリデーション */
export function validateMultiDateOrderForm(context, dates, { today, isPastPreferredDateTime, isGuestSiteOrder = false }) {
  const missing = [];
  const list = (Array.isArray(dates) ? dates : []).map((d) => String(d || '').trim()).filter(Boolean);
  if (list.length === 0) missing.push('納入日（1件以上）');
  if (!String(context.currentCustomerId || '').trim()) missing.push('業者（会社）');
  if (context.isAgentOrCooperative && context.orderKind === 'project' && !String(context.contractorCustomerId || '').trim()) {
    missing.push('発注先業者');
  }
  if (!isGuestSiteOrder) {
    if (context.orderKind === 'project') {
      if (!String(context.contractorName || '').trim()) missing.push('業者');
    } else if (!String(context.contractorName || '').trim()) {
      missing.push('業者名');
    }
  }
  if (!String(context.sitePhone || '').trim()) missing.push('電話番号');
  if (!String(context.quantityM3 || '').trim()) missing.push('数量（m³）');
  if (
    !isGuestSiteOrder &&
    context.orderKind === 'project' &&
    !String(context.selectedProjectId || '').trim()
  ) {
    missing.push('物件');
  }
  if (!isGuestSiteOrder && context.orderKind === 'project' && String(context.selectedProjectId || '').trim()) {
    const targetProject = resolveTargetProject(context);
    if (!targetProject) {
      missing.push('物件（サジェストから選択し直してください）');
    } else {
      const factoryId = resolveOrderPreferredFactoryId(context);
      if (!factoryId) {
        missing.push('工場（物件にメイン工場が未設定です。管理画面で設定するか、第一希望工場を選択してください）');
      }
    }
  }
  if (context.orderKind === 'spot') {
    const locationPending = Boolean(context.isLocationPending);
    if (!locationPending) {
      const la = parseFloat(String(context.deliveryLat).trim());
      const ln = parseFloat(String(context.deliveryLng).trim());
      if (!Number.isFinite(la) || !Number.isFinite(ln)) missing.push('地図上の現場位置');
    }
    const nameTrim = sanitizeSiteNameValue(context.siteName);
    const addrTrim = String(context.siteAddress || '').trim();
    const addrOk = addrTrim && !looksLikeUrlText(addrTrim);
    if (!nameTrim && !addrOk) missing.push('現場名または現場住所');
    missing.push(...validateMunicipalityAndTownName(context));
  }
  if (context.orderKind === 'project' && !isGuestSiteOrder) {
    missing.push(...validateMunicipalityAndTownName(context));
  }
  if (isGuestSiteOrder && context.orderKind === 'project') {
    const full = combineDeliveryAddress(context.deliveryArea, context.siteAddressDetail ?? context.siteAddress);
    if (!String(full || '').trim()) missing.push('現場住所');
  }
  const timeSlot = String(context.timeSlot || '').trim();
  list.forEach((date, i) => {
    if (today && date < today) missing.push(`納入日${i + 1}（過去の日付）`);
    if (typeof isPastPreferredDateTime === 'function' && isPastPreferredDateTime(date, timeSlot)) {
      missing.push(`納入日${i + 1}（過去の日時）`);
    }
  });
  return missing;
}

/** カートに1行追加する前のバリデーション（単一納入日） */
export function validateCartLineForm(context, preferredDate, { today, isPastPreferredDateTime, isGuestSiteOrder = false }) {
  const date = String(preferredDate || '').trim();
  return validateMultiDateOrderForm(context, date ? [date] : [], {
    today,
    isPastPreferredDateTime,
    isGuestSiteOrder,
  });
}
