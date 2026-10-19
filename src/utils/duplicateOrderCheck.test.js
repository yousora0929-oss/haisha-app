import { describe, expect, it, vi } from 'vitest';
import {
  buildDuplicateOrderQueries,
  collectDuplicateMonitorKeys,
  duplicateMonitorKey,
  duplicateOrderStatusLabel,
  duplicateProceedBlocked,
  duplicateWarningLevel,
  fetchDuplicateOrderWarnings,
  formatDuplicateOrderDateLabel,
  formatDuplicateOrderLine,
  groupDuplicateRowsByDate,
} from './duplicateOrderCheck.js';

describe('formatDuplicateOrderLine', () => {
  it('formats an accepted cooperative order with the customer weekday date', () => {
    expect(formatDuplicateOrderDateLabel('2026-10-14')).toBe('10/14㈬');
    expect(
      formatDuplicateOrderLine({
        pour_date: '2026-10-14',
        time_label: '8:00',
        mix: '18-8-20BB',
        quantity_m3: 3,
        status: 'accepted',
        factory_name: '恵藤建設㈱ 千歳生コン',
        relation: 'cooperative',
        level: 'strong',
      }),
    ).toBe('10/14㈬ 8:00　18-8-20BB　3m³　受注済み（恵藤建設㈱ 千歳生コン）　（組合の代理発注）');
  });

  it('formats a pending self order and treats a blank time as 時刻未定', () => {
    expect(
      formatDuplicateOrderLine({
        pour_date: '2026-07-19',
        time_label: '',
        mix: '18-8-20BB',
        quantity_m3: '3.0',
        status: 'pending',
        factory_name: null,
        relation: 'self',
        level: 'notice',
      }),
    ).toBe('7/19㈰ 時刻未定　18-8-20BB　3m³　回答待ち　（あなたの注文）');
  });

  it('uses the existing customer label for non-accepted statuses', () => {
    expect(duplicateOrderStatusLabel('pending_association', null)).toBe('組合承認待ち');
    expect(duplicateOrderStatusLabel('rejected', '')).toBe('お受けできず');
    expect(duplicateOrderStatusLabel('confirmed', 'A工場')).toBe('受注済み（A工場）');
  });
});

describe('duplicate warning level', () => {
  it('is strong when any row is strong, otherwise notice', () => {
    expect(duplicateWarningLevel([])).toBeNull();
    expect(duplicateWarningLevel([{ level: 'notice' }])).toBe('notice');
    expect(duplicateWarningLevel([{ level: 'notice' }, { level: 'strong' }])).toBe('strong');
    expect(duplicateProceedBlocked([{ level: 'strong' }], false)).toBe(true);
    expect(duplicateProceedBlocked([{ level: 'strong' }], true)).toBe(false);
    expect(duplicateProceedBlocked([{ level: 'notice' }], false)).toBe(false);
  });

  it('groups lines by pour date', () => {
    const groups = groupDuplicateRowsByDate([
      { pour_date: '2026-07-20', time_label: '8:00' },
      { pour_date: '2026-07-19', time_label: '8:00' },
      { pour_date: '2026-07-19', time_label: '13:00' },
    ]);
    expect(groups.map((group) => group.date)).toEqual(['2026-07-20', '2026-07-19']);
    expect(groups[1].rows).toHaveLength(2);
    expect(groups[1].label).toBe('7/19㈰');
  });
});

describe('buildDuplicateOrderQueries', () => {
  it('sends every cart date in one call when mix and time match', () => {
    const queries = buildDuplicateOrderQueries(
      [
        {
          project_id: 'proj-1',
          preferredDate: '2026-07-19',
          mixText: '18-8-20BB',
          timePointLabel: '8:00',
          siteAddress: '千歳市',
        },
        {
          projectId: 'proj-1',
          scheduleMatchDate: '2026-07-20',
          mixText: '18-8-20BB',
          timePointLabel: '8:00',
        },
      ],
      { contractorCustomerId: 'contractor-1', excludeOrderId: 'ord-9' },
    );
    expect(queries).toEqual([
      {
        projectId: 'proj-1',
        siteKey: null,
        dates: ['2026-07-19', '2026-07-20'],
        mix: '18-8-20BB',
        timeLabel: '8:00',
        contractorCustomerId: 'contractor-1',
        excludeOrderId: 'ord-9',
      },
    ]);
  });

  it('splits calls when the time differs and uses address then site name without a project', () => {
    const queries = buildDuplicateOrderQueries([
      { preferredDate: '2026-07-19', mixText: '18-8-20BB', timePointLabel: '8:00', siteAddress: '千歳市' },
      { preferredDate: '2026-07-19', mixText: '18-8-20BB', timePointLabel: '13:00', siteName: '現場A' },
    ]);
    expect(queries).toHaveLength(2);
    expect(queries[0].siteKey).toBe('千歳市');
    expect(queries[0].timeLabel).toBe('8:00');
    expect(queries[1].siteKey).toBe('現場A');
    expect(queries[1].projectId).toBeNull();
    expect(queries[1].contractorCustomerId).toBeNull();
    expect(queries[1].excludeOrderId).toBeNull();
  });

  it('fetches each query once and flattens rows', async () => {
    const check = vi.fn(async (query) => [{ pour_date: query.dates[0], level: 'notice' }]);
    const rows = await fetchDuplicateOrderWarnings(
      check,
      [
        { project_id: 'p', preferredDate: '2026-07-19', mixText: 'A', timePointLabel: '8:00' },
        { project_id: 'p', preferredDate: '2026-07-20', mixText: 'A', timePointLabel: '8:00' },
      ],
      {},
    );
    expect(check).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(1);
  });
});

describe('duplicate monitor keys', () => {
  it('flags the same project and pour date when two active orders exist', () => {
    const orders = [
      { id: '1', project_id: 'proj', preferredDate: '2026-07-19', status: 'pending' },
      { id: '2', project_id: 'proj', preferredDate: '2026-07-19', status: 'accepted' },
      { id: '3', project_id: 'proj', preferredDate: '2026-07-19', status: 'customer_cancelled' },
      { id: '4', project_id: 'proj', preferredDate: '2026-07-20', status: 'pending' },
      { id: '5', preferredDate: '2026-07-19', status: 'pending' },
    ];
    const keys = collectDuplicateMonitorKeys(orders);
    expect(keys.has(duplicateMonitorKey(orders[0]))).toBe(true);
    expect(keys.has(duplicateMonitorKey(orders[3]))).toBe(false);
    expect(duplicateMonitorKey(orders[4])).toBe('');
  });
});
