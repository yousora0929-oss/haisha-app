import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

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
const ONESIGNAL_FETCH_TIMEOUT_MS = 5000;
const DB_LOOKUP_TIMEOUT_MS = 3000;

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

function externalIdCandidates(value: string): string[] {
  const base = String(value || '').trim();
  return base ? [base] : [];
}

/** orders.customer_id（UUID）— DB ルックアップ不要（orders.customer_id_idx でインデックス済み） */
function resolveCustomerExternalId(row: OrderRow | null | undefined): string {
  return pickString(row?.customer_id);
}

function factoryNameFromOrder(row: OrderRow | null | undefined, factoryName = ''): string {
  const od = orderData(row);
  return pickString(
    factoryName,
    od.acceptedFactoryLabel,
    od.factorySiteName,
    od.factory_name,
    od.factoryName,
    '工場',
  );
}

function customerAcceptedMessage(order: OrderRow, factoryName: string): string {
  return `${factoryNameFromOrder(order, factoryName)}がご注文承りました。キャンセルのご連絡は前営業日の12時までに工場へご連絡ください。`;
}

function latestChatMessage(messages: unknown[]): Record<string, unknown> | null {
  const list = messages.filter(Boolean);
  if (!list.length) return null;
  const last = list[list.length - 1];
  return asObject(last);
}

function chatMessageKey(message: Record<string, unknown> | null): string {
  if (!message) return '';
  return [message.id, message.createdAt, message.from].map((part) => (part == null ? '' : String(part))).join('|');
}

