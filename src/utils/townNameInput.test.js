import { describe, expect, it } from 'vitest';
import { filterTownSuggestByQuery, getTownNameMatchRank } from './townNameInput.js';

describe('townNameInput suggest sort', () => {
  const pool = ['西大分', '大分駅前', 'おおか', '鶴海おおか'];

  it('ranks prefix match before partial match for 「お」', () => {
    expect(getTownNameMatchRank('おおか', 'お')).toBe(0);
    expect(getTownNameMatchRank('鶴海おおか', 'お')).toBe(1);
    const result = filterTownSuggestByQuery(pool, 'お');
    expect(result[0]).toBe('おおか');
    expect(result.indexOf('鶴海おおか')).toBeGreaterThan(0);
  });

  it('ranks prefix 「大」 before partial 西大分', () => {
    const result = filterTownSuggestByQuery(pool, '大');
    expect(result[0]).toBe('大分駅前');
    expect(result[1]).toBe('西大分');
  });
});
