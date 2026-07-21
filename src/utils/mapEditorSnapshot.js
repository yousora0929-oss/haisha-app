import { MAP_STAMP_EMOJI } from '../mapEditorConstants.js';
import { boundsFromCenter, latLngToRatio } from './mapAnnotations.js';

const EXPORT_W = 800;
const EXPORT_H = 600;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
    img.src = url;
  });
}

function drawGrid(ctx, w, h) {
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 1;
  const step = 40;
  for (let x = 0; x <= w; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  for (let y = 0; y <= h; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
}

function geoToPixel(lat, lng, bounds, w, h) {
  const r = latLngToRatio(lat, lng, bounds);
  if (!r) return null;
  return { px: r.x * w, py: r.y * h };
}

// ---------------------------------------------------------------------------
// OSM タイル背景（Web Mercator）
// エディタは OSM タイル + ライブマーカー表示のため、保存 PNG にも同じ背景を焼き込む。
// tile.openstreetmap.org は CORS 許可 (Access-Control-Allow-Origin: *) なので
// crossOrigin='anonymous' で canvas 汚染なしに描画できる。
// ---------------------------------------------------------------------------

const MAX_SNAPSHOT_TILES = 32;

function lngToTileX(lng, z) {
  return ((lng + 180) / 360) * 2 ** z;
}

function latToTileY(lat, z) {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}

function tileXToLng(x, z) {
  return (x / 2 ** z) * 360 - 180;
}

function tileYToLat(y, z) {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/** latLngToRatio と同じ線形補間だが、bounds 外でもクランプしない（タイル矩形の配置用） */
function geoToPixelUnclamped(lat, lng, bounds, w, h) {
  const [[sLat, sLng], [nLat, nLng]] = bounds;
  const x = ((lng - sLng) / (nLng - sLng || 1)) * w;
  const y = ((nLat - lat) / (nLat - sLat || 1)) * h;
  return { px: x, py: y };
}

async function drawOsmTileBackground(ctx, bounds, zoomHint, w, h) {
  const [[sLat, sLng], [nLat, nLng]] = bounds;
  if (![sLat, sLng, nLat, nLng].every(Number.isFinite)) return false;

  let z = Math.round(Number(zoomHint) || 17);
  z = Math.max(3, Math.min(19, z));
  let xMin;
  let xMax;
  let yMin;
  let yMax;
  for (;;) {
    xMin = Math.floor(lngToTileX(sLng, z));
    xMax = Math.floor(lngToTileX(nLng, z));
    yMin = Math.floor(latToTileY(nLat, z));
    yMax = Math.floor(latToTileY(sLat, z));
    if ((xMax - xMin + 1) * (yMax - yMin + 1) <= MAX_SNAPSHOT_TILES || z <= 3) break;
    z -= 1;
  }

  const jobs = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      jobs.push(
        loadImage(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`).then((img) => ({ img, x, y })),
      );
    }
  }
  const results = await Promise.allSettled(jobs);
  let drawn = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    const { img, x, y } = r.value;
    const nw = geoToPixelUnclamped(tileYToLat(y, z), tileXToLng(x, z), bounds, w, h);
    const se = geoToPixelUnclamped(tileYToLat(y + 1, z), tileXToLng(x + 1, z), bounds, w, h);
    // タイル間の継ぎ目（サブピクセル空隙）を防ぐため僅かに重ねる
    ctx.drawImage(img, nw.px, nw.py, se.px - nw.px + 0.75, se.py - nw.py + 0.75);
    drawn += 1;
  }
  if (!drawn) return false;

  const attribution = '© OpenStreetMap contributors';
  ctx.font = '11px system-ui, sans-serif';
  const tw = ctx.measureText(attribution).width;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(w - tw - 10, h - 18, tw + 10, 18);
  ctx.fillStyle = '#334155';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(attribution, w - tw - 5, h - 9);
  return true;
}

/** 注釈データから PNG 用キャンバスを生成 */
export async function renderAnnotationsSnapshot(annotations, options = {}) {
  const { baseImageUrl = '' } = options;
  const canvas = document.createElement('canvas');
  canvas.width = EXPORT_W;
  canvas.height = EXPORT_H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const bounds =
    annotations?.imageOverlay?.bounds ||
    boundsFromCenter(annotations?.center?.lat, annotations?.center?.lng);

  const drawFallbackBackground = async () => {
    // ベース画像なし（OSM モード）ではタイル地図を背景として焼き込む。
    // タイル取得に全滅した場合のみ従来の格子にフォールバック。
    let ok = false;
    if (bounds) {
      try {
        ok = await drawOsmTileBackground(ctx, bounds, annotations?.center?.zoom, EXPORT_W, EXPORT_H);
      } catch {
        ok = false;
      }
    }
    if (!ok) drawGrid(ctx, EXPORT_W, EXPORT_H);
  };

  const imgUrl = String(annotations?.imageOverlay?.url || baseImageUrl || '').trim();
  if (imgUrl) {
    try {
      const img = await loadImage(imgUrl);
      ctx.drawImage(img, 0, 0, EXPORT_W, EXPORT_H);
    } catch {
      await drawFallbackBackground();
    }
  } else {
    await drawFallbackBackground();
  }

  for (const u of annotations?.unloadPoints || []) {
    const p = geoToPixel(u.lat, u.lng, bounds, EXPORT_W, EXPORT_H);
    if (!p) continue;
    const radiusM = Number(u.radiusM) || 12;
    const pxRadius = Math.max(12, Math.min(80, (radiusM / 180) * EXPORT_W * 0.35));
    ctx.beginPath();
    ctx.arc(p.px, p.py, pxRadius, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.22)';
    ctx.fill();
    ctx.lineWidth = Math.max(3, pxRadius * 0.12);
    ctx.strokeStyle = '#dc2626';
    ctx.stroke();
  }

  for (const s of annotations?.stamps || []) {
    const lat = s.lat;
    const lng = s.lng;
    let p = null;
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      p = geoToPixel(lat, lng, bounds, EXPORT_W, EXPORT_H);
    } else if (Number.isFinite(s.x) && Number.isFinite(s.y)) {
      p = { px: s.x * EXPORT_W, py: s.y * EXPORT_H };
    }
    if (!p) continue;
    const scale = Number(s.scale) > 0 ? Number(s.scale) : 1;
    const fontSize = Math.max(22, 36 * scale);
    const emoji = MAP_STAMP_EMOJI[s.type] || '❓';
    ctx.font = `${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = 4;
    ctx.fillText(emoji, p.px, p.py);
    ctx.restore();
  }

  for (const c of annotations?.comments || []) {
    const p = geoToPixel(c.lat, c.lng, bounds, EXPORT_W, EXPORT_H);
    if (!p) continue;
    const text = String(c.text || '').slice(0, 120);
    ctx.font = 'bold 13px Meiryo, system-ui, sans-serif';
    const metrics = ctx.measureText(text);
    const pad = 8;
    const bw = Math.min(EXPORT_W - 20, metrics.width + pad * 2);
    const bh = 28;
    const bx = Math.min(EXPORT_W - bw - 4, Math.max(4, p.px - bw / 2));
    const by = Math.max(4, p.py - bh - 12);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 2;
    roundRect(ctx, bx, by, bw, bh, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, bx + pad, by + bh / 2);
  }

  return canvas.toDataURL('image/png');
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
