import { describe, expect, it } from 'vitest';
import {
  calcBothVehicles,
  calcCashPrice,
  formatMixLabel,
  getAdmixtureOptions,
  getSlumpOptions,
  getStrengthOptions,
  normalizePriceList,
} from './cashPriceCalc.js';

/** 検証ケース用の最小価格表（実DBの初期データと整合する前提値） */
const FIXTURE = normalizePriceList({
  name: '窓口現金価格表',
  effective_from: '2026-04-01',
  is_active: true,
  small_vehicle_surcharge: 4000,
  bb_discount: 100,
  large_base_load: '3.00',
  small_base_load: '1.50',
  empty_load_rate: 1000,
  tax_rate: '0.100',
  area_surcharges: [
    { code: 'oita', label: '大分', amount: 0 },
    { code: 'yufu', label: '庄内・湯布院', amount: 2000 },
    { code: 'nozuru', label: '野津原・挾間・佐賀関', amount: 1500 },
  ],
  base_prices: [
    { strength: 18, slump: '8', admixture: 'AE', price: 22000 },
    { strength: 18, slump: '12～15', admixture: 'AE', price: 22100 },
    { strength: 18, slump: '18', admixture: 'AE', price: 22200 },
    { strength: 18, slump: '21', admixture: 'AE', price: 22300 },
    { strength: 21, slump: '18', admixture: 'AE', price: 23350 },
    { strength: 24, slump: '18', admixture: 'AE', price: 23250 },
    { strength: 30, slump: '21', admixture: 'HP', price: 26000 },
    { strength: 36, slump: '18', admixture: 'HP', price: 26850 },
  ],
});

