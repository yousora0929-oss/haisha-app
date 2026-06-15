import { chatMessageKey, latestChatMessage } from './customerChatRealtime.js';

const recentChatSoundAt = new Map();
const CHAT_SOUND_DEDUP_MS = 10_000;

/** 同一チャット着信のアプリ内通知音を短時間で1回に抑える */
export function shouldPlayChatSoundOnce(dedupeKey) {
  const key = String(dedupeKey || '').trim();
  if (!key) return true;
  const now = Date.now();
  const prev = recentChatSoundAt.get(key);
  if (prev != null && now - prev < CHAT_SOUND_DEDUP_MS) return false;
  recentChatSoundAt.set(key, now);
  return true;
}

export function chatSoundKeyFromOrderMessages(orderId, messages) {
  const id = String(orderId || '').trim();
  if (!id) return '';
  const latest = latestChatMessage(messages);
  const msgKey = chatMessageKey(latest);
  return msgKey ? `${id}|${msgKey}` : '';
}

export function chatSoundKeyFromRealtimePayload(payload) {
  const newRow = payload?.new && typeof payload.new === 'object' ? payload.new : null;
  if (!newRow?.id) return '';
  const orderId = String(newRow.id);
  const prevMsgs = Array.isArray(payload?.old?.chat_messages) ? payload.old.chat_messages : [];
  const nextMsgs = Array.isArray(newRow.chat_messages) ? newRow.chat_messages : [];
  const prevLatest = latestChatMessage(prevMsgs);
  const nextLatest = latestChatMessage(nextMsgs);
  if (!nextLatest) return '';
  const nextKey = chatMessageKey(nextLatest);
  if (!nextKey) return '';
  if (prevLatest && chatMessageKey(prevLatest) === nextKey) return '';
  return `${orderId}|${nextKey}`;
}
