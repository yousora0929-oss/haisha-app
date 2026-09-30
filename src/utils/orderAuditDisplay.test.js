import { describe, expect, it } from 'vitest';
import {
  auditFieldLabel,
  formatAuditChangeValue,
  formatAuditOccurredAtJst,
  formatDeclineActorNote,
  normalizeAuditChanges,
  splitAuditLogs,
} from './orderAuditDisplay.js';

describe('auditFieldLabel', () => {
  it('separates ordered_by and order_data.orderedBy', () => {
    expect(auditFieldLabel('ordered_by')).toEqual({ label: '発注アカウント', known: true });
    expect(auditFieldLabel('order_data.orderedBy')).toEqual({
      label: '現場担当者名',
      known: true,
    });
  });

  it('falls back to raw key for unknown fields', () => {
    expect(auditFieldLabel('order_data.weirdThing')).toEqual({
      label: 'order_data.weirdThing',
      known: false,
    });
  });
});

describe('formatAuditChangeValue', () => {
  it('handles omitted, null, and status labels', () => {
    expect(formatAuditChangeValue({ omitted: true })).toBe('（長文のため省略）');
    expect(formatAuditChangeValue(null)).toBe('（空）');
    expect(formatAuditChangeValue('accepted', 'status')).toBe('受注');
  });
});

describe('formatDeclineActorNote', () => {
  it('hides factory self and pre-record actors', () => {
    expect(
      formatDeclineActorNote({
        actor_role: 'factory',
        actor_id: 'f1',
        factory_id: 'f1',
        actor_name: '工場A',
      }),
    ).toBeNull();
    expect(
      formatDeclineActorNote({
        actor_role: 'admin',
        actor_name: '（記録開始前）',
      }),
    ).toBeNull();
    expect(formatDeclineActorNote({ actor_role: 'admin', actor_name: '管理者' })).toBe(
      '管理者が操作',
    );
    expect(formatDeclineActorNote({ actor_role: 'system' })).toBe(
      '自動（応答なしタイムアウト等）',
    );
  });
});

describe('splitAuditLogs', () => {
  it('splits decline and timeline events', () => {
    const { declines, timeline } = splitAuditLogs([
      { event_type: 'factory_declined' },
      { event_type: 'factory_decline_revoked' },
      { event_type: 'created' },
      { event_type: 'updated' },
      { event_type: 'status_changed' },
    ]);
    expect(declines).toHaveLength(2);
    expect(timeline).toHaveLength(3);
  });
});

describe('normalizeAuditChanges', () => {
  it('builds before → after rows', () => {
    const rows = normalizeAuditChanges([
      { field: 'status', before: 'pending', after: 'accepted' },
      { field: 'order_data.unknown_x', before: null, after: 'a' },
    ]);
    expect(rows[0].label).toBe('ステータス');
    expect(rows[0].beforeText).toBe('配車待ち');
    expect(rows[0].afterText).toBe('受注');
    expect(rows[1].known).toBe(false);
    expect(rows[1].beforeText).toBe('（空）');
  });
});

describe('formatAuditOccurredAtJst', () => {
  it('formats in JST as M/D HH:mm', () => {
    // 2026-09-30T09:05:00Z = 18:05 JST
    const text = formatAuditOccurredAtJst('2026-09-30T09:05:00.000Z');
    expect(text).toMatch(/^9\/30 18:05$/);
  });
});
