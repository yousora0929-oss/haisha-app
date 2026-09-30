/** order-priority-snapshot v1 — spot order factory ranking snapshot */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  DEFAULT_ESCALATION_STEPS,
  buildCandidateFactoryIds,
  buildMonthlyVolumeByFactoryFromRows,
  calculateDistance,
  filterFactoriesForSmallVehicleOrder,
  getEffectiveStartTime,
  getOrderSiteCoords,
  isUserSpecifiedPreferredFactory,
  normalizeEscalationSteps,
  orderEscalationApprovedAt,
  parseNearPoolSize,
  type EscalationPushContext,
  type EscalationStep,
} from '../_shared/escalationVisibility.ts';

const FUNCTION_VERSION = 1;
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

type SnapshotReason = 'created' | 'coords_resolved' | 'escalation_approved';

type OrderRow = {
  id?: string;
  status?: string | null;
  order_data?: Record<string, unknown> | null;
  created_at?: string | null;
  project_id?: string | null;
  preferred_factory_id?: string | null;
  escalation_approved_at?: string | null;
  is_spot?: boolean | null;
  is_phone_order?: boolean | null;
  delivery_lat?: number | string | null;
  delivery_lng?: number | string | null;
  rejected_factory_ids?: unknown;
  [key: string]: unknown;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Connection': 'keep-alive',
    },
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

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

function orderData(row?: OrderRow | null): Record<string, unknown> {
  return asObject(row?.order_data);
}

function getSupabaseClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function isSpotOrder(row: OrderRow): boolean {
  const od = orderData(row);
  return Boolean(row.is_spot ?? od.is_spot);
}

function isPhoneOrder(row: OrderRow): boolean {
  const od = orderData(row);
  return Boolean(row.is_phone_order ?? od.is_phone_order ?? od.isPhoneOrder);
}

function rejectedFactoryIds(row?: OrderRow | null): string[] {
  if (!row) return [];
  const direct = asArray(row.rejected_factory_ids);
  if (direct.length) {
    return [...new Set(direct.map((x) => pickString(x)).filter(Boolean))];
  }
  const od = orderData(row);
  return [
    ...new Set(
      asArray(od.rejected_factory_ids ?? od.rejectedFactoryIds)
        .map((x) => pickString(x))
        .filter(Boolean),
    ),
  ];
}

function isSmallVehicleFilter(row: OrderRow): boolean {
  const od = orderData(row);
  if (od.vehicleType === 'small' || row.vehicleType === 'small') return true;
  if (String(od.vehicleLabel || row.vehicleLabel || '').trim() === '小型') return true;
  return false;
}

function detectCoordsSource(
  row: OrderRow,
  projectById: EscalationPushContext['projectById'],
): 'order' | 'project' | 'none' {
  const od = orderData(row);
  const olat = Number(
    row.delivery_lat ?? od.delivery_lat ?? od.deliveryLat ?? od.site_lat ?? od.siteLat ?? od.lat,
  );
  const olng = Number(
    row.delivery_lng ?? od.delivery_lng ?? od.deliveryLng ?? od.site_lng ?? od.siteLng ?? od.lng,
  );
  if (Number.isFinite(olat) && Number.isFinite(olng)) return 'order';

  const pid = pickString(row.project_id, od.project_id, od.projectId);
  const project = pid ? projectById[pid] : null;
  const plat = Number(project?.lat);
  const plng = Number(project?.lng);
  if (Number.isFinite(plat) && Number.isFinite(plng)) return 'project';
  return 'none';
}

/** Edge Runtime は UTC のため、getEffectiveStartTime のローカル日付演算を JST 相当にする */
function getEffectiveStartAtIso(
  baseIso: string,
  settings: EscalationPushContext['settings'],
  holidays: EscalationPushContext['holidays'],
): string {
  const parsed = new Date(baseIso);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  const shiftedInput = new Date(parsed.getTime() + JST_OFFSET_MS).toISOString();
  const effectiveShifted = getEffectiveStartTime(shiftedInput, settings, holidays);
  return new Date(effectiveShifted.getTime() - JST_OFFSET_MS).toISOString();
}

function roundDistanceKm(dist: number): number | null {
  if (!Number.isFinite(dist) || dist === Infinity) return null;
  return Math.round(dist * 10) / 10;
}

function visibleFromMinutesForRank(steps: EscalationStep[], rank: number): number | null {
  const list = [...steps].sort(
    (a, b) => a.trigger_minutes - b.trigger_minutes || a.step_number - b.step_number,
  );
  for (const step of list) {
    if (step.target_factory_count >= rank) return step.trigger_minutes;
  }
  return null;
}

