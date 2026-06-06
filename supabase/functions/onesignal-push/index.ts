/** onesignal-push v13 — OneSignal API タイムアウト緩和 */

const FUNCTION_VERSION = 13;
const LEGACY_MAX_BODY_BYTES = 64000;
const FETCH_ORDER_TIMEOUT_MS = 5000;

type PushEvent =
  | 'new_order'
  | 'customer_accepted'
  | 'customer_rejected'
  | 'customer_chat'
  | 'factory_chat';

type SlimPayload = {
  event?: PushEvent | string;
  order_id?: string;
  customer_id?: string | null;
  factory_site_id?: string | null;
  preferred_factory_id?: string | null;
  phone?: string | null;
  factory_name?: string | null;
  contractor_name?: string | null;
  sender_name?: string | null;
  status?: string | null;
};

type OrderRow = {
  id?: string;
  status?: string | null;
  order_data?: Record<string, unknown> | null;
  chat_messages?: unknown[] | null;
  customer_id?: string | null;
  factory_site_id?: string | null;
  preferred_factory_id?: string | null;
};

type LegacyWebhookPayload = {
  type?: string;
  record?: OrderRow;
  old_record?: OrderRow | null;
};

/** 本番 DB トリガーが送る形式（receiver_id = 工場ID または customers.id UUID） */
type ChatMessagePayload = {
  type?: string;
  message?: string;
  order_id?: string;
  receiver_id?: string;
};

type IncomingPayload =
  | { format: 'slim'; data: SlimPayload }
  | { format: 'legacy'; data: LegacyWebhookPayload }
  | { format: 'rescued'; data: OrderRow; hint: 'chat' | 'status' | 'insert' }
  | { format: 'chat_message'; data: ChatMessagePayload };

const ACCEPTED_STATUSES = new Set(['accepted', 'confirmed']);
const ONESIGNAL_FETCH_TIMEOUT_MS = 12000;
const JOB_MAX_MS = 20000;
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

function resolveCustomerExternalIdsFromRow(row: OrderRow): string[] {
  const ids = new Set<string>();
  const customerId = pickString(row.customer_id);
  if (customerId) ids.add(customerId);
  for (const variant of phoneExternalIdVariants(orderCustomerPhone(row))) ids.add(variant);
  return [...ids];
}

function resolveCustomerExternalIds(payload: SlimPayload): string[] {
  const ids = new Set<string>();
  const customerId = pickString(payload.customer_id);
  if (customerId) ids.add(customerId);
  for (const variant of phoneExternalIdVariants(pickString(payload.phone))) ids.add(variant);
  return [...ids];
}

function factoryNameFromOrder(row: OrderRow | null | undefined): string {
  const od = orderData(row);
  return pickString(od.acceptedFactoryLabel, od.factorySiteName, od.factory_name, od.factoryName, '工場');
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

function extractUuidFromText(text: string, ...keys: string[]): string {
  for (const key of keys) {
    const match = text.match(new RegExp(`"${key}"\\s*:\\s*"([0-9a-f-]{36})"`, 'i'));
    if (match?.[1]) return match[1];
  }
  return '';
}

function slimPayloadFromRow(row: OrderRow, event: string): SlimPayload {
  const od = orderData(row);
  return {
    event,
    order_id: pickString(row.id),
    customer_id: pickString(row.customer_id) || null,
    factory_site_id: pickString(row.factory_site_id, od.factory_site_id, od.factorySiteId) || null,
    preferred_factory_id: pickString(row.preferred_factory_id, od.preferred_factory_id, od.preferredFactoryId) || null,
    phone: orderCustomerPhone(row) || null,
    factory_name: factoryNameFromOrder(row),
    contractor_name: pickString(od.customerName, od.customer_name, od.contractorName, '新規注文'),
    sender_name: pickString(od.manager_name, od.contact_person, od.ordered_by, od.orderedBy, '担当者'),
    status: effectiveStatus(row),
  };
}

async function fetchOrderRow(orderId: string): Promise<OrderRow | null> {
  const base = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '') || '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!base || !key || !orderId) return null;

  const response = await withTimeout(
    fetch(`${base}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=*`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
    }),
    FETCH_ORDER_TIMEOUT_MS,
    'fetch order',
  );
  if (!response?.ok) {
    console.warn('[onesignal-push] fetch order failed', { orderId, status: response?.status ?? 'timeout' });
    return null;
  }

  const rows = await withTimeout(response.json(), 2000, 'parse order json');
  if (!Array.isArray(rows) || !rows[0] || typeof rows[0] !== 'object') return null;
  return rows[0] as OrderRow;
}

