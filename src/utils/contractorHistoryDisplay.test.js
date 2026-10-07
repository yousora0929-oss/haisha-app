import { describe, expect, it } from 'vitest';
import {
  OWN_COMPANY_HISTORY_NOTE,
  billingPartyNote,
  formatHistoryMonthDay,
  formatTradingHistoryLine,
  isContractorHistoryEmpty,
  isContractorHistoryHidden,
  isHistoryProjectSelected,
  resolveTappableProject,
  sortTradingCompanies,
  tradingCompanyDisplayName,
} from './contractorHistoryDisplay.js';

describe('contractorHistoryDisplay', () => {
  it('labels a missing trading company as 直取引', () => {
    expect(tradingCompanyDisplayName({ name: null, is_direct: true })).toBe('直取引');
    expect(tradingCompanyDisplayName({ name: '  ', is_direct: true })).toBe('直取引');
    expect(formatTradingHistoryLine({
      name: null,
      is_direct: true,
      project_count: 2,
      order_count: 4,
      last_used_at: '2026-10-06T03:00:00Z',
    })).toBe('直取引（物件2・発注4・最終 10/6）');
    expect(tradingCompanyDisplayName({ name: '大陽機材㈱', is_direct: false })).toBe('大陽機材㈱');
  });

  it('formats M/D in Asia/Tokyo, including UTC times that fall on the next JST date', () => {
    expect(formatHistoryMonthDay('2026-10-06T14:59:00Z')).toBe('10/6');
    expect(formatHistoryMonthDay('2026-10-06T15:00:00Z')).toBe('10/7');
    expect(formatHistoryMonthDay('')).toBe('');
    expect(formatHistoryMonthDay('not-a-date')).toBe('');
  });

  it('sorts trading companies by last_used_at descending', () => {
    const sorted = sortTradingCompanies([
      { name: '古い', last_used_at: '2026-07-01T00:00:00Z' },
      { name: '新しい', last_used_at: '2026-10-01T00:00:00Z' },
      { name: '日付なし', last_used_at: null },
    ]);
    expect(sorted.map((row) => row.name)).toEqual(['新しい', '古い', '日付なし']);
  });

  it('treats null as hidden and an empty payload as no history', () => {
    expect(isContractorHistoryHidden(null)).toBe(true);
    expect(isContractorHistoryEmpty(null)).toBe(false);
    expect(isContractorHistoryEmpty({
      trading_companies: [],
      recent_projects: [],
      recent_spot: { order_count: 0 },
    })).toBe(true);
    expect(isContractorHistoryEmpty({
      trading_companies: [{ name: 'A' }],
      recent_projects: [],
      recent_spot: { order_count: 0 },
    })).toBe(false);
  });

  it('exposes the own-company note text', () => {
    expect(OWN_COMPANY_HISTORY_NOTE).toBe('（自社分のみ表示）');
  });

  it('notes the other party only when this contractor is not the billing target', () => {
    expect(billingPartyNote({
      role: 'main',
      billing_target: 'sub',
      billed_to_contractor: false,
      sub_name: '高聖建設工業㈱',
    })).toBe('請求先は下請（高聖建設工業㈱）');
    expect(billingPartyNote({
      role: 'sub',
      billing_target: 'main',
      billed_to_contractor: false,
      prime_name: '三浦国土建設㈱',
    })).toBe('請求先は元請（三浦国土建設㈱）');
    expect(billingPartyNote({
      role: 'sub',
      billing_target: 'sub',
      billed_to_contractor: true,
      prime_name: '三浦国土建設㈱',
    })).toBe('');
  });

  it('matches a selectable project by string id and knows which row is selected', () => {
    const projects = [{ id: 42, name: '河川' }, { id: 'other', name: '別件' }];
    expect(resolveTappableProject({ project_id: '42' }, projects)).toEqual(projects[0]);
    expect(resolveTappableProject({ project_id: 42 }, projects)?.name).toBe('河川');
    expect(resolveTappableProject({ project_id: 'missing' }, projects)).toBe(null);
    expect(isHistoryProjectSelected({ project_id: 42 }, '42')).toBe(true);
    expect(isHistoryProjectSelected({ project_id: '42' }, 'other')).toBe(false);
  });
});
