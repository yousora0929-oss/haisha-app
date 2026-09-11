import { describe, expect, it } from 'vitest';
import { hasSubmittedSiteMap, isLocationPendingOrder } from './orderWorkflow.js';

describe('hasSubmittedSiteMap', () => {
  it('treats factory manual receipt as submitted without dropping editor checks', () => {
    expect(hasSubmittedSiteMap({ factory_map_received_at: '2026-09-11T12:00:00Z' })).toBe(true);
    expect(hasSubmittedSiteMap({ factoryMapReceivedAt: '2026-09-11T12:00:00Z' })).toBe(true);
    expect(hasSubmittedSiteMap({ override_map_image_url: 'https://example.com/map.png' })).toBe(true);
    expect(hasSubmittedSiteMap({ map_submitted_at: '2026-09-11T12:00:00Z' })).toBe(true);
    expect(hasSubmittedSiteMap({ map_annotations: { imageOverlay: { url: 'https://example.com/x.png' } } })).toBe(true);
    expect(hasSubmittedSiteMap({ map_stamps: [{ id: 1 }] })).toBe(true);
    expect(hasSubmittedSiteMap({ is_location_pending: true })).toBe(false);
  });

  it('clears location-pending when factory recorded an off-app map receipt', () => {
    expect(
      isLocationPendingOrder({
        is_location_pending: true,
        factory_map_received_at: '2026-09-11T12:00:00Z',
      }),
    ).toBe(false);
    expect(isLocationPendingOrder({ is_location_pending: true })).toBe(true);
  });
});
