import { describe, expect, it } from 'vitest';
import {
  OWN_COMPANY_HISTORY_NOTE,
  SPOT_HISTORY_EMPTY_MESSAGE,
  UNREGISTERED_CONTRACTOR_HISTORY_NOTE,
  billingPartyNote,
  MISSING_AGENT_CUSTOMER_NOTE,
  SPOT_TRADER_CHIP_HINT,
  canApplyHistoryTraderChip,
  formatHistoryMonthDay,
  formatProjectTradingHistoryLine,
  formatRecentSpotOrderLine,
  formatSpotTradingChip,
  formatTradingHistoryLine,
  historyChipTraderValue,
  isContractorHistoryEmpty,
  isContractorHistoryHidden,
  isHistoryProjectSelected,
  isHistoryTraderChipSelected,
  isHistoryTraderOrganizationSelected,
  isSpotContractorHistoryEmpty,
  resolveAgentContactForOrganization,
  spotTraderChipAction,
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

  it('formats spot trading chips and omits a zero project count', () => {
    expect(formatSpotTradingChip({
      name: '大陽機材㈱',
      order_count: 3,
      last_used_at: '2026-10-06T03:00:00Z',
    })).toBe('大陽機材㈱（発注3・最終 10/6）');
    expect(formatSpotTradingChip({ name: null, is_direct: true, order_count: 1 })).toBe('直取引（発注1）');
    expect(formatProjectTradingHistoryLine({
      name: '大分総合建設業協同組合',
      project_count: 0,
      order_count: 4,
      last_used_at: '2026-10-06T03:00:00Z',
    })).toBe('大分総合建設業協同組合（発注4・最終 10/6）');
    expect(formatProjectTradingHistoryLine({
      name: '大陽機材㈱',
      project_count: 2,
      order_count: 5,
      last_used_at: '2026-10-06T03:00:00Z',
    })).toBe('大陽機材㈱（物件2・発注5・最終 10/6）');
  });

  it('formats a recent spot order, including a missing site name and direct trade', () => {
    expect(formatRecentSpotOrderLine({
      site_name: null,
      trading_company_name: null,
      order_count: 2,
      last_ordered_at: '2026-10-06T03:00:00Z',
    })).toBe('（現場名なし） / 直取引 / 2件 / 最終 10/6');
    expect(formatRecentSpotOrderLine({
      site_name: '大分市 上宗方',
      trading_company_name: '三和㈱',
      order_count: 3,
      last_ordered_at: '2026-09-01T00:00:00Z',
    })).toBe('大分市 上宗方 / 三和㈱ / 3件 / 最終 9/1');
  });

  it('turns a trading chip into the trader field value', () => {
    const orgs = [{ id: 'org-1', name: '大陽機材株式会社' }];
    expect(historyChipTraderValue({
      name: '大陽機材㈱',
      organization_id: 'org-1',
      is_direct: false,
    }, orgs)).toBe('大陽機材株式会社');
    expect(historyChipTraderValue({
      name: '三和㈱',
      organization_id: 'missing',
      is_direct: false,
    }, orgs)).toBe('三和㈱');
    expect(historyChipTraderValue({ name: null, is_direct: true }, orgs)).toBe('');
    expect(canApplyHistoryTraderChip('cooperative')).toBe(true);
    expect(canApplyHistoryTraderChip('agent')).toBe(false);
  });

  it('marks the selected trader chip across legal-form spelling', () => {
    const chip = { name: '株式会社廣亜', is_direct: false };
    expect(isHistoryTraderChipSelected(chip, '㈱廣亜', [])).toBe(true);
    expect(isHistoryTraderChipSelected(chip, '別会社', [])).toBe(false);
    expect(isHistoryTraderChipSelected({ name: null, is_direct: true }, '', [])).toBe(true);
    expect(isHistoryTraderChipSelected({ name: null, is_direct: true }, '大陽機材㈱', [])).toBe(false);
  });

  it('describes an unregistered contractor and an empty spot history', () => {
    expect(UNREGISTERED_CONTRACTOR_HISTORY_NOTE).toBe('業者マスタ未登録の名称です（スポットの履歴のみ照合）');
    expect(SPOT_HISTORY_EMPTY_MESSAGE).toBe('この業者のスポット・物件の実績はまだありません');
    expect(isSpotContractorHistoryEmpty({
      spot_trading_companies: [],
      recent_spot_orders: [],
      trading_companies: [],
      recent_projects: [],
    })).toBe(true);
    expect(isSpotContractorHistoryEmpty({
      spot_trading_companies: [{ name: '大陽機材㈱' }],
      recent_spot_orders: [],
      trading_companies: [],
      recent_projects: [],
    })).toBe(false);
    expect(isSpotContractorHistoryEmpty(null)).toBe(false);
  });

  it('resolves the representative, a single person, several people, or nobody', () => {
    const representative = {
      id: 'b',
      role: 'agent',
      organization_id: 'org-sanwa',
      manager_name: '',
      phone_number: '',
    };
    const earlierRepresentative = {
      id: 'a',
      role: 'agent',
      organization_id: 'org-sanwa',
      manager_name: '  ',
      phone_number: '',
    };
    const sato = {
      id: 'c',
      role: 'agent',
      organization_id: 'org-sanwa',
      manager_name: '佐藤',
      phone_number: '090',
    };
    expect(resolveAgentContactForOrganization('org-sanwa', [sato, representative, earlierRepresentative])).toEqual({
      kind: 'representative',
      customer: earlierRepresentative,
    });

    const onlyPerson = {
      id: 'p1',
      role: 'agent',
      organization_id: 'org-one',
      manager_name: '山田',
      phone_number: '080',
    };
    expect(resolveAgentContactForOrganization('org-one', [onlyPerson])).toEqual({
      kind: 'person',
      customer: onlyPerson,
    });

    const first = { id: 'a', role: 'agent', organization_id: 'org-many', manager_name: '一郎', phone_number: '1' };
    const second = { id: 'b', role: 'agent', organization_id: 'org-many', manager_name: '二郎', phone_number: '2' };
    expect(resolveAgentContactForOrganization('org-many', [second, first])).toEqual({
      kind: 'ambiguous',
      customers: [first, second],
    });

    expect(resolveAgentContactForOrganization('org-empty', [onlyPerson])).toEqual({ kind: 'none' });
    expect(resolveAgentContactForOrganization('', [representative])).toEqual({ kind: 'none' });
  });

  it('selects a chip by organization id, and keeps agent chips and nameless companies from being applied', () => {
    const chip = { name: '三和㈱', organization_id: 'org-sanwa', is_direct: false };
    expect(isHistoryTraderOrganizationSelected(chip, { organization_id: 'org-sanwa' })).toBe(true);
    expect(isHistoryTraderOrganizationSelected(chip, { organization_id: 'org-other' })).toBe(false);
    expect(isHistoryTraderOrganizationSelected(
      { name: null, is_direct: true, organization_id: 'org-sanwa' },
      { organization_id: 'org-sanwa' },
    )).toBe(false);
    expect(spotTraderChipAction(chip, 'agent')).toEqual({ type: 'disabled' });
    expect(spotTraderChipAction({ name: null, is_direct: true }, 'cooperative')).toEqual({ type: 'clear' });
    expect(spotTraderChipAction({ name: '無名商社', organization_id: '' }, 'cooperative')).toEqual({
      type: 'missing-org',
    });
    expect(canApplyHistoryTraderChip('agent')).toBe(false);
    expect(SPOT_TRADER_CHIP_HINT).toContain('代表');
    expect(MISSING_AGENT_CUSTOMER_NOTE).toBe('この商社の顧客が登録されていません');
  });
});
