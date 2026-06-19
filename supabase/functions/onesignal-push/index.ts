/** onesignal-push v25 — 満車自動拒否時のエスカレーション拡大通知 */

import {
  computeNewlyVisibleFactoryIds,
  type EscalationPushContext,
  type EscalationStep,
} from '../_shared/escalationVisibility.ts';

const FUNCTION_VERSION = 25;
const PUSH_NOTIFY_COOLDOWN_MS = 60_000;
const FETCH_ORDER_TIMEOUT_MS = 4000;

/** factory_escalation_steps 未設定時のデフォルト（src/utils/escalationSteps.js と同一） */
const DEFAULT_ESCALATION_STEPS = [
  { step_number: 1, trigger_minutes: 0, target_factory_count: 3 },
  { step_number: 2, trigger_minutes: 15, target_factory_count: 5 },
  { step_number: 3, trigger_minutes: 30, target_factory_count: 8 },
];

type EscalationStep = {
  step_number: number;
  trigger_minutes: number;
  target_factory_count: number;
};

type PushEvent =
  | 'new_order'
  | 'customer_accepted'
  | 'customer_rejected'
  | 'order_accepted'
  | 'order_rejected'
  | 'order_timeout'
  | 'consult_start'
  | 'customer_chat'
  | 'factory_chat'
  | 'customer_map_shared'
  | 'escalation_expanded';

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
  chat_from?: string | null;
  chat_message_id?: string | null;
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
  project_id?: string | null;
  factory_consult_status?: string | null;
  override_map_image_url?: string | null;
  map_annotations?: unknown;
  is_location_pending?: boolean | null;
  delivery_lat?: number | string | null;
  delivery_lng?: number | string | null;
  push_notified_at?: string | null;
  rejected_factory_ids?: unknown;
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
const LEGACY_MAX_BODY_BYTES = 64000;
const ONESIGNAL_FETCH_TIMEOUT_MS = 10000;
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

function orderCustomerPhone(row: OrderRow | null | undefined): string {
  const od = orderData(row);
  return pickString(od.phone_number, od.customerPhone, od.sitePhone, od.phone);
}

const CUSTOMER_SIDE_SENDERS = new Set(['customer', 'master']);
const FACTORY_SIDE_SENDERS = new Set(['factory', 'admin']);

function normalizeChatSender(from: unknown): string {
  return pickString(from).toLowerCase();
}

function isCustomerSideChatSender(from: unknown): boolean {
  return CUSTOMER_SIDE_SENDERS.has(normalizeChatSender(from));
}

function isFactorySideChatSender(from: unknown): boolean {
  return FACTORY_SIDE_SENDERS.has(normalizeChatSender(from));
}

function withoutExternalIds(ids: string[], ...exclude: unknown[]): string[] {
  const banned = new Set(
    exclude
      .map((value) => pickString(value))
      .filter(Boolean),
  );
  return [...new Set(ids.map((id) => pickString(id)).filter((id) => id && !banned.has(id)))];
}

/** カスタマー向けプッシュは customers.id のみ（電話番号エイリアスは使わない） */
function resolveCustomerPushIds(row?: OrderRow | null, payload?: SlimPayload | null): string[] {
  const customerId = pickString(row?.customer_id, payload?.customer_id);
  return customerId ? [customerId] : [];
}

/** 工場向けプッシュは受注工場 → 第一希望の1件のみ（複数 alias による重複を防ぐ） */
function resolvePrimaryFactoryPushId(row?: OrderRow | null, payload?: SlimPayload | null): string {
  const od = orderData(row);
  return pickString(
    row?.factory_site_id,
    payload?.factory_site_id,
    od.factory_site_id,
    od.factorySiteId,
    row?.preferred_factory_id,
    payload?.preferred_factory_id,
    od.preferred_factory_id,
    od.preferredFactoryId,
  );
}

function resolveFactoryPushTargetIds(row?: OrderRow | null, payload?: SlimPayload | null): string[] {
  const primary = resolvePrimaryFactoryPushId(row, payload);
  if (!primary) return [];
  return withoutExternalIds([primary], row?.customer_id, payload?.customer_id);
}

function resolveChatMessageId(row?: OrderRow | null, payload?: SlimPayload | null): string {
  const fromPayload = pickString(payload?.chat_message_id);
  if (fromPayload) return fromPayload;
  const latest = latestChatMessage(asArray(row?.chat_messages));
  return pickString(latest?.id);
}

const collapseIdCache = new Map<string, string>();

/** orderId から一意かつ64バイト以内の collapse_id / web_push_topic を生成 */
async function makeCollapseId(orderId: string): Promise<string> {
  const oid = pickString(orderId);
  if (!oid) return '';
  const cached = collapseIdCache.get(oid);
  if (cached) return cached;
  const msgBuffer = new TextEncoder().encode(oid);
  const hashBuffer = await crypto.subtle.digest('SHA-1', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const collapseId = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
  collapseIdCache.set(oid, collapseId);
  return collapseId;
}

async function shouldSkipRecentPush(orderId: string): Promise<boolean> {
  const oid = pickString(orderId);
  if (!oid) return false;

  const base = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!base || !serviceKey) return false;

  try {
    const response = await fetch(
      `${base}/rest/v1/orders?id=eq.${encodeURIComponent(oid)}&select=push_notified_at`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept: 'application/json',
        },
      },
    );
    if (!response.ok) {
      console.warn('[onesignal-push] push_notified_at fetch failed', { orderId: oid, status: response.status });
      return false;
    }
    const rows = await response.json();
    const notifiedAt = pickString(rows?.[0]?.push_notified_at);
    if (!notifiedAt) return false;
    const ts = Date.parse(notifiedAt);
    if (Number.isNaN(ts)) return false;
    if (Date.now() - ts < PUSH_NOTIFY_COOLDOWN_MS) {
      console.log('[onesignal-push] skip recent push within 60s', {
        orderId: oid,
        push_notified_at: notifiedAt,
      });
      return true;
    }
    return false;
  } catch (error) {
    console.warn('[onesignal-push] push_notified_at check failed — proceed', error);
    return false;
  }
}

