import { describe, expect, it } from 'vitest';
import { buildDispatchOrderForDate } from './dispatchBulkOrder.js';
import {
  applyCarryOverMapToOrder,
  buildRepeatMapCarryAnchorKey,
  extractCarryOverMap,
  stripMapFieldsFromRepeatSource,
} from './repeatOrderMap.js';

const columnAnnotations = { stamps: [{ id: 'col' }], comments: [{ text: '列' }] };
const orderDataAnnotations = { unloadPoints: [{ id: 'od' }], comments: [{ text: 'データ' }] };

describe('extractCarryOverMap', () => {
  it('reads a map that exists only on the dedicated columns', () => {
    const carry = extractCarryOverMap({
      id: 'col-only',
      override_map_image_url: 'https://example.com/column.png',
      map_annotations: columnAnnotations,
    });
    expect(carry.overrideMapImageUrl).toBe('https://example.com/column.png');
    expect(carry.mapAnnotations).toEqual(columnAnnotations);
    expect(carry.sourceOrderId).toBe('col-only');
  });

  it('reads a map that exists only in order_data', () => {
    const carry = extractCarryOverMap({
      id: 'data-only',
      order_data: {
        overrideMapImageUrl: 'https://example.com/data.png',
        mapAnnotations: orderDataAnnotations,
        map_stamps: [{ id: 'legacy' }],
      },
    });
    expect(carry.overrideMapImageUrl).toBe('https://example.com/data.png');
    expect(carry.mapAnnotations).toEqual(orderDataAnnotations);
    expect(carry.mapStamps).toEqual([{ id: 'legacy' }]);
  });

  it('prefers dedicated columns when both the column and order_data have a map', () => {
    const carry = extractCarryOverMap({
      id: 'both',
      override_map_image_url: 'https://example.com/column.png',
      map_annotations: columnAnnotations,
      order_data: {
        override_map_image_url: 'https://example.com/data.png',
        map_annotations: orderDataAnnotations,
      },
    });
    expect(carry.overrideMapImageUrl).toBe('https://example.com/column.png');
    expect(carry.mapAnnotations).toEqual(columnAnnotations);
  });

  it('returns null when there is no order-specific map', () => {
    expect(extractCarryOverMap({ id: 'none', siteName: '現場' })).toBe(null);
    expect(extractCarryOverMap({ id: 'empty', map_annotations: {} })).toBe(null);
    const order = { id: 'plain', siteName: '現場' };
    expect(applyCarryOverMapToOrder(order, null)).toBe(order);
  });
});

describe('applyCarryOverMapToOrder', () => {
  it('deep-copies annotations and does not set map_submitted_at', () => {
    const sourceAnnotations = { comments: [{ text: '日付限定' }], stamps: [{ id: 's' }] };
    const carry = extractCarryOverMap({
      id: 'src-1',
      override_map_image_url: 'https://example.com/map.png',
      map_annotations: sourceAnnotations,
      map_stamps: [{ id: 'legacy' }],
    });
    const next = applyCarryOverMapToOrder({ id: 'new', is_location_pending: true }, carry);
    sourceAnnotations.comments[0].text = '変更';
    carry.mapAnnotations.comments[0].text = 'carry側';
    expect(next.map_annotations.comments[0].text).toBe('日付限定');
    expect(next.map_annotations).not.toBe(sourceAnnotations);
    expect(next.map_stamps).toEqual([{ id: 'legacy' }]);
    expect(next.map_stamps).not.toBe(carry.mapStamps);
    expect(next.override_map_image_url).toBe('https://example.com/map.png');
    expect(next.map_image_url).toBe('https://example.com/map.png');
    expect(next.is_location_pending).toBe(false);
    expect(next.isLocationPending).toBe(false);
    expect(next.map_carried_from_order_id).toBe('src-1');
    expect(next.map_submitted_at).toBeUndefined();
    expect(next.mapSubmittedAt).toBeUndefined();
  });
});

