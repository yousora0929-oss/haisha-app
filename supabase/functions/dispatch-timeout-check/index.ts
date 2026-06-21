/**
 * dispatch-timeout-check v2
 * - 通常注文: エスカレーション最終段階 + 10分で顧客へタイムアウト通知
 * - 割当物件: サブ工場への通知から10分応答なしで次サブへ（または管理者フォローへ）
 */

const FUNCTION_VERSION = 2;
const TIMEOUT_GRACE_MINUTES = 10;
const SUB_FACTORY_TIMEOUT_MINUTES = 10;

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
  project_id?: string | null;
  preferred_factory_id?: string | null;
  factory_site_id?: string | null;
  created_at?: string | null;
  push_timeout_notified_at?: string | null;
  factory_consult_status?: string | null;
  is_spot?: boolean | null;
  rejected_factory_ids?: unknown;
  sub_factory_current_index?: number | null;
  sub_factory_notified_at?: string | null;
};

type ProjectRow = {
  id?: string;
  main_factory_id?: string | null;
  sub_factory_ids?: unknown;
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

function associationPoolLen(row: OrderRow | null | undefined): number {
  const od = orderData(row);
  const pool = asArray(od.association_assigned_factory_ids ?? od.associationAssignedFactoryIds);
  return pool.length;
}

function isAssignedProjectOrder(row: OrderRow, project: ProjectRow | null | undefined): boolean {
  if (!row || !project) return false;
  const od = orderData(row);
  if (Boolean(row.is_spot ?? od.is_spot)) return false;
  if (!pickString(row.project_id, od.project_id, od.projectId)) return false;
  if (associationPoolLen(row) > 0) return false;
  const mainId = pickString(project.main_factory_id);
  const subLen = asArray(project.sub_factory_ids).length;
  return Boolean(mainId) || subLen > 0;
}

function normalizeSubFactoryIds(raw: unknown): string[] {
  return asArray(raw).map((x) => pickString(x)).filter(Boolean);
}

function rejectedFactoryIds(row: OrderRow): string[] {
  const direct = asArray(row.rejected_factory_ids).map((x) => pickString(x)).filter(Boolean);
  if (direct.length) return [...new Set(direct)];
  const od = orderData(row);
  return [...new Set(asArray(od.rejected_factory_ids ?? od.rejectedFactoryIds).map((x) => pickString(x)).filter(Boolean))];
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
const projectCache = new Map<string, ProjectRow | null>();

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
      escalationCache.set(fid, DEFAULT_ESCALATION_STEPS);
      return DEFAULT_ESCALATION_STEPS;
    }
    const steps = normalizeEscalationSteps(await response.json());
    escalationCache.set(fid, steps);
    return steps;
  } catch {
    return DEFAULT_ESCALATION_STEPS;
  }
}

async function fetchProject(projectId: string): Promise<ProjectRow | null> {
  const pid = pickString(projectId);
  if (!pid) return null;
  if (projectCache.has(pid)) return projectCache.get(pid) ?? null;

  const { base, serviceKey } = supabaseEnv();
  if (!base || !serviceKey) return null;

  try {
    const response = await fetch(
      `${base}/rest/v1/projects?id=eq.${encodeURIComponent(pid)}` +
        `&select=id,main_factory_id,sub_factory_ids`,
      {
        headers: {
          apikey: serviceKey,
          Authorization: `Bearer ${serviceKey}`,
          Accept: 'application/json',
        },
      },
    );
    if (!response.ok) {
      projectCache.set(pid, null);
      return null;
    }
    const rows = await response.json();
    const row = Array.isArray(rows) && rows[0] ? (rows[0] as ProjectRow) : null;
    projectCache.set(pid, row);
    return row;
  } catch {
    projectCache.set(pid, null);
    return null;
  }
}

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
        `&select=id,status,order_data,customer_id,project_id,preferred_factory_id,factory_site_id,created_at,push_timeout_notified_at,factory_consult_status,is_spot,rejected_factory_ids,sub_factory_current_index,sub_factory_notified_at`,
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

