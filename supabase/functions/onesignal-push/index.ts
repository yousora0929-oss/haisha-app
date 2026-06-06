/** onesignal-push v7 — 外部 import なし・202 即返却・DB 参照なし */

const FUNCTION_VERSION = 7;

type OrderRow = {
  id?: string;
  status?: string | null;
  order_data?: Record<string, unknown> | null;
  chat_messages?: unknown[] | null;
  customer_id?: string | null;
  factory_site_id?: string | null;
  preferred_factory_id?: string | null;
};

type WebhookPayload = {
  type?: string;
  record?: OrderRow;
  old_record?: OrderRow | null;
};

const ACCEPTED_STATUSES = new Set(['accepted', 'confirmed']);
const ONESIGNAL_FETCH_TIMEOUT_MS = 4000;
const BODY_READ_TIMEOUT_MS = 2000;
const JOB_MAX_MS = 15000;
const ONESIGNAL_API_URL = 'https://api.onesignal.com/notifications';

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function pickString(...values: unknown[]): string {
  for (const value of values) {
    const text = value != null ? String(value).trim() : '';
    if (text) return text;
  }
  return '';
}

function orderData(row: OrderRow | null | undefined): Record<string, unknown> {
  return asObject(row?.order_data);
}

function effectiveStatus(row: OrderRow | null | undefined): string {
  const od = orderData(row);
  const factoryResponse = pickString(od.factoryResponseStatus, od.factory_response_status);
  if (factoryResponse) return factoryResponse;
  return pickString(row?.status, od.status) || 'pending';
}

function isPendingLike(status: string): boolean {
  return !status || status === 'pending' || status === 'pending_association';
}

function isAcceptedLike(status: string): boolean {
  return ACCEPTED_STATUSES.has(status);
}

function isRejectedLike(status: string): boolean {
  return status === 'rejected' || status === 'cancelled' || status === 'customer_cancelled';
}

function phoneExternalIdVariants(value: string): string[] {
  const base = String(value || '').replace(/\s+/g, '').trim();
  if (!base) return [];
  const compact = base.replace(/[‐-‒–—―ーｰ−\s]/g, '');
  const ids = new Set([base]);
  if (compact) ids.add(compact);
  return [...ids];
}

function orderCustomerPhone(row: OrderRow | null | undefined): string {
  const od = orderData(row);
  return pickString(od.phone_number, od.customerPhone, od.sitePhone, od.phone);
}

function resolveCustomerPushExternalIds(row: OrderRow): string[] {
  const ids = new Set<string>();
  const customerId = pickString(row.customer_id);
  if (customerId) ids.add(customerId);
  for (const variant of phoneExternalIdVariants(orderCustomerPhone(row))) ids.add(variant);
  return [...ids];
}

function factoryNameFromOrder(row: OrderRow | null | undefined): string {
  const od = orderData(row);
  return pickString(od.acceptedFactoryLabel, od.factorySiteName, od.factory_name, od.factoryName, '工場');
}

function customerAcceptedMessage(order: OrderRow, factoryName: string): string {
  return `${factoryNameFromOrder(order) || factoryName}がご注文承りました。キャンセルのご連絡は前営業日の12時までに工場へご連絡ください。`;
}

function latestChatMessage(messages: unknown[]): Record<string, unknown> | null {
  const list = messages.filter(Boolean);
  if (!list.length) return null;
  return asObject(list[list.length - 1]);
}

function chatMessageKey(message: Record<string, unknown> | null): string {
  if (!message) return '';
  return [message.id, message.createdAt, message.from].map((part) => (part == null ? '' : String(part))).join('|');
}

function isVerboseLog(): boolean {
  const v = String(Deno.env.get('ONESIGNAL_PUSH_DEBUG') || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function buildOneSignalAuthHeader(apiKey: string): string {
  const key = String(apiKey || '').trim();
  if (/^(Key|key|Basic)\s+/i.test(key)) return key;
  return `Key ${key}`;
}

function payloadSendTarget(payload: Record<string, unknown>): string {
  const aliases = payload.include_aliases;
  if (aliases && typeof aliases === 'object' && !Array.isArray(aliases)) {
    const external = (aliases as Record<string, unknown>).external_id;
    if (Array.isArray(external) && external.length) {
      return external.map((id) => String(id)).join(',');
    }
  }
  const filters = payload.filters;
  if (Array.isArray(filters) && filters.length) {
    const tag = filters.find((f) => f && typeof f === 'object' && (f as Record<string, unknown>).field === 'tag');
    if (tag && typeof tag === 'object') {
      const t = tag as Record<string, unknown>;
      return `tag:${t.key}=${t.value}`;
    }
  }
  return '';
}

function tryParseJson(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => {
      setTimeout(() => {
        console.warn(`[onesignal-push] ${label} timed out after ${ms}ms`);
        resolve(null);
      }, ms);
    }),
  ]);
}

