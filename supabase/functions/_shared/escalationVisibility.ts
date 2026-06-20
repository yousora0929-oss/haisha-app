/** 工場プッシュ向け: isOrderVisibleToFactory と同等の公開範囲計算（Edge Function 用） */

export type EscalationStep = {
  step_number: number;
  trigger_minutes: number;
  target_factory_count: number;
};

export const DEFAULT_ESCALATION_STEPS: EscalationStep[] = [
  { step_number: 1, trigger_minutes: 0, target_factory_count: 3 },
  { step_number: 2, trigger_minutes: 15, target_factory_count: 5 },
  { step_number: 3, trigger_minutes: 30, target_factory_count: 8 },
];

type OrderLike = {
  id?: string;
  status?: string | null;
  order_data?: Record<string, unknown> | null;
  created_at?: string | null;
  project_id?: string | null;
  preferred_factory_id?: string | null;
  factory_site_id?: string | null;
  factory_consult_status?: string | null;
  factory_consult_by_factory_id?: string | null;
  is_spot?: boolean | null;
  delivery_lat?: number | string | null;
  delivery_lng?: number | string | null;
  rejected_factory_ids?: unknown;
  association_assigned_factory_ids?: unknown;
};

type FactoryLike = {
  id?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
};

type ProjectLike = {
  id?: string;
  main_factory_id?: string | null;
  sub_factory_ids?: unknown;
  lat?: number | string | null;
  lng?: number | string | null;
};

