import { describe, expect, it } from 'vitest';
import { orderFieldSnapshotDiffers, snapshotOrderFields } from './orderFieldSnapshot.js';

describe('orderFieldSnapshot', () => {
  const opened = {
    mixText: '18-8-20BB',
    confirmedMixText: '18-8-20BB',
    quantityM3: '3',
    updated_at: '2026-10-11T12:11:37.000Z',
  };

  it('ignores updated_at when only chat has touched the order', () => {
    const snapshot = snapshotOrderFields(opened, ['mixText', 'confirmedMixText']);
    const latest = { ...opened, updated_at: '2026-10-11T12:12:32.000Z' };
    expect(orderFieldSnapshotDiffers(snapshot, latest, ['mixText', 'confirmedMixText'])).toBe(false);
  });

  it('detects a change to a watched field', () => {
    const snapshot = snapshotOrderFields(opened, ['quantityM3', 'mixText']);
    const latest = { ...opened, quantityM3: '4', confirmedQuantityM3: '4' };
    expect(orderFieldSnapshotDiffers(snapshot, latest, ['quantityM3'])).toBe(true);
    expect(orderFieldSnapshotDiffers(snapshot, latest, ['mixText'])).toBe(false);
  });
});