async function readWebhookPayload(req: Request): Promise<WebhookPayload | null> {
  const text = await withTimeout(req.text(), BODY_READ_TIMEOUT_MS, 'read body');
  if (!text) return null;
  const parsed = tryParseJson(text);
  if (!parsed) return null;
  return parsed as WebhookPayload;
}

async function postOneSignalRequest(payload: Record<string, unknown>): Promise<boolean> {
  const appId =
    Deno.env.get('ONESIGNAL_APP_ID') ||
    Deno.env.get('VITE_ONESIGNAL_APP_ID') ||
    '98ab8b43-0536-4805-bee0-2341648828b6';
  const apiKey = Deno.env.get('ONESIGNAL_REST_API_KEY') || Deno.env.get('VITE_ONESIGNAL_REST_API_KEY') || '';
  if (!appId || !apiKey) {
    console.warn('[onesignal-push] OneSignal env vars missing');
    return false;
  }

  const requestPayload: Record<string, unknown> = {
    app_id: appId,
    target_channel: 'push',
    headings: { ja: '生コン発注システム', en: 'Ready-mix Ordering System' },
    ios_badgeType: 'SetTo',
    ios_badgeCount: 1,
    web_badge: 1,
    ...payload,
  };

  const target = payloadSendTarget(requestPayload);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ONESIGNAL_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(ONESIGNAL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: buildOneSignalAuthHeader(apiKey),
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });

    const responseText = await withTimeout(response.text(), 2000, 'read OneSignal body') ?? '';
    const parsed = tryParseJson(responseText);
    const notificationId = pickString(parsed?.id);

    console.log(
      `[onesignal-push] status=${response.status} target=${target || '(unknown)'} notificationId=${notificationId || 'none'}`,
    );

    if (parsed?.errors) console.warn('[onesignal-push] OneSignal errors:', parsed.errors);
    if (isVerboseLog()) console.log('[onesignal-push] response:', responseText);

    return response.ok && Boolean(notificationId);
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === 'AbortError';
    console.warn(`[onesignal-push] OneSignal fetch ${isAbort ? 'timeout' : 'failed'} target=${target}`);
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function postOneSignal(payload: Record<string, unknown>): Promise<boolean> {
  const result = await withTimeout(postOneSignalRequest(payload), ONESIGNAL_FETCH_TIMEOUT_MS + 1500, 'OneSignal post');
  return result === true;
}

async function sendToExternalIds(externalIds: string[], message: string, data: Record<string, unknown> = {}) {
  const ids = [...new Set(externalIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length || !message) return false;
  return postOneSignal({
    include_aliases: { external_id: ids },
    contents: { ja: message, en: message },
    ...(Object.keys(data).length ? { data } : {}),
  });
}

async function sendToRole(role: string, message: string, data: Record<string, unknown> = {}) {
  const normalizedRole = String(role || '').trim();
  if (!normalizedRole || !message) return false;
  return postOneSignal({
    filters: [{ field: 'tag', key: 'role', relation: '=', value: normalizedRole }],
    contents: { ja: message, en: message },
    ...(Object.keys(data).length ? { data } : {}),
  });
}

function isAuthorized(req: Request): boolean {
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!expected) return false;
  const auth = req.headers.get('Authorization') || '';
  return auth.replace(/^Bearer\s+/i, '').trim() === expected;
}