async function fetchAssignedSubTimeoutOrders(): Promise<OrderRow[]> {
  const { base, serviceKey } = supabaseEnv();
  if (!base || !serviceKey) return [];

  try {
    const response = await fetch(
      `${base}/rest/v1/orders?status=eq.pending` +
        `&sub_factory_notified_at=not.is.null` +
        `&sub_factory_current_index=gte.0` +
        `&select=id,status,order_data,project_id,rejected_factory_ids,sub_factory_current_index,sub_factory_notified_at,is_spot`,
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

async function patchOrder(orderId: string, body: Record<string, unknown>): Promise<boolean> {
  const { base, serviceKey } = supabaseEnv();
  if (!base || !serviceKey || !orderId) return false;
  try {
    const response = await fetch(`${base}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}`, {
      method: 'PATCH',
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    });
    return response.ok;
  } catch {
    return false;
  }
}

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
    if (!response.ok) return false;
    const rows = await response.json();
    return Array.isArray(rows) && rows.length > 0;
  } catch {
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
    return response.ok;
  } catch {
    return false;
  }
}

async function processSubFactoryTimeouts(): Promise<{ checked: number; advanced: number; orderIds: string[] }> {
  const orders = await fetchAssignedSubTimeoutOrders();
  const now = Date.now();
  const orderIds: string[] = [];
  let advanced = 0;

  for (const row of orders) {
    const orderId = pickString(row.id);
    if (!orderId) continue;
    if (pickString(row.factory_consult_status) === 'consulting') continue;

    const notifiedAt = pickString(row.sub_factory_notified_at);
    const notifiedMs = notifiedAt ? Date.parse(notifiedAt) : NaN;
    if (Number.isNaN(notifiedMs)) continue;
    if ((now - notifiedMs) / 60000 <= SUB_FACTORY_TIMEOUT_MINUTES) continue;

    const projectId = pickString(row.project_id, orderData(row).project_id, orderData(row).projectId);
    const project = await fetchProject(projectId);
    if (!isAssignedProjectOrder(row, project)) continue;

    const subIds = normalizeSubFactoryIds(project?.sub_factory_ids);
    const currentIndex = Number(row.sub_factory_current_index ?? -1);
    if (currentIndex < 0 || currentIndex >= subIds.length) continue;

    const timedOutFactoryId = subIds[currentIndex];
    const rejected = rejectedFactoryIds(row);
    if (!rejected.includes(timedOutFactoryId)) rejected.push(timedOutFactoryId);

    const nextIndex = currentIndex + 1;
    const nowIso = new Date().toISOString();
    const od = orderData(row);
    const patch: Record<string, unknown> = {
      rejected_factory_ids: rejected,
      order_data: { ...od, rejected_factory_ids: rejected, rejectedFactoryIds: rejected },
    };

    if (nextIndex < subIds.length) {
      patch.sub_factory_current_index = nextIndex;
      patch.sub_factory_notified_at = nowIso;
    } else {
      patch.status = 'awaiting_admin_followup';
      patch.admin_followup_started_at = nowIso;
      patch.sub_factory_notified_at = null;
    }

    const ok = await patchOrder(orderId, patch);
    if (ok) {
      advanced += 1;
      orderIds.push(orderId);
      console.log('[dispatch-timeout-check] sub factory timeout advanced', {
        orderId,
        timedOutFactoryId,
        nextIndex: nextIndex < subIds.length ? nextIndex : null,
      });
    }
  }

  return { checked: orders.length, advanced, orderIds };
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
    if (pickString(row.factory_consult_status) === 'consulting') continue;

    const projectId = pickString(row.project_id, orderData(row).project_id, orderData(row).projectId);
    const project = projectId ? await fetchProject(projectId) : null;
    if (isAssignedProjectOrder(row, project)) continue;

    const created = pickString(row.created_at);
    const createdMs = created ? Date.parse(created) : NaN;
    if (Number.isNaN(createdMs)) continue;

    const elapsedMinutes = (now - createdMs) / 60000;
    const steps = await fetchEscalationSteps(resolveAnchorFactoryId(row));
    const finalTrigger = finalEscalationTriggerMinutes(steps);

    if (elapsedMinutes <= finalTrigger + TIMEOUT_GRACE_MINUTES) continue;

    timedOut += 1;
    const claimed = await claimTimeoutNotify(orderId);
    if (!claimed) continue;

    const ok = await postTimeoutPush(row);
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
    const subResult = await processSubFactoryTimeouts();
    const result = await processTimeouts();
    console.log('[dispatch-timeout-check] done', {
      v: FUNCTION_VERSION,
      sub: subResult,
      ...result,
      ms: Date.now() - started,
    });
    return new Response(
      JSON.stringify({ ok: true, v: FUNCTION_VERSION, sub: subResult, ...result, ms: Date.now() - started }),
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
