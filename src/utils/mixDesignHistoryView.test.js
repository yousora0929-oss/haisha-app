import { describe, expect, it } from 'vitest';
import {
  filterMixDesignHistoryRows,
  groupActiveMixDesignHistory,
  isMixDesignHistoryDone,
  mixDesignHistoryNeedsAttention,
  mixDesignHistoryTabCounts,
  mixDesignStatusBadgeClass,
} from './mixDesignHistoryView.js';

const rows = [
  { id: '1', status: 'in_progress', created_at: '2026-10-01T00:00:00Z' },
  { id: '2', status: 'completed', created_at: '2026-10-03T00:00:00Z' },
  { id: '3', status: 'requested', created_at: '2026-10-02T00:00:00Z' },
  { id: '4', status: 'submitted', created_at: '2026-10-04T00:00:00Z' },
  { id: '5', status: 'not_started', created_at: '2026-09-01T00:00:00Z' },
  { id: '6', status: 'requested', created_at: '2026-10-05T00:00:00Z' },
];

describe('mix design history tabs', () => {
  it('treats 完成 and 提出済み as done and keeps earlier stages active', () => {
    expect(isMixDesignHistoryDone('not_started')).toBe(false);
    expect(isMixDesignHistoryDone('requested')).toBe(false);
    expect(isMixDesignHistoryDone('in_progress')).toBe(false);
    expect(isMixDesignHistoryDone('completed')).toBe(true);
    expect(isMixDesignHistoryDone('submitted')).toBe(true);
  });

  it('counts the already filtered rows per tab', () => {
    expect(mixDesignHistoryTabCounts(rows)).toEqual({ active: 4, done: 2, all: 6 });
    expect(filterMixDesignHistoryRows(rows, 'done').map((row) => row.id)).toEqual(['2', '4']);
    expect(filterMixDesignHistoryRows(rows, 'all')).toHaveLength(6);
  });

  it('groups active rows by existing status order and drops empty sections', () => {
    const sections = groupActiveMixDesignHistory(rows);
    expect(sections.map((section) => section.status)).toEqual([
      'not_started',
      'requested',
      'in_progress',
    ]);
    expect(sections.map((section) => section.label)).toEqual(['保留中', '依頼中', '作成中']);
    expect(sections.find((section) => section.status === 'requested')?.rows.map((row) => row.id)).toEqual([
      '6',
      '3',
    ]);
    expect(sections.find((section) => section.status === 'not_started')?.attention).toBe(true);
    expect(sections.find((section) => section.status === 'requested')?.attention).toBe(true);
    expect(sections.find((section) => section.status === 'in_progress')?.attention).toBe(false);
    expect(mixDesignHistoryNeedsAttention('completed')).toBe(false);
  });

  it('gives each status its own badge class and keeps a text label available', () => {
    const classes = ['not_started', 'requested', 'in_progress', 'completed', 'submitted'].map(
      mixDesignStatusBadgeClass,
    );
    expect(new Set(classes).size).toBe(5);
  });
});