async function processOrderWebhook(payload: WebhookPayload): Promise<void> {
  const eventType = String(payload.type || '').toUpperCase();
  const record = payload.record || {};
  const oldRecord = payload.old_record || null;
  const orderId = pickString(record.id);
  const customerIds = resolveCustomerPushExternalIds(record);
  const sent: string[] = [];

  console.log('[onesignal-push] process start', { v: FUNCTION_VERSION, eventType, orderId });

  if (eventType === 'INSERT') {
    const status = effectiveStatus(record);
    if (status !== 'pending_association' && isPendingLike(status)) {
      const od = orderData(record);
      const contractorName = pickString(od.customerName, od.customer_name, od.contractorName, '新規注文');
      if (await sendToRole('factory', `新規注文が入りました：${contractorName}`, { type: 'new_order', orderId })) {
        sent.push('factory:new_order');
      }
    }
  }

  if (eventType === 'UPDATE' && oldRecord) {
    const oldStatus = effectiveStatus(oldRecord);
    const newStatus = effectiveStatus(record);
    const factoryName = factoryNameFromOrder(record);

    if (isPendingLike(oldStatus) && isAcceptedLike(newStatus) && customerIds.length) {
      if (await sendToExternalIds(customerIds, customerAcceptedMessage(record, factoryName), {
        type: 'order_status',
        orderId,
        status: newStatus,
      })) sent.push('customer:accepted');
    } else if (isPendingLike(oldStatus) && isRejectedLike(newStatus) && customerIds.length) {
      if (await sendToExternalIds(customerIds, '大変込み合っております。別日をご指定ください。', {
        type: 'order_status',
        orderId,
        status: newStatus,
      })) sent.push('customer:rejected');
    }

    const oldMessages = asArray(oldRecord.chat_messages);
    const newMessages = asArray(record.chat_messages);
    const previous = latestChatMessage(oldMessages);
    const latest = latestChatMessage(newMessages);
    const chatAdded = newMessages.length > oldMessages.length &&
      latest != null &&
      chatMessageKey(previous) !== chatMessageKey(latest);

    if (chatAdded) {
      const chatFrom = pickString(latest?.from);
      if ((chatFrom === 'factory' || chatFrom === 'admin') && customerIds.length) {
        if (await sendToExternalIds(
          customerIds,
          `${factoryName}からメッセージが届いています。`,
          { type: 'chat', orderId, targetApp: 'customer' },
        )) sent.push('customer:chat');
      } else if (chatFrom === 'master' || chatFrom === 'customer') {
        const od = orderData(record);
        const factoryTarget = pickString(
          record.factory_site_id,
          od.factory_site_id,
          od.factorySiteId,
          record.preferred_factory_id,
          od.preferred_factory_id,
          od.preferredFactoryId,
        );
        const senderName = pickString(od.manager_name, od.contact_person, od.ordered_by, od.orderedBy, '担当者');
        if (factoryTarget) {
          if (await sendToExternalIds(
            [factoryTarget],
            `${senderName}から新しいメッセージが届きました。`,
            { type: 'chat', orderId, targetApp: 'factory' },
          )) sent.push('factory:chat');
        } else if (await sendToRole('factory', `${senderName}から新しいメッセージが届きました。`, {
          type: 'chat',
          orderId,
          targetApp: 'factory',
        })) sent.push('factory:chat_role');
      }
    }
  }

  console.log('[onesignal-push] process done', { v: FUNCTION_VERSION, orderId, sent: sent.length ? sent : 'none' });
}

declare const EdgeRuntime: { waitUntil: (promise: Promise<unknown>) => void } | undefined;

function scheduleBackground(job: Promise<unknown>): void {
  if (typeof EdgeRuntime !== 'undefined' && typeof EdgeRuntime.waitUntil === 'function') {
    EdgeRuntime.waitUntil(job);
    return;
  }
  job.catch((error) => console.error('[onesignal-push] background failed', error));
}

Deno.serve(async (req) => {
  const started = Date.now();

  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized', v: FUNCTION_VERSION }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const payload = await readWebhookPayload(req);
  if (!payload) {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid payload', v: FUNCTION_VERSION }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const orderId = pickString(payload.record?.id);
  scheduleBackground(
    withTimeout(processOrderWebhook(payload), JOB_MAX_MS, 'webhook job').catch((error) => {
      console.error('[onesignal-push] job error', orderId, error);
    }),
  );

  return new Response(
    JSON.stringify({ ok: true, accepted: true, v: FUNCTION_VERSION, orderId, ms: Date.now() - started }),
    { status: 202, headers: { 'Content-Type': 'application/json' } },
  );
});