describe('stripMapFieldsFromRepeatSource', () => {
  it('drops every map key, including factory receipt fields, in snake and camel case', () => {
    const item = {
      siteName: '現場',
      map_annotations: { stamps: [{ id: 'a' }] },
      mapAnnotations: { stamps: [{ id: 'b' }] },
      map_stamps: [{ id: 'c' }],
      mapStamps: [{ id: 'd' }],
      map_submitted_at: '2026-10-01T00:00:00Z',
      mapSubmittedAt: '2026-10-01T00:00:00Z',
      override_map_image_url: 'https://example.com/a.png',
      overrideMapImageUrl: 'https://example.com/b.png',
      map_image_url: 'https://example.com/c.png',
      mapImageUrl: 'https://example.com/d.png',
      factory_map_received_at: '2026-10-02T00:00:00Z',
      factoryMapReceivedAt: '2026-10-02T00:00:00Z',
      factory_map_received_by: 'factory-1',
      factoryMapReceivedBy: 'factory-1',
      url_token: 'keep-me',
    };
    const stripped = stripMapFieldsFromRepeatSource(item);
    expect(stripped.siteName).toBe('現場');
    expect(stripped.url_token).toBe('keep-me');
    expect(item.factory_map_received_at).toBe('2026-10-02T00:00:00Z');
    for (const key of [
      'map_annotations',
      'mapAnnotations',
      'map_stamps',
      'mapStamps',
      'map_submitted_at',
      'mapSubmittedAt',
      'override_map_image_url',
      'overrideMapImageUrl',
      'map_image_url',
      'mapImageUrl',
      'factory_map_received_at',
      'factoryMapReceivedAt',
      'factory_map_received_by',
      'factoryMapReceivedBy',
    ]) {
      expect(stripped).not.toHaveProperty(key);
    }
  });
});

describe('buildRepeatMapCarryAnchorKey', () => {
  const base = {
    orderKind: 'spot',
    projectId: '',
    deliveryLat: '33.2',
    deliveryLng: '131.6',
    deliveryArea: '大分市',
    siteAddressDetail: '中央町',
    siteAddress: '大分市中央町',
  };

  it('changes when the order kind, project, coordinates, or address change', () => {
    const key = buildRepeatMapCarryAnchorKey(base);
    expect(buildRepeatMapCarryAnchorKey(base)).toBe(key);
    expect(buildRepeatMapCarryAnchorKey({ ...base, deliveryLat: '33.3' })).not.toBe(key);
    expect(buildRepeatMapCarryAnchorKey({ ...base, deliveryLng: '131.7' })).not.toBe(key);
    expect(buildRepeatMapCarryAnchorKey({ ...base, deliveryArea: '別府市' })).not.toBe(key);
    expect(buildRepeatMapCarryAnchorKey({ ...base, siteAddressDetail: '駅前' })).not.toBe(key);
    expect(buildRepeatMapCarryAnchorKey({ ...base, siteAddress: '大分市駅前' })).not.toBe(key);
    expect(buildRepeatMapCarryAnchorKey({ ...base, orderKind: 'project', projectId: 'p1' })).not.toBe(key);
    expect(
      buildRepeatMapCarryAnchorKey({ ...base, orderKind: 'project', projectId: 'p1' }),
    ).not.toBe(buildRepeatMapCarryAnchorKey({ ...base, orderKind: 'project', projectId: 'p2' }));
  });
});

describe('buildDispatchOrderForDate map carry', () => {
  const context = {
    orderKind: 'spot',
    currentCustomerId: 'c1',
    currentCustomer: { company_name: 'A', phone_number: '1', manager_name: '担当' },
    timeSlot: '480',
    quantityM3: '3',
    mixText: '21-18-20',
    siteName: '現場',
    deliveryArea: '大分市',
    siteAddressDetail: '中央町',
    deliveryLat: '33.2',
    deliveryLng: '131.6',
    isLocationPending: true,
    vehicleType: 'large',
    unloadDuration: '30',
  };

  it('leaves the order unchanged when there is no carry', () => {
    const withoutKey = buildDispatchOrderForDate('2026-10-08', context);
    const withNull = buildDispatchOrderForDate('2026-10-08', { ...context, repeatMapCarry: null });
    delete withoutKey.createdAt;
    delete withNull.createdAt;
    expect(withNull).toEqual(withoutKey);
    expect(withoutKey.map_carried_from_order_id).toBeUndefined();
    expect(withoutKey.is_location_pending).toBe(true);
  });

  it('applies the carried map only when carry is present', () => {
    const carry = extractCarryOverMap({
      id: 'src-2',
      override_map_image_url: 'https://example.com/map.png',
      map_annotations: { comments: [{ text: '残す' }] },
    });
    const order = buildDispatchOrderForDate('2026-10-08', {
      ...context,
      repeatMapCarry: { carry },
    });
    expect(order.override_map_image_url).toBe('https://example.com/map.png');
    expect(order.map_annotations.comments[0].text).toBe('残す');
    expect(order.map_carried_from_order_id).toBe('src-2');
    expect(order.map_submitted_at).toBeUndefined();
    expect(order.is_location_pending).toBe(false);
    expect(order.siteName).toBe('現場');
    expect(order.quantityM3).toBe('3');
  });
});
