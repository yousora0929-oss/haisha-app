/** 組合のデフォルト納入エリアが属する都道府県 */
export const DEFAULT_DELIVERY_PREFECTURE = '大分県';

const HEARTRAILS_GEO_API = 'https://geoapi.heartrails.com/api/json';
const townLocationCache = new Map();

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

function parseCoord(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * HeartRails location 行を正規化
 * @returns {{ town: string, lat: number|null, lng: number|null, x: string, y: string, postal: string, prefecture: string, city: string }}
 */
export function normalizeTownLocationRow(row) {
  if (!row || typeof row !== 'object') return null;
  const town = normalizeTownName(row.town);
  if (!town) return null;
  const lat = parseCoord(row.y);
  const lng = parseCoord(row.x);
  return {
    town,
    lat,
    lng,
    x: row.x != null ? String(row.x) : '',
    y: row.y != null ? String(row.y) : '',
    postal: row.postal != null ? String(row.postal) : '',
    prefecture: row.prefecture != null ? String(row.prefecture) : '',
    city: row.city != null ? String(row.city) : '',
  };
}

function parseTownLocationsFromResponse(payload) {
  const locations = payload?.response?.location;
  if (!Array.isArray(locations)) return [];

  const byTown = new Map();
  for (const row of locations) {
    const normalized = normalizeTownLocationRow(row);
    if (!normalized) continue;
    if (!byTown.has(normalized.town)) {
      byTown.set(normalized.town, normalized);
    }
  }

  return [...byTown.values()].sort((a, b) => a.town.localeCompare(b.town, 'ja'));
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

async function fetchTownLocationsFromApi(prefecture, municipality) {
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
      return parseTownLocationsFromResponse(data);
    }
  } catch {
    /* JSONP にフォールバック */
  }

  const data = await fetchHeartrailsJson(params);
  return parseTownLocationsFromResponse(data);
}

/**
 * 市町村に紐づく町名リスト（代表地点座標付き）を HeartRails Geo API から取得
 * @param {string} municipality 例: 大分市
 * @param {string} [prefecture] 例: 大分県
 * @returns {Promise<Array<{ town: string, lat: number|null, lng: number|null }>>}
 */
export async function fetchTownLocationsForMunicipality(
  municipality,
  prefecture = DEFAULT_DELIVERY_PREFECTURE,
) {
  const city = String(municipality || '').trim();
  const pref = String(prefecture || DEFAULT_DELIVERY_PREFECTURE).trim();
  if (!city) return [];

  const cacheKey = `${pref}|${city}`;
  if (townLocationCache.has(cacheKey)) {
    return townLocationCache.get(cacheKey);
  }

  const towns = await fetchTownLocationsFromApi(pref, city);
  townLocationCache.set(cacheKey, towns);
  return towns;
}

/** @deprecated fetchTownLocationsForMunicipality を使用 */
export async function fetchTownsForMunicipality(municipality, prefecture = DEFAULT_DELIVERY_PREFECTURE) {
  const rows = await fetchTownLocationsForMunicipality(municipality, prefecture);
  return rows.map((row) => row.town);
}

/** 町名リストから入力値に一致する代表地点を検索（完全一致 → 前方一致） */
export function findTownLocation(townList, townInput) {
  const needle = normalizeTownName(townInput);
  if (!needle || !Array.isArray(townList) || !townList.length) return null;

  const exact = townList.find((row) => normalizeTownName(row?.town) === needle);
  if (exact) return exact;

  const prefix = townList.find((row) => {
    const t = normalizeTownName(row?.town);
    return t.startsWith(needle) || needle.startsWith(t);
  });
  return prefix || null;
}

export function townNamesFromLocationList(townList) {
  return (Array.isArray(townList) ? townList : [])
    .map((row) => normalizeTownName(row?.town))
    .filter(Boolean);
}
