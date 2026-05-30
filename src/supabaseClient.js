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

/** 管理画面ログイン後、RLS 用ヘッダー認証の資格情報を sessionStorage に保存 */
export function setAdminPanelSession(phone, password) {
  if (typeof sessionStorage === 'undefined') return;
  const p = String(phone || '').trim();
  const pass = String(password || '').trim();
  if (!p || !pass) return;
  sessionStorage.setItem(ADMIN_PANEL_PHONE_KEY, p);
  sessionStorage.setItem(ADMIN_PANEL_PASSWORD_KEY, pass);
}

export function clearAdminPanelSession() {
  if (typeof sessionStorage === 'undefined') return;
  sessionStorage.removeItem(ADMIN_PANEL_PHONE_KEY);
  sessionStorage.removeItem(ADMIN_PANEL_PASSWORD_KEY);
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
