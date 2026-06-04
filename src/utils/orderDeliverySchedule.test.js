import { describe, expect, it } from 'vitest';
import {
  getOrderDeliveryDateISO,
  isOrderInHistoryView,
  isOrderInProgressView,
  sortOrdersForHistory,
} from './orderDeliverySchedule.js';

describe('orderDeliverySchedule', () => {
  const today = '2026-06-02';

  it('treats past delivery as history even when not completed', () => {
    const order = { preferredDate: '2026-06-01', status: 'accepted' };
    expect(isOrderInProgressView(order, today)).toBe(false);
    expect(isOrderInHistoryView(order, today)).toBe(true);
  });

  it('keeps today delivery in progress', () => {
    const order = { delivery_date: '2026-06-02', status: 'accepted' };
    expect(isOrderInProgressView(order, today)).toBe(true);
    expect(isOrderInHistoryView(order, today)).toBe(false);
  });

  it('sorts history by delivery date descending', () => {
    const sorted = sortOrdersForHistory([
      { preferredDate: '2026-05-01', createdAt: '2026-05-01T10:00:00Z' },
      { preferredDate: '2026-06-01', createdAt: '2026-05-20T10:00:00Z' },
    ]);
    expect(getOrderDeliveryDateISO(sorted[0])).toBe('2026-06-01');
    expect(getOrderDeliveryDateISO(sorted[1])).toBe('2026-05-01');
  });
});
