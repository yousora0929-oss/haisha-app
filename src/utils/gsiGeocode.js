/**
 * 場所検索（地理院住所検索 → 0件時のみ Nominatim フォールバック）
 * @param {string} query
 * @returns {Promise<{ lat: number, lng: number, label: string }[]>}
 */
export async function searchPlaces(query) {
  const q = String(query || '').trim();
  if (!q) return [];

  try {
    const gsi = await searchGsiAddress(q);
    if (gsi.length > 0) return gsi.slice(0, 5);
  } catch (err) {
    console.warn('[searchPlaces] GSI address search failed, falling back to Nominatim', err);
  }

  try {
    return await searchNominatimPlaces(q);
  } catch (err) {
    console.warn('[searchPlaces] Nominatim fallback failed', err);
    return [];
  }
}

/**
 * @param {string} q
 * @returns {Promise<{ lat: number, lng: number, label: string }[]>}
 */
async function searchGsiAddress(q) {
  const url = `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`GSI address search failed: ${res.status}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) return [];

  const out = [];
  for (const feature of data) {
    const coords = feature?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const label = String(feature?.properties?.title || q).trim() || q;
    out.push({ lat, lng, label });
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * Nominatim 複数件検索（フォールバック用）
 * @param {string} q
 * @returns {Promise<{ lat: number, lng: number, label: string }[]>}
 */
export async function searchNominatimPlaces(q) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', '5');
  url.searchParams.set('countrycodes', 'jp');

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'ja',
      'User-Agent': 'HaishaDispatchApp/1.0 (dispatch prototype)',
    },
  });
  if (!res.ok) {
    throw new Error(`Nominatim search failed: ${res.status}`);
  }
  const data = await res.json();
  if (!Array.isArray(data)) return [];

  const out = [];
  for (const row of data) {
    const lat = parseFloat(row?.lat);
    const lng = parseFloat(row?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const label = row?.display_name != null ? String(row.display_name) : q;
    out.push({ lat, lng, label });
    if (out.length >= 5) break;
  }
  return out;
}