async function markPushNotified(orderId: string): Promise<void> {
  const oid = pickString(orderId);
  if (!oid) return;

  const base = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!base || !serviceKey) return;

  const now = new Date().toISOString();
  try {
    const response = await fetch(`${base}/rest/v1/orders?id=eq.${encodeURIComponent(oid)}`, {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ push_notified_at: now }),
    });
    if (!response.ok) {
      const body = await response.text();
      console.warn('[onesignal-push] push_notified_at update failed', {
        orderId: oid,
        status: response.status,
        body: body.slice(0, 200),
      });
      return;
    }
    console.log('[onesignal-push] push_notified_at updated', { orderId: oid, push_notified_at: now });
  } catch (error) {
    console.warn('[onesignal-push] push_notified_at update error', { orderId: oid, error });
  }
}

function normalizeEscalationSteps(rows: unknown): EscalationStep[] {
  const list = asArray(rows)
    .map((row) => {
      const o = asObject(row);
      return {
        step_number: Number(o.step_number) || 0,
        trigger_minutes: Math.max(0, Number(o.trigger_minutes) || 0),
        target_factory_count: Math.max(1, Number(o.target_factory_count) || 1),
      };
    })
    .filter((s) => s.step_number >= 1)
    .sort((a, b) => a.trigger_minutes - b.trigger_minutes || a.step_number - b.step_number);
  return list.length ? list : DEFAULT_ESCALATION_STEPS;
}

async function fetchEscalationSteps(factoryId: string): Promise<EscalationStep[]> {
  const fid = pickString(factoryId);
  if (!fid) return DEFAULT_ESCALATION_STEPS;

  const base = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!base || !serviceKey) return DEFAULT_ESCALATION_STEPS;

  try {
    const response = await fetch(
      `${base}/rest/v1/factory_escalation_steps?factory_id=eq.${encodeURIComponent(fid)}` +
        `&select=step_number,trigger_minutes,target_factory_count&order=trigger_minutes.asc`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept: 'application/json',
        },
      },
    );
    if (!response.ok) {
      console.warn('[onesignal-push] escalation steps fetch failed', { factoryId: fid, status: response.status });
      return DEFAULT_ESCALATION_STEPS;
    }
    return normalizeEscalationSteps(await response.json());
  } catch (error) {
    console.warn('[onesignal-push] escalation steps fetch error — use default', { factoryId: fid, error });
    return DEFAULT_ESCALATION_STEPS;
  }
}

/** エスカレーション最終段階の対象工場数（= 全社拒否とみなす閾値） */
function finalEscalationTargetCount(steps: EscalationStep[]): number {
  const list = steps.length ? steps : DEFAULT_ESCALATION_STEPS;
  const last = list[list.length - 1];
  return Math.max(1, Number(last?.target_factory_count) || 1);
}

function resolveAnchorFactoryId(row?: OrderRow | null, payload?: SlimPayload | null): string {
  const od = orderData(row);
  return pickString(
    row?.preferred_factory_id,
    payload?.preferred_factory_id,
    od.preferred_factory_id,
    od.preferredFactoryId,
    od.main_factory_id,
    od.mainFactoryId,
  );
}

function rejectedFactoryCount(row?: OrderRow | null): number {
  if (!row) return 0;
  const direct = asArray(row.rejected_factory_ids);
  if (direct.length) {
    return new Set(direct.map((x) => pickString(x)).filter(Boolean)).size;
  }
  const od = orderData(row);
  const fromData = asArray(od.rejected_factory_ids ?? od.rejectedFactoryIds);
  return new Set(fromData.map((x) => pickString(x)).filter(Boolean)).size;
}

/**
 * 拒否通知を顧客へ送ってよいか（= 全候補工場が拒否済みか）を判定。
 * - customer_cancelled は顧客本人がキャンセル済みのため通知しない。
 * - rejected_factory_ids.length >= 最終段階 target_factory_count のときのみ true。
 */
async function shouldNotifyFullCompanyRejection(
  inputRow: OrderRow | null | undefined,
  payload: SlimPayload | null | undefined,
  orderId: string,
): Promise<boolean> {
  const status = pickString(payload?.status, effectiveStatus(inputRow));
  if (status === 'customer_cancelled') {
    console.log('[onesignal-push] reject skip: customer_cancelled', { orderId });
    return false;
  }

  let row = inputRow ?? null;
  if (!row && orderId) row = await fetchOrderRow(orderId);
  if (!row) {
    console.log('[onesignal-push] reject skip: order row unavailable', { orderId });
    return false;
  }

  if (effectiveStatus(row) === 'customer_cancelled') {
    console.log('[onesignal-push] reject skip: customer_cancelled (row)', { orderId });
    return false;
  }

  const anchorId = resolveAnchorFactoryId(row, payload);
  const steps = await fetchEscalationSteps(anchorId);
  const threshold = finalEscalationTargetCount(steps);
  const rejectedCount = rejectedFactoryCount(row);
  const isFull = rejectedCount >= threshold;

  console.log('[onesignal-push] full-company rejection check', {
    orderId,
    anchorId: anchorId || '(none)',
    rejectedCount,
    threshold,
    isFull,
  });
  return isFull;
}

function resolveIncomingOrderId(incoming: IncomingPayload): string {
  if (incoming.format === 'slim') return pickString(incoming.data.order_id);
  if (incoming.format === 'rescued') return pickString(incoming.data.id);
  if (incoming.format === 'chat_message') return pickString(incoming.data.order_id);
  return pickString(incoming.data.record?.id);
}