function inferRescueHint(text: string, row: OrderRow): 'chat' | 'status' | 'insert' {
  if (/chat_messages/i.test(text)) return 'chat';
  const status = effectiveStatus(row);
  if (/"(status|factoryResponseStatus|factory_response_status)"/i.test(text)) return 'status';
  if (isAcceptedLike(status) || isRejectedLike(status)) return 'status';
  if (asArray(row.chat_messages).length > 0) return 'chat';
  return 'insert';
}

async function rescueFromHeaders(req: Request): Promise<IncomingPayload | null> {
  const event = pickString(req.headers.get('x-onesignal-event'));
  const orderId = pickString(req.headers.get('x-onesignal-order-id'));
  if (!event || !orderId) return null;

  const row = await fetchOrderRow(orderId);
  if (row) {
    console.log('[onesignal-push] rescued from headers', { event, orderId });
    return { format: 'slim', data: slimPayloadFromRow(row, event) };
  }

  console.log('[onesignal-push] rescued from headers (minimal)', { event, orderId });
  return { format: 'slim', data: { event, order_id: orderId } };
}

async function rescueFromPartialBody(text: string): Promise<IncomingPayload | null> {
  const orderId = extractUuidFromText(text, 'order_id', 'id');
  if (!orderId) return null;

  const row = await fetchOrderRow(orderId);
  if (!row) return null;

  const eventFromBody = pickString(text.match(/"event"\s*:\s*"([a-z_]+)"/i)?.[1]);
  if (eventFromBody) {
    console.log('[onesignal-push] rescued partial slim body', { orderId, event: eventFromBody, bodyLen: text.length });
    return { format: 'slim', data: slimPayloadFromRow(row, eventFromBody) };
  }

  const op = pickString(text.match(/"type"\s*:\s*"(\w+)"/i)?.[1]).toUpperCase();
  if (op === 'INSERT') {
    console.log('[onesignal-push] rescued partial insert', { orderId, bodyLen: text.length });
    return { format: 'rescued', data: row, hint: 'insert' };
  }

  const hint = inferRescueHint(text, row);
  console.log('[onesignal-push] rescued partial body', { orderId, hint, bodyLen: text.length });
  return { format: 'rescued', data: row, hint };
}

function readFromQueryParams(req: Request): SlimPayload | null {
  const url = new URL(req.url);
  const event = pickString(url.searchParams.get('event'));
  const orderId = pickString(url.searchParams.get('order_id'));
  if (!event || !orderId) return null;

  return {
    event,
    order_id: orderId,
    customer_id: pickString(url.searchParams.get('customer_id')) || null,
    factory_site_id: pickString(url.searchParams.get('factory_site_id')) || null,
    preferred_factory_id: pickString(url.searchParams.get('preferred_factory_id')) || null,
    phone: pickString(url.searchParams.get('phone')) || null,
    factory_name: pickString(url.searchParams.get('factory_name')) || null,
    contractor_name: pickString(url.searchParams.get('contractor_name')) || null,
    sender_name: pickString(url.searchParams.get('sender_name')) || null,
    status: pickString(url.searchParams.get('status')) || null,
  };
}