function resolveAnchorFactoryId(row: OrderRow, candidates: string[]): string {
  const od = orderData(row);
  return (
    pickString(row.preferred_factory_id) ||
    pickString(od.preferred_factory_id, od.preferredFactoryId) ||
    pickString(od.main_factory_id, od.mainFactoryId) ||
    pickString(candidates[0]) ||
    ''
  );
}

async function fetchEscalationScoringConfig(supabase: SupabaseClient): Promise<{
  monthlyVolumeByFactory: Record<string, number>;
  rawMonthlyVolumeByFactory: Record<string, number | null>;
  nearPoolSize: number;
  factorySmallVehicleInfo: Record<string, { hasAnyVehicle: boolean; hasSmallVehicle: boolean }>;
  stepVolumeRows: unknown[];
}> {
  const { data: volRows } = await supabase
    .from('factory_escalation_steps')
    .select('factory_id, step_number, trigger_minutes, target_factory_count, monthly_volume_m3')
    .order('factory_id', { ascending: true })
    .order('step_number', { ascending: true });

  const monthlyVolumeByFactory = buildMonthlyVolumeByFactoryFromRows(volRows ?? []);
  const rawMonthlyVolumeByFactory: Record<string, number | null> = {};
  for (const row of volRows ?? []) {
    const fid = pickString((row as { factory_id?: unknown }).factory_id);
    if (!fid || rawMonthlyVolumeByFactory[fid] !== undefined) continue;
    const raw = (row as { monthly_volume_m3?: unknown }).monthly_volume_m3;
    rawMonthlyVolumeByFactory[fid] =
      raw != null && Number.isFinite(Number(raw)) ? Number(raw) : null;
  }

  const { data: wRow } = await supabase
    .from('factory_escalation_weight_config')
    .select('near_pool_size')
    .eq('id', 1)
    .maybeSingle();

  const nearPoolSize = parseNearPoolSize(wRow);

  const { data: vehicleRows } = await supabase
    .from('charter_vehicles')
    .select('owner_id, vehicle_type')
    .eq('owner_type', 'factory');

  const factorySmallVehicleInfo: Record<string, { hasAnyVehicle: boolean; hasSmallVehicle: boolean }> =
    {};
  for (const row of vehicleRows ?? []) {
    const fid = pickString((row as { owner_id?: unknown }).owner_id);
    if (!fid) continue;
    if (!factorySmallVehicleInfo[fid]) {
      factorySmallVehicleInfo[fid] = { hasAnyVehicle: false, hasSmallVehicle: false };
    }
    factorySmallVehicleInfo[fid].hasAnyVehicle = true;
    if (String((row as { vehicle_type?: unknown }).vehicle_type || '').trim() === 'small') {
      factorySmallVehicleInfo[fid].hasSmallVehicle = true;
    }
  }

  return {
    monthlyVolumeByFactory,
    rawMonthlyVolumeByFactory,
    nearPoolSize,
    factorySmallVehicleInfo,
    stepVolumeRows: volRows ?? [],
  };
}

