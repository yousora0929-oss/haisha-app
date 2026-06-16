/**
 * dispatch-timeout-check v1
 * pg_cron から5分おきに呼ばれ、エスカレーション最終段階 + 10分を超えても
 * 未受注（pending / pending_association）の注文を検出し、顧客へ拒否通知を1回だけ送る。
 * 二重送信防止は orders.push_timeout_notified_at で行う。
 */

const FUNCTION_VERSION = 1;
const TIMEOUT_GRACE_MINUTES = 10;

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

type OrderRow = {
  id?: string;
  status?: string | null;
  order_data?: Record<string, unknown> | null;
  customer_id?: string | null;
  preferred_factory_id?: string | null;
  factory_site_id?: string | null;
  created_at?: string | null;
  push_timeout_notified_at?: string | null;
};

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

function supabaseEnv(): { base: string; serviceKey: string } {
  return {
    base: Deno.env.get('SUPABASE_URL')?.replace(/\/$/, '') || '',
    serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '',
  };
}

function isAuthorized(req: Request): boolean {
  const expected = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!expected) return false;
  const auth = req.headers.get('Authorization') || '';
  const bearer = auth.replace(/^Bearer\s+/i, '').trim();
  const apikey = (req.headers.get('apikey') || '').trim();
  return bearer === expected || apikey === expected;
}

function effectiveStatus(row: OrderRow | null | undefined): string {
  const od = orderData(row);
  const factoryResponse = pickString(od.factoryResponseStatus, od.factory_response_status);
  if (factoryResponse) return factoryResponse;
  return pickString(row?.status, od.status) || 'pending';
}

function resolveAnchorFactoryId(row: OrderRow | null | undefined): string {
  const od = orderData(row);
  return pickString(
    row?.preferred_factory_id,
    od.preferred_factory_id,
    od.preferredFactoryId,
    od.main_factory_id,
    od.mainFactoryId,
  );
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

const escalationCache = new Map<string, EscalationStep[]>();

async function fetchEscalationSteps(factoryId: string): Promise<EscalationStep[]> {
  const fid = pickString(factoryId);
  if (!fid) return DEFAULT_ESCALATION_STEPS;
  const cached = escalationCache.get(fid);
  if (cached) return cached;

  const { base, serviceKey } = supabaseEnv();
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
      console.warn('[dispatch-timeout-check] escalation steps fetch failed', { factoryId: fid, status: response.status });
      escalationCache.set(fid, DEFAULT_ESCALATION_STEPS);
      return DEFAULT_ESCALATION_STEPS;
    }
    const steps = normalizeEscalationSteps(await response.json());
    escalationCache.set(fid, steps);
    return steps;
  } catch (error) {
    console.warn('[dispatch-timeout-check] escalation steps fetch error — use default', { factoryId: fid, error });
    return DEFAULT_ESCALATION_STEPS;
  }
}

/** エスカレーション最終段階の trigger_minutes（最大） */
function finalEscalationTriggerMinutes(steps: EscalationStep[]): number {
  const list = steps.length ? steps : DEFAULT_ESCALATION_STEPS;
  const last = list[list.length - 1];
  return Math.max(0, Number(last?.trigger_minutes) || 0);
}

async function fetchPendingOrders(): Promise<OrderRow[]> {
  const { base, serviceKey } = supabaseEnv();
  if (!base || !serviceKey) return [];

  try {
    const response = await fetch(
      `${base}/rest/v1/orders?status=in.(pending,pending_association)` +
        `&push_timeout_notified_at=is.null` +
        `&select=id,status,order_data,customer_id,preferred_factory_id,factory_site_id,created_at,push_timeout_notified_at`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept: 'application/json',
        },
      },
    );
    if (!response.ok) {
      console.warn('[dispatch-timeout-check] pending orders fetch failed', { status: response.status });
      return [];
    }
    const rows = await response.json();
    return Array.isArray(rows) ? (rows as OrderRow[]) : [];
  } catch (error) {
    console.warn('[dispatch-timeout-check] pending orders fetch error', error);
    return [];
  }
}

