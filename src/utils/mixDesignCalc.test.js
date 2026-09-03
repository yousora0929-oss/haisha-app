import { describe, expect, it } from 'vitest';
import {
  buildMixCode,
  lookupCorrectionValue,
  roundUpToNominalStrength,
} from './mixDesignCalc.js';

describe('roundUpToNominalStrength', () => {
  it('rounds 39 up to 40 (no 39 in the spec list)', () => {
    expect(roundUpToNominalStrength(39)).toBe(40);
  });

  it('keeps an exact spec value unchanged', () => {
    expect(roundUpToNominalStrength(27)).toBe(27);
  });

  it('rounds 37 up to 40', () => {
    expect(roundUpToNominalStrength(37)).toBe(40);
  });

  it('returns the raw value when it exceeds the spec list', () => {
    expect(roundUpToNominalStrength(61)).toBe(61);
  });
});

describe('lookupCorrectionValue year wrap', () => {
  const oitaNWinter = [
    {
      date_start_month: 12,
      date_start_day: 6,
      date_end_month: 2,
      date_end_day: 7,
      correction_value: 6,
      category_label: '0℃以上8℃未満',
    },
  ];

  it('matches 1/15 inside 12/6–2/7 wrap', () => {
    expect(lookupCorrectionValue(new Date(2026, 0, 15), oitaNWinter)).toEqual({
      value: 6,
      label: '0℃以上8℃未満',
    });
  });

  it('matches 12/20 inside 12/6–2/7 wrap', () => {
    expect(lookupCorrectionValue(new Date(2026, 11, 20), oitaNWinter)).toEqual({
      value: 6,
      label: '0℃以上8℃未満',
    });
  });

  it('matches the wrap endpoints', () => {
    expect(lookupCorrectionValue(new Date(2026, 11, 6), oitaNWinter)?.value).toBe(6);
    expect(lookupCorrectionValue(new Date(2026, 1, 7), oitaNWinter)?.value).toBe(6);
  });

  it('returns null outside the wrap range', () => {
    expect(lookupCorrectionValue(new Date(2026, 2, 1), oitaNWinter)).toBeNull();
    expect(lookupCorrectionValue(new Date(2026, 5, 1), oitaNWinter)).toBeNull();
  });
});

describe('lookupCorrectionValue non-wrapping range', () => {
  const oitaNSummer = [
    {
      date_start_month: 6,
      date_start_day: 29,
      date_end_month: 9,
      date_end_day: 16,
      correction_value: 6,
      category_label: '暑中期間',
    },
  ];

  it('matches a date inside 6/29–9/16', () => {
    expect(lookupCorrectionValue(new Date(2026, 7, 1), oitaNSummer)).toEqual({
      value: 6,
      label: '暑中期間',
    });
  });

  it('returns null just outside the range', () => {
    expect(lookupCorrectionValue(new Date(2026, 5, 28), oitaNSummer)).toBeNull();
    expect(lookupCorrectionValue(new Date(2026, 8, 17), oitaNSummer)).toBeNull();
  });
});

describe('buildMixCode', () => {
  it('includes correction breakdown and AE admixture', () => {
    expect(
      buildMixCode({
        baseStrength: 30,
        correctionValue: 6,
        nominalStrength: 36,
        cementType: 'N',
        slump: 15,
        aggregateSize: 20,
        aeAdmixture: true,
      }),
    ).toBe('36（30+6N）-15-20N・高性能');
  });

  it('omits correction and AE when not set', () => {
    expect(
      buildMixCode({
        baseStrength: 27,
        correctionValue: null,
        nominalStrength: 27,
        cementType: 'BB',
        slump: 18,
        aggregateSize: 20,
        aeAdmixture: false,
      }),
    ).toBe('27-18-20BB');
  });
});
