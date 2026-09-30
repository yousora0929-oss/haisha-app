import { searchNominatimPlaces } from './gsiGeocode.js';

/**
 * Nominatim（OpenStreetMap）で住所をジオコーディング（先頭1件）
 * 新規呼び出しは searchPlaces（gsiGeocode.js）を推奨。
 * @param {string} address
 * @returns {Promise<{ lat: number, lng: number, displayName: string }>}
 */
export async function geocodeAddress(address) {
  const q = String(address || '').trim();
  if (!q) throw new Error('住所を入力してください');

  const places = await searchNominatimPlaces(q);
  if (!places.length) {
    throw new Error('住所が見つかりませんでした。表記を変えてお試しください。');
  }

  const top = places[0];
  return {
    lat: top.lat,
    lng: top.lng,
    displayName: top.label,
  };
}