function resolveOrderCustomerId(row?: OrderRow | null, payload?: SlimPayload | null): string {
  return pickString(row?.customer_id, payload?.customer_id);
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

function stableJson(value: unknown): string {
  try {
    return JSON.stringify(value ?? null);
  } catch {
    return '';
  }
}

function mapAnnotationsFingerprint(row: OrderRow | null | undefined): string {
  const od = orderData(row);
  const rowAnn = row?.map_annotations;
  const ann = rowAnn ?? od.map_annotations ?? od.mapAnnotations;
  return stableJson(ann);
}

function legacyMapStampsFingerprint(row: OrderRow | null | undefined): string {
  const od = orderData(row);
  const stamps = od.map_stamps ?? od.mapStamps;
  return stableJson(stamps);
}

/** 地図・現場位置の送付状態を比較用フィンガープリントにまとめる */
function orderMapFingerprint(row: OrderRow | null | undefined): string {
  if (!row) return '';
  const od = orderData(row);
  const parts = [
    pickString(
      row.override_map_image_url,
      od.override_map_image_url,
      od.overrideMapImageUrl,
      od.map_image_url,
      od.mapImageUrl,
    ),
    pickString(od.map_submitted_at, od.mapSubmittedAt),
    mapAnnotationsFingerprint(row),
    legacyMapStampsFingerprint(row),
    pickString(row.delivery_lat, od.delivery_lat, od.deliveryLat, od.representative_lat, od.representativeLat),
    pickString(row.delivery_lng, od.delivery_lng, od.deliveryLng, od.representative_lng, od.representativeLng),
  ].filter(Boolean);
  return parts.join('|');
}

/** UPDATE で地図情報が新規追加または変更されたか */
function wasMapSharedOrUpdated(oldRecord: OrderRow | null | undefined, record: OrderRow | null | undefined): boolean {
  const oldFp = orderMapFingerprint(oldRecord);
  const newFp = orderMapFingerprint(record);
  if (!newFp) return false;
  return oldFp !== newFp;
}

function customerSenderNameFromOrder(row: OrderRow | null | undefined): string {
  const od = orderData(row);
  return pickString(
    od.customerName,
    od.customer_name,
    od.contractorName,
    od.contractor_name,
    od.ordered_by,
    od.orderedBy,
    'カスタマー',
  );
}

function isVerboseLog(): boolean {
  const v = String(Deno.env.get('ONESIGNAL_PUSH_DEBUG') || '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function normalizeApiKey(raw: string): string {
  return String(raw || '').trim().replace(/^["']|["']$/g, '');
}

function bareApiKey(apiKey: string): string {
  return normalizeApiKey(apiKey).replace(/^(Key|key|Basic)\s+/i, '').trim();
}

function apiKeyKind(apiKey: string): string {
  const bare = bareApiKey(apiKey);
  if (!bare) return 'missing';
  if (/^os_v2_/i.test(bare)) return 'rich_app_key';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(bare)) return 'legacy_uuid';
  return 'other';
}

function buildOneSignalAuthHeaders(apiKey: string): string[] {
  const bare = bareApiKey(apiKey);
  if (!bare) return [];

  const headers: string[] = [];
  if (/^os_v2_/i.test(bare)) {
    headers.push(`Key ${bare}`);
    return headers;
  }
  if (/^[0-9a-f-]{36}$/i.test(bare)) {
    headers.push(`Basic ${btoa(`${bare}:`)}`);
    headers.push(`Key ${bare}`);
    return headers;
  }
  headers.push(`Key ${bare}`);
  return headers;
}

function resolveOneSignalCredentials(): { appId: string; apiKey: string; keyKind: string } {
  const appId = pickString(
    Deno.env.get('ONESIGNAL_APP_ID'),
    Deno.env.get('VITE_ONESIGNAL_APP_ID'),
    '98ab8b43-0536-4805-bee0-2341648828b6',
  );
  const apiKey = normalizeApiKey(pickString(
    Deno.env.get('ONESIGNAL_REST_API_KEY'),
    Deno.env.get('ONESIGNAL_API_KEY'),
    Deno.env.get('VITE_ONESIGNAL_REST_API_KEY'),
  ));
  return { appId, apiKey, keyKind: apiKeyKind(apiKey) };
}

function isOneSignalAuthError(status: number, parsed: Record<string, unknown> | null): boolean {
  if (status === 401 || status === 403) return true;
  const errors = parsed?.errors;
  if (!Array.isArray(errors)) return false;
  return errors.some((entry) => /access denied|authorization|api key/i.test(String(entry)));
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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_ORDER_TIMEOUT_MS);
  const started = Date.now();

  try {
    const response = await fetch(`${base}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&select=*`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      console.warn('[onesignal-push] fetch order failed', { orderId, status: response.status });
      return null;
    }
    const rows = await response.json();
    if (!Array.isArray(rows) || !rows[0] || typeof rows[0] !== 'object') return null;
    console.log('[onesignal-push] fetch order ok', { orderId, ms: Date.now() - started });
    return rows[0] as OrderRow;
  } catch (error) {
    const isAbort = error instanceof DOMException && error.name === 'AbortError';
    console.warn('[onesignal-push] fetch order error', {
      orderId,
      ms: Date.now() - started,
      reason: isAbort ? 'timeout' : String(error),
    });
    return null;
  } finally {
    clearTimeout(timer);
  }
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
    chat_from: pickString(url.searchParams.get('chat_from')) || null,
    chat_message_id: pickString(url.searchParams.get('chat_message_id')) || null,
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
  const { appId, apiKey, keyKind } = resolveOneSignalCredentials();
  if (!appId || !apiKey) {
    console.warn('[onesignal-push] OneSignal env vars missing', {
      hasAppId: Boolean(appId),
      hasApiKey: Boolean(apiKey),
    });
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
  const authHeaders = buildOneSignalAuthHeaders(apiKey);
  console.log('[onesignal-push] OneSignal request start', {
    target: target || '(unknown)',
    keyKind,
    authModes: authHeaders.map((header) => header.split(/\s+/)[0]),
  });

  for (const authorization of authHeaders) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), ONESIGNAL_FETCH_TIMEOUT_MS);
    const authMode = authorization.split(/\s+/)[0];

    try {
      const response = await fetch(ONESIGNAL_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authorization,
        },
        body: JSON.stringify(requestPayload),
        signal: controller.signal,
      });

      const responseText = await response.text();
      const parsed = tryParseJson(responseText);
      const notificationId = pickString(parsed?.id);
      const elapsed = Date.now() - started;

      console.log(
        `[onesignal-push] status=${response.status} auth=${authMode} target=${target || '(unknown)'} notificationId=${notificationId || 'none'} ms=${elapsed}`,
      );

      if (parsed?.errors) console.warn('[onesignal-push] OneSignal errors:', parsed.errors);
      if (!response.ok || !notificationId) {
        console.warn('[onesignal-push] OneSignal response body:', responseText.slice(0, 600));
      }

      if (response.ok && notificationId) return true;

      if (isOneSignalAuthError(response.status, parsed) && authHeaders.length > 1) {
        console.warn('[onesignal-push] retrying OneSignal with alternate auth', { authMode, keyKind });
        continue;
      }
      return false;
    } catch (error) {
      const isAbort = error instanceof DOMException && error.name === 'AbortError';
      console.warn(
        `[onesignal-push] OneSignal ${isAbort ? 'timeout' : 'failed'} auth=${authMode} target=${target} ms=${Date.now() - started}`,
      );
      return false;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  console.warn('[onesignal-push] OneSignal all auth modes failed', { keyKind, target });
  return false;
}

