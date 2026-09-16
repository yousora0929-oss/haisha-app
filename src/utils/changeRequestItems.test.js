import { describe, expect, it } from 'vitest';
import {
  formatChangeRequestResolveChatBody,
  listChangeRequestItems,
  pickAcceptedChangeRequestPatch,
  pickDeclinedChangeRequestPatch,
  splitChangeRequestDecisions,
} from './changeRequestItems.js';

describe('changeRequestItems', () => {
  const patch = {
    preferredDate: '2026-09-20',
    scheduleMatchDate: '2026-09-20',
    mixText: '33-15-20N',
    confirmedMixText: '33-15-20N',
    quantityM3: '12',
  };

  it('groups related patch keys into selectable items', () => {
    const items = listChangeRequestItems(patch);
    expect(items.map((item) => item.id)).toEqual(['preferredDate', 'quantity', 'mix']);
    expect(items.find((item) => item.id === 'preferredDate').keys).toEqual([
      'preferredDate',
      'scheduleMatchDate',
    ]);
  });

  it('keeps only accepted keys when building the apply patch', () => {
    const picked = pickAcceptedChangeRequestPatch(patch, ['mixText', 'confirmedMixText']);
    expect(picked).toEqual({
      mixText: '33-15-20N',
      confirmedMixText: '33-15-20N',
    });
    const qty = pickAcceptedChangeRequestPatch(patch, ['quantityM3']);
    expect(qty.confirmedQuantityM3).toBe('12');
  });

  it('keeps only declined keys when building re-request patch', () => {
    const declined = pickDeclinedChangeRequestPatch(patch, ['mixText', 'confirmedMixText']);
    expect(declined).toEqual({
      preferredDate: '2026-09-20',
      scheduleMatchDate: '2026-09-20',
      quantityM3: '12',
      confirmedQuantityM3: '12',
    });
  });

  it('splits accepted vs declined items from acceptedKeys', () => {
    const { accepted, declined } = splitChangeRequestDecisions(patch, ['mixText']);
    expect(accepted.map((item) => item.id)).toEqual(['mix']);
    expect(declined.map((item) => item.id)).toEqual(['preferredDate', 'quantity']);
  });

  it('builds a chat body with accepted and declined lines', () => {
    const { accepted, declined } = splitChangeRequestDecisions(patch, ['quantityM3']);
    const body = formatChangeRequestResolveChatBody({
      factoryName: '第一工場',
      acceptedItems: accepted,
      declinedItems: declined,
    });
    expect(body).toContain('【変更依頼への回答】第一工場');
    expect(body).toContain('承諾した項目:');
    expect(body).toContain('対応不可の項目:');
    expect(body).toContain('承諾した項目を注文へ反映しました。');
  });

  it('builds a deferred chat body when awaiting customer', () => {
    const { accepted, declined } = splitChangeRequestDecisions(patch, ['quantityM3']);
    const body = formatChangeRequestResolveChatBody({
      factoryName: '第一工場',
      acceptedItems: accepted,
      declinedItems: declined,
      deferredApply: true,
    });
    expect(body).toContain('お客様の確認をお待ちしています');
    expect(body).not.toContain('承諾した項目を注文へ反映しました。');
  });
});
