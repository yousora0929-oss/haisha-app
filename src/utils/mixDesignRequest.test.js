import { describe, expect, it } from 'vitest';
import {
  buildMixDesignItemInsertRows,
  buildMixDesignRequestInsertRow,
  computeNominalStrength,
  resolveMixDesignProjectId,
  resolvePourDateFromPeriod,
  sanitizeNonNegativeInput,
  validateMixDesignDraft,
} from './mixDesignRequest.js';

describe('computeNominalStrength', () => {
  it('rounds 30+6 to 36', () => {
    expect(computeNominalStrength(30, 6)).toBe(36);
  });

  it('rounds 33+6 to 40', () => {
    expect(computeNominalStrength(33, 6)).toBe(40);
  });
});

describe('validateMixDesignDraft', () => {
  it('requires region and mix fields', () => {
    const missing = validateMixDesignDraft({
      region: '',
      items: [{ baseStrength: '', slump: '', aggregateSize: '', cementType: 'N' }],
    });
    expect(missing).toContain('地域');
    expect(missing.some((m) => m.includes('設計基準強度'))).toBe(true);
  });

  it('accepts a complete single item', () => {
    expect(
      validateMixDesignDraft({
        region: '大分市・挟間町',
        items: [{ baseStrength: 30, slump: 15, aggregateSize: 20, cementType: 'N' }],
      }),
    ).toEqual([]);
  });
});

describe('resolveMixDesignProjectId', () => {
  it('prefers inserted order project_id', () => {
    expect(
      resolveMixDesignProjectId([{ project_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }], 'other'),
    ).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
  });

  it('falls back to selectedProjectId for spot orders without project', () => {
    expect(resolveMixDesignProjectId([{ is_spot: true, project_id: null }], 'proj-1')).toBe('proj-1');
  });
});

describe('buildMixDesignItemInsertRows', () => {
  it('maps camelCase draft items to db columns', () => {
    const rows = buildMixDesignItemInsertRows({
      items: [
        {
          baseStrength: 30,
          correctionValue: 6,
          correctionIsAuto: true,
          slump: 15,
          aggregateSize: 20,
          cementType: 'N',
          aeAdmixture: true,
          quantityM3: 12,
          pourDate: '2026-08-01',
          constructionLocation: '基礎',
          waterCementRatio: 50,
          unitWaterContent: 175,
        },
      ],
    });
    expect(rows[0]).toMatchObject({
      sort_order: 0,
      base_strength: 30,
      correction_value: 6,
      nominal_strength: 36,
      slump: 15,
      aggregate_size: 20,
      cement_type: 'N',
      ae_admixture: true,
    });
  });

  it('clamps negative numeric fields to 0', () => {
    const rows = buildMixDesignItemInsertRows({
      items: [
        {
          baseStrength: 30,
          correctionValue: -3,
          slump: 15,
          aggregateSize: 20,
          cementType: 'N',
          quantityM3: -1,
          waterCementRatio: -10,
          unitWaterContent: -5,
        },
      ],
    });
    expect(rows[0].correction_value).toBe(0);
    expect(rows[0].quantity_m3).toBe(0);
    expect(rows[0].water_cement_ratio).toBe(0);
    expect(rows[0].unit_water_content).toBe(0);
  });
});

describe('resolvePourDateFromPeriod', () => {
  it('uses start year when the period stays in one calendar year', () => {
    expect(
      resolvePourDateFromPeriod({
        month: 7,
        day: 10,
        periodStart: '2026-04-01',
        periodEnd: '2026-12-20',
      }),
    ).toMatchObject({ pourDate: '2026-07-10', outOfRange: false });
  });

  it('picks the in-range year across a year boundary', () => {
    expect(
      resolvePourDateFromPeriod({
        month: 12,
        day: 15,
        periodStart: '2026-11-01',
        periodEnd: '2027-03-31',
      }),
    ).toMatchObject({ pourDate: '2026-12-15', outOfRange: false });
    expect(
      resolvePourDateFromPeriod({
        month: 2,
        day: 5,
        periodStart: '2026-11-01',
        periodEnd: '2027-03-31',
      }),
    ).toMatchObject({ pourDate: '2027-02-05', outOfRange: false });
  });

  it('flags month/day outside the period', () => {
    expect(
      resolvePourDateFromPeriod({
        month: 7,
        day: 10,
        periodStart: '2026-11-01',
        periodEnd: '2027-03-31',
      }),
    ).toMatchObject({ pourDate: '', outOfRange: true, needsYear: true });
  });

  it('uses a manual year override', () => {
    expect(
      resolvePourDateFromPeriod({
        month: 7,
        day: 10,
        periodStart: '2026-11-01',
        periodEnd: '2027-03-31',
        yearOverride: 2026,
      }),
    ).toMatchObject({ pourDate: '2026-07-10', outOfRange: false });
  });
});

describe('sanitizeNonNegativeInput', () => {
  it('strips minus signs', () => {
    expect(sanitizeNonNegativeInput('-12')).toBe('12');
    expect(sanitizeNonNegativeInput('')).toBe('');
  });
});

describe('buildMixDesignRequestInsertRow', () => {
  it('includes snapshot fields and vehicle_types from the draft', () => {
    const row = buildMixDesignRequestInsertRow({
      projectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      draft: {
        requestedToFactoryId: '',
        copiesCount: '-2',
        vehicleTypes: ['large', 'partial_small'],
        primeContractorName: '元請A',
        traderName: '商社B',
        siteManagerName: '山田',
        siteManagerContact: '090-0000-0000',
        periodStart: '2026-04-01',
        periodEnd: '2027-03-31',
        memo: 'メモ',
        items: [],
      },
      requestedBy: '依頼者',
    });
    expect(row.copies_count).toBe(0);
    expect(row.vehicle_types).toEqual(['large', 'partial_small']);
    expect(row.prime_contractor_name).toBe('元請A');
    expect(row.trading_company_name).toBe('商社B');
    expect(row.site_manager_name).toBe('山田');
    expect(row.period_start).toBe('2026-04-01');
  });

  it('includes project_name contractor_name site_address snapshots', () => {
    const row = buildMixDesignRequestInsertRow({
      projectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      draft: {
        projectName: '末広町工事',
        contractorName: '業者C',
        siteAddress: '大分市末広町1',
        traderName: '商社D',
        items: [],
      },
      requestedBy: '依頼者',
    });
    expect(row.project_name).toBe('末広町工事');
    expect(row.contractor_name).toBe('業者C');
    expect(row.site_address).toBe('大分市末広町1');
  });
});
