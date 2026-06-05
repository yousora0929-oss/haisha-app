/**
 * 注文同期とチャット同期のデバウンスを分離（相互にタイマーを潰さない）
 */

export function createSplitRealtimeSyncScheduler(options = {}) {
  const debounceMs = Number.isFinite(options.debounceMs) ? options.debounceMs : 500;
  const onOrderSync = typeof options.onOrderSync === 'function' ? options.onOrderSync : async () => {};
  const onChatSync = typeof options.onChatSync === 'function' ? options.onChatSync : async () => {};

  let orderTimerId = null;
  let chatTimerId = null;
  let orderRunning = false;
  let chatRunning = false;
  let orderPending = false;
  let chatPending = false;
  let orderPayloads = [];
  let chatPayloads = [];

  const takeOrderPayloads = () => {
    const batch = orderPayloads;
    orderPayloads = [];
    return batch;
  };

  const takeChatPayloads = () => {
    const batch = chatPayloads;
    chatPayloads = [];
    return batch;
  };

  const runOrderSync = async () => {
    if (orderRunning) {
      orderPending = true;
      return;
    }
    orderRunning = true;
    try {
      do {
        orderPending = false;
        const batch = takeOrderPayloads();
        const payload = batch.length ? batch[batch.length - 1] : null;
        await onOrderSync(payload, batch);
      } while (orderPending);
    } finally {
      orderRunning = false;
    }
  };

  const runChatSync = async () => {
    if (chatRunning) {
      chatPending = true;
      return;
    }
    chatRunning = true;
    try {
      do {
        chatPending = false;
        const batch = takeChatPayloads();
        const payload = batch.length ? batch[batch.length - 1] : null;
        await onChatSync(payload, batch);
      } while (chatPending);
    } finally {
      chatRunning = false;
    }
  };

  const scheduleOrder = (payload) => {
    if (payload) orderPayloads.push(payload);
    orderPending = true;
    if (orderTimerId != null) return;
    orderTimerId = window.setTimeout(() => {
      orderTimerId = null;
      void runOrderSync();
    }, debounceMs);
  };

  const scheduleChat = (payload) => {
    if (payload) chatPayloads.push(payload);
    chatPending = true;
    if (chatTimerId != null) return;
    chatTimerId = window.setTimeout(() => {
      chatTimerId = null;
      void runChatSync();
    }, debounceMs);
  };

  const schedule = (payload, kind) => {
    if (kind === 'chat') {
      scheduleChat(payload);
      return;
    }
    if (kind === 'order' || kind === 'schedule') {
      scheduleOrder(payload);
      return;
    }
    scheduleOrder(payload);
  };

  const dispose = () => {
    if (orderTimerId != null) {
      window.clearTimeout(orderTimerId);
      orderTimerId = null;
    }
    if (chatTimerId != null) {
      window.clearTimeout(chatTimerId);
      chatTimerId = null;
    }
    orderPayloads = [];
    chatPayloads = [];
    orderPending = false;
    chatPending = false;
  };

  return { scheduleOrder, scheduleChat, schedule, dispose };
}
