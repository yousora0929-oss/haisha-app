import { describe, expect, it } from 'vitest';
import {
  formatChangeRequestResolveChatBody,
  listChangeRequestItems,
  pickAcceptedChangeRequestPatch,
  pickDeclinedChangeRequestPatch,
  splitChangeRequestDecisions,
  changeRequestFormFieldsForKeys,
  filterPatchToChangeRequestKeys,
  changeRequestPatchesEqual,
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

  it('copies only keys that exist on the patch when accepting', () => {
    const patch = {
      mixText: '18-15-20BB',
      confirmedMixText: '18-15-20BB',
      timeSlot: '510',
      timeSlotLabel: '8:30',
      timePointLabel: '8:30',
      timeSlotMinutes: 510,
      scheduleMatchMinutes: 510,
    };
    const picked = pickAcceptedChangeRequestPatch(patch, Object.keys(patch));
    expect(Object.keys(picked).sort()).toEqual(Object.keys(patch).sort());
    expect(picked).not.toHaveProperty('preferredDate');
    expect(picked).not.toHaveProperty('quantityM3');
    expect(picked).not.toHaveProperty('siteName');
    expect(picked).not.toHaveProperty('siteAddress');
    expect(picked).not.toHaveProperty('sitePhone');
    expect(picked).not.toHaveProperty('contractorName');
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

  it('builds a partial answer chat body', () => {
    const { accepted, declined } = splitChangeRequestDecisions(patch, ['quantityM3']);
    const body = formatChangeRequestResolveChatBody({
      factoryName: '第一工場',
      acceptedItems: accepted,
      declinedItems: declined,
    });
    expect(body).toBe(
      [
        '⚠️ 一部のみ変更を承りました（第一工場）',
        '承諾した変更：数量 12m³',
        '対応できなかった変更：打設日 9/20（日）、配合 33-15-20N（元の内容のままです）',
        'ご相談はこのチャット、または電話でお知らせください。',
      ].join('\n'),
    );
  });

  it('builds an all-accepted chat body from the new values', () => {
    const { accepted, declined } = splitChangeRequestDecisions(patch, Object.keys(patch));
    const body = formatChangeRequestResolveChatBody({
      factoryName: '第一工場',
      acceptedItems: accepted,
      declinedItems: declined,
    });
    expect(body).toBe(
      [
        '✅ 変更を承りました（第一工場）',
        '変更後の内容：打設日 9/20（日）、数量 12m³、配合 33-15-20N',
      ].join('\n'),
    );
  });

  it('builds an all-declined chat body from the order that stayed unchanged', () => {
    const timePatch = {
      mixText: '18-15-20BB',
      confirmedMixText: '18-15-20BB',
      timeSlot: '510',
      timeSlotLabel: '8:30',
      timePointLabel: '8:30',
      timeSlotMinutes: 510,
      scheduleMatchMinutes: 510,
    };
    const { accepted, declined } = splitChangeRequestDecisions(timePatch, []);
    const body = formatChangeRequestResolveChatBody({
      factoryName: '㈱九大技建',
      acceptedItems: accepted,
      declinedItems: declined,
      order: {
        preferredDate: '2026-10-15',
        timePointLabel: '10:00',
        mixText: '18-8-20BB',
      },
    });
    expect(body).toBe(
      [
        '❌ 変更に対応できませんでした（㈱九大技建）',
        '対応できなかった変更：時刻 8:30、配合 18-15-20BB',
        'ご注文は元の内容のままです：打設日 10/15（木）、時刻 10:00、配合 18-8-20BB',
        'ご相談はこのチャット、または電話でお知らせください。',
      ].join('\n'),
    );
  });

  it('maps declined keys to form fields and compares patch summaries', () => {
    const fields = changeRequestFormFieldsForKeys(['preferredDate', 'quantityM3']);
    expect([...fields].sort()).toEqual(['preferredDate', 'quantityM3']);
    const filtered = filterPatchToChangeRequestKeys(patch, ['mixText']);
    expect(Object.keys(filtered).sort()).toEqual(['confirmedMixText', 'mixText']);
    expect(
      changeRequestPatchesEqual(
        { mixText: '33-15-20N', confirmedMixText: '33-15-20N' },
        { mixText: '33-15-20N' },
      ),
    ).toBe(true);
    expect(changeRequestPatchesEqual({ mixText: 'A' }, { mixText: 'B' })).toBe(false);
  });
});