describe('cashPriceCalc', () => {
  it('normalizes numeric strings from jsonb/numeric columns', () => {
    expect(FIXTURE.large_base_load).toBe(3);
    expect(FIXTURE.small_base_load).toBe(1.5);
    expect(FIXTURE.tax_rate).toBe(0.1);
  });

  it('lists strength / slump / admixture options with filtering', () => {
    expect(getStrengthOptions(FIXTURE)).toEqual([18, 21, 24, 30, 36]);
    expect(getSlumpOptions(FIXTURE, 18)).toEqual(['8', '12～15', '18', '21']);
    expect(getAdmixtureOptions(FIXTURE, 30, '21')).toEqual(['HP']);
    expect(getAdmixtureOptions(FIXTURE, 18, '8')).toEqual(['AE']);
  });

  it('formats mix label', () => {
    expect(formatMixLabel({ strength: 18, slump: '8', cement: 'BB', admixture: 'AE' })).toBe(
      '18-8-20 BB（AE）',
    );
    expect(formatMixLabel({ strength: 36, slump: '18', cement: 'N', admixture: 'HP' })).toBe(
      '36-18-20 N（高性能）',
    );
  });

  it('matches verification cases', () => {
    const cases = [
      {
        label: '18-8 AE BB / 1 / 大分 / 小型',
        params: {
          strength: 18,
          slump: '8',
          admixture: 'AE',
          cement: 'BB',
          quantity: 1,
          vehicle: 'small',
          areaCode: 'oita',
        },
        expect: {
          unitPrice: 25900,
          materialAmount: 25900,
          emptyLoadAmount: 500,
          subtotal: 26400,
          tax: 2640,
          total: 29040,
        },
      },
      {
        label: '21-18 AE BB / 3.5 / 庄内・湯布院 / 大型',
        params: {
          strength: 21,
          slump: '18',
          admixture: 'AE',
          cement: 'BB',
          quantity: 3.5,
          vehicle: 'large',
          areaCode: 'yufu',
        },
        expect: {
          unitPrice: 25250,
          materialAmount: 88375,
          emptyLoadAmount: 0,
          subtotal: 88375,
          tax: 8837,
          total: 97212,
        },
      },
      {
        label: '21-18 AE BB / 3.5 / 庄内・湯布院 / 小型',
        params: {
          strength: 21,
          slump: '18',
          admixture: 'AE',
          cement: 'BB',
          quantity: 3.5,
          vehicle: 'small',
          areaCode: 'yufu',
        },
        expect: {
          unitPrice: 29250,
          materialAmount: 102375,
          emptyLoadAmount: 0,
          subtotal: 102375,
          tax: 10237,
          total: 112612,
        },
      },
      {
        label: '24-18 AE N / 10 / 大分 / 大型',
        params: {
          strength: 24,
          slump: '18',
          admixture: 'AE',
          cement: 'N',
          quantity: 10,
          vehicle: 'large',
          areaCode: 'oita',
        },
        expect: {
          unitPrice: 23250,
          materialAmount: 232500,
          emptyLoadAmount: 0,
          subtotal: 232500,
          tax: 23250,
          total: 255750,
        },
      },
      {
        label: '36-18 HP N / 5 / 野津原・挾間・佐賀関 / 大型',
        params: {
          strength: 36,
          slump: '18',
          admixture: 'HP',
          cement: 'N',
          quantity: 5,
          vehicle: 'large',
          areaCode: 'nozuru',
        },
        expect: {
          unitPrice: 28350,
          materialAmount: 141750,
          emptyLoadAmount: 0,
          subtotal: 141750,
          tax: 14175,
          total: 155925,
        },
      },
      {
        label: '24-18 AE N / 2 / 大分 / 大型（空積）',
        params: {
          strength: 24,
          slump: '18',
          admixture: 'AE',
          cement: 'N',
          quantity: 2,
          vehicle: 'large',
          areaCode: 'oita',
        },
        expect: {
          unitPrice: 23250,
          materialAmount: 46500,
          emptyLoadAmount: 1000,
          subtotal: 47500,
          tax: 4750,
          total: 52250,
        },
      },
      {
        label: '24-18 AE N / 1 / 大分 / 小型（空積）',
        params: {
          strength: 24,
          slump: '18',
          admixture: 'AE',
          cement: 'N',
          quantity: 1,
          vehicle: 'small',
          areaCode: 'oita',
        },
        expect: {
          unitPrice: 27250,
          materialAmount: 27250,
          emptyLoadAmount: 500,
          subtotal: 27750,
          tax: 2775,
          total: 30525,
        },
      },
      {
        label: '24-18 AE N / 3 / 大分 / 大型（境界）',
        params: {
          strength: 24,
          slump: '18',
          admixture: 'AE',
          cement: 'N',
          quantity: 3,
          vehicle: 'large',
          areaCode: 'oita',
        },
        expect: {
          unitPrice: 23250,
          materialAmount: 69750,
          emptyLoadAmount: 0,
          subtotal: 69750,
          tax: 6975,
          total: 76725,
        },
      },
      {
        label: '24-18 AE N / 0.3 / 大分 / 大型',
        params: {
          strength: 24,
          slump: '18',
          admixture: 'AE',
          cement: 'N',
          quantity: 0.3,
          vehicle: 'large',
          areaCode: 'oita',
        },
        expect: {
          unitPrice: 23250,
          materialAmount: 6975,
          emptyLoadAmount: 2700,
          subtotal: 9675,
          tax: 967,
          total: 10642,
        },
      },
    ];

    for (const c of cases) {
      const result = calcCashPrice({ priceList: FIXTURE, ...c.params });
      expect(result.ok, c.label).toBe(true);
      expect(result.unitPrice, `${c.label} unit`).toBe(c.expect.unitPrice);
      expect(result.materialAmount, `${c.label} material`).toBe(c.expect.materialAmount);
      expect(result.emptyLoadAmount, `${c.label} empty`).toBe(c.expect.emptyLoadAmount);
      expect(result.subtotal, `${c.label} subtotal`).toBe(c.expect.subtotal);
      expect(result.tax, `${c.label} tax`).toBe(c.expect.tax);
      expect(result.total, `${c.label} total`).toBe(c.expect.total);
    }
  });

  it('returns error for missing mix 33-21 AE', () => {
    const result = calcCashPrice({
      priceList: FIXTURE,
      strength: 33,
      slump: '21',
      admixture: 'AE',
      cement: 'N',
      quantity: 1,
      vehicle: 'large',
      areaCode: 'oita',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('価格表にない配合です（協組へ確認）');
  });

  it('rejects invalid quantity and missing area', () => {
    expect(
      calcCashPrice({
        priceList: FIXTURE,
        strength: 24,
        slump: '18',
        admixture: 'AE',
        cement: 'N',
        quantity: 0,
        vehicle: 'large',
        areaCode: 'oita',
      }).error,
    ).toBe('数量を確認してください');
    expect(
      calcCashPrice({
        priceList: FIXTURE,
        strength: 24,
        slump: '18',
        admixture: 'AE',
        cement: 'N',
        quantity: 1,
        vehicle: 'large',
        areaCode: '',
      }).error,
    ).toBe('地区を選択してください');
  });

  it('calcBothVehicles returns large and small', () => {
    const both = calcBothVehicles({
      priceList: FIXTURE,
      strength: 24,
      slump: '18',
      admixture: 'AE',
      cement: 'N',
      quantity: 1,
      areaCode: 'oita',
    });
    expect(both.large.ok).toBe(true);
    expect(both.small.ok).toBe(true);
    expect(both.small.unitPrice - both.large.unitPrice).toBe(4000);
  });
});
