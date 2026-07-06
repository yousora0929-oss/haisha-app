import { createClient } from '@supabase/supabase-js';

/**
 * createClient 第1引数はプロジェクトのルート URL のみ
 * （例: https://xxxx.supabase.co）。/rest/v1 や末尾スラッシュがあると SDK が
 * rest/v1 を再度付与し、/rest/v1/rest/v1/... の 404 や WebSocket パス異常の原因になる。
 */
function normalizeSupabaseProjectUrl(raw) {
  if (raw == null) return '';
  let s = String(raw).trim();
  if (!s) return '';

  s = s.replace(/\/+$/, '');
  // よくある誤設定: API パスまでベース URL に含めている
  s = s.replace(/\/rest\/v1(?:\/.*)?$/i, '');
  s = s.replace(/\/auth\/v1(?:\/.*)?$/i, '');
  s = s.replace(/\/storage\/v1(?:\/.*)?$/i, '');
  s = s.replace(/\/realtime\/v1(?:\/.*)?$/i, '');
  s = s.replace(/\/+$/, '');

  try {
    const u = new URL(s);
    if (!u.protocol.startsWith('http')) return '';
    // ホスト型の Supabase では origin のみを使う（余計な pathname を捨てる）
    if (u.hostname.endsWith('.supabase.co')) {
      return u.origin;
    }
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

export const ADMIN_PANEL_PHONE_KEY = 'concrete_link_admin_phone_v1';
export const ADMIN_PANEL_PASSWORD_KEY = 'concrete_link_admin_pass_v1';
export const CUSTOMER_PANEL_PHONE_KEY = 'concrete_link_customer_phone_v1';
export const CUSTOMER_PANEL_PASSWORD_KEY = 'concrete_link_customer_pass_v1';
export const FACTORY_PANEL_ID_KEY = 'concrete_link_factory_id_v1';
export const FACTORY_PANEL_PASSWORD_KEY = 'concrete_link_factory_pass_v1';
export const CHARTER_PANEL_ID_KEY = 'concrete_link_charter_id_v1';
export const CHARTER_PANEL_PASSWORD_KEY = 'concrete_link_charter_pass_v1';
export const GUEST_SITE_ORDER_TOKEN_KEY = 'concrete_link_guest_site_order_token_v1';
export const PANEL_REALTIME_TOKEN_KEY = 'concrete_link_panel_realtime_token_v1';

/** 別タブ地図エディタ向け: sessionStorage → localStorage 一時退避 */
export const MAP_EDITOR_PANEL_AUTH_STAGING_KEY = 'haisha_map_editor_panel_auth_staging_v1';
export const MAP_EDITOR_RETURN_LOCAL_KEY = 'haisha_map_editor_return_url_local_v1';
export const MAP_EDITOR_OPENED_AS_POPUP_KEY = 'haisha_map_editor_opened_as_popup_v1';

/** 各パネルアプリ固有の sessionStorage キー（別タブ地図エディタ往復用） */
export const DISPATCH_AUTH_SESSION_KEY = 'haisha_dispatch_auth_customer_id_v1';
export const DISPATCH_CUSTOMER_SESSION_KEY = 'haisha_dispatch_customer_id_v1';
export const ADMIN_AUTH_SESSION_KEY = 'concrete_link_admin_auth_v1';
export const FACTORY_SESSION_STORAGE_KEY = 'haisha_factory_site_id_v1';
export const FACTORY_AUTH_STORAGE_KEY = 'haisha_factory_auth_id_v1';
export const CHARTER_SESSION_STORAGE_KEY = 'haisha_charter_operator_id_v1';
export const CHARTER_AUTH_STORAGE_KEY = 'haisha_charter_auth_id_v1';

const MAP_EDITOR_PANEL_AUTH_KEYS = [
  ADMIN_PANEL_PHONE_KEY,
  ADMIN_PANEL_PASSWORD_KEY,
  CUSTOMER_PANEL_PHONE_KEY,
  CUSTOMER_PANEL_PASSWORD_KEY,
  FACTORY_PANEL_ID_KEY,
  FACTORY_PANEL_PASSWORD_KEY,
  GUEST_SITE_ORDER_TOKEN_KEY,
  PANEL_REALTIME_TOKEN_KEY,
  DISPATCH_AUTH_SESSION_KEY,
  DISPATCH_CUSTOMER_SESSION_KEY,
  ADMIN_AUTH_SESSION_KEY,
  FACTORY_SESSION_STORAGE_KEY,
  FACTORY_AUTH_STORAGE_KEY,
];

const MAP_EDITOR_AUTH_STAGING_TTL_MS = 10 * 60 * 1000;

function readLocalStorageJson(key) {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function readStagedPanelAuthPayload() {
  const payload = readLocalStorageJson(MAP_EDITOR_PANEL_AUTH_STAGING_KEY);
  if (!payload || typeof payload !== 'object' || !payload.keys || typeof payload.keys !== 'object') {
    return null;
  }
  const age = Date.now() - Number(payload.at || 0);
  if (!Number.isFinite(age) || age < 0 || age > MAP_EDITOR_AUTH_STAGING_TTL_MS) {
    try {
      localStorage.removeItem(MAP_EDITOR_PANEL_AUTH_STAGING_KEY);
    } catch {
      /* ignore */
    }
    return null;
  }
  return payload;
}

function readStagedPanelAuthValue(key) {
  const payload = readStagedPanelAuthPayload();
  if (!payload?.keys) return '';
  const value = payload.keys[key];
  return value != null ? String(value).trim() : '';
}

function readPanelAuthValue(key) {
  if (typeof sessionStorage !== 'undefined') {
    try {
      const fromSession = sessionStorage.getItem(key);
      if (fromSession != null && String(fromSession).trim()) {
        return String(fromSession).trim();
      }
    } catch {
      /* ignore */
    }
  }
  return readStagedPanelAuthValue(key);
}

/** ゲスト専用発注トークンを path / query / session / localStorage 退避から解決 */
export function resolveGuestSiteOrderToken() {
  if (typeof window === 'undefined') return '';
  try {
    const pathMatch = window.location.pathname.match(/\/(?:order|guest-order)\/([^/?#]+)/i);
    if (pathMatch?.[1]) {
      return decodeURIComponent(pathMatch[1]).trim();
    }
  } catch {
    /* ignore */
  }
  try {
    const fromQuery = String(new URLSearchParams(window.location.search).get('token') || '').trim();
    if (fromQuery) return fromQuery;
  } catch {
    /* ignore */
  }
  const fromSession = readPanelAuthValue(GUEST_SITE_ORDER_TOKEN_KEY);
  if (fromSession) return fromSession;
  return '';
}

/**
 * 地図エディタを別タブで開く直前に呼ぶ。
 * sessionStorage が新タブに引き継がれない環境向けに localStorage へ一時コピーする。
 */
function capturePanelAuthToLocalStorage() {
  if (typeof localStorage === 'undefined' || typeof sessionStorage === 'undefined') return false;
  const keys = {};
  for (const key of MAP_EDITOR_PANEL_AUTH_KEYS) {
    try {
      const value = sessionStorage.getItem(key);
      if (value != null && String(value).trim()) {
        keys[key] = String(value);
      }
    } catch {
      /* ignore */
    }
  }
  if (Object.keys(keys).length === 0) return false;
  try {
    localStorage.setItem(
      MAP_EDITOR_PANEL_AUTH_STAGING_KEY,
      JSON.stringify({ at: Date.now(), keys }),
    );
    return true;
  } catch {
    return false;
  }
}

export function stageMapEditorPanelAuth() {
  return capturePanelAuthToLocalStorage();
}

/** 地図エディタを閉じて元画面へ戻る直前: 現在タブの認証を再退避 */
export function stageMapEditorPanelAuthForReturn() {
  return capturePanelAuthToLocalStorage();
}

/** 地図エディタ起動時 / パネル画面復帰時: localStorage 退避から sessionStorage へ認証を復元 */
export function restoreMapEditorPanelAuthFromStorage(options = {}) {
  const { overwrite = false, consume = true } = options;
  if (typeof sessionStorage === 'undefined') return false;
  const payload = readStagedPanelAuthPayload();
  if (!payload?.keys) return false;

  let restored = false;
  for (const key of MAP_EDITOR_PANEL_AUTH_KEYS) {
    const value = payload.keys[key];
    if (value == null || !String(value).trim()) continue;
    try {
      if (overwrite || !sessionStorage.getItem(key)) {
        sessionStorage.setItem(key, String(value));
        restored = true;
      }
    } catch {
      /* ignore */
    }
  }

  if (consume) {
    try {
      localStorage.removeItem(MAP_EDITOR_PANEL_AUTH_STAGING_KEY);
    } catch {
      /* ignore */
    }
  }

  return restored;
}

/** 別タブ地図エディタ向け: 戻り先 URL を localStorage にも保存 */
export function stageMapEditorReturnUrl(url) {
  const target = String(url || '').trim();
  if (!target || typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(MAP_EDITOR_RETURN_LOCAL_KEY, target);
  } catch {
    /* ignore */
  }
}

export function consumeStagedMapEditorReturnUrl() {
  if (typeof localStorage === 'undefined') return '';
  try {
    const url = String(localStorage.getItem(MAP_EDITOR_RETURN_LOCAL_KEY) || '').trim();
    localStorage.removeItem(MAP_EDITOR_RETURN_LOCAL_KEY);
    return url;
  } catch {
    return '';
  }
}

/** 管理画面ログイン後、RLS 用ヘッダー認証の資格情報を sessionStorage に保存 */
export function setAdminPanelSession(phone, password) {
  if (typeof sessionStorage === 'undefined') return;
  const p = String(phone || '').trim();
  const pass = String(password || '').trim();
  if (!p || !pass) return;
  sessionStorage.setItem(ADMIN_PANEL_PHONE_KEY, p);
  sessionStorage.setItem(ADMIN_PANEL_PASSWORD_KEY, pass);
}

let panelRealtimeAuthPromise = null;

export function clearAdminPanelSession() {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(ADMIN_PANEL_PHONE_KEY);
  sessionStorage.removeItem(ADMIN_PANEL_PASSWORD_KEY);
  clearPanelRealtimeAuth();
}

export function hasAdminPanelSession() {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    return Boolean(
      sessionStorage.getItem(ADMIN_PANEL_PHONE_KEY) && sessionStorage.getItem(ADMIN_PANEL_PASSWORD_KEY),
    );
  } catch {
    return false;
  }
}

export function setCustomerPanelSession(phone, password) {
  if (typeof sessionStorage === 'undefined') return;
  const p = String(phone || '').trim();
  const pass = String(password || '').trim();
  if (!p || !pass) return;
  sessionStorage.setItem(CUSTOMER_PANEL_PHONE_KEY, p);
  sessionStorage.setItem(CUSTOMER_PANEL_PASSWORD_KEY, pass);
}

export function clearCustomerPanelSession() {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(CUSTOMER_PANEL_PHONE_KEY);
  sessionStorage.removeItem(CUSTOMER_PANEL_PASSWORD_KEY);
  clearPanelRealtimeAuth();
}

export function hasCustomerPanelSession() {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    return Boolean(
      sessionStorage.getItem(CUSTOMER_PANEL_PHONE_KEY) && sessionStorage.getItem(CUSTOMER_PANEL_PASSWORD_KEY),
    );
  } catch {
    return false;
  }
}

export function setFactoryPanelSession(factoryId, password) {
  if (typeof sessionStorage === 'undefined') return;
  const id = String(factoryId || '').trim();
  const pass = String(password || '').trim();
  if (!id || !pass) return;
  sessionStorage.setItem(FACTORY_PANEL_ID_KEY, id);
  sessionStorage.setItem(FACTORY_PANEL_PASSWORD_KEY, pass);
}

export function clearFactoryPanelSession() {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(FACTORY_PANEL_ID_KEY);
  sessionStorage.removeItem(FACTORY_PANEL_PASSWORD_KEY);
  clearPanelRealtimeAuth();
}

export function setCharterPanelSession(charterId, password) {
  if (typeof sessionStorage === 'undefined') return;
  const id = String(charterId || '').trim();
  const pass = String(password || '').trim();
  if (!id || !pass) return;
  sessionStorage.setItem(CHARTER_PANEL_ID_KEY, id);
  sessionStorage.setItem(CHARTER_PANEL_PASSWORD_KEY, pass);
}

export function clearCharterPanelSession() {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(CHARTER_PANEL_ID_KEY);
  sessionStorage.removeItem(CHARTER_PANEL_PASSWORD_KEY);
}

export function hasCharterPanelSession() {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    return Boolean(
      sessionStorage.getItem(CHARTER_PANEL_ID_KEY) && sessionStorage.getItem(CHARTER_PANEL_PASSWORD_KEY),
    );
  } catch {
    return false;
  }
}

export function hasFactoryPanelSession() {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    return Boolean(
      sessionStorage.getItem(FACTORY_PANEL_ID_KEY) && sessionStorage.getItem(FACTORY_PANEL_PASSWORD_KEY),
    );
  } catch {
    return false;
  }
}

export function setGuestSiteOrderSession(urlToken) {
  if (typeof sessionStorage === 'undefined') return;
  const token = String(urlToken || '').trim();
  if (!token) return;
  sessionStorage.setItem(GUEST_SITE_ORDER_TOKEN_KEY, token);
}

export function clearGuestSiteOrderSession() {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(GUEST_SITE_ORDER_TOKEN_KEY);
  clearPanelRealtimeAuth();
}

export function hasGuestSiteOrderSession() {
  if (typeof sessionStorage === 'undefined') return false;
  try {
    return Boolean(sessionStorage.getItem(GUEST_SITE_ORDER_TOKEN_KEY));
  } catch {
    return false;
  }
}

export function hasAnyPanelSession() {
  if (
    hasAdminPanelSession() ||
    hasCustomerPanelSession() ||
    hasFactoryPanelSession() ||
    hasCharterPanelSession() ||
    hasGuestSiteOrderSession()
  ) {
    return true;
  }
  return Boolean(detectPanelCredentials());
}

/** 地図エディタ URL の ?token= からゲスト専用発注トークンを取得 */
export function parseMapEditorGuestTokenFromUrl() {
  if (typeof window === 'undefined') return '';
  try {
    return String(new URLSearchParams(window.location.search).get('token') || '').trim();
  } catch {
    return '';
  }
}

/**
 * 地図エディタ起動時: URL の token を session に反映し、Realtime JWT を同期する。
 * REST の RLS は readPanelRequestHeaders() 経由の x-* ヘッダーで評価される。
 */
export async function ensureMapEditorPanelAuth() {
  restoreMapEditorPanelAuthFromStorage();

  const urlToken = parseMapEditorGuestTokenFromUrl();
  if (urlToken) {
    setGuestSiteOrderSession(urlToken);
  }

  return ensurePanelRealtimeAuth();
}

function detectPanelCredentials() {
  try {
    const adminPhone = readPanelAuthValue(ADMIN_PANEL_PHONE_KEY);
    const adminPassword = readPanelAuthValue(ADMIN_PANEL_PASSWORD_KEY);
    if (adminPhone && adminPassword) {
      return { panelType: 'admin', credentialA: adminPhone, credentialB: adminPassword };
    }
    const customerPhone = readPanelAuthValue(CUSTOMER_PANEL_PHONE_KEY);
    const customerPassword = readPanelAuthValue(CUSTOMER_PANEL_PASSWORD_KEY);
    if (customerPhone && customerPassword) {
      return { panelType: 'customer', credentialA: customerPhone, credentialB: customerPassword };
    }
    const factoryId = readPanelAuthValue(FACTORY_PANEL_ID_KEY);
    const factoryPassword = readPanelAuthValue(FACTORY_PANEL_PASSWORD_KEY);
    if (factoryId && factoryPassword) {
      return { panelType: 'factory', credentialA: factoryId, credentialB: factoryPassword };
    }
    const charterId = readPanelAuthValue(CHARTER_PANEL_ID_KEY);
    const charterPassword = readPanelAuthValue(CHARTER_PANEL_PASSWORD_KEY);
    if (charterId && charterPassword) {
      return { panelType: 'charter', credentialA: charterId, credentialB: charterPassword };
    }
    const guestToken = readPanelAuthValue(GUEST_SITE_ORDER_TOKEN_KEY);
    if (guestToken) {
      return { panelType: 'guest', credentialA: guestToken, credentialB: null };
    }
  } catch {
    return null;
  }
  return null;
}

/** 地図エディタから戻る際のフォールバック先（ログイン画面には飛ばさない） */
export function resolveMapEditorHomeUrl() {
  if (typeof window === 'undefined') return '';
  const creds = detectPanelCredentials();
  if (!creds) return '';
  const origin = window.location.origin || '';
  switch (creds.panelType) {
    case 'customer':
      return `${origin}/DispatchOrderPrototype.html`;
    case 'factory':
      return `${origin}/FactoryTabletPrototype.html`;
    case 'charter':
      return `${origin}/CharterTabletPrototype.html`;
    case 'admin':
      return `${origin}/AdminPrototype.html`;
    case 'guest': {
      const token = String(creds.credentialA || '').trim();
      if (!token) return '';
      return `${origin}/order/${encodeURIComponent(token)}`;
    }
    default:
      return '';
  }
}

/** Realtime 用 JWT を supabase.realtime に適用 */
export async function applyPanelRealtimeAuth(token) {
  const normalized = token ? String(token).trim() : '';
  if (typeof sessionStorage !== 'undefined') {
    if (normalized) sessionStorage.setItem(PANEL_REALTIME_TOKEN_KEY, normalized);
    else sessionStorage.removeItem(PANEL_REALTIME_TOKEN_KEY);
  }
  await supabase.realtime.setAuth(normalized || null);
  return normalized || null;
}

export function clearPanelRealtimeAuth() {
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.removeItem(PANEL_REALTIME_TOKEN_KEY);
  }
  void supabase.realtime.setAuth(null);
}

/** RPC で Realtime JWT を発行して適用 */
export async function issuePanelRealtimeAuth(panelType, credentialA, credentialB) {
  const { data, error } = await supabase.rpc('issue_panel_realtime_jwt', {
    p_panel_type: panelType,
    p_credential_a: credentialA ?? null,
    p_credential_b: credentialB ?? null,
  });
  if (error) throw error;
  const token = data != null ? String(data).trim() : '';
  if (!token) throw new Error('Realtime JWT の発行に失敗しました');
  return applyPanelRealtimeAuth(token);
}

/**
 * セッション復元・チャネル購読前に呼ぶ。
 * preferredToken があればそれを優先（login RPC 同梱トークン等）。
 */
export async function ensurePanelRealtimeAuth(preferredToken) {
  if (preferredToken) {
    return applyPanelRealtimeAuth(preferredToken);
  }
  if (panelRealtimeAuthPromise) return panelRealtimeAuthPromise;
  panelRealtimeAuthPromise = (async () => {
    try {
      const stored = readPanelAuthValue(PANEL_REALTIME_TOKEN_KEY);
      if (stored) {
        return applyPanelRealtimeAuth(stored);
      }
      const creds = detectPanelCredentials();
      if (creds) {
        return issuePanelRealtimeAuth(creds.panelType, creds.credentialA, creds.credentialB);
      }
      await supabase.realtime.setAuth(null);
      return null;
    } catch (err) {
      console.warn('[haisha] Realtime JWT の適用に失敗しました', err);
      return null;
    } finally {
      panelRealtimeAuthPromise = null;
    }
  })();
  return panelRealtimeAuthPromise;
}

function readPanelRequestHeaders() {
  try {
    const creds = detectPanelCredentials();
    if (!creds) return {};
    const headers = {};
    switch (creds.panelType) {
      case 'admin':
        headers['x-admin-phone'] = creds.credentialA;
        headers['x-admin-password'] = creds.credentialB;
        break;
      case 'customer':
        headers['x-customer-phone'] = creds.credentialA;
        headers['x-customer-password'] = creds.credentialB;
        break;
      case 'factory':
        headers['x-factory-id'] = creds.credentialA;
        headers['x-factory-password'] = creds.credentialB;
        break;
      case 'charter':
        headers['x-charter-id'] = creds.credentialA;
        headers['x-charter-password'] = creds.credentialB;
        break;
      case 'guest':
        headers['x-site-order-token'] = creds.credentialA;
        break;
      default:
        break;
    }
    return headers;
  } catch {
    return {};
  }
}

const supabaseUrl = normalizeSupabaseProjectUrl(import.meta.env.VITE_SUPABASE_URL);
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY
  ? String(import.meta.env.VITE_SUPABASE_ANON_KEY).trim()
  : '';

if (!supabaseUrl || !anonKey) {
  throw new Error(
    '[haisha] .env に VITE_SUPABASE_URL（例: https://xxxx.supabase.co のみ）と VITE_SUPABASE_ANON_KEY を設定してください。URL に /rest/v1 や末尾 / を付けないでください。',
  );
}

export const supabase = createClient(supabaseUrl, anonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
  global: {
    fetch: (url, options = {}) => {
      const panelHdrs = readPanelRequestHeaders();
      const headers = new Headers(options.headers || {});
      for (const [key, value] of Object.entries(panelHdrs)) {
        if (value) headers.set(key, value);
      }
      return fetch(url, { ...options, headers });
    },
  },
});
