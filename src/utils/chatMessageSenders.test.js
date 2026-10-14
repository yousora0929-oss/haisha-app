import { describe, expect, it } from 'vitest';
import { customerChatDisplayName, factoryChatDisplayName } from './chatMessageSenders.js';

const names = { f1: '九大技建', f2: '別工場' };

describe('chat factory sender labels', () => {
  it('shows the factory name to customers when factoryId is present', () => {
    expect(customerChatDisplayName('factory', '担当者', { factoryId: 'f1', factoryNameById: names })).toBe('九大技建');
  });

  it('keeps the generic factory label when factoryId is missing or unknown', () => {
    expect(customerChatDisplayName('factory', '担当者', { factoryNameById: names })).toBe('工場');
    expect(customerChatDisplayName('factory', '担当者', { factoryId: 'missing', factoryNameById: names })).toBe('工場');
  });

  it('keeps the own-factory label on the factory screen', () => {
    expect(
      factoryChatDisplayName('factory', '担当者', '工場（この端末）', {
        factoryId: 'f1',
        ownFactoryId: 'f1',
        factoryNameById: names,
      }),
    ).toBe('工場（この端末）');
    expect(
      factoryChatDisplayName('factory', '担当者', '工場（この端末）', {
        factoryId: 'f2',
        ownFactoryId: 'f1',
        factoryNameById: names,
      }),
    ).toBe('別工場');
    expect(factoryChatDisplayName('factory', '担当者')).toBe('工場（この端末）');
  });
});