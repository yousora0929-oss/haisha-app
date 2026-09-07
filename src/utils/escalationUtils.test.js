import { describe, expect, it } from 'vitest';
import {
  getOrderEscalationStepInfo,
  rankFactoryIdsByDistance,
  rankFactoryIdsNearestThenCheapest,
} from './escalationUtils.js';

describe('rankFactoryIdsNearestThenCheapest', () => {
  it('keeps distance ascending when all volumes are equal (要町 production case)', () => {
    const ids = rankFactoryIdsNearestThenCheapest(
      [
        { id: 'FACTORY_01', dist: 2.4, vol: 0 },
        { id: 'FACTORY_02', dist: 1.3, vol: 0 },
        { id: 'FACTORY_03', dist: 2.0, vol: 0 },
        { id: 'FACTORY_04', dist: 2.8, vol: 0 },
        { id: 'FACTORY_05', dist: 3.6, vol: 0 },
      ],
      5,
    );
    expect(ids).toEqual([
      'FACTORY_02',
      'FACTORY_03',
      'FACTORY_01',
      'FACTORY_04',
      'FACTORY_05',
    ]);
  });

  it('ranks the cheaper factory first among the nearest N, then keeps farther factories by distance', () => {
    const ids = rankFactoryIdsNearestThenCheapest(
      [
        { id: 'A', dist: 1, vol: 100 },
        { id: 'B', dist: 2, vol: 10 },
        { id: 'C', dist: 3, vol: 50 },
        { id: 'D', dist: 10, vol: 0 },
      ],
      3,
    );
    expect(ids.slice(0, 3)).toEqual(['B', 'C', 'A']);
    expect(ids[3]).toBe('D');
  });
});

describe('rankFactoryIdsByDistance', () => {
  const SITE = { lat: 33.24, lng: 131.61 };

  function factoryAt(id, dLat) {
    return { id, latitude: SITE.lat + dLat, longitude: SITE.lng };
  }

  it('returns mixed-distance factories in distance ascending order when volumes are equal', () => {
    const factories = [
      factoryAt('FACTORY_01', 0.022),
      factoryAt('FACTORY_02', 0.012),
      factoryAt('FACTORY_03', 0.018),
      factoryAt('FACTORY_04', 0.025),
      factoryAt('FACTORY_05', 0.032),
    ];
    const order = { id: 'ord_test', is_spot: true };
    const monthlyVolumeByFactory = Object.fromEntries(factories.map((f) => [f.id, 0]));

    const ids = rankFactoryIdsByDistance(
      order,
      {},
      SITE,
      factories,
      [],
      monthlyVolumeByFactory,
      0.7,
      5,
      {},
    );

    expect(ids).toEqual([
      'FACTORY_02',
      'FACTORY_03',
      'FACTORY_01',
      'FACTORY_04',
      'FACTORY_05',
    ]);
  });
});

describe('getOrderEscalationStepInfo anchor', () => {
  const SITE = { lat: 33.24, lng: 131.61 };

  function factoryAt(id, dLat) {
    return { id, latitude: SITE.lat + dLat, longitude: SITE.lng };
  }

  it('uses the nearest factory as anchor for a spot order with no preferred/main', () => {
    const factories = [
      factoryAt('FACTORY_01', 0.022),
      factoryAt('FACTORY_02', 0.012),
      factoryAt('FACTORY_03', 0.018),
      factoryAt('FACTORY_04', 0.025),
      factoryAt('FACTORY_05', 0.032),
    ];
    const order = {
      id: 'ord_b912f1e4-496d-47d7-b52c-0faf83669a16',
      is_spot: true,
      status: 'pending',
      created_at: '2026-09-07T00:00:00.000Z',
      delivery_lat: SITE.lat,
      delivery_lng: SITE.lng,
    };
    const ctx = {
      factories,
      projectById: {},
      globalAllowedAreas: [],
      monthlyVolumeByFactory: Object.fromEntries(factories.map((f) => [f.id, 0])),
      nearPoolSize: 5,
      factorySmallVehicleInfo: {},
      escalationStepsByFactoryId: {},
      settings: { start_time: '00:00', end_time: '23:59' },
      holidays: [],
      now: new Date('2026-09-07T01:00:00.000Z'),
    };

    const info = getOrderEscalationStepInfo(order, ctx);
    expect(info.anchorId).toBe('FACTORY_02');
  });
});
