import { describe, expect, it } from 'vitest';
import {
  addDaysIso,
  attachReservationGroupFromRow,
  defaultReservationDayDates,
  mergeReservationGroupFields,
  nextReservationDate,
  parseSubmitReservationGroupResult,
  reservationDayCountError,
  reservationGroupMonitorBadgeText,
  reservationGroupStatusLabel,
  siblingReservationFactoryLine,
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

  it('attaches reservation_groups embed object or array without changing other fields', () => {
    const fromObject = attachReservationGroupFromRow({
      id: 'ord_1',
      reservation_group_id: 'grp_1',
      reservation_groups: { id: 'grp_1', status: 'conflict', same_factory_required: true },
    });
    expect(fromObject).toEqual({
      reservation_group_id: 'grp_1',
      reservation_group: { id: 'grp_1', status: 'conflict', same_factory_required: true },
    });
    const fromArray = attachReservationGroupFromRow({
      reservation_group_id: 'grp_2',
      reservation_groups: [{ id: 'grp_2', status: 'pending' }],
    });
    expect(fromArray.reservation_group).toEqual({
      id: 'grp_2',
      status: 'pending',
      same_factory_required: false,
    });
    expect(attachReservationGroupFromRow({ id: 'ord_plain' })).toEqual({
      reservation_group_id: '',
      reservation_group: null,
    });
  });

  it('keeps reservation group fields when an order update omits them', () => {
    const prev = {
      id: 'ord_1',
      status: 'pending',
      reservation_group_id: 'grp_1',
      reservation_group: { id: 'grp_1', status: 'matched', same_factory_required: true },
    };
    const merged = mergeReservationGroupFields({ id: 'ord_1', status: 'accepted' }, prev);
    expect(merged.status).toBe('accepted');
    expect(merged.reservation_group_id).toBe('grp_1');
    expect(merged.reservation_group.status).toBe('matched');
  });

  it('builds monitor badge text and sibling factory lines', () => {
    expect(reservationGroupMonitorBadgeText('pending')).toBe('予約グループ：回答待ち');
    expect(reservationGroupMonitorBadgeText('matched')).toBe('予約グループ：確定');
    expect(reservationGroupMonitorBadgeText('conflict')).toBe('予約グループ：要調整');
    expect(
      siblingReservationFactoryLine(
        { accepted_at: '2026-09-10T00:00:00Z', factory_site_id: 'f1' },
        { f1: '第一工場' },
      ),
    ).toBe('確定工場: 第一工場');
    expect(
      siblingReservationFactoryLine(
        { status: 'pending', preferred_factory_id: 'f2' },
        { f2: '第二工場' },
      ),
    ).toBe('未確定（第一希望: 第二工場）');
  });
});