const CUSTOMER_APP_PATH = '/DispatchOrderPrototype.html';
const FACTORY_APP_PATH = '/FactoryTabletPrototype.html';

function inferTargetAppFromPushData(data: Record<string, unknown>): string {
  const explicit = pickString(data.targetApp);
  if (explicit === 'customer' || explicit === 'factory') return explicit;
  const type = pickString(data.type);
  if (type === 'order_status' || type === 'order_accepted' || type === 'order_rejected') return 'customer';
  if (type === 'new_order' || type === 'customer_map_shared') return 'factory';
  return '';
}

function buildPushLaunchUrl(data: Record<string, unknown>): string {
  const base = pickString(Deno.env.get('APP_BASE_URL'), Deno.env.get('VITE_PUBLIC_APP_ORIGIN')).replace(/\/$/, '');
  const orderId = pickString(data.orderId);
  const targetApp = inferTargetAppFromPushData(data);
  if (!base || !orderId || !targetApp) return '';
  const path = targetApp === 'customer' ? CUSTOMER_APP_PATH : FACTORY_APP_PATH;
  const type = pickString(data.type);
  const view = type === 'chat' ? 'chat' : 'order';
  const params = new URLSearchParams({
    orderId,
    view,
    type: type || 'order',
    app: targetApp,
  });
  return `${base}${path}?${params.toString()}`;
}

function oneSignalPayloadExtras(data: Record<string, unknown>): Record<string, unknown> {
  const extras: Record<string, unknown> = {};
  if (Object.keys(data).length) extras.data = data;
  const url = buildPushLaunchUrl(data);
  if (url) extras.url = url;
  return extras;
}

async function postOneSignal(payload: Record<string, unknown>): Promise<boolean> {
  return postOneSignalRequest(payload);
}

