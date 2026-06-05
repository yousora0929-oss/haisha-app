/** Realtime ペイロードのテーブル名・種別（注文 / チャット）を安全に判定 */

const CHAT_META_KEYS = new Set(['id', 'updated_at', 'chat_messages', 'chatMessages']);

export function resolveRealtimeTable(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const direct = payload.table != null ? String(payload.table).trim() : '';
  if (direct) return direct;
  const topic = payload.topic != null ? String(payload.topic) : '';
  if (topic.includes(':')) {
    const parts = topic.split(':');
    return parts.length >= 3 ? String(parts[2]).trim() : '';
  }
  return '';
}

function stableJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return '';
  }
}

/** orders UPDATE が chat_messages のみの変更か（注文同期と分離するため） */
export function isChatOnlyOrdersUpdate(payload) {
  const table = resolveRealtimeTable(payload);
  if (table !== 'orders') return false;

  const eventType = String(payload?.eventType || payload?.event || '').toUpperCase();
  if (eventType !== 'UPDATE') return false;

  const newRow = payload?.new && typeof payload.new === 'object' ? payload.new : null;
  const oldRow = payload?.old && typeof payload.old === 'object' ? payload.old : null;
  if (!newRow || !oldRow) return false;

  const chatChanged =
    stableJson(oldRow?.chat_messages ?? oldRow?.chatMessages) !==
    stableJson(newRow?.chat_messages ?? newRow?.chatMessages);
  if (!chatChanged) return false;

  const keys = new Set([...Object.keys(newRow), ...Object.keys(oldRow)]);
  for (const key of keys) {
    if (CHAT_META_KEYS.has(key)) continue;
    if (stableJson(oldRow[key]) !== stableJson(newRow[key])) {
      return false;
    }
  }

  return true;
}

/** 別テーブル order_messages（将来互換） */
export function isOrderMessagesTablePayload(payload) {
  return resolveRealtimeTable(payload) === 'order_messages';
}

/** 注文一覧の再同期が必要なイベント */
export function isOrderSyncRealtimePayload(payload) {
  if (!payload) return false;
  const table = resolveRealtimeTable(payload);
  if (table === 'schedules') return true;
  if (table === 'order_messages') return false;
  if (table !== 'orders') return false;
  if (isChatOnlyOrdersUpdate(payload)) return false;
  return true;
}

/** チャット着信・未読バッジ用イベント（orders.chat_messages または order_messages） */
export function isChatSyncRealtimePayload(payload) {
  if (!payload) return false;
  if (isOrderMessagesTablePayload(payload)) return true;
  return isChatOnlyOrdersUpdate(payload);
}

/**
 * 受信ハンドラ用: 注文・チャットを独立した if ブロックで処理
 * @param {object} payload
 * @param {{ onOrder?: Function, onChat?: Function, onSchedule?: Function }} handlers
 */
export function dispatchRealtimePayloadByKind(payload, handlers) {
  if (!payload || typeof handlers !== 'object') return;

  const table = resolveRealtimeTable(payload);

  if (table === 'schedules') {
    handlers.onSchedule?.(payload);
    handlers.onOrder?.(payload);
    return;
  }

  if (table === 'order_messages') {
    handlers.onChat?.(payload);
    return;
  }

  if (table === 'orders') {
    if (isChatOnlyOrdersUpdate(payload)) {
      handlers.onChat?.(payload);
      return;
    }
    handlers.onOrder?.(payload);
    return;
  }

  if (isOrderSyncRealtimePayload(payload)) {
    handlers.onOrder?.(payload);
  }
  if (isChatSyncRealtimePayload(payload)) {
    handlers.onChat?.(payload);
  }
}
