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
export const GUEST_SITE_ORDER_TOKEN_KEY = 'concrete_link_guest_site_order_token_v1';

/** 管理画面ログイン後、RLS 用ヘッダー認証の資格情報を sessionStorage に保存 */
export function setAdminPanelSession(phone, password) {
  if (typeof sessionStorage === 'undefined') return;
  const p = String(phone || '').trim();
  const pass = String(password || '').trim();
  if (!p || !pass) return;
  sessionStorage.setItem(ADMIN_PANEL_PHONE_KEY, p);
  sessionStorage.setItem(ADMIN_PANEL_PASSWORD_KEY, pass);
}

export const PANEL_REALTIME_TOKEN_KEY = 'concrete_link_panel_realtime_token_v1';

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

function detectPanelCredentials() {
  if (typeof sessionStorage === 'undefined') return null;
  try {
    const adminPhone = sessionStorage.getItem(ADMIN_PANEL_PHONE_KEY);
    const adminPassword = sessionStorage.getItem(ADMIN_PANEL_PASSWORD_KEY);
    if (adminPhone && adminPassword) {
      return { panelType: 'admin', credentialA: adminPhone, credentialB: adminPassword };
    }
    const customerPhone = sessionStorage.getItem(CUSTOMER_PANEL_PHONE_KEY);
    const customerPassword = sessionStorage.getItem(CUSTOMER_PANEL_PASSWORD_KEY);
    if (customerPhone && customerPassword) {
      return { panelType: 'customer', credentialA: customerPhone, credentialB: customerPassword };
    }
    const factoryId = sessionStorage.getItem(FACTORY_PANEL_ID_KEY);
    const factoryPassword = sessionStorage.getItem(FACTORY_PANEL_PASSWORD_KEY);
    if (factoryId && factoryPassword) {
      return { panelType: 'factory', credentialA: factoryId, credentialB: factoryPassword };
    }
    const guestToken = sessionStorage.getItem(GUEST_SITE_ORDER_TOKEN_KEY);
    if (guestToken) {
      return { panelType: 'guest', credentialA: guestToken, credentialB: null };
    }
  } catch {
    return null;
  }
  return null;
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
      const stored =
        typeof sessionStorage !== 'undefined' ? sessionStorage.getItem(PANEL_REALTIME_TOKEN_KEY) : null;
      if (stored) {
        return applyPanelRealtimeAuth(stored);
      }
      const creds = detectPanelCredentials();
      if (!creds) {
        await supabase.realtime.setAuth(null);
        return null;
      }
      return issuePanelRealtimeAuth(creds.panelType, creds.credentialA, creds.credentialB);
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
  if (typeof sessionStorage === 'undefined') return {};
  try {
    const headers = {};
    const adminPhone = sessionStorage.getItem(ADMIN_PANEL_PHONE_KEY);
    const adminPassword = sessionStorage.getItem(ADMIN_PANEL_PASSWORD_KEY);
    if (adminPhone && adminPassword) {
      headers['x-admin-phone'] = adminPhone;
      headers['x-admin-password'] = adminPassword;
    }
    const customerPhone = sessionStorage.getItem(CUSTOMER_PANEL_PHONE_KEY);
    const customerPassword = sessionStorage.getItem(CUSTOMER_PANEL_PASSWORD_KEY);
    if (customerPhone && customerPassword) {
      headers['x-customer-phone'] = customerPhone;
      headers['x-customer-password'] = customerPassword;
    }
    const factoryId = sessionStorage.getItem(FACTORY_PANEL_ID_KEY);
    const factoryPassword = sessionStorage.getItem(FACTORY_PANEL_PASSWORD_KEY);
    if (factoryId && factoryPassword) {
      headers['x-factory-id'] = factoryId;
      headers['x-factory-password'] = factoryPassword;
    }
    const guestToken = sessionStorage.getItem(GUEST_SITE_ORDER_TOKEN_KEY);
    if (guestToken) {
      headers['x-site-order-token'] = guestToken;
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
