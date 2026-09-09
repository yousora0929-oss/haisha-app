import { describe, expect, it } from 'vitest';
import {
  buildOrderPartyPersistPatch,
  orderPartyInfo,
  resolveOrderContractorDisplayName,
  resolveOrderParties,
  resolveOrderTradingCompanyDisplayName,
} from './orderPartyInfo.js';

const customersById = {
  'cust-contractor': { id: 'cust-contractor', company_name: '山田建設' },
  'cust-orderer': { id: 'cust-orderer', company_name: '大分中央生コンクリート協同組合' },
  'cust-agent': { id: 'cust-agent', company_name: '大陽機材' },
};

const organizationsById = {
  'org-taiho': { id: 'org-taiho', name: '大陽機材㈱', type: 'agent' },
};

describe('resolveOrderParties', () => {
  it('prefers contractor_customer_id over customerName', () => {
    const parties = resolveOrderParties(
      {
        customer_id: 'cust-orderer',
        customerName: '大分中央生コンクリート協同組合',
        contractor_customer_id: 'cust-contractor',
        contractorName: '',
      },
      { customersById, organizationsById },
    );
    expect(parties.contractorName).toBe('山田建設');
    expect(parties.ordererName).toBe('大分中央生コンクリート協同組合');
  });

  it('never uses customerName as the contractor fallback', () => {
    const parties = resolveOrderParties(
      {
        customer_id: 'cust-orderer',
        customerName: '大分中央生コンクリート協同組合',
        contractorName: '',
      },
      { customersById, organizationsById },
    );
    expect(parties.contractorName).toBe('');
    expect(parties.ordererName).toBe('大分中央生コンクリート協同組合');
  });

  it('uses order_data.contractorName for direct orders without contractor_customer_id', () => {
    const parties = resolveOrderParties(
      {
        customer_id: 'cust-contractor',
        customerName: '山田建設',
        contractorName: '山田建設',
      },
      { customersById, organizationsById },
    );
    expect(parties.contractorName).toBe('山田建設');
  });

  it('prefers agent_organization_id over empty trader snapshot', () => {
    const parties = resolveOrderParties(
      {
        agent_organization_id: 'org-taiho',
        traderName: '',
        trading_company_name: '',
      },
      { customersById, organizationsById },
    );
    expect(parties.traderName).toBe('大陽機材㈱');
  });

  it('falls back to trading agent company when organization is missing', () => {
    const parties = resolveOrderParties(
      {
        trading_agent_customer_id: 'cust-agent',
        traderName: '',
      },
      { customersById, organizationsById },
    );
    expect(parties.traderName).toBe('大陽機材');
    expect(parties.tradingAgentCompanyName).toBe('大陽機材');
  });

  it('does not treat a cooperative organization as the trader', () => {
    const parties = resolveOrderParties(
      {
        customerName: '大分中央生コンクリート協同組合',
        agent_organization_id: 'org-coop',
        trading_agent_customer_id: 'cust-agent',
        traderName: '小野建㈱',
      },
      {
        customersById,
        organizationsById: {
          ...organizationsById,
          'org-coop': {
            id: 'org-coop',
            name: '大分中央生コンクリート協同組合',
            type: 'cooperative',
          },
        },
      },
    );
    expect(parties.traderName).toBe('大陽機材');
    expect(parties.ordererName).toBe('大分中央生コンクリート協同組合');
  });

  it('keeps snapshot trader name when IDs are absent', () => {
    const parties = resolveOrderParties(
      { traderName: '梅田建材', trading_company_name: '' },
      { customersById, organizationsById },
    );
    expect(parties.traderName).toBe('梅田建材');
  });
});

describe('orderPartyInfo', () => {
  it('does not show the ordering cooperative as the contractor on agent orders', () => {
    const party = orderPartyInfo(
      {
        customer_id: 'cust-orderer',
        customerName: '大分中央生コンクリート協同組合',
        contractor_customer_id: 'cust-contractor',
        agent_organization_id: 'org-taiho',
        contractorName: '',
        traderName: '',
      },
      { preferSiteContact: true, customersById, organizationsById },
    );
    expect(party.contractorName).toBe('山田建設');
    expect(party.traderName).toBe('大陽機材㈱');
    expect(party.contractor).toContain('山田建設');
    expect(party.contractor).toContain('大陽機材㈱');
    expect(party.contractor).not.toContain('協同組合');
  });
});

describe('buildOrderPartyPersistPatch', () => {
  it('writes IDs and generated display names together', () => {
    const patch = buildOrderPartyPersistPatch(
      {
        contractorCustomerId: 'cust-contractor',
        agentOrganizationId: 'org-taiho',
        tradingAgentCustomerId: 'cust-agent',
      },
      { customersById, organizationsById },
    );
    expect(patch.contractor_customer_id).toBe('cust-contractor');
    expect(patch.contractorName).toBe('山田建設');
    expect(patch.agent_organization_id).toBe('org-taiho');
    expect(patch.traderName).toBe('大陽機材㈱');
    expect(patch.trading_agent_customer_id).toBe('cust-agent');
  });

  it('clears trader snapshot when organization is unset', () => {
    const patch = buildOrderPartyPersistPatch(
      {
        contractorCustomerId: 'cust-contractor',
        agentOrganizationId: '',
        tradingAgentCustomerId: '',
      },
      { customersById, organizationsById },
    );
    expect(patch.agent_organization_id).toBe(null);
    expect(patch.traderName).toBe('');
  });

  it('keeps direct-order contractorName when contractor id stays empty', () => {
    const patch = buildOrderPartyPersistPatch(
      {
        contractorCustomerId: '',
        agentOrganizationId: '',
        tradingAgentCustomerId: '',
      },
      {
        previousOrder: {
          contractorName: '山田建設',
          traderName: '',
        },
      },
    );
    expect(patch.contractor_customer_id).toBe(null);
    expect(patch.contractorName).toBe('山田建設');
  });

  it('does not blank existing trader/contractor snapshots when IDs are unchanged and lookups are missing', () => {
    const patch = buildOrderPartyPersistPatch(
      {
        contractorCustomerId: 'cust-contractor',
        agentOrganizationId: 'org-taiho',
        tradingAgentCustomerId: 'cust-agent',
      },
      {
        previousOrder: {
          contractor_customer_id: 'cust-contractor',
          agent_organization_id: 'org-taiho',
          trading_agent_customer_id: 'cust-agent',
          contractorName: '山田建設',
          traderName: '大陽機材㈱',
          trading_company_name: '',
        },
      },
    );
    expect(patch.contractorName).toBe('山田建設');
    expect(patch.traderName).toBe('大陽機材㈱');
    expect(patch.agent_organization_id).toBe('org-taiho');
    expect(patch.contractor_customer_id).toBe('cust-contractor');
  });
});

describe('legacy helpers', () => {
  it('resolveOrderContractorDisplayName uses ID maps', () => {
    expect(
      resolveOrderContractorDisplayName(
        { contractor_customer_id: 'cust-contractor', customerName: '組合' },
        { customersById },
      ),
    ).toBe('山田建設');
  });

  it('resolveOrderTradingCompanyDisplayName uses organization maps', () => {
    expect(
      resolveOrderTradingCompanyDisplayName(
        { agent_organization_id: 'org-taiho', traderName: '' },
        { organizationsById },
      ),
    ).toBe('大陽機材㈱');
  });
});