async function readWebhookPayload(req: Request): Promise<{ incoming: IncomingPayload | null; reason?: string }> {
  const fromQuery = readFromQueryParams(req);
  if (fromQuery) {
    console.log('[onesignal-push] query params', { event: fromQuery.event, orderId: fromQuery.order_id });
    return { incoming: { format: 'slim', data: fromQuery } };
  }

  const contentLengthHeader = req.headers.get('content-length');
  const rawText = await req.text();
  const bodyLen = rawText.length;

  console.log('[onesignal-push] body received', {
    bodyLen,
    contentLength: contentLengthHeader,
    preview: rawText.slice(0, 240),
  });

  if (rawText) {
    const parsed = tryParseJson(rawText);
    if (parsed) {
      if (pickString(parsed.event)) {
        return { incoming: { format: 'slim', data: parsed as SlimPayload } };
      }

      if (pickString(parsed.type) === 'chat_message') {
        console.log('[onesignal-push] chat_message payload', {
          receiverId: pickString(parsed.receiver_id),
          orderId: pickString(parsed.order_id),
        });
        return { incoming: { format: 'chat_message', data: parsed as ChatMessagePayload } };
      }

      const record = parsed.record;
      const recordObject = record && typeof record === 'object' && !Array.isArray(record)
        ? record as OrderRow
        : null;

      if (pickString(parsed.type) && recordObject) {
        const contentLength = contentLengthHeader ? Number(contentLengthHeader) : bodyLen;
        if (contentLength > LEGACY_MAX_BODY_BYTES) {
          return { incoming: null, reason: 'legacy_payload_too_large' };
        }
        console.log('[onesignal-push] legacy payload');
        return {
          incoming: {
            format: 'legacy',
            data: {
              type: pickString(parsed.type),
              record: recordObject,
              old_record: parsed.old_record && typeof parsed.old_record === 'object'
                ? parsed.old_record as OrderRow
                : null,
            },
          },
        };
      }

      if (pickString(parsed.type) && !recordObject) {
        const rescued = await rescueFromPartialBody(rawText);
        if (rescued) return { incoming: rescued };
      }
    }
  }

  const fromHeaders = await rescueFromHeaders(req);
  if (fromHeaders) return { incoming: fromHeaders };

  if (rawText) {
    const rescued = await rescueFromPartialBody(rawText);
    if (rescued) return { incoming: rescued };
  }

  return {
    incoming: null,
    reason: bodyLen ? 'unrecognized_payload' : 'empty_body',
  };
}

async function postOneSignalRequest(payload: Record<string, unknown>): Promise<boolean> {
  const started = Date.now();
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
    console.log('[onesignal-push] OneSignal request start', { target: target || '(unknown)' });

    const response = await fetch(ONESIGNAL_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: buildOneSignalAuthHeader(apiKey),
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });

    const responseText = await response.text();
    const parsed = tryParseJson(responseText);
    const notificationId = pickString(parsed?.id);
    const elapsed = Date.now() - started;

    console.log(
      `[onesignal-push] status=${response.status} target=${target || '(unknown)'} notificationId=${notificationId || 'none'} ms=${elapsed}`,
    );

    if (parsed?.errors) console.warn('[onesignal-push] OneSignal errors:', parsed.errors);
    if (isVerboseLog()) console.log('[onesignal-push] response:', responseText);

    if (response.ok && notificationId) return true;
    if (response.ok && !notificationId) {
      console.warn('[onesignal-push] OneSignal 200 but no notification id', { target, elapsed });
    }
    return false;
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === 'AbortError';
    console.warn(
      `[onesignal-push] OneSignal ${isAbort ? 'timeout' : 'failed'} target=${target} ms=${Date.now() - started}`,
    );
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function postOneSignal(payload: Record<string, unknown>): Promise<boolean> {
  return postOneSignalRequest(payload);
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
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  const apikey = (req.headers.get('apikey') || '').trim();
  return bearer === expected || apikey === expected;
}

