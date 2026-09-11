import { describe, expect, it } from 'vitest';
import {
  applyAutoCorrection,
  applyPourDateResolution,
  buildMixDesignAnchorProjectPayload,
  buildMixDesignItemInsertRows,
  buildMixDesignRequestInsertRow,
  computeNominalStrength,
  createEmptyMixDesignItem,
  duplicateMixDesignItem,
  factoryNamesText,
  formatRequesterDisplay,
  mixCodeForItem,
  mixCodeLinesForPrint,
  mixDesignItemFromDbRow,
  mixDesignPrintPropsFromDb,
  normalizeMixDesignFactoryIds,
  parseRequesterDisplay,
  regionFromDeliveryArea,
  resolveMixDesignProjectId,
  resolvePourDateFromPeriod,
  sanitizeNonNegativeInput,
  stepCandidateValue,
  validateMixDesignDraft,
} from './mixDesignRequest.js';
import { BASE_STRENGTH_CANDIDATES, SLUMP_CANDIDATES, AGGREGATE_SIZE_CANDIDATES } from './mixDesignCalc.js';

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
          memo: '基礎注意',
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
    expect(rows[0].memo).toBe('基礎注意');
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

  it('uses the current calendar year when no construction period is set', () => {
    const y = new Date().getFullYear();
    expect(
      resolvePourDateFromPeriod({
        month: 12,
        day: 6,
        periodStart: '',
        periodEnd: '',
      }),
    ).toMatchObject({ pourDate: `${y}-12-06`, outOfRange: false });
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

  it('persists entered totalVolumeM3 instead of summing item quantities', () => {
    const row = buildMixDesignRequestInsertRow({
      projectId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      draft: {
        totalVolumeM3: '80',
        requestedByAffiliation: '協同組合事務局',
        items: [{ quantityM3: '12' }, { quantityM3: '8' }],
      },
      requestedBy: '佐藤',
    });
    expect(row.total_volume_m3).toBe(80);
    expect(row.requested_by).toBe('佐藤（協同組合事務局）');
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
          memo: 'スラブ注意',
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
    expect(props.items[0].memo).toBe('スラブ注意');
    expect(props.request.memo).toBe('メモ');
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

describe('mixCodeLinesForPrint', () => {
  it('splits a long mix code onto two lines', () => {
    expect(
      mixCodeLinesForPrint({
        baseStrength: 27,
        correctionValue: 3,
        slump: 18,
        aggregateSize: 20,
        cementType: 'BB',
      }),
    ).toEqual(['30（27+3BB）', '18-20BB']);
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

describe('normalizeMixDesignFactoryIds', () => {
  it('prefers array and dedupes', () => {
    expect(
      normalizeMixDesignFactoryIds({
        requestedToFactoryIds: ['a', 'b', 'a'],
        requestedToFactoryId: 'z',
      }),
    ).toEqual(['a', 'b']);
  });

  it('falls back to single id', () => {
    expect(normalizeMixDesignFactoryIds({ requestedToFactoryId: 'f1' })).toEqual(['f1']);
  });
});

describe('regionFromDeliveryArea', () => {
  it('maps unambiguous cities and leaves 由布市 for manual pick', () => {
    expect(regionFromDeliveryArea('大分市')).toBe('大分市・挟間町');
    expect(regionFromDeliveryArea('湯布院町')).toBe('湯布院・庄内');
    expect(regionFromDeliveryArea('由布市')).toBe('');
  });
});

describe('formatRequesterDisplay / parseRequesterDisplay', () => {
  it('formats name and affiliation together', () => {
    expect(formatRequesterDisplay('佐藤', '協同組合事務局')).toBe('佐藤（協同組合事務局）');
    expect(parseRequesterDisplay('佐藤（協同組合事務局）')).toEqual({
      name: '佐藤',
      affiliation: '協同組合事務局',
    });
  });

  it('does not double-wrap an already formatted name', () => {
    expect(formatRequesterDisplay('佐藤（協同組合事務局）', '協同組合事務局')).toBe(
      '佐藤（協同組合事務局）',
    );
  });
});

describe('stepCandidateValue', () => {
  it('jumps along the specified candidate lists', () => {
    expect(stepCandidateValue('24', BASE_STRENGTH_CANDIDATES, 'up')).toBe('27');
    expect(stepCandidateValue('36', BASE_STRENGTH_CANDIDATES, 'up')).toBe('40');
    expect(stepCandidateValue('12', SLUMP_CANDIDATES, 'down')).toBe('8');
    expect(stepCandidateValue('20', AGGREGATE_SIZE_CANDIDATES, 'up')).toBe('40');
    expect(stepCandidateValue('25', AGGREGATE_SIZE_CANDIDATES, 'up')).toBe('40');
    expect(stepCandidateValue('', BASE_STRENGTH_CANDIDATES, 'up')).toBe('18');
  });
});

describe('applyAutoCorrection', () => {
  const winterRules = [
    {
      fiscal_year: 2026,
      region: '大分市・挟間町',
      cement_type: 'N',
      date_start_month: 12,
      date_start_day: 6,
      date_end_month: 2,
      date_end_day: 7,
      correction_value: 6,
      category_label: '0℃以上8℃未満',
    },
  ];

  it('looks up the correction value from pour month/day even without a construction period', () => {
    const withDate = applyPourDateResolution(
      { ...createEmptyMixDesignItem(), pourMonth: '12', pourDay: '20', cementType: 'N', correctionIsAuto: true },
      '',
      '',
    );
    const next = applyAutoCorrection(withDate, winterRules, '大分市・挟間町');
    expect(next.correctionValue).toBe('6');
    expect(next.correctionLabel).toBe('0℃以上8℃未満');
  });

  it('uses 湯布院・庄内 rules for a year-wrapping winter date', () => {
    const yufuRules = [
      {
        fiscal_year: 2026,
        region: '湯布院・庄内',
        cement_type: 'N',
        date_start_month: 11,
        date_start_day: 11,
        date_end_month: 3,
        date_end_day: 3,
        correction_value: 6,
        category_label: '0℃以上8℃未満',
      },
    ];
    const withDate = applyPourDateResolution(
      { ...createEmptyMixDesignItem(), pourMonth: '1', pourDay: '15', cementType: 'N', correctionIsAuto: true },
      '2026-11-01',
      '2027-03-31',
    );
    const next = applyAutoCorrection(withDate, yufuRules, '湯布院・庄内');
    expect(withDate.pourDate).toBe('2027-01-15');
    expect(next.correctionValue).toBe('6');
  });

  it('leaves a manual value untouched when auto is off', () => {
    const next = applyAutoCorrection(
      {
        ...createEmptyMixDesignItem(),
        pourDate: '2026-12-20',
        cementType: 'N',
        correctionIsAuto: false,
        correctionValue: '3',
      },
      winterRules,
      '大分市・挟間町',
    );
    expect(next.correctionValue).toBe('3');
  });

  it('still looks up when construction period excludes the pour month/day', () => {
    const withDate = applyPourDateResolution(
      { ...createEmptyMixDesignItem(), pourMonth: '12', pourDay: '20', cementType: 'N', correctionIsAuto: true },
      '2026-04-01',
      '2026-10-31',
    );
    expect(withDate.pourDate).toBe('');
    const next = applyAutoCorrection(withDate, [], '大分市・挟間町');
    expect(next.correctionValue).toBe('6');
    expect(next.correctionLabel).toBe('0℃以上8℃未満');
  });
});

describe('duplicateMixDesignItem', () => {
  it('copies fields onto a new card with a new localId', () => {
    const source = {
      ...createEmptyMixDesignItem(),
      localId: 'mixitem_src',
      baseStrength: '30',
      slump: '15',
      aggregateSize: '20',
      cementType: 'BB',
      quantityM3: '12',
      constructionLocation: '基礎',
      pourMonth: '8',
      pourDay: '1',
      waterCementRatio: '50',
      unitWaterContent: '175',
      memo: '基礎注意',
      aeAdmixture: true,
      correctionIsAuto: true,
      correctionValue: '6',
    };
    const copy = duplicateMixDesignItem(source);
    expect(copy.localId).not.toBe(source.localId);
    expect(copy.baseStrength).toBe('30');
    expect(copy.constructionLocation).toBe('基礎');
    expect(copy.memo).toBe('基礎注意');
    expect(copy.aeAdmixture).toBe(true);
    expect(copy.correctionValue).toBe('6');
  });
});

describe('factoryNamesText', () => {
  it('never returns a non-string that would crash React print', () => {
    expect(factoryNamesText(null)).toBe('');
    expect(factoryNamesText(['A工場', 'B工場'])).toBe('A工場、B工場');
    expect(factoryNamesText({ name: 'obj' })).toBe('');
  });
});

describe('mixDesignPrintPropsFromDb requester affiliation', () => {
  it('parses affiliation from requested_by and keeps entered total volume', () => {
    const props = mixDesignPrintPropsFromDb(
      {
        requested_by: '佐藤（協同組合事務局）',
        total_volume_m3: 80,
      },
      [{ quantity_m3: 12, base_strength: 24, slump: 15, aggregate_size: 20, cement_type: 'N' }],
      null,
    );
    expect(props.header.requestedBy).toBe('佐藤（協同組合事務局）');
    expect(props.header.requestedByAffiliation).toBe('協同組合事務局');
    expect(props.header.totalVolumeM3).toBe(80);
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

  it('records per-item memo diffs separately from request-level memo', async () => {
    const { buildMixDesignChangeEntries, buildMixDesignRequestSnapshot, formatMixDesignChangeLine } =
      await import('./mixDesignRequest.js');
    const before = buildMixDesignRequestSnapshot({
      memo: '全体メモ',
      items: [{ baseStrength: '24', slump: '18', aggregateSize: '20', cementType: 'N', memo: '' }],
    });
    const after = buildMixDesignRequestSnapshot({
      memo: '全体メモ',
      items: [{ baseStrength: '24', slump: '18', aggregateSize: '20', cementType: 'N', memo: 'スラブ注意' }],
    });
    const changes = buildMixDesignChangeEntries(before, after);
    expect(changes.some((c) => c.field === 'memo')).toBe(false);
    const itemMemo = changes.find((c) => c.field === 'items.0.memo');
    expect(itemMemo).toMatchObject({ label: '配合1の備考', new: 'スラブ注意' });
    expect(formatMixDesignChangeLine(itemMemo)).toBe('配合1の備考: （空） → スラブ注意');
  });
});

describe('mixDesignStatusLabel', () => {
  it('maps five stages to the new display labels', async () => {
    const { mixDesignStatusLabel, MIX_DESIGN_STATUS_VALUES } = await import('./mixDesignRequest.js');
    expect(MIX_DESIGN_STATUS_VALUES).toEqual([
      'not_started',
      'requested',
      'in_progress',
      'completed',
      'submitted',
    ]);
    expect(mixDesignStatusLabel('not_started')).toBe('保留中');
    expect(mixDesignStatusLabel('requested')).toBe('依頼中');
    expect(mixDesignStatusLabel('in_progress')).toBe('作成中');
    expect(mixDesignStatusLabel('completed')).toBe('完成');
    expect(mixDesignStatusLabel('submitted')).toBe('提出済み');
  });
});

describe('formatMixDesignChangeLine status', () => {
  it('renders status diffs with Japanese labels', async () => {
    const { formatMixDesignChangeLine } = await import('./mixDesignRequest.js');
    expect(
      formatMixDesignChangeLine({
        field: 'status',
        label: 'ステータス',
        old: 'in_progress',
        new: 'completed',
      }),
    ).toBe('ステータス: 作成中 → 完成');
  });
});
