import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  defaultReservationDayDates,
  parseSubmitReservationGroupResult,
  reservationGroupStatusLabel,
} from './reservationGroup.js';

describe('reservationGroup helpers', () => {
  it('labels pending / matched / conflict', () => {
    expect(reservationGroupStatusLabel('pending')).toBe('回答待ち');
    expect(reservationGroupStatusLabel('matched')).toBe('確定');
    expect(reservationGroupStatusLabel('conflict')).toBe('要調整');
  });

  it('parses submit_guest_reservation_group json', () => {
    const parsed = parseSubmitReservationGroupResult({
      group_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      orders: [{ id: 'ord_1' }, { id: 'ord_2' }, { id: 'ord_3' }],
    });
    expect(parsed.groupId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(parsed.orderIds).toEqual(['ord_1', 'ord_2', 'ord_3']);
  });

  it('builds three consecutive default dates', () => {
    expect(defaultReservationDayDates('2026-09-10')).toEqual([
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
    ]);
    expect(addDaysIso('2026-09-30', 1)).toBe('2026-10-01');
  });
});
