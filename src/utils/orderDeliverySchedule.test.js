import { describe, expect, it } from 'vitest';
import {
  getOrderDeliveryDateISO,
  isOrderAcceptedByOtherFactory,
  isOrderInHistoryView,
  isOrderInProgressView,
  isOrderVisibleToFactoryHistory,
  isOtherFactoryAcceptedPastHistoryCutoff,
  sortOrdersForHistory,
} from './orderDeliverySchedule.js';

describe('orderDeliverySchedule', () => {
  const today = '2026-06-02';
  const factoryA = 'factory-a';
  const factoryB = 'factory-b';

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

  it('keeps orders with unset or invalid delivery date in progress', () => {
    expect(isOrderInProgressView({ status: 'pending' }, today)).toBe(true);
    expect(isOrderInProgressView({ preferredDate: null, status: 'pending' }, today)).toBe(true);
    expect(isOrderInProgressView({ preferredDate: 'invalid', status: 'pending' }, today)).toBe(true);
    expect(isOrderInHistoryView({ preferredDate: null, status: 'pending' }, today)).toBe(false);
  });

  it('uses scheduleMatchDate when preferredDate is absent', () => {
    const order = { scheduleMatchDate: '2026-06-02', status: 'pending' };
    expect(getOrderDeliveryDateISO(order)).toBe('2026-06-02');
    expect(isOrderInProgressView(order, today)).toBe(true);
  });

  it('sorts history by delivery date descending', () => {
    const sorted = sortOrdersForHistory([
      { preferredDate: '2026-05-01', createdAt: '2026-05-01T10:00:00Z' },
      { preferredDate: '2026-06-01', createdAt: '2026-05-20T10:00:00Z' },
    ]);
    expect(getOrderDeliveryDateISO(sorted[0])).toBe('2026-06-01');
    expect(getOrderDeliveryDateISO(sorted[1])).toBe('2026-05-01');
  });

  it('keeps other-factory accepted in progress until next-day midnight Tokyo', () => {
    const order = {
      status: 'accepted',
      factory_site_id: factoryB,
      preferredDate: '2026-06-10',
      accepted_at: '2026-06-02T10:42:00+09:00',
    };
    const beforeCutoff = Date.parse('2026-06-02T23:59:00+09:00');
    const afterCutoff = Date.parse('2026-06-03T00:01:00+09:00');
    expect(isOrderAcceptedByOtherFactory(order, factoryA)).toBe(true);
    expect(isOtherFactoryAcceptedPastHistoryCutoff(order, factoryA, beforeCutoff)).toBe(false);
    expect(isOtherFactoryAcceptedPastHistoryCutoff(order, factoryA, afterCutoff)).toBe(true);
  });

  it('moves other-factory accepted to history view after acceptance-day midnight', () => {
    const order = {
      status: 'accepted',
      factory_site_id: factoryB,
      preferredDate: '2026-06-10',
      accepted_at: '2026-06-01T15:00:00+09:00',
    };
    expect(isOrderInProgressView(order, today, factoryA)).toBe(false);
    expect(isOrderInHistoryView(order, today, factoryA)).toBe(true);
  });

  it('does not move own-factory accepted to history by accepted_at rule', () => {
    const order = {
      status: 'accepted',
      factory_site_id: factoryA,
      preferredDate: '2026-06-10',
      accepted_at: '2026-06-01T10:00:00+09:00',
    };
    expect(isOtherFactoryAcceptedPastHistoryCutoff(order, factoryA)).toBe(false);
    expect(isOrderInProgressView(order, today, factoryA)).toBe(true);
    expect(isOrderInHistoryView(order, today, factoryA)).toBe(false);
  });

  it('keeps declined and other-factory accepted visible in history source filter', () => {
    expect(
      isOrderVisibleToFactoryHistory(
        { status: 'pending', rejected_factory_ids: [factoryA], preferredDate: '2026-06-10' },
        factoryA,
      ),
    ).toBe(true);
    expect(
      isOrderVisibleToFactoryHistory(
        { status: 'accepted', factory_site_id: factoryB, preferredDate: '2026-06-10' },
        factoryA,
      ),
    ).toBe(true);
    expect(
      isOrderVisibleToFactoryHistory(
        { status: 'accepted', factory_site_id: factoryA, preferredDate: '2026-06-10' },
        factoryA,
      ),
    ).toBe(true);
    expect(
      isOrderVisibleToFactoryHistory(
        { status: 'deleted', factory_site_id: factoryA },
        factoryA,
      ),
    ).toBe(false);
    expect(
      isOrderVisibleToFactoryHistory(
        { status: 'pending_association', preferred_factory_id: factoryA },
        factoryA,
      ),
    ).toBe(false);
  });
});
