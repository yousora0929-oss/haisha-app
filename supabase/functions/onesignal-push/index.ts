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

async function lookupFactoryName(
  supabase: ReturnType<typeof createClient>,
  row: OrderRow,
): Promise<string> {
  const od = orderData(row);
  const fromOrder = factoryNameFromOrder(row);
  if (fromOrder !== '工場') return fromOrder;
  const factoryId = pickString(row.factory_site_id, od.factory_site_id, od.factorySiteId);
  if (!factoryId) return '工場';
  const { data, error } = await supabase.from('factories').select('name').eq('id', factoryId).maybeSingle();
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
    console.warn('[onesignal-push] OneSignal env vars are missing');
    return false;
  }
  const res = await fetch('https://onesignal.com/api/v1/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Basic ${apiKey}`,
    },
    body: JSON.stringify({
      app_id: appId,
      headings: { ja: '生コン発注システム', en: 'Ready-mix Ordering System' },
      ios_badgeType: 'SetTo',
      ios_badgeCount: 1,
      web_badge: 1,
      ...payload,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.warn('[onesignal-push] OneSignal API error', res.status, text);
    return false;
  }
  return true;
}

async function sendToExternalIds(externalIds: string[], message: string, data: Record<string, unknown> = {}) {
  const ids = [...new Set(externalIds.flatMap((id) => externalIdCandidates(id)).filter(Boolean))];
  if (!ids.length || !message) return false;
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
  const sent: string[] = [];

  if (eventType === 'INSERT') {
    const status = effectiveStatus(record);
    if (status !== 'pending_association' && isPendingLike(status)) {
      const od = orderData(record);
      const contractorName = pickString(od.customerName, od.customer_name, od.contractorName, '新規注文');
      const ok = await sendToRole('factory', `新規注文が入りました：${contractorName}`, {
        type: 'new_order',
        orderId: pickString(record.id),
      });
      if (ok) sent.push('factory:new_order');
    }
  }

  if (eventType === 'UPDATE' && oldRecord) {
    const oldStatus = effectiveStatus(oldRecord);
    const newStatus = effectiveStatus(record);

    if (isPendingLike(oldStatus) && isAcceptedLike(newStatus)) {
      const customerExternalId = resolveCustomerExternalId(record);
      const factoryName = await lookupFactoryName(supabase, record);
      if (customerExternalId) {
        const ok = await sendToExternalIds([customerExternalId], customerAcceptedMessage(record, factoryName), {
          type: 'order_status',
          orderId: pickString(record.id),
          status: newStatus,
        });
        if (ok) sent.push('customer:accepted');
      }
    } else if (
      isPendingLike(oldStatus) &&
      isRejectedLike(newStatus)
    ) {
      const customerExternalId = resolveCustomerExternalId(record);
      if (customerExternalId) {
        const ok = await sendToExternalIds([customerExternalId], '大変込み合っております。別日をご指定ください。', {
          type: 'order_status',
          orderId: pickString(record.id),
          status: newStatus,
        });
        if (ok) sent.push('customer:rejected');
      }
    }

    const oldMessages = asArray(oldRecord.chat_messages);
    const newMessages = asArray(record.chat_messages);
    if (newMessages.length > oldMessages.length) {
      const previous = latestChatMessage(oldMessages);
      const latest = latestChatMessage(newMessages);
      if (latest && chatMessageKey(previous) !== chatMessageKey(latest)) {
        const from = pickString(latest.from);
        const orderId = pickString(record.id);
        if (from === 'factory' || from === 'admin') {
          const customerExternalId = resolveCustomerExternalId(record);
          const factoryName = await lookupFactoryName(supabase, record);
          if (customerExternalId) {
            const ok = await sendToExternalIds(
              [customerExternalId],
              `${factoryName}からメッセージが届いています。`,
              { type: 'chat', orderId, targetApp: 'customer' },
            );
            if (ok) sent.push('customer:chat');
          }
        } else if (from === 'master' || from === 'customer') {
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
            const ok = await sendToExternalIds(
              [factoryTarget],
              `${senderName}から新しいメッセージが届きました。`,
              { type: 'chat', orderId, targetApp: 'factory' },
            );
            if (ok) sent.push('factory:chat');
          } else {
            const ok = await sendToRole('factory', `${senderName}から新しいメッセージが届きました。`, {
              type: 'chat',
              orderId,
              targetApp: 'factory',
            });
            if (ok) sent.push('factory:chat_role');
          }
        }
      }
    }
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
