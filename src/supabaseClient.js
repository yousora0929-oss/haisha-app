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
});
