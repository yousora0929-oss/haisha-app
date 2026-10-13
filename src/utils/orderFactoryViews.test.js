import { describe, expect, it } from 'vitest';
import {
  adminFactoryViewText,
  customerFactoryViewText,
  isPendingOrderStatus,
} from './orderFactoryViews.js';

describe('orderFactoryViews', () => {
  it('shows a count only while the order is pending', () => {
    expect(isPendingOrderStatus({ status: 'pending' })).toBe(true);
    expect(isPendingOrderStatus({ status: 'accepted' })).toBe(false);
  });

  it('hides factory names from the customer wording', () => {
    expect(customerFactoryViewText(0).text).toBe('まだ工場が確認していません');
    expect(customerFactoryViewText(2).text).toBe('👀 2工場が確認しました');
  });

  it('includes the factory total for admins', () => {
    expect(adminFactoryViewText(2, 13)).toBe('確認済み 2／13工場');
  });
});