/** 地図エディタで使うスタンプ種別 */
export const MAP_STAMP_TYPES = [
  'PUMP',
  'MIXER',
  'EXCAVATOR',
  'ARROW_UP',
  'ARROW_DOWN',
  'ARROW_LEFT',
  'ARROW_RIGHT',
  'PARKING',
  'WASH',
  'FORBIDDEN',
];

export const MAP_STAMP_DEFS = [
  { type: 'PUMP', emoji: '🏗️', label: 'ポンプ車' },
  { type: 'MIXER', emoji: '🚛', label: 'ミキサー車' },
  { type: 'EXCAVATOR', emoji: '🚜', label: '重機' },
  { type: 'ARROW_UP', emoji: '⬆️', label: '進入・上' },
  { type: 'ARROW_DOWN', emoji: '⬇️', label: '進入・下' },
  { type: 'ARROW_LEFT', emoji: '⬅️', label: '進入・左' },
  { type: 'ARROW_RIGHT', emoji: '➡️', label: '進入・右' },
  { type: 'PARKING', emoji: '🅿️', label: '待機場所' },
  { type: 'WASH', emoji: '🚰', label: '洗い場' },
  { type: 'FORBIDDEN', emoji: '⛔', label: '進入禁止' },
];

/** 地図エディタの操作モード */
export const MAP_EDITOR_TOOLS = {
  PAN: 'pan',
  STAMP: 'stamp',
  UNLOAD: 'unload',
  COMMENT: 'comment',
};

export const MAP_STAMP_EMOJI = Object.fromEntries(MAP_STAMP_DEFS.map((d) => [d.type, d.emoji]));

/** Supabase Storage の公開バケット名（現場図 PNG 保存先） */
export const MAP_STORAGE_BUCKET = 'maps';

export const MAP_EDITOR_RETURN_SESSION_KEY = 'haisha_map_editor_return_url_v1';

/** 地図保存完了を他タブ（工場画面など）へ通知 */
export const MAP_EDITOR_ORDER_SAVED_EVENT_KEY = 'haisha_map_editor_order_saved_v1';
export const MAP_EDITOR_ORDER_SAVED_DOM_EVENT = 'haisha-map-order-saved';

export function publishMapEditorOrderSaved(orderId) {
  const id = String(orderId || '').trim();
  if (!id || typeof window === 'undefined') return;
  const payload = JSON.stringify({ orderId: id, at: Date.now() });
  try {
    localStorage.setItem(MAP_EDITOR_ORDER_SAVED_EVENT_KEY, payload);
  } catch {
    /* ignore */
  }
  try {
    window.dispatchEvent(new CustomEvent(MAP_EDITOR_ORDER_SAVED_DOM_EVENT, { detail: { orderId: id } }));
  } catch {
    /* ignore */
  }
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage({ type: 'haisha_map_editor_saved', orderId: id }, window.location.origin);
    }
  } catch {
    /* ignore */
  }
}

/** 地図エディタを開く直前に呼び、保存後の戻り先 URL を記憶する */
export function rememberMapEditorReturnUrl() {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(MAP_EDITOR_RETURN_SESSION_KEY, window.location.href);
  } catch {
    /* ignore */
  }
}

/** 保存成功後に前画面へ戻る（return クエリ / sessionStorage / history.back / window.close） */
export function navigateAfterMapEditorSave() {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search).get('return');
    const fromSession = sessionStorage.getItem(MAP_EDITOR_RETURN_SESSION_KEY);
    sessionStorage.removeItem(MAP_EDITOR_RETURN_SESSION_KEY);
    const target = (q && decodeURIComponent(q)) || fromSession || '';
    if (target && target !== window.location.href) {
      window.location.assign(target);
      return true;
    }
  } catch {
    /* ignore */
  }
  if (window.history.length > 1) {
    window.history.back();
    return true;
  }
  try {
    if (window.opener && !window.opener.closed) {
      window.close();
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

/** 注文に紐づく地図エディタURL（Vite dev / 静的ホストで /map-editor/:id にルーティング） */
export function buildMapEditorUrl(orderId, baseOrigin) {
  const id = String(orderId || '').trim();
  if (!id) return '';
  const envOrigin =
    typeof import.meta !== 'undefined' && import.meta.env?.VITE_PUBLIC_APP_ORIGIN
      ? String(import.meta.env.VITE_PUBLIC_APP_ORIGIN).replace(/\/$/, '')
      : '';
  const origin =
    (baseOrigin && String(baseOrigin).replace(/\/$/, '')) ||
    envOrigin ||
    (typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '');
  return `${origin}/map-editor/${encodeURIComponent(id)}`;
}

/** URL パスまたはクエリから order_id を取得 */
export function parseMapEditorOrderId() {
  if (typeof window === 'undefined') return null;
  const pathMatch = window.location.pathname.match(/\/map-editor\/([^/?#]+)/i);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
  const q = new URLSearchParams(window.location.search).get('orderId');
  return q ? String(q).trim() : null;
}