async function processSlimPayload(payload: SlimPayload): Promise<void> {
  const event = pickString(payload.event) as PushEvent;
  const orderId = pickString(payload.order_id);
  const factoryName = pickString(payload.factory_name, '工場');
  const customerIds = resolveCustomerExternalIds(payload);
  const sent: string[] = [];

  console.log('[onesignal-push] process start', { v: FUNCTION_VERSION, format: 'slim', event, orderId });

  switch (event) {
    case 'new_order': {
      const contractorName = pickString(payload.contractor_name, '新規注文');
      if (await sendToRole('factory', `新規注文が入りました：${contractorName}`, { type: 'new_order', orderId })) {
        sent.push('factory:new_order');
      }
      break;
    }
    case 'customer_accepted': {
      if (customerIds.length) {
        const message =
          `${factoryName}がご注文承りました。キャンセルのご連絡は前営業日の12時までに工場へご連絡ください。`;
        if (await sendToExternalIds(customerIds, message, {
          type: 'order_status',
          orderId,
          status: pickString(payload.status, 'accepted'),
        })) sent.push('customer:accepted');
      }
      break;
    }
    case 'customer_rejected': {
      if (customerIds.length) {
        if (await sendToExternalIds(customerIds, '大変込み合っております。別日をご指定ください。', {
          type: 'order_status',
          orderId,
          status: pickString(payload.status, 'rejected'),
        })) sent.push('customer:rejected');
      }
      break;
    }
    case 'customer_chat': {
      if (customerIds.length) {
        if (await sendToExternalIds(
          customerIds,
          `${factoryName}からメッセージが届いています。`,
          { type: 'chat', orderId, targetApp: 'customer' },
        )) sent.push('customer:chat');
      }
      break;
    }
    case 'factory_chat': {
      const senderName = pickString(payload.sender_name, '担当者');
      const factoryTarget = pickString(payload.factory_site_id, payload.preferred_factory_id);
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
      break;
    }
    default:
      console.warn('[onesignal-push] unknown event', event);
  }

  console.log('[onesignal-push] process done', { v: FUNCTION_VERSION, orderId, sent: sent.length ? sent : 'none' });
}

