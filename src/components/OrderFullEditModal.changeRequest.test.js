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
});
