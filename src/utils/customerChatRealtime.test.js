import { describe, expect, it } from 'vitest';
import { isUnreadChatForCustomer } from './customerChatRealtime.js';

describe('isUnreadChatForCustomer', () => {
  it('returns false when messages is missing or empty', () => {
    expect(isUnreadChatForCustomer(undefined, '')).toBe(false);
    expect(isUnreadChatForCustomer(null, '')).toBe(false);
    expect(isUnreadChatForCustomer([], '')).toBe(false);
  });

  it('returns true for unread factory/admin/system message', () => {
    const messages = [
      { id: 'm1', from: 'factory', body: 'hello', createdAt: '2026-10-02T00:00:00Z' },
    ];
    expect(isUnreadChatForCustomer(messages, '')).toBe(true);
    expect(isUnreadChatForCustomer(messages, 'other|key|factory')).toBe(true);
  });

  it('returns false when latest message is already read', () => {
    const messages = [
      { id: 'm1', from: 'factory', body: 'hello', createdAt: '2026-10-02T00:00:00Z' },
    ];
    expect(isUnreadChatForCustomer(messages, 'm1|2026-10-02T00:00:00Z|factory')).toBe(false);
  });

  it('ignores factory-accepted system messages', () => {
    const messages = [
      { id: 'm1', from: 'system', body: '【受注】工場Aが受注しました', createdAt: '2026-10-02T00:00:00Z' },
    ];
    expect(isUnreadChatForCustomer(messages, '')).toBe(false);
  });
});