async function processLegacyWebhook(payload: LegacyWebhookPayload): Promise<void> {
  const eventType = String(payload.type || '').toUpperCase();
  const record = payload.record || {};
  const oldRecord = payload.old_record || null;
  const orderId = pickString(record.id);
  const customerIds = resolveCustomerExternalIdsFromRow(record);
  const sent: string[] = [];

  console.log('[onesignal-push] process start', { v: FUNCTION_VERSION, format: 'legacy', eventType, orderId });

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
      const message =
        `${factoryName}がご注文承りました。キャンセルのご連絡は前営業日の12時までに工場へご連絡ください。`;
      if (await sendToExternalIds(customerIds, message, {
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

async function processRescued(record: OrderRow, hint: 'chat' | 'status' | 'insert'): Promise<void> {
  const orderId = pickString(record.id);
  const customerIds = resolveCustomerExternalIdsFromRow(record);
  const factoryName = factoryNameFromOrder(record);
  const sent: string[] = [];

  console.log('[onesignal-push] process start', { v: FUNCTION_VERSION, format: 'rescued', hint, orderId });

  if (hint === 'insert') {
    const status = effectiveStatus(record);
    if (status !== 'pending_association' && isPendingLike(status)) {
      const od = orderData(record);
      const contractorName = pickString(od.customerName, od.customer_name, od.contractorName, '新規注文');
      if (await sendToRole('factory', `新規注文が入りました：${contractorName}`, { type: 'new_order', orderId })) {
        sent.push('factory:new_order');
      }
    }
  } else if (hint === 'status') {
    const newStatus = effectiveStatus(record);
    if (isAcceptedLike(newStatus) && customerIds.length) {
      const message =
        `${factoryName}がご注文承りました。キャンセルのご連絡は前営業日の12時までに工場へご連絡ください。`;
      if (await sendToExternalIds(customerIds, message, {
        type: 'order_status',
        orderId,
        status: newStatus,
      })) sent.push('customer:accepted');
    } else if (isRejectedLike(newStatus) && customerIds.length) {
      if (await sendToExternalIds(customerIds, '大変込み合っております。別日をご指定ください。', {
        type: 'order_status',
        orderId,
        status: newStatus,
      })) sent.push('customer:rejected');
    }
  } else {
    const latest = latestChatMessage(asArray(record.chat_messages));
    if (!latest) {
      console.log('[onesignal-push] rescued chat with no messages', { orderId });
      return;
    }
    const chatFrom = pickString(latest.from);
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

  console.log('[onesignal-push] process done', { v: FUNCTION_VERSION, orderId, sent: sent.length ? sent : 'none' });
}

function isFactoryReceiverId(receiverId: string): boolean {
  return /^FACTORY_/i.test(receiverId);
}

async function processChatMessagePayload(payload: ChatMessagePayload): Promise<void> {
  const receiverId = pickString(payload.receiver_id);
  const message = pickString(payload.message, '新しいメッセージが届きました');
  const orderId = pickString(payload.order_id);
  const sent: string[] = [];

  console.log('[onesignal-push] process start', {
    v: FUNCTION_VERSION,
    format: 'chat_message',
    receiverId,
    orderId,
    targetApp: isFactoryReceiverId(receiverId) ? 'factory' : 'customer',
  });

  if (!receiverId) {
    console.warn('[onesignal-push] chat_message missing receiver_id');
    return;
  }

  if (await sendToExternalIds([receiverId], message, {
    type: 'chat',
    orderId,
    targetApp: isFactoryReceiverId(receiverId) ? 'factory' : 'customer',
  })) {
    sent.push(isFactoryReceiverId(receiverId) ? 'factory:chat' : 'customer:chat');
  }

  console.log('[onesignal-push] process done', { v: FUNCTION_VERSION, orderId, sent: sent.length ? sent : 'none' });
}

async function processIncoming(incoming: IncomingPayload): Promise<void> {
  if (incoming.format === 'slim') {
    await processSlimPayload(incoming.data);
    return;
  }
  if (incoming.format === 'legacy') {
    await processLegacyWebhook(incoming.data);
    return;
  }
  if (incoming.format === 'chat_message') {
    await processChatMessagePayload(incoming.data);
    return;
  }
  await processRescued(incoming.data, incoming.hint);
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

  if (req.method !== 'POST' && req.method !== 'GET') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized', v: FUNCTION_VERSION }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { incoming, reason } = await readWebhookPayload(req);
  if (!incoming) {
    return new Response(JSON.stringify({ ok: false, error: 'Invalid payload', reason, v: FUNCTION_VERSION }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const orderId = incoming.format === 'slim'
    ? pickString(incoming.data.order_id)
    : incoming.format === 'rescued'
    ? pickString(incoming.data.id)
    : incoming.format === 'chat_message'
    ? pickString(incoming.data.order_id)
    : pickString(incoming.data.record?.id);
  const eventLabel = incoming.format === 'slim'
    ? pickString(incoming.data.event)
    : incoming.format === 'legacy'
    ? pickString(incoming.data.type)
    : incoming.format === 'chat_message'
    ? 'chat_message'
    : incoming.hint;

  scheduleBackground(
    withTimeout(processIncoming(incoming), JOB_MAX_MS, 'webhook job').catch((error) => {
      console.error('[onesignal-push] job error', orderId, error);
    }),
  );

  return new Response(
    JSON.stringify({
      ok: true,
      accepted: true,
      v: FUNCTION_VERSION,
      format: incoming.format,
      orderId,
      event: eventLabel,
      ms: Date.now() - started,
    }),
    { status: 202, headers: { 'Content-Type': 'application/json' } },
  );
});