async function sendToExternalIds(
  externalIds: string[],
  message: string,
  data: Record<string, unknown> = {},
  options: { orderId?: string; title?: string } = {},
) {
  const ids = [...new Set(externalIds.map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length || !message) return false;

  const orderId = pickString(options.orderId, data.orderId);
  if (orderId && await shouldSkipRecentPush(orderId)) return false;

  const collapseId = orderId ? await makeCollapseId(orderId) : '';

  const ok = await postOneSignal({
    include_aliases: { external_id: ids },
    ...(options.title ? { headings: { ja: options.title, en: options.title } } : {}),
    contents: { ja: message, en: message },
    ...(collapseId ? { collapse_id: collapseId, web_push_topic: collapseId } : {}),
    ...oneSignalPayloadExtras(data),
  });
  if (ok && orderId) await markPushNotified(orderId);
  return ok;
}

async function sendToRole(
  role: string,
  message: string,
  data: Record<string, unknown> = {},
  options: { orderId?: string; title?: string } = {},
) {
  const normalizedRole = String(role || '').trim();
  if (!normalizedRole || !message) return false;

  const orderId = pickString(options.orderId, data.orderId);
  if (orderId && await shouldSkipRecentPush(orderId)) return false;

  const collapseId = orderId ? await makeCollapseId(orderId) : '';

  const ok = await postOneSignal({
    filters: [{ field: 'tag', key: 'role', relation: '=', value: normalizedRole }],
    ...(options.title ? { headings: { ja: options.title, en: options.title } } : {}),
    contents: { ja: message, en: message },
    ...(collapseId ? { collapse_id: collapseId, web_push_topic: collapseId } : {}),
    ...oneSignalPayloadExtras(data),
  });
  if (ok && orderId) await markPushNotified(orderId);
  return ok;
}

async function sendToCustomerAudience(
  row: OrderRow | null | undefined,
  payload: SlimPayload | null | undefined,
  message: string,
  data: Record<string, unknown> = {},
  options: { orderId?: string; title?: string } = {},
): Promise<boolean> {
  const customerIds = withoutExternalIds(
    resolveCustomerPushIds(row, payload),
    ...resolveFactoryPushTargetIds(row, payload),
  );
  if (!customerIds.length || !message) {
    console.log('[onesignal-push] skip customer audience (no recipients)', {
      orderId: pickString(row?.id, payload?.order_id),
    });
    return false;
  }
  return sendToExternalIds(customerIds, message, data, options);
}

async function sendToFactoryAudience(
  row: OrderRow | null | undefined,
  payload: SlimPayload | null | undefined,
  message: string,
  data: Record<string, unknown> = {},
  options: { orderId?: string; title?: string } = {},
): Promise<boolean> {
  const customerId = resolveOrderCustomerId(row, payload);
  const factoryIds = withoutExternalIds(resolveFactoryPushTargetIds(row, payload), customerId);
  let sent = false;

  if (factoryIds.length) {
    sent = await sendToExternalIds(factoryIds, message, data, {
      orderId: pickString(data.orderId),
      title: options.title,
    });
  } else {
    const orderId = pickString(data.orderId);
    sent = await sendToRole('factory', message, data, { orderId, title: options.title });
    if (!sent) {
      const adminSent = await sendToRole('admin', message, data, { orderId, title: options.title });
      sent = adminSent;
    }
  }

  if (customerId) {
    console.log('[onesignal-push] factory audience excludes customer', { customerId });
  }
  return sent;
}

async function fetchEscalationPushContext(projectId?: string): Promise<EscalationPushContext | null> {
  const base = Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!base || !serviceKey) return null;

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    Accept: 'application/json',
  };

  try {
    const fetches: Promise<Response>[] = [
      fetch(`${base}/rest/v1/factories?select=id,latitude,longitude`, { headers }),
      fetch(`${base}/rest/v1/holidays?select=holiday_date`, { headers }),
      fetch(`${base}/rest/v1/system_settings?select=start_time,end_time&id=eq.1`, { headers }),
      fetch(
        `${base}/rest/v1/factory_escalation_steps?select=factory_id,step_number,trigger_minutes,target_factory_count&order=factory_id.asc,trigger_minutes.asc`,
        { headers },
      ),
    ];
    if (projectId) {
      fetches.push(
        fetch(
          `${base}/rest/v1/projects?select=id,main_factory_id,lat,lng&id=eq.${encodeURIComponent(projectId)}`,
          { headers },
        ),
      );
    }

    const responses = await Promise.all(fetches);
    const [factoriesRes, holidaysRes, settingsRes, stepsRes, projectRes] = responses;

    if (!factoriesRes.ok) {
      console.warn('[onesignal-push] escalation context factories fetch failed', factoriesRes.status);
      return null;
    }

    const factories = await factoriesRes.json();
    const holidays = holidaysRes.ok ? await holidaysRes.json() : [];
    const settingsRows = settingsRes.ok ? await settingsRes.json() : [];
    const stepRows = stepsRes.ok ? await stepsRes.json() : [];
    const projectRows = projectRes?.ok ? await projectRes.json() : [];

    const escalationStepsByFactoryId: Record<string, EscalationStep[]> = {};
    for (const row of asArray(stepRows)) {
      const o = asObject(row);
      const fid = pickString(o.factory_id);
      if (!fid) continue;
      if (!escalationStepsByFactoryId[fid]) escalationStepsByFactoryId[fid] = [];
      escalationStepsByFactoryId[fid].push({
        step_number: Number(o.step_number) || 0,
        trigger_minutes: Math.max(0, Number(o.trigger_minutes) || 0),
        target_factory_count: Math.max(1, Number(o.target_factory_count) || 1),
      });
    }

    const projectById: Record<string, { id?: string; main_factory_id?: string | null; lat?: number; lng?: number }> = {};
    for (const row of asArray(projectRows)) {
      const o = asObject(row);
      const id = pickString(o.id);
      if (!id) continue;
      projectById[id] = {
        id,
        main_factory_id: pickString(o.main_factory_id) || null,
        lat: Number(o.lat),
        lng: Number(o.lng),
      };
    }

    const settingsRow = asObject(asArray(settingsRows)[0]);
    return {
      factories: asArray(factories) as EscalationPushContext['factories'],
      projectById,
      settings: {
        start_time: pickString(settingsRow.start_time) || '08:00:00',
        end_time: pickString(settingsRow.end_time) || '16:00:00',
      },
      holidays: asArray(holidays) as EscalationPushContext['holidays'],
      escalationStepsByFactoryId,
      now: new Date(),
    };
  } catch (error) {
    console.warn('[onesignal-push] escalation context fetch error', error);
    return null;
  }
}

function buildOldRowForRejectionDiff(newRow: OrderRow, oldRow?: OrderRow | null): OrderRow {
  if (oldRow) return oldRow;
  const rejected = asArray(newRow.rejected_factory_ids);
  if (!rejected.length) return { ...newRow, rejected_factory_ids: [] };
  return { ...newRow, rejected_factory_ids: rejected.slice(0, -1) };
}

function rejectedFactoryIdsArray(row?: OrderRow | null): string[] {
  if (!row) return [];
  const direct = asArray(row.rejected_factory_ids);
  if (direct.length) {
    return [...new Set(direct.map((x) => pickString(x)).filter(Boolean))];
  }
  const od = orderData(row);
  return [...new Set(asArray(od.rejected_factory_ids ?? od.rejectedFactoryIds).map((x) => pickString(x)).filter(Boolean))];
}

