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
