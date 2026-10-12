import { describe, expect, it } from 'vitest';
import {
  formatFactoryCustomerCancelledAt,
  isUnacknowledgedFactoryCustomerCancel,
} from './factoryCustomerCancel.js';

describe('isUnacknowledgedFactoryCustomerCancel', () => {
  const order = {
    status: 'customer_cancelled',
    factory_site_id: 'FACTORY_13',
    factory_cancel_ack_at: null,
  };

  it('matches the assigned factory while unacknowledged', () => {
    expect(isUnacknowledgedFactoryCustomerCancel(order, 'FACTORY_13')).toBe(true);
    expect(isUnacknowledgedFactoryCustomerCancel(order, 'FACTORY_1')).toBe(false);
  });

  it('stops matching after the factory acknowledges', () => {
    expect(
      isUnacknowledgedFactoryCustomerCancel(
        { ...order, factory_cancel_ack_at: '2026-10-11T12:00:00.000Z' },
        'FACTORY_13',
      ),
    ).toBe(false);
  });
});

describe('formatFactoryCustomerCancelledAt', () => {
  it('formats the timestamp in Japan time', () => {
    expect(formatFactoryCustomerCancelledAt('2026-10-11T12:11:00.000Z')).toBe('2026/10/11 21:11');
  });
});