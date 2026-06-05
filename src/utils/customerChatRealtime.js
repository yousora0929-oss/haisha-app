/** 工場・管理者からのチャット着信をカスタマー向けに検出 */

export function isIncomingChatForCustomer(message) {
  const from = String(message?.from || '').trim();
  return from === 'factory' || from === 'admin';
}

export function latestChatMessage(messages) {
  const list = Array.isArray(messages) ? messages.filter(Boolean) : [];
  return list.length ? list[list.length - 1] : null;
}

export function chatMessageKey(message) {
  if (!message) return '';
  return [message.id, message.createdAt, message.from].map((x) => (x == null ? '' : String(x))).join('|');
}

export function isUnreadChatForCustomer(messages, readKey) {
  const latest = latestChatMessage(messages);
  if (!latest || !isIncomingChatForCustomer(latest)) return false;
  return chatMessageKey(latest) !== String(readKey || '');
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

/**
 * チャットスレッドの前後比較で新着（工場・管理者）を検出
 * @returns {{ notifyOrderIds: string[] }}
 */
export function detectCustomerChatNotifications(prevThreads, nextThreads, orderIds, readKeys = {}) {
  const notifyOrderIds = new Set();
  const ids = Array.isArray(orderIds)
    ? orderIds.map((id) => String(id)).filter(Boolean)
    : [
        ...new Set([
          ...Object.keys(prevThreads || {}),
          ...Object.keys(nextThreads || {}),
        ]),
      ];

  for (const orderId of ids) {
    const prevLatest = latestChatMessage(prevThreads?.[orderId]);
    const nextLatest = latestChatMessage(nextThreads?.[orderId]);
    if (!nextLatest || !isIncomingChatForCustomer(nextLatest)) continue;

    const nextKey = chatMessageKey(nextLatest);
    if (readKeys?.[orderId] === nextKey) continue;

    if (!prevLatest || chatMessageKey(prevLatest) !== nextKey) {
      notifyOrderIds.add(String(orderId));
    }
  }

  return { notifyOrderIds: [...notifyOrderIds] };
}

/**
 * orders テーブルの Realtime ペイロードからチャット着信を推定（chat_messages JSONB）
 * @returns {{ notifyOrderIds: string[], shouldPlayChatSound: boolean }}
 */
export function analyzeCustomerChatRealtimePayload(payload, isRelevantOrder, prevThreads = {}, readKeys = {}) {
  const result = { notifyOrderIds: [], shouldPlayChatSound: false };
  const isRelevant = typeof isRelevantOrder === 'function' ? isRelevantOrder : () => true;
  if (!payload) return result;

  const eventType = String(payload.eventType || payload.event || '').toUpperCase();
  if (eventType !== 'UPDATE' && eventType !== 'INSERT') return result;

  const newRow = payload.new && typeof payload.new === 'object' ? payload.new : null;
  if (!newRow?.id || !isRelevant(newRow)) return result;

  const orderId = String(newRow.id);
  const prevMsgs = prevThreads?.[orderId] ?? extractChatMessagesFromRow(payload.old);
  const nextMsgs = extractChatMessagesFromRow(newRow);

  const prevLatest = latestChatMessage(prevMsgs);
  const nextLatest = latestChatMessage(nextMsgs);
  if (!nextLatest || !isIncomingChatForCustomer(nextLatest)) return result;

  const nextKey = chatMessageKey(nextLatest);
  if (readKeys?.[orderId] === nextKey) return result;

  if (!prevLatest || chatMessageKey(prevLatest) !== nextKey) {
    result.notifyOrderIds = [orderId];
    result.shouldPlayChatSound = true;
  }

  return result;
}
