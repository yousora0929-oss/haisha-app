/** 受注済み注文を顧客がキャンセルし、受注工場がまだ確認していない */

export function isUnacknowledgedFactoryCustomerCancel(order, factoryId) {
  if (!order) return false;
  if (String(order.status || '').trim() !== 'customer_cancelled') return false;
  if (String(order.factory_cancel_ack_at || '').trim()) return false;
  const assigned = String(order.factory_site_id || order.factorySiteId || '').trim();
  if (!assigned) return false;
  const fid = String(factoryId || '').trim();
  if (!fid) return true;
  return assigned === fid;
}

export function formatFactoryCustomerCancelledAt(value) {
  const raw = String(value || '').trim();
  if (!raw) return '日時不明';
  const ts = Date.parse(raw);
  if (!Number.isFinite(ts)) return '日時不明';
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(ts));
  const pick = (type) => parts.find((p) => p.type === type)?.value ?? '';
  return `${pick('year')}/${pick('month')}/${pick('day')} ${pick('hour')}:${pick('minute')}`;
}