async function sendEscalationExpandedNotifications(
  row: OrderRow | null | undefined,
  payload: SlimPayload | null | undefined,
  orderId: string,
  oldRow?: OrderRow | null,
): Promise<string[]> {
  let newRow = row ?? null;
  if (!newRow && orderId) newRow = await fetchOrderRow(orderId);
  if (!newRow) {
    console.log('[onesignal-push] escalation_expanded skip: order unavailable', { orderId });
    return [];
  }

  const status = effectiveStatus(newRow);
  if (status !== 'pending' && status !== 'pending_association' && status !== '') {
    console.log('[onesignal-push] escalation_expanded skip: not pending', { orderId, status });
    return [];
  }
  if (pickString(newRow.factory_consult_status) === 'consulting') {
    console.log('[onesignal-push] escalation_expanded skip: consulting', { orderId });
    return [];
  }

  const oldRejected = rejectedFactoryIdsArray(oldRow ?? buildOldRowForRejectionDiff(newRow));
  const newRejected = rejectedFactoryIdsArray(newRow);
  if (newRejected.length <= oldRejected.length) {
    console.log('[onesignal-push] escalation_expanded skip: rejected list did not grow', {
      orderId,
      oldRejected,
      newRejected,
    });
    return [];
  }

  const pid = pickString(newRow.project_id, orderData(newRow).project_id, orderData(newRow).projectId);
  const ctx = await fetchEscalationPushContext(pid || undefined);
  if (!ctx) {
    console.log('[onesignal-push] escalation_expanded skip: context unavailable', { orderId });
    return [];
  }

  const oldState = oldRow ?? buildOldRowForRejectionDiff(newRow);
  const newlyVisible = computeNewlyVisibleFactoryIds(oldState, newRow, ctx);
  if (!newlyVisible.length) {
    console.log('[onesignal-push] escalation_expanded skip: no newly visible factories', { orderId });
    return [];
  }

  const contractorName = pickString(
    payload?.contractor_name,
    orderData(newRow).customerName,
    orderData(newRow).customer_name,
    orderData(newRow).contractorName,
    '新規注文',
  );
  const message = `新規注文が入りました：${contractorName}`;
  const data = { type: 'escalation_expanded', orderId, targetApp: 'factory' };
  const customerId = resolveOrderCustomerId(newRow, payload);
  const factoryIds = withoutExternalIds(newlyVisible, customerId);

  console.log('[onesignal-push] escalation_expanded notify', { orderId, factoryIds, newlyVisible });

  if (!factoryIds.length) return [];

  if (await sendToExternalIds(factoryIds, message, data, {
    orderId,
    title: '【配車依頼】新しい注文があります',
  })) {
    return ['factory:escalation_expanded'];
  }
  return [];
}

async function sendNewOrderNotifications(
  row: OrderRow | null | undefined,
  payload: SlimPayload | null | undefined,
  orderId: string,
): Promise<string[]> {
  const customerId = resolveOrderCustomerId(row, payload);
  const contractorName = pickString(
    payload?.contractor_name,
    orderData(row).customerName,
    orderData(row).customer_name,
    orderData(row).contractorName,
    '新規注文',
  );
  const message = `新規注文が入りました：${contractorName}`;
  const data = { type: 'new_order', orderId, targetApp: 'factory' };
  const sent: string[] = [];

  if (customerId) {
    console.log('[onesignal-push] new_order skips customer recipient', { customerId, orderId });
  }

  if (await sendToFactoryAudience(row, payload, message, data)) {
    sent.push('factory:new_order');
  }
  return sent;
}

async function sendCustomerChatNotifications(
  row: OrderRow | null | undefined,
  payload: SlimPayload | null | undefined,
  orderId: string,
  chatFrom: string,
): Promise<string[]> {
  if (!isFactorySideChatSender(chatFrom)) {
    console.log('[onesignal-push] skip customer_chat: sender is not factory/admin', { orderId, chatFrom });
    return [];
  }
  const factoryName = pickString(payload?.factory_name, factoryNameFromOrder(row));
  const message = `${factoryName}からメッセージが届いています。`;
  const chatMessageId = resolveChatMessageId(row, payload);
  const sent: string[] = [];
  if (await sendToCustomerAudience(row, payload, message, {
    type: 'chat',
    orderId,
    targetApp: 'customer',
    chatMessageId,
  })) {
    sent.push('customer:chat');
  }
  return sent;
}

async function sendFactoryChatNotifications(
  row: OrderRow | null | undefined,
  payload: SlimPayload | null | undefined,
  orderId: string,
  chatFrom: string,
): Promise<string[]> {
  if (!isCustomerSideChatSender(chatFrom)) {
    console.log('[onesignal-push] skip factory_chat: sender is not customer/master', { orderId, chatFrom });
    return [];
  }
  const senderName = pickString(
    payload?.sender_name,
    orderData(row).manager_name,
    orderData(row).contact_person,
    orderData(row).ordered_by,
    orderData(row).orderedBy,
    '担当者',
  );
  const message = `${senderName}から新しいメッセージが届きました。`;
  const chatMessageId = resolveChatMessageId(row, payload);
  const sent: string[] = [];
  if (await sendToFactoryAudience(row, payload, message, {
    type: 'chat',
    orderId,
    targetApp: 'factory',
    chatMessageId,
  })) {
    sent.push('factory:chat');
  }
  return sent;
}

async function sendCustomerMapSharedNotifications(
  row: OrderRow | null | undefined,
  payload: SlimPayload | null | undefined,
  orderId: string,
): Promise<string[]> {
  const senderName = pickString(
    payload?.contractor_name,
    customerSenderNameFromOrder(row),
    payload?.sender_name,
    'カスタマー',
  );
  const message = `${senderName}から新しい地図（現場情報）が共有されました。`;
  const sent: string[] = [];
  const customerId = resolveOrderCustomerId(row, payload);
  console.log('[onesignal-push] customer_map_shared', { orderId, customerId, senderName });
  if (await sendToFactoryAudience(row, payload, message, {
    type: 'customer_map_shared',
    orderId,
    targetApp: 'factory',
  })) {
    sent.push('factory:customer_map_shared');
  }
  return sent;
}

async function sendOrderAcceptedNotifications(
  row: OrderRow | null | undefined,
  payload: SlimPayload | null | undefined,
  orderId: string,
): Promise<string[]> {
  const factoryName = pickString(payload?.factory_name, factoryNameFromOrder(row), '工場');
  const message =
    `${factoryName}がご注文承りました。キャンセルのご連絡は前営業日の12時までに工場へご連絡ください。`;
  const sent: string[] = [];
  if (await sendToCustomerAudience(row, payload, message, {
    type: 'order_accepted',
    orderId,
    targetApp: 'customer',
    status: pickString(payload?.status, effectiveStatus(row), 'accepted'),
  })) {
    sent.push('customer:order_accepted');
  }
  return sent;
}