export type EscalationPushContext = {
  factories: FactoryLike[];
  projectById: Record<string, ProjectLike>;
  settings: { start_time?: string; end_time?: string };
  holidays: Array<{ holiday_date?: string } | string>;
  escalationStepsByFactoryId: Record<string, EscalationStep[]>;
  now?: Date;
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

function orderData(row?: OrderLike | null): Record<string, unknown> {
  return asObject(row?.order_data);
}

function associationAssignedFactoryIds(order: OrderLike): string[] {
  const od = orderData(order);
  const raw =
    order?.association_assigned_factory_ids ??
    od.association_assigned_factory_ids ??
    od.associationAssignedFactoryIds;
  return asArray(raw)
    .map((x) => pickString(x))
    .filter(Boolean);
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

function getEscalationStepsForAnchor(anchorFactoryId: string, map: Record<string, EscalationStep[]>): EscalationStep[] {
  const anchor = pickString(anchorFactoryId);
  const configured = anchor ? normalizeEscalationSteps(map[anchor]) : [];
  return configured.length ? configured : DEFAULT_ESCALATION_STEPS;
}

function getActiveEscalationStep(steps: EscalationStep[], effectiveMinutes: number): EscalationStep {
  const minutes = Number.isFinite(Number(effectiveMinutes)) ? Number(effectiveMinutes) : 0;
  const list = normalizeEscalationSteps(steps);
  let active = list[0];
  for (const step of list) {
    if (minutes >= step.trigger_minutes) active = step;
  }
  return active || { step_number: 1, trigger_minutes: 0, target_factory_count: 3 };
}

function rejectedFactoryIdSet(order?: OrderLike | null): Set<string> {
  const direct = asArray(order?.rejected_factory_ids);
  const fromData = asArray(orderData(order).rejected_factory_ids ?? orderData(order).rejectedFactoryIds);
  const source = direct.length ? direct : fromData;
  return new Set(source.map((x) => pickString(x)).filter(Boolean));
}

function orderCreatedAt(order?: OrderLike | null): string {
  const od = orderData(order);
  return pickString(order?.created_at, od.createdAt, od.created_at);
}

function orderProjectId(order?: OrderLike | null): string {
  const od = orderData(order);
  return pickString(order?.project_id, od.project_id, od.projectId);
}

function orderPreferredFactoryId(order?: OrderLike | null): string {
  const od = orderData(order);
  return pickString(order?.preferred_factory_id, od.preferred_factory_id, od.preferredFactoryId);
}

function parseTimeToMinutes(timeStr: string): number {
  const m = String(timeStr || '08:00:00').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 8 * 60;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function toLocalDateISO(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function holidayDateSet(holidays: EscalationPushContext['holidays']): Set<string> {
  const set = new Set<string>();
  for (const h of holidays || []) {
    const d = typeof h === 'string'
      ? h.slice(0, 10)
      : h && typeof h === 'object' && h.holiday_date != null
        ? String(h.holiday_date).slice(0, 10)
        : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) set.add(d);
  }
  return set;
}

function isNonBusinessDay(d: Date, holidaySet: Set<string>): boolean {
  if (d.getDay() === 0) return true;
  return holidaySet.has(toLocalDateISO(d));
}

function nextBusinessDayAtStart(from: Date, startMinutes: number, holidaySet: Set<string>): Date {
  const next = new Date(from);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  while (isNonBusinessDay(next, holidaySet)) {
    next.setDate(next.getDate() + 1);
  }
  next.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  return next;
}

function getEffectiveStartTime(
  createdAt: string,
  settings: EscalationPushContext['settings'],
  holidays: EscalationPushContext['holidays'],
): Date {
  const parsed = new Date(createdAt);
  if (Number.isNaN(parsed.getTime())) return new Date();

  const holidaySet = holidayDateSet(holidays);
  const startMin = parseTimeToMinutes(settings?.start_time ?? '08:00:00');
  const endMin = parseTimeToMinutes(settings?.end_time ?? '16:00:00');

  if (isNonBusinessDay(parsed, holidaySet)) {
    const dayStart = new Date(parsed);
    dayStart.setHours(0, 0, 0, 0);
    return nextBusinessDayAtStart(dayStart, startMin, holidaySet);
  }

  const dayMinutes = parsed.getHours() * 60 + parsed.getMinutes();
  if (dayMinutes >= endMin) return nextBusinessDayAtStart(parsed, startMin, holidaySet);
  if (dayMinutes < startMin) {
    const start = new Date(parsed);
    start.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
    return start;
  }
  return parsed;
}

function getElapsedMinutesSinceEffectiveStart(
  createdAt: string,
  settings: EscalationPushContext['settings'],
  holidays: EscalationPushContext['holidays'],
  now: Date,
): number {
  const start = getEffectiveStartTime(createdAt, settings, holidays);
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / 60000));
}

function getEffectiveEscalationMinutes(order: OrderLike, ctx: EscalationPushContext): number | null {
  const od = orderData(order);
  const status = pickString(order?.status, od.status, od.factoryResponseStatus);
  if (status === 'accepted' || status === 'customer_cancelled') return null;
  const created = orderCreatedAt(order);
  if (!created) return 0;
  const minutes = getElapsedMinutesSinceEffectiveStart(created, ctx.settings, ctx.holidays, ctx.now ?? new Date());
  const isSpot = Boolean(order?.is_spot ?? od.is_spot);
  if (isSpot) {
    const rejected = rejectedFactoryIdSet(order);
    if (rejected.size > 0 && minutes < 15) return 15;
    return minutes;
  }

  const pid = orderProjectId(order);
  const project = pid ? ctx.projectById[pid] : null;
  if (!project) return minutes;

  const preferredId = orderPreferredFactoryId(order);
  const mainId = pickString(project.main_factory_id);
  const firstTargetId = preferredId || mainId;
  if (!firstTargetId) return minutes;

  const rejected = rejectedFactoryIdSet(order);
  if (rejected.has(firstTargetId) && minutes < 15) return 15;
  return minutes;
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const la1 = Number(lat1);
  const ln1 = Number(lng1);
  const la2 = Number(lat2);
  const ln2 = Number(lng2);
  if (!Number.isFinite(la1) || !Number.isFinite(ln1) || !Number.isFinite(la2) || !Number.isFinite(ln2)) {
    return Infinity;
  }
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(la2 - la1);
  const dLng = toRad(ln2 - ln1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(la1)) * Math.cos(toRad(la2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getOrderSiteCoords(order: OrderLike, projectById: Record<string, ProjectLike>) {
  const od = orderData(order);
  const lat = Number(
    order.delivery_lat ?? od.delivery_lat ?? od.deliveryLat ?? od.site_lat ?? od.siteLat ?? od.lat,
  );
  const lng = Number(
    order.delivery_lng ?? od.delivery_lng ?? od.deliveryLng ?? od.site_lng ?? od.siteLng ?? od.lng,
  );
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };

  const pid = orderProjectId(order);
  const project = pid ? projectById[pid] : null;
  const plat = Number(project?.lat);
  const plng = Number(project?.lng);
  if (Number.isFinite(plat) && Number.isFinite(plng)) return { lat: plat, lng: plng };
  return null;
}

function sortFactoryIdsByDistance(order: OrderLike, ctx: EscalationPushContext): string[] {
  const known = (ctx.factories || [])
    .map((f) => pickString(f.id))
    .filter(Boolean);
  const siteCoords = getOrderSiteCoords(order, ctx.projectById);
  const rankedWithDist = (ctx.factories || [])
    .map((f) => {
      const id = pickString(f.id);
      if (!id) return null;
      const dist = siteCoords
        ? calculateDistance(siteCoords.lat, siteCoords.lng, Number(f.latitude), Number(f.longitude))
        : Infinity;
      return { id, dist };
    })
    .filter((x): x is { id: string; dist: number } => Boolean(x))
    .sort((a, b) => a.dist - b.dist || a.id.localeCompare(b.id));
  const ranked = rankedWithDist.map((x) => x.id);
  return ranked.length ? ranked : known;
}

/** escalationUtils.buildCandidateFactoryIds と同等 */
export function buildCandidateFactoryIds(order: OrderLike, ctx: EscalationPushContext): string[] {
  const rejectedIds = rejectedFactoryIdSet(order);
  const known = (ctx.factories || [])
    .map((f) => pickString(f.id))
    .filter(Boolean);
  const knownSet = new Set(known);
  const od = orderData(order);
  const pid = orderProjectId(order);
  const project = pid ? ctx.projectById[pid] : null;

  const vipIds = [
    orderPreferredFactoryId(order),
    pickString(od.main_factory_id, od.mainFactoryId),
    pickString(project?.main_factory_id),
  ].filter((id) => id && knownSet.has(id));

  const subSource = od.sub_factory_ids ?? od.subFactoryIds ?? project?.sub_factory_ids ?? [];
  const subIds = asArray(subSource)
    .map((x) => pickString(x))
    .filter((id) => id && knownSet.has(id));

  const sortedByDistance = sortFactoryIdsByDistance(order, ctx);
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const id of [...vipIds, ...subIds, ...sortedByDistance]) {
    if (!id || seen.has(id) || rejectedIds.has(id)) continue;
    candidates.push(id);
    seen.add(id);
  }

  if (!candidates.length && known.length) {
    const preferredId = orderPreferredFactoryId(order);
    if (preferredId && knownSet.has(preferredId)) return [preferredId];
    const mainId = pickString(project?.main_factory_id);
    if (mainId && knownSet.has(mainId)) return [mainId];
    return [...known];
  }

  return candidates;
}

function resolveEscalationAnchorFactoryId(
  order: OrderLike,
  project: ProjectLike | null | undefined,
  candidates: string[],
): string {
  const preferredId = orderPreferredFactoryId(order);
  if (preferredId) return preferredId;
  const od = orderData(order);
  const mainFromOrder = pickString(od.main_factory_id, od.mainFactoryId);
  if (mainFromOrder) return mainFromOrder;
  const mainId = pickString(project?.main_factory_id);
  if (mainId) return mainId;
  return candidates[0] || '';
}

export function isOrderVisibleToFactory(order: OrderLike, factoryId: string, ctx: EscalationPushContext): boolean {
  const fid = pickString(factoryId);
  if (!fid) return false;

  const rejectedIds = rejectedFactoryIdSet(order);
  if (rejectedIds.has(fid)) return false;

  const od = orderData(order);
  const status = pickString(order?.status, od.status);
  if (status === 'deleted' || status === 'pending_association') return false;

  const assigned = pickString(order?.factory_site_id, od.factory_site_id, od.factorySiteId);
  if (assigned) return assigned === fid;

  const consultStatus = pickString(order?.factory_consult_status, od.factory_consult_status, od.factoryConsultStatus);
  if (consultStatus === 'consulting' && status !== 'accepted') {
    const consultBy = pickString(order?.factory_consult_by_factory_id, od.factory_consult_by_factory_id, od.factoryConsultByFactoryId);
    return Boolean(consultBy) && fid === consultBy;
  }

  const associationPool = associationAssignedFactoryIds(order);
  if (associationPool.length > 0 && status === 'pending') {
    return associationPool.includes(fid);
  }

  const isSpot = Boolean(order?.is_spot ?? od.is_spot);
  const pid = orderProjectId(order);
  const project = pid && !isSpot ? ctx.projectById[pid] : null;

  if (status === 'accepted') {
    if (!assigned) return false;
    if (!isSpot) {
      const preferredId = orderPreferredFactoryId(order);
      const mainId = pickString(project?.main_factory_id);
      const subIds = asArray(project?.sub_factory_ids).map((x) => pickString(x)).filter(Boolean);
      return assigned === fid || [preferredId, mainId, ...subIds].includes(fid);
    }
    return true;
  }

  const effectiveMinutes = getEffectiveEscalationMinutes(order, ctx);
  if (effectiveMinutes == null) return false;

  const candidates = buildCandidateFactoryIds(order, ctx);
  const anchorId = resolveEscalationAnchorFactoryId(order, project, candidates);
  const steps = getEscalationStepsForAnchor(anchorId, ctx.escalationStepsByFactoryId);
  const active = getActiveEscalationStep(steps, effectiveMinutes);
  const visibleCount = Math.max(1, Number(active.target_factory_count) || 3);
  const visibleIds = candidates.slice(0, visibleCount);
  return visibleIds.includes(fid);
}

function getVisibleFactoryIdsForOrder(order: OrderLike, ctx: EscalationPushContext): string[] {
  const status = pickString(order?.status, orderData(order).status);
  if (status === 'deleted' || status === 'pending_association') return [];

  const known = (ctx.factories || [])
    .map((f) => pickString(f.id))
    .filter(Boolean);

  return known.filter((fid) => isOrderVisibleToFactory(order, fid, ctx));
}

/** rejected_factory_ids 更新前後で新たに公開対象になった工場 ID */
export function computeNewlyVisibleFactoryIds(
  oldRow: OrderLike,
  newRow: OrderLike,
  ctx: EscalationPushContext,
): string[] {
  const oldVisible = new Set(getVisibleFactoryIdsForOrder(oldRow, ctx));
  const newVisible = getVisibleFactoryIdsForOrder(newRow, ctx);
  const rejected = rejectedFactoryIdSet(newRow);
  return newVisible.filter((id) => !oldVisible.has(id) && !rejected.has(id));
}