async function fetchEscalationPushContext(
  supabase: SupabaseClient,
  projectId?: string,
): Promise<EscalationPushContext | null> {
  try {
    const [factoriesRes, holidaysRes, settingsRes, stepsRes] = await Promise.all([
      supabase.from('factories').select('id,latitude,longitude'),
      supabase.from('holidays').select('holiday_date'),
      supabase.from('system_settings').select('start_time,end_time').eq('id', 1).maybeSingle(),
      supabase
        .from('factory_escalation_steps')
        .select('factory_id,step_number,trigger_minutes,target_factory_count')
        .order('factory_id', { ascending: true })
        .order('trigger_minutes', { ascending: true }),
    ]);

    if (factoriesRes.error) {
      console.warn('[order-priority-snapshot] factories fetch failed', factoriesRes.error.message);
      return null;
    }

    let projectRows: unknown[] = [];
    if (projectId) {
      const projectRes = await supabase
        .from('projects')
        .select('id,main_factory_id,lat,lng')
        .eq('id', projectId);
      if (!projectRes.error) projectRows = projectRes.data ?? [];
    }

    const escalationStepsByFactoryId: Record<string, EscalationStep[]> = {};
    for (const row of stepsRes.data ?? []) {
      const fid = pickString((row as { factory_id?: unknown }).factory_id);
      if (!fid) continue;
      if (!escalationStepsByFactoryId[fid]) escalationStepsByFactoryId[fid] = [];
      escalationStepsByFactoryId[fid].push({
        step_number: Number((row as { step_number?: unknown }).step_number) || 0,
        trigger_minutes: Math.max(0, Number((row as { trigger_minutes?: unknown }).trigger_minutes) || 0),
        target_factory_count: Math.max(
          1,
          Number((row as { target_factory_count?: unknown }).target_factory_count) || 1,
        ),
      });
    }

    const projectById: EscalationPushContext['projectById'] = {};
    for (const row of projectRows) {
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

    return {
      factories: (factoriesRes.data ?? []) as EscalationPushContext['factories'],
      projectById,
      settings: {
        start_time: pickString(settingsRes.data?.start_time) || '08:00:00',
        end_time: pickString(settingsRes.data?.end_time) || '16:00:00',
      },
      holidays: (holidaysRes.data ?? []) as EscalationPushContext['holidays'],
      escalationStepsByFactoryId,
      monthlyVolumeByFactory: {},
      distanceWeight: 0.7,
      nearPoolSize: 5,
      factorySmallVehicleInfo: {},
      now: new Date(),
    };
  } catch (error) {
    console.warn('[order-priority-snapshot] context fetch error', error);
    return null;
  }
}

function buildNearPoolIdSet(
  order: OrderRow,
  ctx: EscalationPushContext,
  nearPoolSize: number,
): Set<string> {
  const filtered = filterFactoriesForSmallVehicleOrder(
    ctx.factories || [],
    order,
    ctx.factorySmallVehicleInfo ?? {},
  );
  const siteCoords = getOrderSiteCoords(order, ctx.projectById);
  const items = filtered
    .map((f) => {
      const id = pickString(f.id);
      if (!id) return null;
      const dist = siteCoords
        ? calculateDistance(siteCoords.lat, siteCoords.lng, f.latitude, f.longitude)
        : Infinity;
      return { id, dist };
    })
    .filter((x): x is { id: string; dist: number } => Boolean(x))
    .sort((a, b) => {
      if (a.dist !== b.dist) return a.dist - b.dist;
      return a.id.localeCompare(b.id);
    });
  const poolSize = Math.max(1, Number(nearPoolSize) || 5);
  return new Set(items.slice(0, poolSize).map((x) => x.id));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
    });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: false, error: 'method_not_allowed' }, 405);
  }

  if (!isAuthorized(req)) {
    return jsonResponse({ ok: false, error: 'unauthorized' }, 401);
  }

  try {
    let body: Record<string, unknown> = {};
    try {
      body = asObject(await req.json());
    } catch {
      return jsonResponse({ ok: true, skipped: true, reason: 'invalid_body' });
    }

    const orderId = pickString(body.order_id);
    const reason = pickString(body.reason) as SnapshotReason;
    if (!orderId) {
      return jsonResponse({ ok: true, skipped: true, reason: 'missing_order_id' });
    }
    if (
      reason !== 'created' &&
      reason !== 'coords_resolved' &&
      reason !== 'escalation_approved'
    ) {
      return jsonResponse({ ok: true, skipped: true, reason: 'invalid_reason' });
    }

    const supabase = getSupabaseClient();
    const { data: row, error: orderErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr) {
      console.warn('[order-priority-snapshot] order fetch error', orderErr.message);
      return jsonResponse({ ok: false, error: 'order_fetch_failed' }, 500);
    }
    if (!row) {
      return jsonResponse({ ok: true, skipped: true, reason: 'order_not_found' });
    }

    const order = row as OrderRow;
    if (!isSpotOrder(order)) {
      return jsonResponse({ ok: true, skipped: true, reason: 'not_spot' });
    }
    if (isPhoneOrder(order)) {
      return jsonResponse({ ok: true, skipped: true, reason: 'phone_order' });
    }

    const od = orderData(order);
    const projectId = pickString(order.project_id, od.project_id, od.projectId);
    const [ctxBase, scoring] = await Promise.all([
      fetchEscalationPushContext(supabase, projectId || undefined),
      fetchEscalationScoringConfig(supabase),
    ]);
    if (!ctxBase) {
      return jsonResponse({ ok: false, error: 'context_unavailable' }, 500);
    }

    const ctx: EscalationPushContext = {
      ...ctxBase,
      monthlyVolumeByFactory: scoring.monthlyVolumeByFactory,
      nearPoolSize: scoring.nearPoolSize,
      factorySmallVehicleInfo: scoring.factorySmallVehicleInfo,
      now: new Date(),
    };

    const mode: 'ranking' | 'preferred_only' =
      isUserSpecifiedPreferredFactory(order) && !orderEscalationApprovedAt(order)
        ? 'preferred_only'
        : 'ranking';

    const rejectedAtSnapshot = rejectedFactoryIds(order);
    const rankingOrder: OrderRow = {
      ...order,
      rejected_factory_ids: [],
      order_data: {
        ...od,
        rejected_factory_ids: [],
        rejectedFactoryIds: [],
      },
      escalation_approved_at:
        orderEscalationApprovedAt(order) || new Date().toISOString(),
    };

    const candidates = buildCandidateFactoryIds(
      rankingOrder,
      ctx,
      scoring.monthlyVolumeByFactory,
      ctx.distanceWeight,
      scoring.nearPoolSize,
    );

    const coordsSource = detectCoordsSource(order, ctx.projectById);
    const siteCoords = getOrderSiteCoords(rankingOrder, ctx.projectById);
    const nearPoolIds = buildNearPoolIdSet(rankingOrder, ctx, scoring.nearPoolSize);

    const anchorFactoryId = resolveAnchorFactoryId(order, candidates);
    const steps = normalizeEscalationSteps(
      anchorFactoryId ? ctx.escalationStepsByFactoryId[anchorFactoryId] : [],
    );
    const effectiveSteps = steps.length ? steps : DEFAULT_ESCALATION_STEPS;

    const ranking = candidates.map((factoryId, index) => {
      const rank = index + 1;
      const factory = (ctx.factories || []).find((f) => pickString(f.id) === factoryId);
      const dist =
        coordsSource === 'none' || !siteCoords || !factory
          ? null
          : roundDistanceKm(
              calculateDistance(siteCoords.lat, siteCoords.lng, factory.latitude, factory.longitude),
            );
      const vol =
        Object.prototype.hasOwnProperty.call(scoring.rawMonthlyVolumeByFactory, factoryId)
          ? scoring.rawMonthlyVolumeByFactory[factoryId]
          : null;
      return {
        rank,
        factory_id: factoryId,
        distance_km: dist,
        monthly_volume_m3: vol,
        in_near_pool: nearPoolIds.has(factoryId),
        visible_from_minutes: visibleFromMinutesForRank(effectiveSteps, rank),
      };
    });

    const approvedAt = orderEscalationApprovedAt(order);
    const createdAt = pickString(order.created_at, od.createdAt, od.created_at);
    const baseIso = approvedAt || createdAt || new Date().toISOString();
    const effectiveStartAt = getEffectiveStartAtIso(baseIso, ctx.settings, ctx.holidays);
    const smallVehicleFilter = isSmallVehicleFilter(order);

    const snapshot = {
      order_id: orderId,
      computed_at: new Date().toISOString(),
      reason,
      mode,
      site_lat: siteCoords?.lat ?? null,
      site_lng: siteCoords?.lng ?? null,
      coords_source: coordsSource,
      effective_start_at: effectiveStartAt,
      near_pool_size: scoring.nearPoolSize,
      small_vehicle_filter: smallVehicleFilter,
      anchor_factory_id: anchorFactoryId || null,
      steps: effectiveSteps.map((s) => ({
        step_number: s.step_number,
        trigger_minutes: s.trigger_minutes,
        target_factory_count: s.target_factory_count,
      })),
      ranking,
      rejected_at_snapshot: rejectedAtSnapshot,
    };

    const { error: insertErr } = await supabase
      .from('order_priority_snapshots')
      .upsert(snapshot, {
        onConflict: 'order_id,reason',
        ignoreDuplicates: true,
      });

    if (insertErr) {
      console.warn('[order-priority-snapshot] insert failed', insertErr.message);
      return jsonResponse({ ok: false, error: 'insert_failed' }, 500);
    }

    console.log('[order-priority-snapshot] saved', {
      v: FUNCTION_VERSION,
      order_id: orderId,
      reason,
      mode,
      coords_source: coordsSource,
      ranking_count: ranking.length,
    });

    return jsonResponse({
      ok: true,
      skipped: false,
      order_id: orderId,
      reason,
      mode,
      ranking_count: ranking.length,
    });
  } catch (error) {
    console.error('[order-priority-snapshot] unexpected', error);
    return jsonResponse(
      { ok: false, error: error instanceof Error ? error.message : 'internal_error' },
      500,
    );
  }
});
