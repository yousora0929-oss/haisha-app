function toFiniteCoord(n) {
  const v = Number(n);
  return Number.isFinite(v) ? v : null;
}

/**
 * 2点間の直線距離（Haversine・km）
 * 座標が無効な場合は Infinity
 */
export function calculateDistance(lat1, lng1, lat2, lng2) {
  const la1 = toFiniteCoord(lat1);
  const ln1 = toFiniteCoord(lng1);
  const la2 = toFiniteCoord(lat2);
  const ln2 = toFiniteCoord(lng2);
  if (la1 == null || ln1 == null || la2 == null || ln2 == null) return Infinity;

  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(la2 - la1);
  const dLng = toRad(ln2 - ln1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
