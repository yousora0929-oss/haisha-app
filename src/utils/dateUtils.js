/** @param {string} timeStr - "HH:MM" or "HH:MM:SS" */
function parseTimeToMinutes(timeStr) {
  const m = String(timeStr || '08:00:00').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return 8 * 60;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function toLocalDateISO(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}`;
}

function holidayDateSet(holidays) {
  const set = new Set();
  for (const h of holidays || []) {
    const d =
      typeof h === 'string'
        ? h.slice(0, 10)
        : h && h.holiday_date != null
          ? String(h.holiday_date).slice(0, 10)
          : '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) set.add(d);
  }
  return set;
}

/** 日曜または holidays テーブル上の休日 */
function isNonBusinessDay(d, holidaySet) {
  if (d.getDay() === 0) return true;
  return holidaySet.has(toLocalDateISO(d));
}

/**
 * 翌営業日の稼働開始時刻（日曜・休日をスキップ）
 * @param {Date} from
 * @param {number} startMinutes
 * @param {Set<string>} holidaySet
 */
function nextBusinessDayAtStart(from, startMinutes, holidaySet) {
  const next = new Date(from);
  next.setDate(next.getDate() + 1);
  next.setHours(0, 0, 0, 0);
  while (isNonBusinessDay(next, holidaySet)) {
    next.setDate(next.getDate() + 1);
  }
  next.setHours(Math.floor(startMinutes / 60), startMinutes % 60, 0, 0);
  return next;
}

/**
 * エスカレーション起算時刻 T=0
 * - 日曜は定休
 * - holidays 登録日は休日
 * - 稼働終了（既定 16:00）以降 → 翌営業日 08:00
 * - 稼働開始前 → 当日 08:00（営業日の場合）
 *
 * @param {string|Date} createdAt
 * @param {{ start_time?: string, end_time?: string }} settings
 * @param {Array<{ holiday_date?: string }>|string[]} holidays
 * @returns {Date}
 */
export function getEffectiveStartTime(createdAt, settings, holidays) {
  const parsed = createdAt instanceof Date ? new Date(createdAt.getTime()) : new Date(createdAt);
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

  if (dayMinutes >= endMin) {
    return nextBusinessDayAtStart(parsed, startMin, holidaySet);
  }

  if (dayMinutes < startMin) {
    const start = new Date(parsed);
    start.setHours(Math.floor(startMin / 60), startMin % 60, 0, 0);
    return start;
  }

  return parsed;
}

/**
 * 起算時刻からの経過分数
 * @param {string|Date} createdAt
 * @param {{ start_time?: string, end_time?: string }} settings
 * @param {Array|Set} holidays
 * @param {Date} [now]
 */
export function getElapsedMinutesSinceEffectiveStart(createdAt, settings, holidays, now = new Date()) {
  const start = getEffectiveStartTime(createdAt, settings, holidays);
  return Math.max(0, Math.floor((now.getTime() - start.getTime()) / 60000));
}