async function sendOrderRejectedNotifications(
  row: OrderRow | null | undefined,
  payload: SlimPayload | null | undefined,
  orderId: string,
  options: { force?: boolean } = {},
): Promise<string[]> {
  // 全社拒否（最終段階到達）でない限り送らない。timeout 経路のみ force=true。
  if (!options.force) {
    const allowed = await shouldNotifyFullCompanyRejection(row, payload, orderId);
    if (!allowed) return [];
  }
  const sent: string[] = [];
  if (await sendToCustomerAudience(row, payload, '大変込み合っております。別日をご指定ください。', {
    type: 'order_rejected',
    orderId,
    targetApp: 'customer',
    status: pickString(payload?.status, effectiveStatus(row), 'rejected'),
  })) {
    sent.push(options.force ? 'customer:order_timeout' : 'customer:order_rejected');
  }
  return sent;
}

async function sendConsultStartNotifications(
  row: OrderRow | null | undefined,
  payload: SlimPayload | null | undefined,
  orderId: string,
): Promise<string[]> {
  const message = '工場から相談があります。アプリをご確認ください';
  const sent: string[] = [];
  if (await sendToCustomerAudience(row, payload, message, {
    type: 'order_status',
    orderId,
    targetApp: 'customer',
    status: 'consulting',
  })) {
    sent.push('customer:consult_start');
  }
  return sent;
}

function isAuthorized(req: Request): boolean {
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!expected) return false;
  const auth = req.headers.get('Authorization') || '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  const apikey = (req.headers.get('apikey') || '').trim();
  return bearer === expected || apikey === expected;
}

async function resolveChatFromForSlimPayload(
  payload: SlimPayload,
): Promise<{ row: OrderRow | null; chatFrom: string }> {
  const chatFrom = pickString(payload.chat_from);
  if (chatFrom) return { row: null, chatFrom };

  const orderId = pickString(payload.order_id);
  if (!orderId) return { row: null, chatFrom: '' };

  const row = await fetchOrderRow(orderId);
  const latest = latestChatMessage(asArray(row?.chat_messages));
  return { row, chatFrom: pickString(latest?.from) };
}

async function processSlimPayload(payload: SlimPayload): Promise<string[]> {
  const event = pickString(payload.event) as PushEvent;
  const orderId = pickString(payload.order_id);
  const sent: string[] = [];

  console.log('[onesignal-push] process start', { v: FUNCTION_VERSION, format: 'slim', event, orderId });

  switch (event) {
    case 'new_order':
      sent.push(...await sendNewOrderNotifications(null, payload, orderId));
      break;
    case 'customer_accepted': {
      sent.push(...await sendOrderAcceptedNotifications(null, payload, orderId));
      break;
    }
    case 'order_accepted': {
      sent.push(...await sendOrderAcceptedNotifications(null, payload, orderId));
      break;
    }
    case 'customer_rejected': {
      sent.push(...await sendOrderRejectedNotifications(null, payload, orderId));
      break;
    }
    case 'order_rejected': {
      sent.push(...await sendOrderRejectedNotifications(null, payload, orderId));
      break;
    }
    case 'order_timeout': {
      // エスカレーション完了後も未受注 → タイムアウト拒否（全社拒否ゲートをバイパス）
      sent.push(...await sendOrderRejectedNotifications(null, payload, orderId, { force: true }));
      break;
    }
    case 'consult_start': {
      sent.push(...await sendConsultStartNotifications(null, payload, orderId));
      break;
    }
    case 'customer_chat': {
      const { row, chatFrom } = await resolveChatFromForSlimPayload(payload);
      sent.push(...await sendCustomerChatNotifications(row, payload, orderId, chatFrom));
      break;
    }
    case 'factory_chat': {
      const { row, chatFrom } = await resolveChatFromForSlimPayload(payload);
      sent.push(...await sendFactoryChatNotifications(row, payload, orderId, chatFrom));
      break;
    }
    case 'customer_map_shared': {
      const row = orderId ? await fetchOrderRow(orderId) : null;
      sent.push(...await sendCustomerMapSharedNotifications(row, payload, orderId));
      break;
    }
    case 'escalation_expanded': {
      const row = orderId ? await fetchOrderRow(orderId) : null;
      sent.push(...await sendEscalationExpandedNotifications(row, payload, orderId));
      break;
    }
    default:
      console.warn('[onesignal-push] unknown event', event);
  }

  console.log('[onesignal-push] process done', { v: FUNCTION_VERSION, orderId, sent: sent.length ? sent : 'none' });
  return sent;
}

async function processLegacyWebhook(payload: LegacyWebhookPayload): Promise<string[]> {
  const eventType = String(payload.type || '').toUpperCase();
  const record = payload.record || {};
  const oldRecord = payload.old_record || null;
  const orderId = pickString(record.id);
  const sent: string[] = [];

  console.log('[onesignal-push] process start', { v: FUNCTION_VERSION, format: 'legacy', eventType, orderId });

  if (eventType === 'INSERT') {
    const status = effectiveStatus(record);
    if (status !== 'pending_association' && isPendingLike(status)) {
      sent.push(...await sendNewOrderNotifications(record, null, orderId));
    }
  }

  if (eventType === 'UPDATE' && oldRecord) {
    const oldStatus = effectiveStatus(oldRecord);
    const newStatus = effectiveStatus(record);
    if (isPendingLike(oldStatus) && isAcceptedLike(newStatus)) {
      sent.push(...await sendOrderAcceptedNotifications(record, null, orderId));
    } else if (isPendingLike(oldStatus) && isRejectedLike(newStatus)) {
      sent.push(...await sendOrderRejectedNotifications(record, null, orderId));
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
      if (isFactorySideChatSender(chatFrom)) {
        sent.push(...await sendCustomerChatNotifications(record, null, orderId, chatFrom));
      } else if (isCustomerSideChatSender(chatFrom)) {
        sent.push(...await sendFactoryChatNotifications(record, null, orderId, chatFrom));
      } else {
        console.warn('[onesignal-push] legacy chat unknown sender', { orderId, chatFrom });
      }
    }

    if (wasMapSharedOrUpdated(oldRecord, record)) {
      sent.push(...await sendCustomerMapSharedNotifications(record, null, orderId));
    }

    const oldRejectedLen = rejectedFactoryIdsArray(oldRecord).length;
    const newRejectedLen = rejectedFactoryIdsArray(record).length;
    if (newRejectedLen > oldRejectedLen) {
      sent.push(...await sendEscalationExpandedNotifications(record, null, orderId, oldRecord));
    }
  }

  console.log('[onesignal-push] process done', { v: FUNCTION_VERSION, orderId, sent: sent.length ? sent : 'none' });
  return sent;
}

