import { describe, expect, it } from 'vitest';
import {
  formatOrderDateTimeSummary,
  resolveInProgressGroupStorageId,
  resolveNearestUpcomingOrder,
} from './orderGrouping.js';

describe('orderGrouping in-progress collapse helpers', () => {
  it('prefers project id for group storage key', () => {
    expect(
      resolveInProgressGroupStorageId({
        type: 'group',
        key: 'site:A現場',
        site: 'A現場',
        orders: [
          { id: '1', project_id: 'proj-1', preferredDate: '2026-07-28' },
          { id: '2', projectId: 'proj-1', preferredDate: '2026-07-29' },
        ],
      }),
    ).toBe('project:proj-1');
  });

  it('falls back to site key when project ids differ', () => {
    expect(
      resolveInProgressGroupStorageId({
        type: 'group',
        key: 'site:A現場',
        site: 'A現場',
        orders: [
          { id: '1', project_id: 'proj-1' },
          { id: '2', project_id: 'proj-2' },
        ],
      }),
    ).toBe('site:A現場');
  });

  it('picks nearest upcoming order, else latest past', () => {
    const now = Date.parse('2026-07-28T09:00:00');
    const upcoming = resolveNearestUpcomingOrder(
      [
        { preferredDate: '2026-07-27', timeSlotMinutes: 600, timePointLabel: '10:00' },
        { preferredDate: '2026-07-28', timeSlotMinutes: 630, timePointLabel: '10:30' },
        { preferredDate: '2026-07-29', timeSlotMinutes: 480, timePointLabel: '8:00' },
      ],
      now,
    );
    expect(formatOrderDateTimeSummary(upcoming)).toBe('2026/7/28 · 10:30');

    const pastOnly = resolveNearestUpcomingOrder(
      [
        { preferredDate: '2026-07-26', timeSlotMinutes: 600, timePointLabel: '10:00' },
        { preferredDate: '2026-07-27', timeSlotMinutes: 480, timePointLabel: '8:00' },
      ],
      now,
    );
    expect(formatOrderDateTimeSummary(pastOnly)).toBe('2026/7/27 · 8:00');
  });
});