function isVerboseLog(): boolean {
  const v = String(Deno.env.get('ONESIGNAL_PUSH_DEBUG') || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function logSendTarget(kind: string, target: string) {
  console.log(`[onesignal-push] send ${kind} → ${target || '(none)'}`);
}

function payloadSendTarget(payload: Record<string, unknown>): string {
  const ids = payload.include_external_user_ids;
  if (Array.isArray(ids) && ids.length) return ids.map((id) => String(id)).join(',');
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

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`[onesignal-push] ${label} timed out after ${ms}ms`);
          resolve(null);
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** factories.id は PK — .eq('id', factoryId) でインデックス利用。order_data に名前があれば DB 省略 */
async function lookupFactoryName(
  supabase: ReturnType<typeof createClient>,
  row: OrderRow,
): Promise<string> {
  const fromOrder = factoryNameFromOrder(row);
  if (fromOrder !== '工場') return fromOrder;

  const od = orderData(row);
  const factoryId = pickString(row.factory_site_id, od.factory_site_id, od.factorySiteId);
  if (!factoryId) return '工場';

  const result = await withTimeout(
    supabase.from('factories').select('name').eq('id', factoryId).maybeSingle(),
    DB_LOOKUP_TIMEOUT_MS,
    'factory lookup',
  );
  if (!result) return '工場';
  const { data, error } = result;
  if (error) {
    console.warn('[onesignal-push] factory lookup failed', error.message);
    return '工場';
  }
  return pickString(data?.name, '工場');
}

async function postOneSignal(payload: Record<string, unknown>): Promise<boolean> {
  const appId =
    Deno.env.get('ONESIGNAL_APP_ID') ||
    Deno.env.get('VITE_ONESIGNAL_APP_ID') ||
    '98ab8b43-0536-4805-bee0-2341648828b6';
  const apiKey = Deno.env.get('ONESIGNAL_REST_API_KEY') || Deno.env.get('VITE_ONESIGNAL_REST_API_KEY') || '';
  if (!appId || !apiKey) {
    console.warn('[onesignal-push] OneSignal env vars missing');
    return false;
  }

  const requestPayload = {
    app_id: appId,
    headings: { ja: '生コン発注システム', en: 'Ready-mix Ordering System' },
    ios_badgeType: 'SetTo',
    ios_badgeCount: 1,
    web_badge: 1,
    ...payload,
  };

  const target = payloadSendTarget(requestPayload);
  if (isVerboseLog()) {
    console.log('OneSignal 送信 payload:', JSON.stringify(requestPayload, null, 2));
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ONESIGNAL_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${apiKey}`,
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal,
    });

    const responseText = await response.text().catch(() => '');
    console.log(`[onesignal-push] OneSignal status=${response.status} target=${target || '(unknown)'}`);

    if (isVerboseLog()) {
      console.log('[onesignal-push] OneSignal response body:', responseText);
    }

    if (!response.ok) {
      console.warn('[onesignal-push] OneSignal API error', response.status, isVerboseLog() ? responseText : '');
      return false;
    }
    return true;
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === 'AbortError';
    console.warn(
      `[onesignal-push] OneSignal fetch ${isAbort ? 'timeout' : 'failed'} target=${target || '(unknown)'}`,
      isVerboseLog() ? error : '',
    );
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function sendToExternalIds(externalIds: string[], message: string, data: Record<string, unknown> = {}) {
  const ids = [...new Set(externalIds.flatMap((id) => externalIdCandidates(id)).filter(Boolean))];
  if (!ids.length || !message) return false;
  logSendTarget('external', ids.join(','));
  return postOneSignal({
    include_external_user_ids: ids,
    channel_for_external_user_ids: 'push',
    contents: { ja: message, en: message },
    ...(Object.keys(data).length ? { data } : {}),
  });
}

async function sendToRole(role: string, message: string, data: Record<string, unknown> = {}) {
  const normalizedRole = String(role || '').trim();
  if (!normalizedRole || !message) return false;
  logSendTarget('role', normalizedRole);
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
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return token === expected;
}

type SendResult = { label: string; ok: boolean };

async function handleOrderWebhook(payload: WebhookPayload): Promise<Response> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ ok: false, error: 'Supabase env missing' }), { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const eventType = String(payload.type || '').toUpperCase();
  const record = payload.record || {};
  const oldRecord = payload.old_record || null;
  const orderId = pickString(record.id);
  const sendTasks: Promise<SendResult>[] = [];

  if (eventType === 'INSERT') {
    const status = effectiveStatus(record);
    if (status !== 'pending_association' && isPendingLike(status)) {
      const od = orderData(record);
      const contractorName = pickString(od.customerName, od.customer_name, od.contractorName, '新規注文');
      sendTasks.push(
        sendToRole('factory', `新規注文が入りました：${contractorName}`, {
          type: 'new_order',
          orderId,
        }).then((ok) => ({ label: 'factory:new_order', ok })),
      );
    }
  }

  if (eventType === 'UPDATE' && oldRecord) {
    const oldStatus = effectiveStatus(oldRecord);
    const newStatus = effectiveStatus(record);
    const customerExternalId = resolveCustomerExternalId(record);

    const oldMessages = asArray(oldRecord.chat_messages);
    const newMessages = asArray(record.chat_messages);
    const previous = latestChatMessage(oldMessages);
    const latest = latestChatMessage(newMessages);
    const chatAdded = newMessages.length > oldMessages.length &&
      latest != null &&
      chatMessageKey(previous) !== chatMessageKey(latest);
    const chatFrom = chatAdded ? pickString(latest?.from) : '';

    const needsFactoryName =
      (isPendingLike(oldStatus) && isAcceptedLike(newStatus)) ||
      (chatAdded && (chatFrom === 'factory' || chatFrom === 'admin'));

    const factoryNamePromise = needsFactoryName ? lookupFactoryName(supabase, record) : Promise.resolve('工場');

    if (isPendingLike(oldStatus) && isAcceptedLike(newStatus)) {
      if (customerExternalId) {
        sendTasks.push(
          factoryNamePromise.then((factoryName) =>
            sendToExternalIds([customerExternalId], customerAcceptedMessage(record, factoryName), {
              type: 'order_status',
              orderId,
              status: newStatus,
            })
          ).then((ok) => ({ label: 'customer:accepted', ok })),
        );
      } else if (isVerboseLog()) {
        console.warn('[onesignal-push] customer:accepted skipped — customer_id empty', { orderId });
      }
    } else if (isPendingLike(oldStatus) && isRejectedLike(newStatus)) {
      if (customerExternalId) {
        sendTasks.push(
          sendToExternalIds([customerExternalId], '大変込み合っております。別日をご指定ください。', {
            type: 'order_status',
            orderId,
            status: newStatus,
          }).then((ok) => ({ label: 'customer:rejected', ok })),
        );
      } else if (isVerboseLog()) {
        console.warn('[onesignal-push] customer:rejected skipped — customer_id empty', { orderId });
      }
    }

    if (chatAdded) {
      if (chatFrom === 'factory' || chatFrom === 'admin') {
        if (customerExternalId) {
          sendTasks.push(
            factoryNamePromise.then((factoryName) =>
              sendToExternalIds(
                [customerExternalId],
                `${factoryName}からメッセージが届いています。`,
                { type: 'chat', orderId, targetApp: 'customer' },
              )
            ).then((ok) => ({ label: 'customer:chat', ok })),
          );
        } else if (isVerboseLog()) {
          console.warn('[onesignal-push] customer:chat skipped — customer_id empty', { orderId });
        }
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
          sendTasks.push(
            sendToExternalIds(
              [factoryTarget],
              `${senderName}から新しいメッセージが届きました。`,
              { type: 'chat', orderId, targetApp: 'factory' },
            ).then((ok) => ({ label: 'factory:chat', ok })),
          );
        } else {
          sendTasks.push(
            sendToRole('factory', `${senderName}から新しいメッセージが届きました。`, {
              type: 'chat',
              orderId,
              targetApp: 'factory',
            }).then((ok) => ({ label: 'factory:chat_role', ok })),
          );
        }
      }
    }
  }

  const results = sendTasks.length ? await Promise.all(sendTasks) : [];
  const sent = results.filter((r) => r.ok).map((r) => r.label);

  if (isVerboseLog()) {
    console.log('[onesignal-push] done', { orderId, sent, attempted: results.length });
  }

  return new Response(JSON.stringify({ ok: true, sent }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  if (!isAuthorized(req)) {
    return new Response(JSON.stringify({ ok: false, error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    const payload = (await req.json()) as WebhookPayload;
    return await handleOrderWebhook(payload);
  } catch (error) {
    console.error('[onesignal-push] handler failed', error);
    return new Response(JSON.stringify({ ok: false, error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
