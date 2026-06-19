export const DISPATCH_DEFAULT_FACTORY_SITE_NAME = 'A工場';
export const DISPATCH_DEFAULT_FACTORY_SITE_ID = 'FACTORY_A';

export const FACTORY_SITE_ID = 'FACTORY_A';
export const FACTORY_SITE_NAME = 'A工場';

export const SCHEDULE_BLOCK_IDS = ['am1', 'am2', 'pm1', 'pm2'];

export const SCHEDULE_BLOCKS = [
  { id: 'am1', label: '8:00 ～ 10:30', shortLabel: '午前 ①' },
  { id: 'am2', label: '10:30 ～ 12:00', shortLabel: '午前 ②' },
  { id: 'pm1', label: '13:00 ～ 13:59', shortLabel: '午後 ①' },
  { id: 'pm2', label: '14:00 ～ 15:30', shortLabel: '午後 ②' },
];

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function todayLocalISODate() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** 8:00, 8:30, … 15:30 まで30分刻み */
export function buildTimePointsHalfHour() {
  const slots = [];
  const fmt = (totalMin) => {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `${h}:${pad2(m)}`;
  };
  const endMin = 15 * 60 + 30;
  for (let m = 8 * 60; m <= endMin; m += 30) {
    slots.push({ value: String(m), label: fmt(m) });
  }
  return slots;
}

export const TIME_SLOTS = buildTimePointsHalfHour();

export function defaultEmptyDayBlocks() {
  const o = {};
  for (const id of SCHEDULE_BLOCK_IDS) {
    o[id] = { large: 'available', small: 'available' };
  }
  return o;
}

export function normalizeDayBlockSchedule(maybe) {
  const defaults = defaultEmptyDayBlocks();
  if (!maybe || typeof maybe !== 'object' || Array.isArray(maybe)) return defaults;
  const keys = Object.keys(maybe);
  if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) return defaults;
  const out = { ...defaults };
  for (const id of SCHEDULE_BLOCK_IDS) {
    const b = maybe[id];
    if (!b || typeof b !== 'object') continue;
    out[id] = {
      large: b.large === 'full' || b.large === 'available' ? b.large : defaults[id].large,
      small: b.small === 'full' || b.small === 'available' ? b.small : defaults[id].small,
    };
  }
  return out;
}

export function normalizeFullSchedule(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [dateKey, dayMap] of Object.entries(raw)) {
    if (typeof dateKey === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
      out[dateKey] = normalizeDayBlockSchedule(dayMap);
    }
  }
  return out;
}

export function getScheduleBlockIdForMinutes(totalMin) {
  if (!Number.isFinite(totalMin)) return null;
  if (totalMin >= 8 * 60 && totalMin <= 10 * 60 + 29) return 'am1';
  if (totalMin >= 10 * 60 + 30 && totalMin <= 12 * 60) return 'am2';
  if (totalMin >= 13 * 60 && totalMin <= 13 * 60 + 59) return 'pm1';
  if (totalMin >= 14 * 60 && totalMin <= 15 * 60 + 30) return 'pm2';
  return null;
}

export function getOrderVehicleScheduleKey(order) {
  if (order && order.vehicleType === 'small') return 'small';
  if (order && String(order.vehicleLabel || '').trim() === '小型') return 'small';
  return 'large';
}

export function getOrderMinutesForScheduleScan(order) {
  const m =
    order?.scheduleMatchMinutes ??
    order?.timeSlotMinutes ??
    (String(order?.timeSlot || '').match(/^\d+$/) ? parseInt(String(order.timeSlot), 10) : NaN);
  return Number.isFinite(m) ? m : NaN;
}

export function computeScheduleAutoRejectReason(order, dayBlocks) {
  const orderMins = getOrderMinutesForScheduleScan(order);
  if (!Number.isFinite(orderMins)) return null;
  const bid = getScheduleBlockIdForMinutes(orderMins);
  if (!bid) return null;
  const vk = getOrderVehicleScheduleKey(order);
  const block = dayBlocks[bid];
  if (!block || block[vk] !== 'full') return null;
  const meta = SCHEDULE_BLOCKS.find((b) => b.id === bid);
  const windowLabel = meta ? meta.label : bid;
  const vj = vk === 'small' ? '小型' : '大型';
  return `【自動】${windowLabel}・${vj}はただいま受入が難しい状況です`;
}

/** 今日を含む31日分の type=date 用 min/max */
export function getScheduleDateBoundsISO() {
  const start = todayLocalISODate();
  const [y0, m0, d0] = start.split('-').map(Number);
  const base = new Date(y0, m0 - 1, d0);
  const end = new Date(base);
  end.setDate(base.getDate() + 30);
  const maxIso = `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`;
  return { minIso: start, maxIso };
}