/** push_timeout_notified_at を立てる（既に立っていれば敗北＝二重送信回避） */
async function claimTimeoutNotify(orderId: string): Promise<boolean> {
  const { base, serviceKey } = supabaseEnv();
  if (!base || !serviceKey || !orderId) return false;

  const now = new Date().toISOString();
  try {
    const response = await fetch(
      `${base}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}&push_timeout_notified_at=is.null`,
      {
        method: 'PATCH',
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
          Prefer: 'return=representation',
        },
        body: JSON.stringify({ push_timeout_notified_at: now }),
      },
    );
    if (!response.ok) {
      console.warn('[dispatch-timeout-check] claim timeout failed', { orderId, status: response.status });
      return false;
    }
    const rows = await response.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch (error) {
    console.warn('[dispatch-timeout-check] claim timeout error', { orderId, error });
    return false;
  }
}

async function postTimeoutPush(row: OrderRow): Promise<boolean> {
  const { base, serviceKey } = supabaseEnv();
  if (!base || !serviceKey) return false;

  const od = orderData(row);
  const params = new URLSearchParams({
    event: 'order_timeout',
    order_id: pickString(row.id),
    customer_id: pickString(row.customer_id),
    preferred_factory_id: resolveAnchorFactoryId(row),
    factory_site_id: pickString(row.factory_site_id, od.factory_site_id, od.factorySiteId),
    status: 'rejected',
  });

  try {
    const response = await fetch(`${base}/functions/v1/onesignal-push?${params.toString()}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        'Content-Type': 'application/json',
      },
      body: '{}',
    });
    if (!response.ok) {
      console.warn('[dispatch-timeout-check] onesignal-push call failed', {
        orderId: pickString(row.id),
        status: response.status,
      });
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[dispatch-timeout-check] onesignal-push call error', { orderId: pickString(row.id), error });
    return false;
  }
}

async function processTimeouts(): Promise<{ checked: number; timedOut: number; notified: string[] }> {
  const orders = await fetchPendingOrders();
  const now = Date.now();
  const notified: string[] = [];
  let timedOut = 0;

  for (const row of orders) {
    const orderId = pickString(row.id);
    if (!orderId) continue;
    if (effectiveStatus(row) === 'customer_cancelled') continue;

    const created = pickString(row.created_at);
    const createdMs = created ? Date.parse(created) : NaN;
    if (Number.isNaN(createdMs)) continue;

    const elapsedMinutes = (now - createdMs) / 60000;
    const steps = await fetchEscalationSteps(resolveAnchorFactoryId(row));
    const finalTrigger = finalEscalationTriggerMinutes(steps);

    if (elapsedMinutes <= finalTrigger + TIMEOUT_GRACE_MINUTES) continue;

    timedOut += 1;
    const claimed = await claimTimeoutNotify(orderId);
    if (!claimed) {
      console.log('[dispatch-timeout-check] already notified — skip', { orderId });
      continue;
    }

    const ok = await postTimeoutPush(row);
    console.log('[dispatch-timeout-check] timeout notify', {
      orderId,
      elapsedMinutes: Math.round(elapsedMinutes),
      finalTrigger,
      grace: TIMEOUT_GRACE_MINUTES,
      pushOk: ok,
    });
    if (ok) notified.push(orderId);
  }

  return { checked: orders.length, timedOut, notified };
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

  try {
    const result = await processTimeouts();
    console.log('[dispatch-timeout-check] done', { v: FUNCTION_VERSION, ...result, ms: Date.now() - started });
    return new Response(
      JSON.stringify({ ok: true, v: FUNCTION_VERSION, ...result, ms: Date.now() - started }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[dispatch-timeout-check] error', error);
    return new Response(
      JSON.stringify({ ok: false, error: String(error), v: FUNCTION_VERSION }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
