/**
 * maplibre-gl v6 の Web Worker を Vite 本番ビルドでも動かす。
 *
 * 旧 CSP ビルド (maplibre-gl-csp*) は v6 に無い。
 * worker.mjs は ./maplibre-gl-shared.mjs を相対 import するため、
 * Vite の ?url 単体コピーだと shared が 404（HTML）になり
 * "Worker failed to load" になる。
 * → public/ に worker + shared を同居させ、絶対 URL で setWorkerUrl する。
 *   （相対パスだと maplibre 内部の new URL(worker, import.meta.url) が
 *    Invalid base URL で落ちることがある）
 */
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

let configured = false;

function workerPublicUrl() {
  const base = String(import.meta.env.BASE_URL || '/');
  const prefix = base.endsWith('/') ? base : `${base}/`;
  const path = `${prefix}maplibre-gl-worker.mjs`;
  try {
    if (typeof window !== 'undefined' && window.location?.href) {
      return new URL(path, window.location.href).href;
    }
  } catch {
    /* fall through */
  }
  return path;
}

export function ensureMaplibreWorker() {
  if (configured) return maplibregl;
  configured = true;
  const url = workerPublicUrl();
  try {
    if (typeof maplibregl.setWorkerUrl === 'function') {
      maplibregl.setWorkerUrl(url);
    }
  } catch (err) {
    console.warn('[ensureMaplibreWorker] setWorkerUrl failed', err);
  }
  try {
    globalThis.maplibregl = maplibregl;
  } catch {
    /* ignore */
  }
  return maplibregl;
}

ensureMaplibreWorker();

export { maplibregl };
export const maplibreWorkerUrl = typeof window !== 'undefined' ? workerPublicUrl() : '/maplibre-gl-worker.mjs';
