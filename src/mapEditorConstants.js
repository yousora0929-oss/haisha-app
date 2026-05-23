/** 地図エディタで使うスタンプ種別 */
export const MAP_STAMP_TYPES = [
  'PUMP',
  'ARROW_UP',
  'ARROW_DOWN',
  'ARROW_LEFT',
  'ARROW_RIGHT',
  'PARKING',
  'WASH',
  'FORBIDDEN',
];

export const MAP_STAMP_DEFS = [
  { type: 'PUMP', emoji: '🏗️', label: '打設・ポンプ車' },
  { type: 'ARROW_UP', emoji: '⬆️', label: '進入・上' },
  { type: 'ARROW_DOWN', emoji: '⬇️', label: '進入・下' },
  { type: 'ARROW_LEFT', emoji: '⬅️', label: '進入・左' },
  { type: 'ARROW_RIGHT', emoji: '➡️', label: '進入・右' },
  { type: 'PARKING', emoji: '🅿️', label: '待機場所' },
  { type: 'WASH', emoji: '🚰', label: '洗い場' },
  { type: 'FORBIDDEN', emoji: '⛔', label: '進入禁止' },
];

export const MAP_STAMP_EMOJI = Object.fromEntries(MAP_STAMP_DEFS.map((d) => [d.type, d.emoji]));

export const MAP_STORAGE_BUCKET = 'maps';

/** 注文に紐づく地図エディタURL（Vite dev / 静的ホストで /map-editor/:id にルーティング） */
export function buildMapEditorUrl(orderId) {
  const id = String(orderId || '').trim();
  if (!id) return '';
  const origin = typeof window !== 'undefined' && window.location?.origin ? window.location.origin : '';
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
