/** onesignal-push v8 — slim payload（pg_net 64KB 回避）・202 即返却 */

const FUNCTION_VERSION = 8;

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

const ONESIGNAL_FETCH_TIMEOUT_MS = 4000;
const JOB_MAX_MS = 15000;
const ONESIGNAL_API_URL = 'https://api.onesignal.com/notifications';

function pickString(...values: unknown[]): string {
  for (const value of values) {
    const text = value != null ? String(value).trim() : '';
    if (text) return text;
  }
  return '';
}

function phoneExternalIdVariants(value: string): string[] {
  const base = String(value || '').replace(/\s+/g, '').trim();
  if (!base) return [];
  const compact = base.replace(/[‐-‒–—―ーｰ−\s]/g, '');
  const ids = new Set([base]);
  if (compact) ids.add(compact);
  return [...ids];
}

function resolveCustomerExternalIds(payload: SlimPayload): string[] {
  const ids = new Set<string>();
  const customerId = pickString(payload.customer_id);
  if (customerId) ids.add(customerId);
  for (const variant of phoneExternalIdVariants(pickString(payload.phone))) ids.add(variant);
  return [...ids];
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

async function readWebhookPayload(req: Request): Promise<SlimPayload | null> {
  const contentLength = req.headers.get('content-length') ?? 'unknown';
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch (error) {
    console.warn('[onesignal-push] req.json failed', { contentLength, error: String(error) });
    return null;
  }

  if (!parsed || typeof parsed !== 'object') {
    console.warn('[onesignal-push] empty or invalid payload', { contentLength });
    return null;
  }

  const body = parsed as Record<string, unknown>;
  if (!pickString(body.event)) {
    console.warn('[onesignal-push] legacy payload rejected — apply slim_payload migration', { contentLength });
    return null;
  }

  return body as SlimPayload;
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

async function processSlimPayload(payload: SlimPayload): Promise<void> {
  const event = pickString(payload.event) as PushEvent;
  const orderId = pickString(payload.order_id);
  const factoryName = pickString(payload.factory_name, '工場');
  const customerIds = resolveCustomerExternalIds(payload);
  const sent: string[] = [];

  console.log('[onesignal-push] process start', { v: FUNCTION_VERSION, event, orderId });

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

  const orderId = pickString(payload.order_id);
  scheduleBackground(
    withTimeout(processSlimPayload(payload), JOB_MAX_MS, 'webhook job').catch((error) => {
      console.error('[onesignal-push] job error', orderId, error);
    }),
  );

  return new Response(
    JSON.stringify({ ok: true, accepted: true, v: FUNCTION_VERSION, orderId, event: payload.event, ms: Date.now() - started }),
    { status: 202, headers: { 'Content-Type': 'application/json' } },
  );
});
