import {
  resolveGuestSiteOrderToken,
  stageMapEditorPanelAuth,
  stageMapEditorPanelAuthForReturn,
  stageMapEditorReturnUrl,
  consumeStagedMapEditorReturnUrl,
  resolveMapEditorHomeUrl,
  MAP_EDITOR_OPENED_AS_POPUP_KEY,
} from './supabaseClient.js';

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
  { type: 'PUMP', emoji: '🏗️', label: 'ポンプ車', hideFromPicker: true },
  { type: 'MIXER', emoji: '🚛', label: 'ミキサー車', hideFromPicker: true },
  { type: 'EXCAVATOR', emoji: '🚜', label: '重機', hideFromPicker: true },
  { type: 'ARROW_UP', emoji: '⬆️', label: '進入・上' },
  { type: 'ARROW_DOWN', emoji: '⬇️', label: '進入・下' },
  { type: 'ARROW_LEFT', emoji: '⬅️', label: '進入・左' },
  { type: 'ARROW_RIGHT', emoji: '➡️', label: '進入・右' },
  { type: 'PARKING', emoji: '🅿️', label: '待機場所' },
  { type: 'WASH', emoji: '🚰', label: '洗い場', hideFromPicker: true },
  { type: 'FORBIDDEN', emoji: '⛔', label: '進入禁止' },
];

/** スタンプ選択メニューに表示する種別（既存データの描画用定義は MAP_STAMP_DEFS に残す） */
export const MAP_STAMP_PICKER_DEFS = MAP_STAMP_DEFS.filter((d) => !d.hideFromPicker);

export const DEFAULT_MAP_STAMP_TYPE = MAP_STAMP_PICKER_DEFS[0]?.type ?? 'ARROW_UP';

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
  const href = window.location.href;
  try {
    sessionStorage.setItem(MAP_EDITOR_RETURN_SESSION_KEY, href);
  } catch {
    /* ignore */
  }
  stageMapEditorReturnUrl(href);
  stageMapEditorPanelAuth();
  try {
    localStorage.setItem(MAP_EDITOR_OPENED_AS_POPUP_KEY, '1');
  } catch {
    /* ignore */
  }
}

function isUsableMapEditorReturnUrl(raw) {
  if (!raw || typeof raw !== 'string') return false;
  try {
    const u = new URL(raw, typeof window !== 'undefined' ? window.location.origin : undefined);
    const path = (u.pathname || '/').toLowerCase();
    if (path === '/' || path === '/index.html') return false;
    if (/\/map-editor\//i.test(path)) return false;
    if (/\/login\b/i.test(path) || path.endsWith('/login')) return false;
    if (typeof window !== 'undefined' && raw === window.location.href) return false;
    return true;
  } catch {
    return false;
  }
}

function tryCloseMapEditorPopupTab() {
  if (typeof localStorage === 'undefined') return false;
  try {
    const opened = localStorage.getItem(MAP_EDITOR_OPENED_AS_POPUP_KEY);
    if (opened !== '1') return false;
    localStorage.removeItem(MAP_EDITOR_OPENED_AS_POPUP_KEY);
    window.close();
    return true;
  } catch {
    return false;
  }
}

function resolveMapEditorReturnTarget() {
  let target = '';
  try {
    const q = new URLSearchParams(window.location.search).get('return');
    if (q) target = decodeURIComponent(q);
    if (!isUsableMapEditorReturnUrl(target)) {
      target = sessionStorage.getItem(MAP_EDITOR_RETURN_SESSION_KEY) || '';
    }
    if (!isUsableMapEditorReturnUrl(target)) {
      target = consumeStagedMapEditorReturnUrl();
    }
    if (!isUsableMapEditorReturnUrl(target)) {
      target = resolveMapEditorHomeUrl();
    }
  } catch {
    target = resolveMapEditorHomeUrl();
  }
  return isUsableMapEditorReturnUrl(target) ? target : '';
}

/**
 * 保存せず閉じる・戻る用: 遷移元へ必ず戻す（ログイン画面・トップ `/` へは飛ばさない）
 */
export function navigateBackFromMapEditor() {
  if (typeof window === 'undefined') return false;

  stageMapEditorPanelAuthForReturn();

  const target = resolveMapEditorReturnTarget();

  try {
    sessionStorage.removeItem(MAP_EDITOR_RETURN_SESSION_KEY);
  } catch {
    /* ignore */
  }

  if (target) {
    tryCloseMapEditorPopupTab();
    window.location.assign(target);
    return true;
  }

  if (tryCloseMapEditorPopupTab()) {
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

/** 保存成功後に前画面へ戻る */
export function navigateAfterMapEditorSave() {
  return navigateBackFromMapEditor();
}

/** 注文に紐づく地図エディタURL（Vite dev / 静的ホストで /map-editor/:id にルーティング） */
export function buildMapEditorUrl(orderId, baseOrigin, options = {}) {
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

  const params = new URLSearchParams();
  if (typeof window !== 'undefined') {
    const ret = window.location.href;
    if (ret && !/\/map-editor\//i.test(ret)) {
      params.set('return', ret);
    }
    const explicitToken = String(options.guestToken ?? options.token ?? '').trim();
    const guestToken = explicitToken || resolveGuestSiteOrderToken();
    if (guestToken) {
      params.set('token', guestToken);
    }
  }

  let url = `${origin}/map-editor/${encodeURIComponent(id)}`;
  const qs = params.toString();
  if (qs) url += `?${qs}`;
  return url;
}

/** URL パスまたはクエリから order_id を取得 */
export function parseMapEditorOrderId() {
  if (typeof window === 'undefined') return null;
  const pathMatch = window.location.pathname.match(/\/map-editor\/([^/?#]+)/i);
  if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
  const q = new URLSearchParams(window.location.search).get('orderId');
  return q ? String(q).trim() : null;
}
