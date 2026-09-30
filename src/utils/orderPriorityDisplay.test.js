import { describe, expect, it } from 'vitest';
import {
  defaultSnapshotIndex,
  formatEscalationStepsChip,
  formatPriorityDateTimeJst,
  formatSnapshotDistanceKm,
  formatVisibleFromLabel,
  isFactoryDeclinedInAudit,
  snapshotReasonLabel,
} from './orderPriorityDisplay.js';

describe('snapshotReasonLabel', () => {
  it('maps known reasons', () => {
    expect(snapshotReasonLabel('created')).toBe('受付時');
    expect(snapshotReasonLabel('coords_resolved')).toBe('現場位置確定時');
    expect(snapshotReasonLabel('escalation_approved')).toBe('拡大承認時');
  });
});

describe('formatVisibleFromLabel', () => {
  it('shows 受付直後 for 0 minutes', () => {
    expect(formatVisibleFromLabel(0, '2026-09-30T00:00:00.000Z')).toBe('受付直後');
  });

  it('shows — for null', () => {
    expect(formatVisibleFromLabel(null, '2026-09-30T00:00:00.000Z')).toBe('—');
    expect(formatVisibleFromLabel(10, null)).toBe('—');
  });

  it('adds minutes to effective_start_at in JST', () => {
    // 2026-09-30T00:00:00Z = 09:00 JST → +10min = 09:10 JST
    expect(formatVisibleFromLabel(10, '2026-09-30T00:00:00.000Z')).toBe('9/30 09:10');
  });
});

describe('formatEscalationStepsChip', () => {
  it('builds chip string', () => {
    expect(
      formatEscalationStepsChip([
        { step_number: 2, trigger_minutes: 10, target_factory_count: 3 },
        { step_number: 1, trigger_minutes: 0, target_factory_count: 1 },
        { step_number: 3, trigger_minutes: 15, target_factory_count: 5 },
      ]),
    ).toBe('0分:1社 → 10分:3社 → 15分:5社');
  });
});

describe('formatPriorityDateTimeJst', () => {
  it('formats M/D HH:mm in JST', () => {
    expect(formatPriorityDateTimeJst('2026-09-30T09:05:00.000Z')).toBe('9/30 18:05');
  });
});

describe('isFactoryDeclinedInAudit', () => {
  it('detects factory_declined only', () => {
    const logs = [
      { event_type: 'factory_declined', factory_id: 'f1' },
      { event_type: 'factory_decline_revoked', factory_id: 'f2' },
    ];
    expect(isFactoryDeclinedInAudit('f1', logs)).toBe(true);
    expect(isFactoryDeclinedInAudit('f2', logs)).toBe(false);
    expect(isFactoryDeclinedInAudit('f3', logs)).toBe(false);
  });
});

describe('formatSnapshotDistanceKm', () => {
  it('shows dash for null', () => {
    expect(formatSnapshotDistanceKm(null)).toBe('—');
    expect(formatSnapshotDistanceKm(12.3)).toBe('12.3');
  });
});

describe('defaultSnapshotIndex', () => {
  it('picks latest', () => {
    expect(defaultSnapshotIndex([])).toBe(0);
    expect(defaultSnapshotIndex([{ computed_at: 'a' }, { computed_at: 'b' }])).toBe(1);
  });
});
