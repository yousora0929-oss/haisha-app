import { describe, expect, it } from 'vitest';
import {
  buildMixDesignAnchorProjectPayload,
  buildMixDesignItemInsertRows,
  buildMixDesignRequestInsertRow,
  computeNominalStrength,
  mixCodeForItem,
  mixDesignItemFromDbRow,
  mixDesignPrintPropsFromDb,
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

describe('mixDesignPrintPropsFromDb', () => {
  it('maps all item columns and enriches header from project when snapshots are missing', () => {
    const props = mixDesignPrintPropsFromDb(
      {
        requested_by: '梅田',
        vehicle_types: ['large'],
        total_volume_m3: 12.5,
        memo: 'メモ',
        submission_method: 'original',
      },
      [
        {
          id: 'item-1',
          sort_order: 0,
          base_strength: 18,
          correction_value: 3,
          correction_is_auto: false,
          nominal_strength: 21,
          slump: 8,
          aggregate_size: 20,
          cement_type: 'N',
          ae_admixture: true,
          quantity_m3: '12.5',
          pour_date: '2026-09-15',
          construction_location: '1階スラブ',
          water_cement_ratio: 55,
          unit_water_content: 175,
        },
      ],
      {
        name: '棚林川復旧工事',
        contractor_display_name: '表示業者',
        contractor: '業者名',
        trading_company_name: '商社X',
        site_address: '大分市xxx',
      },
    );

    expect(props.header.projectName).toBe('棚林川復旧工事');
    expect(props.header.contractorName).toBe('表示業者');
    expect(props.header.traderName).toBe('商社X');
    expect(props.header.siteAddress).toBe('大分市xxx');
    expect(props.header.requestedBy).toBe('梅田');
    expect(props.items).toHaveLength(1);
    expect(props.items[0].waterCementRatio).toBe('55');
    expect(props.items[0].unitWaterContent).toBe('175');
    expect(props.items[0].quantityM3).toBe('12.5');
    expect(props.items[0].constructionLocation).toBe('1階スラブ');
    expect(props.items[0].pourDate).toBe('2026-09-15');
    expect(mixCodeForItem(props.items[0])).toContain('18');
  });

  it('prefers request snapshot fields over project fallback', () => {
    const props = mixDesignPrintPropsFromDb(
      {
        project_name: '依頼時の工事名',
        contractor_name: '依頼時の業者',
        site_address: '依頼時住所',
        trading_company_name: '依頼時商社',
      },
      [],
      {
        name: '物件名',
        contractor: '物件業者',
        site_address: '物件住所',
        trading_company_name: '物件商社',
      },
    );
    expect(props.header.projectName).toBe('依頼時の工事名');
    expect(props.header.contractorName).toBe('依頼時の業者');
    expect(props.header.siteAddress).toBe('依頼時住所');
    expect(props.header.traderName).toBe('依頼時商社');
  });
});

describe('mixDesignItemFromDbRow', () => {
  it('keeps numeric DB values as printable strings', () => {
    const item = mixDesignItemFromDbRow({
      base_strength: 24,
      slump: 12,
      aggregate_size: 25,
      cement_type: 'BB',
      quantity_m3: 3,
      water_cement_ratio: 0,
      unit_water_content: 160,
    });
    expect(item.baseStrength).toBe('24');
    expect(item.quantityM3).toBe('3');
    expect(item.waterCementRatio).toBe('0');
    expect(item.unitWaterContent).toBe('160');
  });
});

describe('buildMixDesignAnchorProjectPayload', () => {
  it('uses draft.contractorName for p_contractor payload, never requestedBy', () => {
    const payload = buildMixDesignAnchorProjectPayload(
      {
        customer_id: '7c67a6df-1520-4c8d-a9e9-02c20273cf92',
        vehicleType: 'large',
      },
      {
        projectName: 'テスト工事',
        contractorName: '後藤建設株式会社',
        contractorCustomerId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        siteAddress: '大分市',
        traderName: '商社A',
        tradingCompanyOrganizationId: '11111111-2222-3333-4444-555555555555',
        requestedBy: '梅田',
        requestedToFactoryId: '',
      },
    );
    expect(payload.contractor).toBe('後藤建設株式会社');
    expect(payload.contractor).not.toBe('梅田');
    expect(payload.customerId).toBe('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee');
    expect(payload.customerId).not.toBe('7c67a6df-1520-4c8d-a9e9-02c20273cf92');
    expect(payload.tradingCompanyOrganizationId).toBe('11111111-2222-3333-4444-555555555555');
    expect(payload).not.toHaveProperty('requestedBy');
    expect(payload.name).toBe('テスト工事');
    expect(payload.tradingCompanyName).toBe('商社A');
  });
});

describe('buildMixDesignChangeEntries', () => {
  it('records header field diffs', async () => {
    const { buildMixDesignChangeEntries, buildMixDesignRequestSnapshot } = await import(
      './mixDesignRequest.js'
    );
    const before = buildMixDesignRequestSnapshot({
      projectName: 'A',
      contractorName: '旧業者',
      items: [{ baseStrength: '24', slump: '18', aggregateSize: '20', cementType: 'N' }],
    });
    const after = buildMixDesignRequestSnapshot({
      projectName: 'A',
      contractorName: '新業者',
      items: [{ baseStrength: '27', slump: '18', aggregateSize: '20', cementType: 'N' }],
    });
    const changes = buildMixDesignChangeEntries(before, after);
    expect(changes.some((c) => c.field === 'contractorName')).toBe(true);
    expect(changes.some((c) => c.field === 'items')).toBe(true);
  });
});
