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
  is_spot?: boolean | null;
  delivery_lat?: number | string | null;
  delivery_lng?: number | string | null;
  rejected_factory_ids?: unknown;
  factory_consult_status?: string | null;
};

type FactoryLike = {
  id?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
};

type ProjectLike = {
  id?: string;
  main_factory_id?: string | null;
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
  return active || { step_number: 1, trigger_minutes: 0, target_factory_count: 1 };
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
  const plat = Number((project as { lat?: number })?.lat);
  const plng = Number((project as { lng?: number })?.lng);
  if (Number.isFinite(plat) && Number.isFinite(plng)) return { lat: plat, lng: plng };
  return null;
}

function rankFactoryIdsForOrder(order: OrderLike, ctx: EscalationPushContext): string[] {
  const known = (ctx.factories || [])
    .map((f) => pickString(f.id))
    .filter(Boolean);
  const preferredId = orderPreferredFactoryId(order);
  const siteCoords = getOrderSiteCoords(order, ctx.projectById);
  const od = orderData(order);
  const userSpecified =
    order.preferred_factory_user_specified === true ||
    od.preferred_factory_user_specified === true ||
    od.preferredFactoryUserSpecified === true;

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

  let ranked = rankedWithDist.map((x) => x.id);
  if (!ranked.length) ranked = [...known];

  if (userSpecified && preferredId && known.includes(preferredId)) {
    ranked = [preferredId, ...ranked.filter((id) => id !== preferredId)];
  }

  return ranked.length ? ranked : known;
}

function resolveEscalationAnchorFactoryId(
  order: OrderLike,
  project: ProjectLike | null | undefined,
  ranked: string[],
): string {
  const od = orderData(order);
  const userSpecified =
    order.preferred_factory_user_specified === true ||
    od.preferred_factory_user_specified === true ||
    od.preferredFactoryUserSpecified === true;
  const preferredId = userSpecified ? orderPreferredFactoryId(order) : '';
  if (preferredId) return preferredId;
  const mainId = pickString(project?.main_factory_id);
  if (mainId) return mainId;
  return ranked[0] || '';
}

function getVisibleFactoryIdsForOrder(order: OrderLike, ctx: EscalationPushContext): string[] {
  const status = pickString(order?.status, orderData(order).status);
  if (status === 'deleted' || status === 'pending_association') return [];
  const consultStatus = pickString(order?.factory_consult_status, orderData(order).factory_consult_status);
  if (consultStatus === 'consulting' && status !== 'accepted') return [];

  const assigned = pickString(order?.factory_site_id, orderData(order).factory_site_id, orderData(order).factorySiteId);
  if (status === 'accepted') return assigned ? [assigned] : [];
  if (assigned) return [assigned];

  const effectiveMinutes = getEffectiveEscalationMinutes(order, ctx);
  if (effectiveMinutes == null) return [];

  const pid = orderProjectId(order);
  const project = pid ? ctx.projectById[pid] : null;
  const ranked = rankFactoryIdsForOrder(order, ctx);
  const anchorId = resolveEscalationAnchorFactoryId(order, project, ranked);
  const steps = getEscalationStepsForAnchor(anchorId, ctx.escalationStepsByFactoryId);
  const active = getActiveEscalationStep(steps, effectiveMinutes);
  const count = Math.max(1, Number(active.target_factory_count) || 1);
  const rejected = rejectedFactoryIdSet(order);
  return ranked.slice(0, count).filter((id) => !rejected.has(id));
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
