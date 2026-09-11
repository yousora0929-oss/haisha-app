import { describe, expect, it } from 'vitest';
import { analyzeFactoryOrderRealtimePayload, detectFactoryNotifyOrderIds } from './factoryOrderRealtime.js';

const FACTORY_ID = 'f1';
const ctx = { projectById: {}, customerById: {} };

function visiblePendingOrder(id, extra = {}) {
  return {
    id,
    status: 'pending',
    association_assigned_factory_ids: [FACTORY_ID],
    ...extra,
  };
}

describe('factory order notify extraction', () => {
  it('notifies a normal pending order that newly becomes visible', () => {
    const next = [visiblePendingOrder('solo')];
    const detected = detectFactoryNotifyOrderIds([], next, FACTORY_ID, ctx);
    expect([...detected.notifyOrderIds]).toEqual(['solo']);
  });

  it('does not escalate reservation_group_id orders as individual new orders', () => {
    const grouped = visiblePendingOrder('g-day', {
      reservation_group_id: 'g1',
      reservation_group: { id: 'g1', status: 'pending', same_factory_required: true },
    });
    const detected = detectFactoryNotifyOrderIds([], [grouped], FACTORY_ID, ctx);
    expect(detected.notifyOrderIds.size).toBe(0);

    const analysis = analyzeFactoryOrderRealtimePayload(
      { eventType: 'INSERT', new: grouped },
      FACTORY_ID,
      ctx,
    );
    expect(analysis.notifyOrderIds.size).toBe(0);
  });

  it('still skips reservation groups after availability is confirmed', () => {
    const confirmed = visiblePendingOrder('g-day', {
      reservation_group_id: 'g1',
      accepted_at: '2026-09-11T01:02:03.456Z',
      factory_site_id: FACTORY_ID,
    });
    const detected = detectFactoryNotifyOrderIds([], [confirmed], FACTORY_ID, ctx);
    expect(detected.notifyOrderIds.size).toBe(0);
  });
});
