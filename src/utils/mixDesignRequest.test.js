import { describe, expect, it } from 'vitest';
import {
  buildMixDesignItemInsertRows,
  computeNominalStrength,
  resolveMixDesignProjectId,
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
});
