import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  defaultReservationDayDates,
  nextReservationDate,
  parseSubmitReservationGroupResult,
  reservationDayCountError,
  reservationGroupStatusLabel,
  RESERVATION_GROUP_MAX_DAYS,
  RESERVATION_GROUP_MIN_DAYS,
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

  it('builds consecutive default dates for a given count', () => {
    expect(defaultReservationDayDates('2026-09-10')).toEqual(['2026-09-10', '2026-09-11']);
    expect(defaultReservationDayDates('2026-09-10', 4)).toEqual([
      '2026-09-10',
      '2026-09-11',
      '2026-09-12',
      '2026-09-13',
    ]);
    expect(addDaysIso('2026-09-30', 1)).toBe('2026-10-01');
  });

  it('picks the next unused date when adding a day', () => {
    expect(nextReservationDate(['2026-09-10', '2026-09-11'], '2026-09-10')).toBe('2026-09-12');
    expect(nextReservationDate(['2026-09-12'], '2026-09-10')).toBe('2026-09-13');
  });

  it('validates reservation day count between 2 and 7', () => {
    expect(reservationDayCountError(2)).toBe('');
    expect(reservationDayCountError(7)).toBe('');
    expect(reservationDayCountError(1)).toContain(String(RESERVATION_GROUP_MIN_DAYS));
    expect(reservationDayCountError(8)).toContain(String(RESERVATION_GROUP_MAX_DAYS));
  });
});
