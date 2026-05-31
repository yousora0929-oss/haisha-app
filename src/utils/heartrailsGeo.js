/** 組合のデフォルト納入エリアが属する都道府県 */
export const DEFAULT_DELIVERY_PREFECTURE = '大分県';

const HEARTRAILS_GEO_API = 'https://geoapi.heartrails.com/api/json';
const townListCache = new Map();

/** 管理設定または環境変数から都道府県名を解決 */
export function resolveDeliveryPrefecture(adminSettings) {
  const fromSettings = adminSettings?.delivery_prefecture ?? adminSettings?.deliveryPrefecture;
  if (fromSettings && String(fromSettings).trim()) {
    return String(fromSettings).trim();
  }
  const fromEnv =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_DELIVERY_PREFECTURE
      ? String(import.meta.env.VITE_DELIVERY_PREFECTURE).trim()
      : '';
  if (fromEnv) return fromEnv;
  return DEFAULT_DELIVERY_PREFECTURE;
}

function normalizeTownName(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function parseTownsFromResponse(payload) {
  const locations = payload?.response?.location;
  if (!Array.isArray(locations)) return [];
  const names = locations
    .map((row) => normalizeTownName(row?.town))
    .filter(Boolean);
  return [...new Set(names)].sort((a, b) => a.localeCompare(b, 'ja'));
}

function fetchHeartrailsJson(params) {
  return new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('HeartRails API はブラウザ環境でのみ利用できます'));
      return;
    }

    const callbackName = `heartrails_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const url = new URL(HEARTRAILS_GEO_API);
    for (const [key, value] of Object.entries(params)) {
      if (value != null && String(value).trim()) {
        url.searchParams.set(key, String(value).trim());
      }
    }
    url.searchParams.set('jsonp', callbackName);

    const script = document.createElement('script');
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error('町名リストの取得がタイムアウトしました'));
    }, 12000);

    function cleanup() {
      window.clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (data) => {
      cleanup();
      resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error('町名リストの取得に失敗しました'));
    };

    script.src = url.toString();
    document.head.appendChild(script);
  });
}

async function fetchTownsFromApi(prefecture, municipality) {
  const params = {
    method: 'getTowns',
    prefecture: String(prefecture || '').trim(),
    city: String(municipality || '').trim(),
  };

  try {
    const url = new URL(HEARTRAILS_GEO_API);
    url.searchParams.set('method', params.method);
    url.searchParams.set('prefecture', params.prefecture);
    url.searchParams.set('city', params.city);

    const res = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
    });
    if (res.ok) {
      const data = await res.json();
      return parseTownsFromResponse(data);
    }
  } catch {
    /* JSONP にフォールバック */
  }

  const data = await fetchHeartrailsJson(params);
  return parseTownsFromResponse(data);
}

/**
 * 市町村に紐づく町名リストを HeartRails Geo API から取得
 * @param {string} municipality 例: 大分市
 * @param {string} [prefecture] 例: 大分県
 * @returns {Promise<string[]>}
 */
export async function fetchTownsForMunicipality(municipality, prefecture = DEFAULT_DELIVERY_PREFECTURE) {
  const city = String(municipality || '').trim();
  const pref = String(prefecture || DEFAULT_DELIVERY_PREFECTURE).trim();
  if (!city) return [];

  const cacheKey = `${pref}|${city}`;
  if (townListCache.has(cacheKey)) {
    return townListCache.get(cacheKey);
  }

  const towns = await fetchTownsFromApi(pref, city);
  townListCache.set(cacheKey, towns);
  return towns;
}
