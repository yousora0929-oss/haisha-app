/** 管理画面で設定する納入可能エリアのデフォルト */
export const DEFAULT_ALLOWED_DELIVERY_AREAS = ['大分市', '由布市', '杵築市', '別府市', '中津市'];

export const DEFAULT_SPOT_THRESHOLD_VOLUME = 50;

export function normalizeAllowedDeliveryAreas(raw) {
  if (Array.isArray(raw)) {
    return [...new Set(raw.map((x) => String(x || '').trim()).filter(Boolean))];
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return normalizeAllowedDeliveryAreas(parsed);
    } catch {
      return raw
        .split(/[\n,、]+/)
        .map((x) => x.trim())
        .filter(Boolean);
    }
  }
  return [...DEFAULT_ALLOWED_DELIVERY_AREAS];
}

export function parseDeliveryAreasTextInput(text) {
  return [...new Set(String(text || '').split(/[\n,、]+/).map((x) => x.trim()).filter(Boolean))];
}

export function formatDeliveryAreasTextInput(areas) {
  return normalizeAllowedDeliveryAreas(areas).join('\n');
}

export function combineDeliveryAddress(deliveryArea, detail) {
  const area = String(deliveryArea || '').trim();
  const rest = String(detail || '').trim();
  if (!area && !rest) return '';
  if (!rest) return area;
  if (!area) return rest;
  if (rest.startsWith(area)) return rest;
  return `${area} ${rest}`;
}

export function splitDeliveryAddress(fullAddress, allowedAreas) {
  const text = String(fullAddress || '').trim();
  const areas = normalizeAllowedDeliveryAreas(allowedAreas);
  if (!text) return { deliveryArea: areas[0] || '', addressDetail: '' };
  const hit = areas.find((a) => text === a || text.startsWith(a));
  if (!hit) return { deliveryArea: '', addressDetail: text };
  const detail = text.slice(hit.length).trim();
  return { deliveryArea: hit, addressDetail: detail };
}

/**
 * 物件（project）から市町村・町名のオートフィル用フィールドを抽出する。
 * delivery_area / site_address に加え city / town_address や結合住所文字列にも対応。
 *
 * @param {Record<string, unknown> | null | undefined} project
 * @param {string[] | unknown} [allowedAreas]
 * @returns {{ deliveryArea: string, siteAddressDetail: string }}
 */
export function extractProjectAddressFields(project, allowedAreas = []) {
  if (!project || typeof project !== 'object') {
    return { deliveryArea: '', siteAddressDetail: '' };
  }

  const areas = normalizeAllowedDeliveryAreas(allowedAreas);

  let deliveryArea = String(
    project.delivery_area ?? project.deliveryArea ?? project.city ?? '',
  ).trim();
  let siteAddressDetail = String(
    project.site_address ??
      project.site_address_detail ??
      project.siteAddressDetail ??
      project.town_address ??
      project.townAddress ??
      '',
  ).trim();

  const fullCandidates = [
    project.full_address,
    project.address,
    project.siteAddress,
    project.site_address_full,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  const combinedFromParts = combineDeliveryAddress(deliveryArea, siteAddressDetail);
  if (combinedFromParts) fullCandidates.unshift(combinedFromParts);

  for (const fullRaw of fullCandidates) {
    if (deliveryArea && siteAddressDetail) break;
    const split = splitDeliveryAddress(fullRaw, areas);
    if (!deliveryArea && split.deliveryArea) deliveryArea = split.deliveryArea;
    if (!siteAddressDetail && split.addressDetail) siteAddressDetail = split.addressDetail;
    if (!deliveryArea && !siteAddressDetail && fullRaw) {
      deliveryArea = split.deliveryArea;
      siteAddressDetail = split.addressDetail || fullRaw;
    }
  }

  if (deliveryArea && siteAddressDetail.startsWith(deliveryArea)) {
    siteAddressDetail = siteAddressDetail.slice(deliveryArea.length).trim();
  }

  if (!deliveryArea && siteAddressDetail) {
    const split = splitDeliveryAddress(siteAddressDetail, areas);
    if (split.deliveryArea) {
      deliveryArea = split.deliveryArea;
      siteAddressDetail = split.addressDetail;
    }
  }

  if (deliveryArea && areas.length && !areas.includes(deliveryArea)) {
    const hit = areas.find((a) => deliveryArea === a || deliveryArea.startsWith(a));
    if (hit) {
      const remainder = deliveryArea.slice(hit.length).trim();
      deliveryArea = hit;
      if (remainder) {
        siteAddressDetail = siteAddressDetail ? `${remainder} ${siteAddressDetail}`.trim() : remainder;
      }
    }
  }

  return {
    deliveryArea: deliveryArea.trim(),
    siteAddressDetail: siteAddressDetail.trim(),
  };
}

export function isAddressInAllowedAreas(fullAddress, allowedAreas) {
  const areas = normalizeAllowedDeliveryAreas(allowedAreas);
  if (!areas.length) return true;
  const text = String(fullAddress || '').trim();
  if (!text) return false;
  return areas.some((a) => text === a || text.startsWith(a) || text.includes(a));
}

export function getDeliveryAreaValidationMessage(fullAddress, allowedAreas) {
  const areas = normalizeAllowedDeliveryAreas(allowedAreas);
  if (!areas.length) return '';
  if (isAddressInAllowedAreas(fullAddress, areas)) return '';
  return `納入エリアは次のいずれかから選択してください: ${areas.join('、')}`;
}

export function parseSpotThresholdVolume(raw) {
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) return n;
  return DEFAULT_SPOT_THRESHOLD_VOLUME;
}
