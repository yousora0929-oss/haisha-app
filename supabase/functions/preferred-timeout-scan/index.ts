/**
 * preferred-timeout-scan
 * 第一希望指定注文で無応答タイムアウトを検出し、顧客へ preferred_timeout プッシュを1回だけ送る
 */

const FUNCTION_VERSION = 1;

type OrderRow = {
  id?: string;
  status?: string | null;
  order_data?: Record<string, unknown> | null;
  customer_id?: string | null;
  preferred_factory_id?: string | null;
  created_at?: string | null;
  escalation_approved_at?: string | null;
  rejected_factory_ids?: unknown;
  push_notified_map?: Record<string, string> | null;
  is_spot?: boolean | null;
  project_id?: string | null;
};

type FactoryRow = {
  id?: string;
  preferred_no_response_timeout_minutes?: number | null;
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

function isUserSpecifiedPreferredFactory(row: OrderRow): boolean {
  const od = orderData(row);
  if (od.preferred_factory_user_specified === true) return true;
  if (od.preferredFactoryUserSpecified === true) return true;
  const pid = pickString(row.project_id, od.project_id, od.projectId);
  const pref = pickString(row.preferred_factory_id, od.preferred_factory_id, od.preferredFactoryId);
  return Boolean(pid && pref);
}

function isFactoryHoldPending(row: OrderRow): boolean {
  const od = orderData(row);
  return pickString(od.factoryResponseStatus, od.factory_response_status) === 'pending';
}

function isPreferredRejected(row: OrderRow): boolean {
  const preferredId = pickString(row.preferred_factory_id, orderData(row).preferred_factory_id);
  if (!preferredId) return false;
  const declined = pickString(
    orderData(row).preferred_factory_declined_at,
    orderData(row).preferredFactoryDeclinedAt,
  );
  if (declined) return true;
  const rejected = asArray(row.rejected_factory_ids).map((x) => pickString(x)).filter(Boolean);
  return rejected.includes(preferredId);
}

function alreadySentPreferredTimeout(row: OrderRow): boolean {
  const map = asObject(row.push_notified_map);
  return Boolean(pickString(map.preferred_timeout));
}

function elapsedMinutesSince(iso: string, now = new Date()): number {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return 0;
  return Math.max(0, Math.floor((now.getTime() - ts) / 60000));
}

async function fetchCandidateOrders(): Promise<OrderRow[]> {
  const { base, serviceKey } = supabaseEnv();
  if (!base || !serviceKey) return [];
  try {
    const response = await fetch(
      `${base}/rest/v1/orders?status=eq.pending` +
        `&escalation_approved_at=is.null` +
        `&preferred_factory_id=not.is.null` +
        `&select=id,status,order_data,customer_id,preferred_factory_id,created_at,escalation_approved_at,rejected_factory_ids,push_notified_map,is_spot,project_id`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept: 'application/json',
        },
      },
    );
    if (!response.ok) return [];
    const rows = await response.json();
    return Array.isArray(rows) ? (rows as OrderRow[]) : [];
  } catch {
    return [];
  }
}

async function fetchFactoriesById(): Promise<Record<string, FactoryRow>> {
  const { base, serviceKey } = supabaseEnv();
  if (!base || !serviceKey) return {};
  try {
    const response = await fetch(
      `${base}/rest/v1/factories?select=id,preferred_no_response_timeout_minutes`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept: 'application/json',
        },
      },
    );
    if (!response.ok) return {};
    const rows = await response.json();
    const map: Record<string, FactoryRow> = {};
    for (const row of asArray(rows)) {
      const o = asObject(row) as FactoryRow;
      const id = pickString(o.id);
      if (id) map[id] = o;
    }
    return map;
  } catch {
    return {};
  }
}

async function claimPreferredTimeout(orderId: string, prevMap: Record<string, unknown>): Promise<boolean> {
  const { base, serviceKey } = supabaseEnv();
  if (!base || !serviceKey || !orderId) return false;
  if (pickString(prevMap.preferred_timeout)) return false;

  const now = new Date().toISOString();
  const nextMap = { ...prevMap, preferred_timeout: now };
  try {
    const response = await fetch(`${base}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        push_notified_map: nextMap,
        push_notified_at: now,
      }),
    });
    if (!response.ok) return false;
    const rows = await response.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch {
    return false;
  }
}

async function postPreferredTimeoutPush(row: OrderRow): Promise<boolean> {
  const { base, serviceKey } = supabaseEnv();
  if (!base || !serviceKey) return false;
  const params = new URLSearchParams({
    event: 'preferred_timeout',
    order_id: pickString(row.id),
    customer_id: pickString(row.customer_id),
    preferred_factory_id: pickString(row.preferred_factory_id),
    status: 'pending',
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
    return response.ok;
  } catch {
    return false;
  }
}

async function runScan(): Promise<{ checked: number; notified: number; orderIds: string[] }> {
  const [orders, factories] = await Promise.all([fetchCandidateOrders(), fetchFactoriesById()]);
  const now = new Date();
  const notifiedIds: string[] = [];
  let checked = 0;

  for (const row of orders) {
    if (!isUserSpecifiedPreferredFactory(row)) continue;
    if (pickString(row.escalation_approved_at)) continue;
    if (alreadySentPreferredTimeout(row)) continue;
    if (isPreferredRejected(row)) continue;
    if (isFactoryHoldPending(row)) continue;

    const preferredId = pickString(row.preferred_factory_id, orderData(row).preferred_factory_id);
    if (!preferredId) continue;

    const factory = factories[preferredId];
    const timeoutRaw = Number(factory?.preferred_no_response_timeout_minutes);
    const timeoutMinutes =
      Number.isFinite(timeoutRaw) && timeoutRaw >= 5 && timeoutRaw <= 60 && timeoutRaw % 5 === 0
        ? timeoutRaw
        : 15;

    const created = pickString(row.created_at, orderData(row).createdAt, orderData(row).created_at);
    if (!created) continue;
    checked += 1;
    if (elapsedMinutesSince(created, now) < timeoutMinutes) continue;

    const claimed = await claimPreferredTimeout(pickString(row.id), asObject(row.push_notified_map));
    if (!claimed) continue;

    const ok = await postPreferredTimeoutPush(row);
    if (ok) notifiedIds.push(pickString(row.id));
  }

  return { checked, notified: notifiedIds.length, orderIds: notifiedIds };
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
    const result = await runScan();
    console.log('[preferred-timeout-scan] done', result);
    return new Response(
      JSON.stringify({ ok: true, v: FUNCTION_VERSION, ...result, ms: Date.now() - started }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  } catch (error) {
    console.error('[preferred-timeout-scan] failed', error);
    return new Response(
      JSON.stringify({ ok: false, error: String(error), v: FUNCTION_VERSION, ms: Date.now() - started }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
