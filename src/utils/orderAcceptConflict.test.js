import { describe, expect, it } from 'vitest';
import {
  acceptBlockedStatusMessage,
  buildFactoryAcceptOrderData,
  formatAcceptVehicleLabel,
  listAcceptContentConflicts,
  normalizeAcceptVehicle,
} from './orderAcceptConflict.js';

function order(overrides = {}) {
  return {
    preferredDate: '2026-10-14',
    timePointLabel: '8:00',
    siteName: '北現場',
    mixText: '21-18-20',
    quantityM3: 5,
    vehicleType: 'large',
    ...overrides,
  };
}

describe('normalizeAcceptVehicle', () => {
  it('maps size aliases and treats blanks as unspecified', () => {
    expect(normalizeAcceptVehicle('small')).toBe('small');
    expect(normalizeAcceptVehicle(' 小型 ')).toBe('small');
    expect(normalizeAcceptVehicle('小型車')).toBe('small');
    expect(normalizeAcceptVehicle('LARGE')).toBe('large');
    expect(normalizeAcceptVehicle('大型')).toBe('large');
    expect(normalizeAcceptVehicle('大型車')).toBe('large');
    for (const value of [null, undefined, '', '  ', 'any', 'none', '指定なし', '未定']) {
      expect(normalizeAcceptVehicle(value)).toBe('unspecified');
    }
  });
});

describe('listAcceptContentConflicts', () => {
  it('ignores background fields and blank-equivalent text', () => {
    const base = order({
      preferredDate: '',
      timePointLabel: null,
      siteName: undefined,
      mixText: '',
      quantityM3: null,
      vehicleType: '',
      updated_at: '2026-10-14T00:00:00.000Z',
      chat_messages: [],
    });
    const latest = order({
      preferredDate: null,
      timePointLabel: '',
      timeSlotLabel: '',
      timeSlot: null,
      siteName: '',
      projectName: '  ',
      mixText: undefined,
      quantityM3: undefined,
      quantityCube: '',
      vehicleType: null,
      vehicleLabel: '指定なし',
      updated_at: '2026-10-14T00:00:01.000Z',
      chat_messages: [{ body: 'hello' }],
      push_notified_at: '2026-10-14T00:00:01.000Z',
      push_notified_map: { a: 1 },
      factory_chat_read_key: 'k',
      customer_chat_read_key: 'c',
      updatedAt: '2026-10-14T00:00:01.000Z',
    });
    expect(listAcceptContentConflicts(base, latest)).toEqual([]);
  });

  it('uses the same fallbacks as the accept dialog', () => {
    const base = order({
      timePointLabel: '',
      timeSlotLabel: '午前',
      siteName: '',
      projectName: '南現場',
      quantityM3: null,
      quantityCube: 3,
      vehicleType: '  ',
      vehicleLabel: '小型車',
    });
    const latest = order({
      timePointLabel: null,
      timeSlotLabel: '',
      timeSlot: '午前',
      siteName: null,
      projectName: '南現場',
      quantityM3: undefined,
      quantityCube: '3.0',
      vehicleType: null,
      vehicleLabel: 'small',
    });
    expect(listAcceptContentConflicts(base, latest)).toEqual([]);
    expect(formatAcceptVehicleLabel(base)).toBe('小型');
  });

  it('prefers the first fallback and reports changed labels', () => {
    const base = order({
      timePointLabel: '8:00',
      timeSlotLabel: '午後',
      siteName: '北現場',
      projectName: '別名',
      quantityM3: 5,
      quantityCube: 9,
      vehicleType: 'large',
      vehicleLabel: '小型',
    });
    const latest = order({
      preferredDate: '2026-10-15',
      timePointLabel: '9:00',
      siteName: '南現場',
      mixText: '24-18-20',
      quantityM3: '6',
      vehicleType: '小型',
    });
    expect(listAcceptContentConflicts(base, latest).map((item) => item.label)).toEqual([
      '日付',
      '時刻',
      '現場',
      '配合',
      '数量',
      '車両',
    ]);
  });

  it('treats numeric quantity strings as the same number', () => {
    expect(listAcceptContentConflicts(order({ quantityM3: 1 }), order({ quantityM3: '1.0' }))).toEqual([]);
    expect(listAcceptContentConflicts(order({ quantityM3: '8' }), order({ quantityM3: 8.5 }))).toEqual([
      { key: 'quantity', label: '数量' },
    ]);
  });
});

describe('acceptBlockedStatusMessage', () => {
  it('separates pending, own accept, other accept, cancel, and the rest', () => {
    expect(acceptBlockedStatusMessage({ status: 'pending' }, 'fac-a')).toBe('');
    expect(acceptBlockedStatusMessage({ status: 'accepted', factory_site_id: 'fac-a' }, 'fac-a')).toBe(
      'この注文はすでに受注済みです。',
    );
    expect(acceptBlockedStatusMessage({ status: 'accepted', factorySiteId: 'fac-b' }, 'fac-a')).toBe(
      'この注文はすでに他工場が受注済みです。',
    );
    expect(acceptBlockedStatusMessage({ status: 'customer_cancelled' }, 'fac-a')).toBe(
      'この注文はお客様によりキャンセルされています。',
    );
    expect(acceptBlockedStatusMessage({ status: 'rejected' }, 'fac-a')).toBe(
      'この注文は現在受注できない状態です。',
    );
  });
});

describe('buildFactoryAcceptOrderData', () => {
  it('keeps background keys in order_data and confirms quantity from latest', () => {
    const raw = {
      quantityM3: 8,
      mixText: '21-18-20',
      factory_chat_read_key: 'read-1',
      push_notified_at: '2026-10-14T01:00:00.000Z',
      chat_messages: [{ body: '残す' }],
      factoryPendingStartedAt: 'old',
    };
    const latest = {
      id: 'ord-1',
      has_test: true,
      quantityM3: 8,
      mixText: '21-18-20',
    };
    const dialog = {
      quantityM3: 3,
      mixText: '古い配合',
      displayTraderName: '商社X',
      displayContractorName: '業者Y',
    };
    const built = buildFactoryAcceptOrderData(raw, latest, 'fac-a', '工場A', '2026-10-14T02:00:00.000Z', dialog);
    expect(built.factory_chat_read_key).toBe('read-1');
    expect(built.push_notified_at).toBe('2026-10-14T01:00:00.000Z');
    expect(built.chat_messages).toEqual([{ body: '残す' }]);
    expect(built.confirmedQuantityM3).toBe(8);
    expect(built.confirmedMixText).toBe('21-18-20');
    expect(built.quantityM3).toBe(8);
    expect(built.status).toBe('accepted');
    expect(built.factory_site_id).toBe('fac-a');
    expect(built.displayTraderName).toBe('商社X');
    expect(built.displayContractorName).toBe('業者Y');
    expect(built.factoryPendingStartedAt).toBeUndefined();
    expect(built.has_test).toBe(true);
  });

  it('keeps display names already stored on the latest order_data', () => {
    const built = buildFactoryAcceptOrderData(
      { displayTraderName: '保存済み' },
      { id: 'ord-1', displayTraderName: '' },
      'fac-a',
      '工場A',
      '2026-10-14T02:00:00.000Z',
      { displayTraderName: '一覧' },
    );
    expect(built.displayTraderName).toBe('保存済み');
  });
});
