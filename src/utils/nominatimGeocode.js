/**
 * Nominatim（OpenStreetMap）で住所をジオコーディング
 * @param {string} address
 * @returns {Promise<{ lat: number, lng: number, displayName: string }>}
 */
export async function geocodeAddress(address) {
  const q = String(address || '').trim();
  if (!q) throw new Error('住所を入力してください');

  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'json');
  url.searchParams.set('q', q);
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'jp');

  const res = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'ja',
      'User-Agent': 'HaishaDispatchApp/1.0 (dispatch prototype)',
    },
  });

  if (!res.ok) throw new Error('住所検索に失敗しました。しばらくしてから再度お試しください。');

  const data = await res.json();
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('住所が見つかりませんでした。表記を変えてお試しください。');
  }

  const la = parseFloat(data[0].lat);
  const ln = parseFloat(data[0].lon);
  if (!Number.isFinite(la) || !Number.isFinite(ln)) {
    throw new Error('座標の取得に失敗しました。');
  }

  return {
    lat: la,
    lng: ln,
    displayName: data[0].display_name != null ? String(data[0].display_name) : q,
  };
}