async function processRescued(record: OrderRow, hint: 'chat' | 'status' | 'insert'): Promise<string[]> {
  const orderId = pickString(record.id);
  const sent: string[] = [];

  console.log('[onesignal-push] process start', { v: FUNCTION_VERSION, format: 'rescued', hint, orderId });

  if (hint === 'insert') {
    const status = effectiveStatus(record);
    if (status !== 'pending_association' && isPendingLike(status)) {
      sent.push(...await sendNewOrderNotifications(record, null, orderId));
    }
  } else if (hint === 'status') {
    const newStatus = effectiveStatus(record);
    if (isAcceptedLike(newStatus)) {
      sent.push(...await sendOrderAcceptedNotifications(record, null, orderId));
    } else if (isRejectedLike(newStatus)) {
      sent.push(...await sendOrderRejectedNotifications(record, null, orderId));
    }
  } else {
    const latest = latestChatMessage(asArray(record.chat_messages));
    if (!latest) {
      console.log('[onesignal-push] rescued chat with no messages', { orderId });
      return sent;
    }
    const chatFrom = pickString(latest.from);
    if (isFactorySideChatSender(chatFrom)) {
      sent.push(...await sendCustomerChatNotifications(record, null, orderId, chatFrom));
    } else if (isCustomerSideChatSender(chatFrom)) {
      sent.push(...await sendFactoryChatNotifications(record, null, orderId, chatFrom));
    } else {
      console.warn('[onesignal-push] rescued chat unknown sender', { orderId, chatFrom });
    }
  }

  console.log('[onesignal-push] process done', { v: FUNCTION_VERSION, orderId, sent: sent.length ? sent : 'none' });
  return sent;
}

async function routeChatFromOrder(row: OrderRow, message: string, orderId: string): Promise<string | null> {
  const latest = latestChatMessage(asArray(row.chat_messages));
  if (!latest) {
    console.warn('[onesignal-push] chat_message order has no messages', { orderId });
    return null;
  }

  const chatFrom = pickString(latest.from);
  console.log('[onesignal-push] chat route from order', { orderId, chatFrom, customer_id: row.customer_id });

  if (isFactorySideChatSender(chatFrom)) {
    const sent = await sendCustomerChatNotifications(row, null, orderId, chatFrom);
    return sent[0] ?? null;
  }
  if (isCustomerSideChatSender(chatFrom)) {
    const sent = await sendFactoryChatNotifications(row, null, orderId, chatFrom);
    return sent[0] ?? null;
  }

  console.warn('[onesignal-push] chat_message unknown sender', { orderId, chatFrom });
  return null;
}

async function processChatMessagePayload(payload: ChatMessagePayload): Promise<string[]> {
  const message = pickString(payload.message, '新しいメッセージが届きました');
  const orderId = pickString(payload.order_id);
  const sent: string[] = [];

  console.log('[onesignal-push] process start', {
    v: FUNCTION_VERSION,
    format: 'chat_message',
    orderId,
  });

  if (!orderId) {
    console.warn('[onesignal-push] chat_message missing order_id — skip (sender routing required)');
    console.log('[onesignal-push] process done', { v: FUNCTION_VERSION, orderId, sent: 'none' });
    return sent;
  }

  const row = await fetchOrderRow(orderId);
  if (!row) {
    console.warn('[onesignal-push] chat_message order fetch failed — skip blind receiver_id routing', { orderId });
    console.log('[onesignal-push] process done', { v: FUNCTION_VERSION, orderId, sent: 'none' });
    return sent;
  }

  const result = await routeChatFromOrder(row, message, orderId);
  if (result) sent.push(result);

  console.log('[onesignal-push] process done', {
    v: FUNCTION_VERSION,
    orderId,
    sent: sent.length ? sent : 'none',
    via: 'order_route',
  });
  return sent;
}

async function processIncoming(incoming: IncomingPayload): Promise<void> {
  let sent: string[] = [];
  if (incoming.format === 'slim') {
    sent = await processSlimPayload(incoming.data);
  } else if (incoming.format === 'legacy') {
    sent = await processLegacyWebhook(incoming.data);
  } else if (incoming.format === 'chat_message') {
    sent = await processChatMessagePayload(incoming.data);
  } else {
    sent = await processRescued(incoming.data, incoming.hint);
  }
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

  const orderId = resolveIncomingOrderId(incoming);
  const eventLabel = incoming.format === 'slim'
    ? pickString(incoming.data.event)
    : incoming.format === 'legacy'
    ? pickString(incoming.data.type)
    : incoming.format === 'chat_message'
    ? 'chat_message'
    : incoming.hint;

  if (orderId && await shouldSkipRecentPush(orderId)) {
    return new Response(
      JSON.stringify({
        ok: true,
        accepted: false,
        skipped: true,
        reason: 'recent_push',
        v: FUNCTION_VERSION,
        format: incoming.format,
        orderId,
        event: eventLabel,
        ms: Date.now() - started,
      }),
      { status: 202, headers: { 'Content-Type': 'application/json' } },
    );
  }

  scheduleBackground(
    processIncoming(incoming).catch((error) => {
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
