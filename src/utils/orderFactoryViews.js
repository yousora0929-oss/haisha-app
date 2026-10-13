/** 工場が注文詳細を開いた記録。チャット既読とは別。 */

export function isPendingOrderStatus(order) {
  return String(order?.status || '').trim() === 'pending';
}

export function customerFactoryViewText(count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n <= 0) {
    return { seen: false, text: 'まだ工場が確認していません' };
  }
  return { seen: true, text: `👀 ${n}工場が確認しました` };
}

export function adminFactoryViewText(count, factoryTotal) {
  const n = Math.max(0, Number(count) || 0);
  const total = Number(factoryTotal);
  if (Number.isFinite(total) && total > 0) return `確認済み ${n}／${total}工場`;
  return `確認済み ${n}工場`;
}

export function formatOrderViewedAt(value) {
  const ts = Date.parse(String(value || ''));
  if (!Number.isFinite(ts)) return '時刻不明';
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ts));
  const pick = (type) => parts.find((part) => part.type === type)?.value ?? '';
  return `${pick('year')}/${pick('month')}/${pick('day')} ${pick('hour')}:${pick('minute')}`;
}
