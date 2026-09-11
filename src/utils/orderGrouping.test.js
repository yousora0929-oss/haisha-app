import { describe, expect, it } from 'vitest';
import {
  formatOrderDateTimeSummary,
  groupOrdersBySiteForAssignedProjects,
  reservationGroupIdsFromOrders,
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

describe('groupOrdersBySiteForAssignedProjects reservation groups', () => {
  it('collects unique reservation_group_id in appearance order', () => {
    expect(
      reservationGroupIdsFromOrders([
        { id: '1', reservation_group_id: 'g-a' },
        { id: '2', reservation_group: { id: 'g-a' } },
        { id: '3', reservation_group_id: 'g-b' },
        { id: '4' },
      ]),
    ).toEqual(['g-a', 'g-b']);
  });

  it('puts reservation group orders into the same site group as other assigned orders', () => {
    const projectById = { 'proj-1': { main_factory_id: 'fac-1' } };
    const entries = groupOrdersBySiteForAssignedProjects(
      [
        {
          id: 'regular',
          project_id: 'proj-1',
          siteName: '北現場',
          preferredDate: '2026-09-12',
          timeSlotMinutes: 600,
        },
        {
          id: 'rg-1',
          project_id: 'proj-1',
          reservation_group_id: 'grp-9',
          siteName: '北現場',
          preferredDate: '2026-09-13',
          timeSlotMinutes: 540,
        },
        {
          id: 'rg-2',
          project_id: 'proj-1',
          reservation_group_id: 'grp-9',
          siteName: '北現場',
          preferredDate: '2026-09-14',
          timeSlotMinutes: 540,
        },
      ],
      projectById,
      { includeReservationGroups: true },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe('group');
    expect(entries[0].site).toBe('北現場');
    expect(entries[0].orders.map((o) => o.id)).toEqual(['rg-1', 'rg-2', 'regular']);
    expect(reservationGroupIdsFromOrders(entries[0].orders)).toEqual(['grp-9']);
  });

  it('groups reservation orders by site even without assigned factory', () => {
    const entries = groupOrdersBySiteForAssignedProjects(
      [
        {
          id: 'rg-1',
          reservation_group_id: 'grp-1',
          siteName: '南現場',
          preferredDate: '2026-09-12',
          timeSlotMinutes: 480,
        },
        {
          id: 'rg-2',
          reservation_group_id: 'grp-1',
          siteName: '南現場',
          preferredDate: '2026-09-13',
          timeSlotMinutes: 480,
        },
      ],
      {},
      { includeReservationGroups: true },
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].key).toBe('site:南現場');
    expect(entries[0].orders).toHaveLength(2);
  });
});
