/** 管理者向け order_priority_snapshots 表示ヘルパー */

const REASON_LABELS = {
  created: '受付時',
  coords_resolved: '現場位置確定時',
  escalation_approved: '拡大承認時',
};

/** JST の M/D HH:mm（orderAuditDisplay と同形式） */
export function formatPriorityDateTimeJst(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Tokyo',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(d);
  const get = (type) => parts.find((p) => p.type === type)?.value || '';
  const month = String(Number(get('month')));
  const day = String(Number(get('day')));
  let hour = get('hour');
  if (hour === '24') hour = '00';
  const minute = get('minute');
  return `${month}/${day} ${hour}:${minute}`;
}

export function snapshotReasonLabel(reason) {
  const key = String(reason || '').trim();
  return REASON_LABELS[key] || key || '—';
}

/**
 * 公開の目安ラベル
 * @param {number|null|undefined} visibleFromMinutes
 * @param {string|null|undefined} effectiveStartAt ISO
 */
export function formatVisibleFromLabel(visibleFromMinutes, effectiveStartAt) {
  if (visibleFromMinutes == null || visibleFromMinutes === '') return '—';
  const mins = Number(visibleFromMinutes);
  if (!Number.isFinite(mins)) return '—';
  if (mins === 0) return '受付直後';
  const start = effectiveStartAt ? new Date(effectiveStartAt) : null;
  if (!start || Number.isNaN(start.getTime())) return '—';
  const at = new Date(start.getTime() + mins * 60 * 1000);
  return formatPriorityDateTimeJst(at.toISOString());
}

/**
 * 段階設定チップ: 「0分:1社 → 10分:3社 → …」
 * @param {Array<{ trigger_minutes?: number, target_factory_count?: number }>|null|undefined} steps
 */
export function formatEscalationStepsChip(steps) {
  const list = Array.isArray(steps) ? steps.filter(Boolean) : [];
  if (!list.length) return '';
  const sorted = [...list].sort(
    (a, b) =>
      (Number(a.trigger_minutes) || 0) - (Number(b.trigger_minutes) || 0) ||
      (Number(a.step_number) || 0) - (Number(b.step_number) || 0),
  );
  return sorted
    .map((s) => {
      const mins = Number(s.trigger_minutes) || 0;
      const count = Math.max(1, Number(s.target_factory_count) || 1);
      return `${mins}分:${count}社`;
    })
    .join(' → ');
}

export function formatSnapshotDistanceKm(distanceKm) {
  if (distanceKm == null || distanceKm === '') return '—';
  const n = Number(distanceKm);
  if (!Number.isFinite(n)) return '—';
  return String(n);
}

export function formatSnapshotMonthlyVolume(volume) {
  if (volume == null || volume === '') return '—';
  const n = Number(volume);
  if (!Number.isFinite(n)) return '—';
  return String(n);
}

/**
 * 辞退バッジ対象か（ブロックAの factory_declined 行に工場が含まれる）
 * @param {string} factoryId
 * @param {Array<{ event_type?: string, factory_id?: string }>|null|undefined} declineLogs
 */
export function isFactoryDeclinedInAudit(factoryId, declineLogs) {
  const fid = String(factoryId || '').trim();
  if (!fid) return false;
  const list = Array.isArray(declineLogs) ? declineLogs : [];
  return list.some(
    (row) =>
      String(row?.event_type || '') === 'factory_declined' &&
      String(row?.factory_id || '').trim() === fid,
  );
}

/**
 * computed_at 昇順のスナップショットから、既定で選択する最新インデックス
 * @param {Array<{ computed_at?: string }>|null|undefined} snapshots
 */
export function defaultSnapshotIndex(snapshots) {
  const list = Array.isArray(snapshots) ? snapshots : [];
  if (!list.length) return 0;
  return list.length - 1;
}
