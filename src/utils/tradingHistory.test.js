import { describe, expect, it } from 'vitest';
import {
  buildTradingHistoryForParty,
  resolveProjectBilledPartyName,
  tradingCompanyDraftFromHistoryLabel,
} from './tradingHistory.js';

const customerById = {
  miura: { id: 'miura', company_name: '三浦国土建設㈱' },
  kosei: { id: 'kosei', company_name: '高聖建設工業㈱' },
};

const projects = [
  {
    id: 'p1',
    name: '三浦物件1',
    customer_id: 'miura',
    billing_target: 'main',
    trading_company_name: '大分総合建設業協同組合',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 'p2',
    name: '三浦物件2',
    customer_id: 'miura',
    billing_target: 'main',
    trading_company_name: '大分総合建設業協同組合',
    created_at: '2026-02-01T00:00:00Z',
  },
  {
    id: 'p3',
    name: '三浦物件3',
    customer_id: 'miura',
    billing_target: 'main',
    trading_company_name: '大分総合建設業協同組合',
    created_at: '2026-03-01T00:00:00Z',
  },
  {
    id: 'river',
    name: '河川改良工事',
    customer_id: 'miura',
    billing_target: 'sub',
    sub_contractor_name: '高聖建設工業㈱',
    trading_company_name: '大陽機材㈱',
    created_at: '2026-04-01T00:00:00Z',
  },
];

describe('buildTradingHistoryForParty', () => {
  it('keeps only the prime billing party and drops the subcontractor trading company', () => {
    const rows = buildTradingHistoryForParty(projects, '三浦国土建設㈱', { customerById });
    expect(rows.map((row) => row.tradingCompanyName)).toEqual(['大分総合建設業協同組合']);
    expect(rows[0].count).toBe(3);
    expect(rows[0].latestProjectName).toBe('三浦物件3');
  });

  it('counts the river project under the subcontractor when that company is the billing party', () => {
    const rows = buildTradingHistoryForParty(projects, '高聖建設工業㈱', { customerById });
    expect(rows.map((row) => row.tradingCompanyName)).toEqual(['大陽機材㈱']);
    expect(rows[0].count).toBe(1);
  });

  it('returns no history when the billing party name is empty', () => {
    expect(buildTradingHistoryForParty(projects, '   ', { customerById })).toEqual([]);
  });

  it('matches a free-typed subcontractor name that is not in the customer master', () => {
    const rows = buildTradingHistoryForParty(
      [
        {
          id: 'free',
          name: '自由入力現場',
          customer_id: 'miura',
          billing_target: 'sub',
          sub_contractor_name: '未登録建設',
          trading_company_name: '某商社',
          created_at: '2026-05-01T00:00:00Z',
        },
      ],
      '未登録建設',
      { customerById },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].tradingCompanyName).toBe('某商社');
    expect(resolveProjectBilledPartyName(projects[3], customerById)).toBe('高聖建設工業㈱');
  });

  it('treats legal-form spellings of 廣亜 as the same company', () => {
    const hiroaProjects = [
      {
        id: 'hiroa',
        name: '廣亜現場',
        billing_target: 'sub',
        sub_contractor_name: '株式会社廣亜',
        trading_company_name: '小野建㈱',
        created_at: '2026-06-01T00:00:00Z',
      },
    ];
    for (const partyName of ['株式会社廣亜', '㈱廣亜', '(株)廣亜', '（株）廣亜']) {
      const rows = buildTradingHistoryForParty(hiroaProjects, partyName, { customerById });
      expect(rows.map((row) => row.tradingCompanyName)).toEqual(['小野建㈱']);
    }
  });

  it('does not match ㈱廣亜 when a space remains inside the name', () => {
    const rows = buildTradingHistoryForParty(
      [
        {
          id: 'hiroa-space',
          name: '空白入り',
          billing_target: 'sub',
          sub_contractor_name: '㈱ 廣亜',
          trading_company_name: '空白商社',
          created_at: '2026-06-02T00:00:00Z',
        },
      ],
      '㈱廣亜',
      { customerById },
    );
    expect(rows).toEqual([]);
  });

  it('does not fold letter case', () => {
    const rows = buildTradingHistoryForParty(
      [
        {
          id: 'case',
          name: '大文字違い',
          billing_target: 'sub',
          contractor: 'ABC工業㈱',
          trading_company_name: '大文字商社',
          created_at: '2026-06-03T00:00:00Z',
        },
      ],
      'abc工業㈱',
      { customerById },
    );
    expect(rows).toEqual([]);
  });

  it('does not treat a leading and trailing legal form as the same company', () => {
    const rows = buildTradingHistoryForParty(
      [
        {
          id: 'trailing',
          name: '後株',
          billing_target: 'sub',
          sub_contractor_name: '廣亜株式会社',
          trading_company_name: '後株商社',
          created_at: '2026-06-04T00:00:00Z',
        },
      ],
      '株式会社廣亜',
      { customerById },
    );
    expect(rows).toEqual([]);
  });

  it('groups projects with no trading company as 直取引', () => {
    const rows = buildTradingHistoryForParty(
      [
        {
          id: 'direct-1',
          name: '直取引現場',
          customer_id: 'miura',
          billing_target: 'main',
          trading_company_name: '',
          created_at: '2026-07-01T00:00:00Z',
        },
        {
          id: 'direct-2',
          name: '直取引現場2',
          customer_id: 'miura',
          billing_target: 'main',
          created_at: '2026-08-01T00:00:00Z',
        },
      ],
      '三浦国土建設㈱',
      { customerById },
    );
    expect(rows).toEqual([
      {
        tradingCompanyName: '直取引',
        count: 2,
        latestProjectName: '直取引現場2',
        latestDate: '2026-08-01T00:00:00Z',
      },
    ]);
  });

  it('excludes the project being edited', () => {
    const rows = buildTradingHistoryForParty(projects, '三浦国土建設㈱', {
      customerById,
      excludeProjectId: 'p3',
    });
    expect(rows[0].count).toBe(2);
    expect(rows[0].latestProjectName).toBe('三浦物件2');
  });

  it('clears the trading company field when the direct-trade row is selected', () => {
    expect(tradingCompanyDraftFromHistoryLabel('直取引')).toBe('');
    expect(tradingCompanyDraftFromHistoryLabel('  直取引  ')).toBe('');
    expect(tradingCompanyDraftFromHistoryLabel('大分総合建設業協同組合')).toBe(
      '大分総合建設業協同組合',
    );
  });
});
