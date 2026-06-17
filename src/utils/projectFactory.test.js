import { describe, expect, it } from 'vitest';
import {
  resolveGuestPreferredFactoryId,
  resolveProjectMainFactoryId,
  swapMainFactorySubIds,
} from './projectFactory.js';

describe('resolveProjectMainFactoryId', () => {
  it('returns main_factory_id when set', () => {
    expect(resolveProjectMainFactoryId({ main_factory_id: 'a-1' })).toBe('a-1');
  });

  it('returns empty string when project is null or main is unset', () => {
    expect(resolveProjectMainFactoryId(null)).toBe('');
    expect(resolveProjectMainFactoryId({ main_factory_id: null })).toBe('');
  });
});

describe('resolveGuestPreferredFactoryId', () => {
  it('mirrors project main factory id', () => {
    expect(resolveGuestPreferredFactoryId({ main_factory_id: 'f-main' })).toBe('f-main');
    expect(resolveGuestPreferredFactoryId({})).toBe('');
  });
});

describe('swapMainFactorySubIds', () => {
  it('moves old main to sub and removes new main from sub', () => {
    const next = swapMainFactorySubIds(new Set(['b', 'c']), 'a', 'b');
    expect([...next].sort()).toEqual(['a', 'c']);
  });

  it('does not add empty old main', () => {
    const next = swapMainFactorySubIds(new Set(['b']), '', 'b');
    expect([...next]).toEqual([]);
  });
});
