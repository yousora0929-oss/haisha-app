import { describe, expect, it } from 'vitest';
import { isFactorySpotInboxOrder, splitFactoryInboxOrdersByKind } from './factoryInboxKind.js';
import { chipRoleLabel, getOrderVisibilityScope } from './orderVisibilityScope.js';

describe('splitFactoryInboxOrdersByKind', () => {
  it('splits mixed inbox into assigned (2) and spot (5)', () => {
    const orders = [
      { id: 'a1', is_spot: false },
      { id: 's1', is_spot: true },
      { id: 's2', is_spot: true },
      { id: 'a2', is_spot: false },
      { id: 's3', is_spot: true },
      { id: 's4', is_spot: true },
      { id: 's5', is_spot: true },
    ];
    const { assigned, spot } = splitFactoryInboxOrdersByKind(orders);
    expect(assigned.map((o) => o.id)).toEqual(['a1', 'a2']);
    expect(spot.map((o) => o.id)).toEqual(['s1', 's2', 's3', 's4', 's5']);
    expect(assigned).toHaveLength(2);
    expect(spot).toHaveLength(5);
  });

  it('treats missing is_spot as assigned', () => {
    const { assigned, spot } = splitFactoryInboxOrdersByKind([{ id: 'x' }]);
    expect(assigned.map((o) => o.id)).toEqual(['x']);
    expect(spot).toEqual([]);
  });

  it('hides both sections when empty', () => {
    const { assigned, spot } = splitFactoryInboxOrdersByKind([]);
    expect(assigned).toEqual([]);
    expect(spot).toEqual([]);
  });

  it('detects spot with isFactorySpotInboxOrder', () => {
    expect(isFactorySpotInboxOrder({ is_spot: true })).toBe(true);
    expect(isFactorySpotInboxOrder({ is_spot: false })).toBe(false);
  });
});

describe('assigned order visibility summary for factory mini', () => {
  it('returns FACTORY_03-only summary and main chip without emoji text', () => {
    const project = { id: 'p1', main_factory_id: 'FACTORY_03', sub_factory_ids: [] };
    const order = { id: 'a1', is_spot: false, status: 'pending', project_id: 'p1' };
    const scope = getOrderVisibilityScope(
      order,
      { projectById: { p1: project }, allFactoryIds: ['FACTORY_03'] },
      { FACTORY_03: 'FACTORY_03' },
    );
    expect(scope.summary).toBe('FACTORY_03 のみに表示');
    expect(scope.chips).toEqual([{ id: 'FACTORY_03', name: 'FACTORY_03', role: 'main' }]);
    expect(chipRoleLabel('main')).toBe('メイン');
    expect(scope.summary).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(chipRoleLabel('main')).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});
