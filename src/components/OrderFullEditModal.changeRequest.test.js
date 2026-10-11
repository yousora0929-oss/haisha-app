import { describe, expect, it } from 'vitest';
import {
  buildChangeRequestChatMessage,
  buildChangeRequestDiffRows,
  buildChangeRequestPatch,
} from '../components/OrderFullEditModal.jsx';

describe('buildChangeRequestPatch', () => {
  it('includes mixText when confirmed mix changes', () => {
    const patch = buildChangeRequestPatch(
      { confirmedMixText: '18-15-20N', mixText: '18-15-20N' },
      { mixText: '33(27+6)-15-20N' },
    );
    expect(patch.mixText).toBe('33(27+6)-15-20N');
    expect(patch.confirmedMixText).toBe('33(27+6)-15-20N');
  });

  it('includes trader fields when agent_organization_id changes', () => {
    const patch = buildChangeRequestPatch(
      {
        agent_organization_id: null,
        traderName: '大分中央生コンクリート協同組合',
      },
      {
        agent_organization_id: 'org-taiho',
        traderName: '大陽機材㈱',
        trading_company_name: '大陽機材㈱',
      },
    );
    expect(patch.agent_organization_id).toBe('org-taiho');
    expect(patch.traderName).toBe('大陽機材㈱');
    expect(patch.trading_company_name).toBe('大陽機材㈱');
    expect(patch.projectTradingCompanyName).toBe('大陽機材㈱');
  });

  it('includes trader fields when only display name changes', () => {
    const patch = buildChangeRequestPatch(
      { agent_organization_id: null, traderName: '旧商社' },
      { agent_organization_id: null, traderName: '新商社' },
    );
    expect(patch.traderName).toBe('新商社');
    expect(patch.trading_company_name).toBe('新商社');
  });

  it('includes contractor_customer_id when the contractor changes', () => {
    const patch = buildChangeRequestPatch(
      {
        contractor_customer_id: 'cust-old',
        contractorName: '旧業者',
      },
      {
        contractor_customer_id: 'cust-new',
        contractorName: '新業者',
      },
    );
    expect(patch.contractor_customer_id).toBe('cust-new');
    expect(patch.contractorName).toBe('新業者');
  });

  it('still includes contractorName and timeSlot', () => {
    const patch = buildChangeRequestPatch(
      { contractorName: '', timeSlot: '480', timeSlotLabel: '8:00' },
      {
        contractorName: '㈱フジタ',
        timeSlot: '540',
        timeSlotLabel: '9:00',
        timePointLabel: '9:00',
        timeSlotMinutes: 540,
      },
    );
    expect(patch.contractorName).toBe('㈱フジタ');
    expect(patch.timeSlot).toBe('540');
    expect(patch.timeSlotLabel).toBe('9:00');
  });
});

describe('buildChangeRequestDiffRows / chat', () => {
  it('lists mix and trader in the same order as the chat message', () => {
    const order = {
      confirmedMixText: '18-15-20N',
      agent_organization_id: null,
      traderName: '大分中央生コンクリート協同組合',
    };
    const patch = {
      mixText: '33(27+6)-15-20N',
      agent_organization_id: 'org-taiho',
      traderName: '大陽機材㈱',
      trading_company_name: '大陽機材㈱',
    };
    const rows = buildChangeRequestDiffRows(order, patch);
    expect(rows.map((r) => r.label)).toEqual(['配合', '商社']);
    const structured = buildChangeRequestPatch(order, patch);
    expect(Object.keys(structured).length).toBeGreaterThan(0);
    expect(structured.mixText).toBeTruthy();
    expect(structured.traderName).toBeTruthy();
    const message = buildChangeRequestChatMessage(order, patch);
    expect(message).toContain('配合:');
    expect(message).toContain('商社:');
  });

  it('shows only keys present in the patch and labels an explicit blank as 空欄にする', () => {
    const order = {
      preferredDate: '2026-10-15',
      delivery_date: '2026-10-15',
      timePointLabel: '10:00',
      quantityM3: '3',
      confirmedQuantityM3: '3',
      mixText: '18-8-20BB',
      confirmedMixText: '18-8-20BB',
      siteName: '現場A',
      siteAddress: '大分市',
      sitePhone: '09000000000',
      contractorName: '山田建設',
    };
    const patch = {
      mixText: '18-15-20BB',
      confirmedMixText: '18-15-20BB',
      timeSlot: '510',
      timeSlotLabel: '8:30',
      timePointLabel: '8:30',
      timeSlotMinutes: 510,
      scheduleMatchMinutes: 510,
    };
    const rows = buildChangeRequestDiffRows(order, patch);
    expect(rows).toEqual([
      { label: '希望時刻', before: '10:00', after: '8:30' },
      { label: '配合', before: '18-8-20BB', after: '18-15-20BB' },
    ]);

    const cleared = buildChangeRequestDiffRows(
      { mixText: '18-8-20BB', confirmedMixText: '18-8-20BB', siteName: '現場A' },
      { mixText: '', confirmedMixText: '' },
    );
    expect(cleared).toEqual([
      { label: '配合', before: '18-8-20BB', after: '（空欄にする）' },
    ]);
  });
});
