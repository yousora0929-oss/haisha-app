/** カスタマー・管理者からのチャット着信を工場向けに検出 */

export function isIncomingChatForFactory(message) {
  const from = String(message?.from || '').trim();
  return from === 'customer' || from === 'master' || from === 'admin';
}

export function latestChatMessage(messages) {
  const list = Array.isArray(messages) ? messages.filter(Boolean) : [];
  return list.length ? list[list.length - 1] : null;
}

export function chatMessageKey(message) {
  if (!message) return '';
  return [message.id, message.createdAt, message.from].map((x) => (x == null ? '' : String(x))).join('|');
}

function normalizeChatMessagesRaw(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m) => m && typeof m === 'object')
    .map((m) => ({
      id: m.id != null ? String(m.id) : '',
      from:
        m.from === 'factory'
          ? 'factory'
          : m.from === 'admin'
            ? 'admin'
            : m.from === 'customer'
              ? 'customer'
              : m.from === 'master'
                ? 'master'
                : m.from === 'system'
                  ? 'system'
                  : String(m.from || ''),
      body: String(m.body ?? ''),
      createdAt: m.createdAt != null ? String(m.createdAt) : '',
    }));
}

function extractChatMessagesFromRow(row) {
  if (!row || typeof row !== 'object') return [];
  const raw = row.chat_messages ?? row.chatMessages;
  return normalizeChatMessagesRaw(raw);
}

function extractSenderType(row) {
  if (!row || typeof row !== 'object') return '';
  return String(row.sender_type ?? row.senderType ?? '').trim();
}

function isCustomerSenderMessage(message, row) {
  if (!message) return false;
  const from = String(message.from || '').trim();
  if (from === 'customer' || from === 'master') return true;
  const senderType = extractSenderType(row);
  if (senderType && senderType !== 'factory') return true;
  return isIncomingChatForFactory(message);
}

/**
 * orders / order_messages の Realtime ペイロードから工場向けチャット着信を推定
 * @returns {{ notifyOrderIds: string[], shouldPlayChatSound: boolean }}
 */
export function analyzeFactoryChatRealtimePayload(payload, prevThreads = {}) {
  const result = { notifyOrderIds: [], shouldPlayChatSound: false };
  if (!payload) return result;

  const table = String(payload.table || '').trim();
  const eventType = String(payload.eventType || payload.event || '').toUpperCase();
  if (eventType !== 'UPDATE' && eventType !== 'INSERT') return result;

  if (table === 'order_messages') {
    const newRow = payload.new && typeof payload.new === 'object' ? payload.new : null;
    if (!newRow) return result;
    const senderType = extractSenderType(newRow);
    if (senderType === 'factory') return result;
    const orderId = String(newRow.order_id ?? newRow.orderId ?? '').trim();
    if (orderId) {
      result.notifyOrderIds = [orderId];
      result.shouldPlayChatSound = true;
    }
    return result;
  }

  if (table !== 'orders') return result;

  const newRow = payload.new && typeof payload.new === 'object' ? payload.new : null;
  if (!newRow?.id) return result;

  const orderId = String(newRow.id);
  const prevMsgs = prevThreads?.[orderId] ?? extractChatMessagesFromRow(payload.old);
  const nextMsgs = extractChatMessagesFromRow(newRow);
  const prevLatest = latestChatMessage(prevMsgs);
  const nextLatest = latestChatMessage(nextMsgs);
  if (!nextLatest || !isCustomerSenderMessage(nextLatest, newRow)) return result;
  if (!prevLatest || chatMessageKey(prevLatest) !== chatMessageKey(nextLatest)) {
    result.notifyOrderIds = [orderId];
    result.shouldPlayChatSound = true;
  }

  return result;
}
