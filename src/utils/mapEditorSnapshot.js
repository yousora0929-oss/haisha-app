import { MAP_STAMP_EMOJI } from '../mapEditorConstants.js';
import {
  boundsFromCenter,
  commentCanvasLayout,
  latLngToRatio,
  snapshotBoundsForAnnotations,
} from './mapAnnotations.js';

const EXPORT_W = 800;
const EXPORT_H = 600;

const IMAGE_LOAD_TIMEOUT_MS = 10000;

function loadImage(url, timeoutMs = IMAGE_LOAD_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // crossOrigin 無しで描画すると canvas が汚染され toDataURL が SecurityError になるため必須
    img.crossOrigin = 'anonymous';
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      img.src = '';
      reject(new Error('画像の読み込みがタイムアウトしました'));
    }, timeoutMs);
    img.onload = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(img);
    };
    img.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(new Error('画像の読み込みに失敗しました'));
    };
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
// 全タイルを一斉に読み込むと、ブラウザの同時接続制限で後回しにされたタイルが
// タイムアウトし、その領域だけ描画されず白い帯として残る。並列数を制限し、
// 失敗タイルは1回だけ再試行する。
const TILE_LOAD_CONCURRENCY = 6;

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

  const coords = [];
  for (let x = xMin; x <= xMax; x++) {
    for (let y = yMin; y <= yMax; y++) {
      coords.push({ x, y });
    }
  }

  const results = new Array(coords.length);
  let nextIndex = 0;
  const worker = async () => {
    for (;;) {
      const idx = nextIndex;
      if (idx >= coords.length) return;
      nextIndex += 1;
      const { x, y } = coords[idx];
      const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
      try {
        results[idx] = { x, y, img: await loadImage(url) };
      } catch {
        try {
          results[idx] = { x, y, img: await loadImage(url) };
        } catch (err) {
          results[idx] = { x, y, error: err };
        }
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(TILE_LOAD_CONCURRENCY, coords.length) }, () => worker()),
  );

  let drawn = 0;
  const failedTiles = [];
  for (const r of results) {
    if (!r || !r.img) {
      if (r) failedTiles.push(`${z}/${r.x}/${r.y}`);
      continue;
    }
    const nw = geoToPixelUnclamped(tileYToLat(r.y, z), tileXToLng(r.x, z), bounds, w, h);
    const se = geoToPixelUnclamped(tileYToLat(r.y + 1, z), tileXToLng(r.x + 1, z), bounds, w, h);
    // タイル間の継ぎ目（サブピクセル空隙）を防ぐため僅かに重ねる
    ctx.drawImage(r.img, nw.px, nw.py, se.px - nw.px + 0.75, se.py - nw.py + 0.75);
    drawn += 1;
  }
  if (failedTiles.length) {
    console.warn(
      `[renderAnnotationsSnapshot] OSMタイル ${failedTiles.length}/${coords.length} 枚の取得に失敗（該当領域は格子下地のまま）`,
      failedTiles,
    );
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

  const imgUrl = String(annotations?.imageOverlay?.url || baseImageUrl || '').trim();

  // ベース画像を描く場合はその配置基準（imageOverlay.bounds）を、
  // OSM タイル背景の場合は全マーカーが収まる 4:3 の bounds を使う。
  // タイル・マーカーとも同じ bounds を共有するため位置ズレは起きない。
  const bounds =
    (imgUrl && annotations?.imageOverlay?.bounds) ||
    snapshotBoundsForAnnotations(annotations) ||
    boundsFromCenter(annotations?.center?.lat, annotations?.center?.lng);

  const drawFallbackBackground = async () => {
    // 先に格子を不透明の下地として敷く。タイルが部分的に取得失敗しても
    // 透明（＝白い余白）ではなく格子が見えるだけで済む。
    drawGrid(ctx, EXPORT_W, EXPORT_H);
    if (!bounds) return;
    try {
      await drawOsmTileBackground(ctx, bounds, annotations?.center?.zoom, EXPORT_W, EXPORT_H);
    } catch (err) {
      console.warn('[renderAnnotationsSnapshot] OSMタイル背景の描画に失敗（格子にフォールバック）', err);
    }
  };

  if (imgUrl) {
    try {
      const img = await loadImage(imgUrl);
      ctx.drawImage(img, 0, 0, EXPORT_W, EXPORT_H);
    } catch (err) {
      console.warn('[renderAnnotationsSnapshot] ベース画像の読み込みに失敗（タイル/格子にフォールバック）', err);
      await drawFallbackBackground();
    }
  } else {
    await drawFallbackBackground();
  }

  drawAnnotationMarkers(ctx, annotations, bounds);

  try {
    return canvas.toDataURL('image/png');
  } catch (err) {
    // canvas 汚染（SecurityError）等で書き出せない場合でも保存自体は成功させる。
    // 外部画像を一切使わないクリーンなキャンバス（格子＋マーカーのみ）で再描画する。
    console.error('[renderAnnotationsSnapshot] toDataURL に失敗。格子背景で再生成します', err);
    const clean = document.createElement('canvas');
    clean.width = EXPORT_W;
    clean.height = EXPORT_H;
    const cleanCtx = clean.getContext('2d');
    if (!cleanCtx) return '';
    drawGrid(cleanCtx, EXPORT_W, EXPORT_H);
    drawAnnotationMarkers(cleanCtx, annotations, bounds);
    return clean.toDataURL('image/png');
  }
}

/** マーカー（荷卸し地点・スタンプ・コメント）をキャンバスに描画 */
function drawAnnotationMarkers(ctx, annotations, bounds) {
  // bounds の縦方向実距離（m）。円の見た目サイズを表示範囲に応じて変える
  const spanM = (() => {
    const sLat = Number(bounds?.[0]?.[0]);
    const nLat = Number(bounds?.[1]?.[0]);
    const span = Math.abs(nLat - sLat) * 111320;
    return Number.isFinite(span) && span > 0 ? span : 180;
  })();

  for (const u of annotations?.unloadPoints || []) {
    const p = geoToPixel(u.lat, u.lng, bounds, EXPORT_W, EXPORT_H);
    if (!p) continue;
    const radiusM = Number(u.radiusM) || 12;
    const pxRadius = Math.max(12, Math.min(80, (radiusM / spanM) * EXPORT_W * 0.35));
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
    const layout = commentCanvasLayout(c.text, c.scale);
    ctx.font = `bold ${layout.fontSize}px Meiryo, system-ui, sans-serif`;
    const metrics = ctx.measureText(layout.label);
    const pad = layout.pad;
    const bw = Math.min(EXPORT_W - 20, metrics.width + pad * 2);
    const bh = layout.height;
    const bx = Math.min(EXPORT_W - bw - 4, Math.max(4, p.px - bw / 2));
    const by = Math.max(4, p.py - bh - 12);
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = layout.borderW;
    roundRect(ctx, bx, by, bw, bh, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#0f172a';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(layout.label, bx + pad, by + bh / 2);
  }
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
