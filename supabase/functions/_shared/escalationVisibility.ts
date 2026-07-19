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
  preferred_factory_declined_at?: string | null;
  preferred_factory_choice?: string | null;
  escalation_approved_at?: string | null;
  factory_site_id?: string | null;
  factory_consult_status?: string | null;
  factory_consult_by_factory_id?: string | null;
  is_spot?: boolean | null;
  delivery_lat?: number | string | null;
  delivery_lng?: number | string | null;
  rejected_factory_ids?: unknown;
  association_assigned_factory_ids?: unknown;
  sub_factory_current_index?: number | null;
  push_notified_map?: Record<string, string> | null;
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
  sales_admin_id?: string | null;
};

export type EscalationPushContext = {
  factories: FactoryLike[];
  projectById: Record<string, ProjectLike>;
  settings: { start_time?: string; end_time?: string };
  holidays: Array<{ holiday_date?: string } | string>;
  escalationStepsByFactoryId: Record<string, EscalationStep[]>;
  monthlyVolumeByFactory: Record<string, number>;
  distanceWeight: number;
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

/** ユーザーが第一希望工場を明示指定したか（フロント isUserSpecifiedPreferredFactory と同等） */
export function isUserSpecifiedPreferredFactory(order?: OrderLike | null): boolean {
  if (!order || typeof order !== 'object') return false;
  const od = orderData(order);
  if (od.preferred_factory_user_specified === true) return true;
  if (od.preferredFactoryUserSpecified === true) return true;
  if ((order as Record<string, unknown>).preferred_factory_user_specified === true) return true;
  if ((order as Record<string, unknown>).preferredFactoryUserSpecified === true) return true;
  const pid = orderProjectId(order);
  if (pid && orderPreferredFactoryId(order)) return true;
  return false;
}

export function orderEscalationApprovedAt(order?: OrderLike | null): string {
  const od = orderData(order);
  return pickString(
    order?.escalation_approved_at,
    od.escalation_approved_at,
    od.escalationApprovedAt,
  );
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

  const approvedAt = orderEscalationApprovedAt(order);
  const created = approvedAt || orderCreatedAt(order);
  if (!created) return 0;
  const minutes = getElapsedMinutesSinceEffectiveStart(created, ctx.settings, ctx.holidays, ctx.now ?? new Date());

  if (approvedAt) return minutes;

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

function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number | string | null | undefined,
  lng2: number | string | null | undefined,
): number {
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

/** factory_escalation_steps 行から月次出荷量マップを組み立て（step_number 最小を採用） */
export function buildMonthlyVolumeByFactoryFromRows(rows: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  const sorted = asArray(rows).slice().sort((a, b) => {
    const ao = asObject(a);
    const bo = asObject(b);
    const fa = pickString(ao.factory_id);
    const fb = pickString(bo.factory_id);
    if (fa !== fb) return fa.localeCompare(fb);
    return (Number(ao.step_number) || 0) - (Number(bo.step_number) || 0);
  });
  for (const row of sorted) {
    const o = asObject(row);
    const fid = pickString(o.factory_id);
    if (!fid || out[fid] !== undefined) continue;
    out[fid] = o.monthly_volume_m3 != null && Number.isFinite(Number(o.monthly_volume_m3))
      ? Number(o.monthly_volume_m3)
      : 0;
  }
  return out;
}

/** distance_weight 設定行からウェイトを取得（未設定時 0.7） */
export function parseEscalationDistanceWeight(row: unknown): number {
  const o = asObject(row);
  const w = o.distance_weight;
  return w != null && Number.isFinite(Number(w)) ? Number(w) : 0.7;
}

/** 距離・容量スコアの高い順に工場 ID を並べる（escalationUtils.rankFactoryIdsByDistance と同等） */
export function rankFactoryIdsByDistance(
  order: OrderLike,
  projectById: Record<string, ProjectLike>,
  siteCoords: { lat: number; lng: number } | null,
  factories: FactoryLike[],
  monthlyVolumeByFactory: Record<string, number> = {},
  distanceWeight = 0.7,
): string[] {
  const list = Array.isArray(factories) ? factories : [];
  const eligibleWithFallback = list;

  const items = eligibleWithFallback
    .map((f) => {
      const id = String(f?.id ?? '').trim();
      if (!id) return null;
      const dist = siteCoords
        ? calculateDistance(siteCoords.lat, siteCoords.lng, f.latitude, f.longitude)
        : Infinity;
      const rawVol = monthlyVolumeByFactory[id];
      const vol = rawVol !== undefined && rawVol !== null ? Number(rawVol) : null;
      return { id, dist, vol };
    })
    .filter((x): x is { id: string; dist: number; vol: number | null } => Boolean(x));

  const maxDist = Math.max(...items.map((x) => x.dist).filter(Number.isFinite), 1);
  const volValues = items.map((x) => x.vol).filter((v): v is number => v != null);
  const maxVol = volValues.length > 0 ? Math.max(...volValues) : 1;
  const capWeight = 1 - distanceWeight;

  const scored = items
    .map((x) => {
      const dScore = Number.isFinite(x.dist) ? 1 - x.dist / maxDist : 0;
      const cScore = x.vol != null ? 1 - x.vol / maxVol : 0.5;
      const total = dScore * distanceWeight + cScore * capWeight;
      return { ...x, total };
    })
    .sort((a, b) => b.total - a.total || a.id.localeCompare(b.id));

  const ids = scored.map((x) => x.id);

  console.log('[escalationVisibility] DISTANCE scored', {
    orderId: pickString(order.id, orderData(order).id),
    distanceWeight,
    capWeight,
    top3: scored.slice(0, 3).map((x) => ({
      id: x.id,
      dist: Number.isFinite(x.dist) ? x.dist.toFixed(1) : x.dist,
      vol: x.vol,
      score: x.total?.toFixed(3),
    })),
  });

  if (ids.length) return ids;
  return list.map((f) => pickString(f.id)).filter(Boolean);
}

function sortFactoryIdsByDistance(
  order: OrderLike,
  ctx: EscalationPushContext,
  monthlyVolumeByFactory?: Record<string, number>,
  distanceWeight?: number,
): string[] {
  const vol = monthlyVolumeByFactory ?? ctx.monthlyVolumeByFactory ?? {};
  const weight = distanceWeight ?? ctx.distanceWeight ?? 0.7;
  const siteCoords = getOrderSiteCoords(order, ctx.projectById);
  return rankFactoryIdsByDistance(order, ctx.projectById, siteCoords, ctx.factories, vol, weight);
}

/** escalationUtils.rankFactoryIdsForOrder の Edge 向け簡易版（距離ベースのみ） */
export function rankFactoryIdsForOrder(
  order: OrderLike,
  ctx: EscalationPushContext,
  monthlyVolumeByFactory?: Record<string, number>,
  distanceWeight?: number,
): string[] {
  return buildCandidateFactoryIds(order, ctx, monthlyVolumeByFactory, distanceWeight);
}

/** escalationUtils.buildCandidateFactoryIds と同等 */
export function buildCandidateFactoryIds(
  order: OrderLike,
  ctx: EscalationPushContext,
  monthlyVolumeByFactory?: Record<string, number>,
  distanceWeight?: number,
): string[] {
  const rejectedIds = rejectedFactoryIdSet(order);
  const preferredId = orderPreferredFactoryId(order);
  const approvedAt = orderEscalationApprovedAt(order);

  // 第一希望指定かつ未許可: 第一希望のみ（拒否済みなら候補ゼロ＝顧客選択待ち）
  if (isUserSpecifiedPreferredFactory(order) && !approvedAt) {
    if (!preferredId) return [];
    return rejectedIds.has(preferredId) ? [] : [preferredId];
  }

  const known = (ctx.factories || [])
    .map((f) => pickString(f.id))
    .filter(Boolean);
  const knownSet = new Set(known);
  const od = orderData(order);
  const pid = orderProjectId(order);
  const project = pid ? ctx.projectById[pid] : null;

  const vipIds = [
    preferredId,
    pickString(od.main_factory_id, od.mainFactoryId),
    pickString(project?.main_factory_id),
  ].filter((id) => id && knownSet.has(id));

  const subSource = od.sub_factory_ids ?? od.subFactoryIds ?? project?.sub_factory_ids ?? [];
  const subIds = asArray(subSource)
    .map((x) => pickString(x))
    .filter((id) => id && knownSet.has(id));

  const vol = monthlyVolumeByFactory ?? ctx.monthlyVolumeByFactory ?? {};
  const weight = distanceWeight ?? ctx.distanceWeight ?? 0.7;
  const sortedByDistance = sortFactoryIdsByDistance(order, ctx, vol, weight);
  const candidates: string[] = [];
  const seen = new Set<string>();
  for (const id of [...vipIds, ...subIds, ...sortedByDistance]) {
    if (!id || seen.has(id) || rejectedIds.has(id)) continue;
    candidates.push(id);
    seen.add(id);
  }

  if (!candidates.length && known.length) {
    if (preferredId && knownSet.has(preferredId)) return [preferredId];
    const mainId = pickString(project?.main_factory_id);
    if (mainId && knownSet.has(mainId)) return [mainId];
    return [...known];
  }

  return candidates;
}

function normalizeSubFactoryIds(raw: unknown): string[] {
  return asArray(raw).map((x) => pickString(x)).filter(Boolean);
}

function assignedProjectSubIndex(order?: OrderLike | null): number {
  const preferredId = pickString(order?.preferred_factory_id);
  const approvedAt = orderEscalationApprovedAt(order);
  // 第一希望ゲート中はサブインデックスを -1
  if (preferredId && isUserSpecifiedPreferredFactory(order) && !approvedAt) {
    return -1;
  }
  const od = orderData(order);
  const raw = order?.sub_factory_current_index ?? od.sub_factory_current_index ?? od.subFactoryCurrentIndex;
  if (raw == null || raw === '') return -1;
  const n = Number(raw);
  return Number.isFinite(n) ? n : -1;
}

function isAssignedProject(order: OrderLike, project: ProjectLike | null | undefined): boolean {
  if (!order || !project) return false;
  const od = orderData(order);
  if (Boolean(order.is_spot ?? od.is_spot)) return false;
  if (!orderProjectId(order)) return false;
  if (associationAssignedFactoryIds(order).length > 0) return false;
  const mainId = pickString(project.main_factory_id);
  const subIds = normalizeSubFactoryIds(project.sub_factory_ids);
  return Boolean(mainId) || subIds.length > 0;
}

function isOrderVisibleToAssignedProjectFactory(
  order: OrderLike,
  project: ProjectLike,
  factoryId: string,
): boolean {
  const fid = pickString(factoryId);
  if (!fid) return false;

  const preferredId = pickString(order?.preferred_factory_id);
  const approvedAt = orderEscalationApprovedAt(order);
  const rejectedIds = rejectedFactoryIdSet(order);

  // 第一希望指定かつ未許可: 第一希望のみ（拒否済みなら誰にも非公開）
  if (preferredId && isUserSpecifiedPreferredFactory(order) && !approvedAt) {
    if (rejectedIds.has(preferredId)) return false;
    return fid === preferredId;
  }

  const mainId = pickString(project.main_factory_id);
  const subIds = normalizeSubFactoryIds(project.sub_factory_ids);
  const currentSubIndex = assignedProjectSubIndex(order);

  if (mainId && !rejectedIds.has(mainId)) return fid === mainId;
  if (currentSubIndex >= 0 && currentSubIndex < subIds.length) return fid === subIds[currentSubIndex];
  return false;
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
  if (status === 'awaiting_admin_followup') return false;

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

  if (isAssignedProject(order, project) && status === 'pending') {
    return isOrderVisibleToAssignedProjectFactory(order, project!, fid);
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
