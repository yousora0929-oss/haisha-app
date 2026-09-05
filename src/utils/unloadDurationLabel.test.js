import { describe, expect, it } from 'vitest';
import { factoryUnloadDurationLabel, unloadDurationLabel } from './unloadDurationLabel.js';

describe('unloadDurationLabel', () => {
  it('maps known codes', () => {
    expect(unloadDurationLabel('15')).toBe('15分');
    expect(unloadDurationLabel('30')).toBe('30分（標準）');
    expect(unloadDurationLabel('95_plus')).toBe('95分以上（要相談）');
  });

  it('reads from order fields', () => {
    expect(factoryUnloadDurationLabel({ unloadDuration: '45' })).toBe('45分');
    expect(factoryUnloadDurationLabel({ unloadDurationMinutes: '60' })).toContain('60分');
  });
});
