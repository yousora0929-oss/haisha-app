import { describe, expect, it } from 'vitest';
import { buildRepeatOrderDraft } from './dispatchBulkOrder.js';

describe('buildRepeatOrderDraft', () => {
  const factoryA = { id: 'fac-a', name: 'A工場' };
  const past = {
    id: 'ord-1',
    status: 'accepted',
    project_id: 'proj-1',
    is_spot: false,
    preferred_factory_id: 'fac-a',
    agent_organization_id: 'org-1',
    trading_company_name: '〇〇商社',
    contractor_customer_id: 'ctr-1',
    contractorName: '業者A',
    mixText: '21-18-20N',
    quantityM3: '5',
    vehicleType: 'large',
    unloadDuration: '30',
    siteName: '現場X',
    delivery_area: '大分市',
    site_address_detail: '中央町1',
    sitePhone: '09011112222',
    orderedBy: '現場太郎',
    siteContactName: '現場太郎',
    preferredDate: '2026-01-10',
    timeSlot: '540',
    factoryResponseStatus: 'accepted',
    rejected_factory_ids: ['fac-b'],
    chat_messages: [{ id: 1 }],
    customer_cancel_requested: true,
  };

  it('copies editable fields and clears dates', () => {
    const draft = buildRepeatOrderDraft(past, { id: 'user-1' }, { factories: [factoryA] });
    expect(draft.orderKind).toBe('project');
    expect(draft.selectedProjectId).toBe('proj-1');
    expect(draft.preferredFactoryId).toBe('fac-a');
    expect(draft.quantityM3).toBe('5');
    expect(draft.mixText).toBe('21-18-20N');
    expect(draft.siteContactName).toBe('現場太郎');
    expect(draft.preferredDate).toBe('');
    expect(draft.timeSlot).toBe('');
    expect(draft.traderName).toBe('〇〇商社');
    expect(draft.agentOrganizationId).toBe('org-1');
    expect(draft.contractorCustomerId).toBe('ctr-1');
    expect(draft.fromHistoryRepeat).toBe(true);
  });

  it('clears trading_company_name when agent_organization_id is null', () => {
    const draft = buildRepeatOrderDraft(
      { ...past, agent_organization_id: null, trading_company_name: '残ってはいけない' },
      null,
      { factories: [factoryA] },
    );
    expect(draft.agentOrganizationId).toBe(null);
    expect(draft.traderName).toBe('');
    expect(draft.tradingCompanyName).toBe('');
  });

  it('clears preferred factory when not selectable', () => {
    const draft = buildRepeatOrderDraft(past, null, { factories: [{ id: 'other' }] });
    expect(draft.preferredFactoryId).toBe('');
  });

  it('lists non-copied keys as ignored', () => {
    const draft = buildRepeatOrderDraft(past, null, { factories: [factoryA] });
    expect(draft.ignoredOrderDataKeys).toContain('factoryResponseStatus');
    expect(draft.ignoredOrderDataKeys).toContain('chat_messages');
    expect(draft.ignoredOrderDataKeys).toContain('customer_cancel_requested');
    expect(draft.ignoredOrderDataKeys).not.toContain('mixText');
  });

  it('does not set ordered_by from login user', () => {
    const draft = buildRepeatOrderDraft(past, { manager_name: 'ログイン担当' }, { factories: [factoryA] });
    expect(draft).not.toHaveProperty('ordered_by');
    expect(draft).not.toHaveProperty('orderPlacerName');
  });
});
