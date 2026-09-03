import { describe, expect, it } from 'vitest';
import {
  resolveOrdererLabel,
  resolveOrdererOrgName,
  resolveOrderPartyDisplay,
} from './projectPartyDisplay.js';

const cooperativeOrg = {
  id: 'org-coop',
  name: '大分中央生コンクリート協同組合',
  type: 'cooperative',
};
const agentOrg = {
  id: 'org-agent',
  name: 'トクヤマ通商㈱',
  type: 'agent',
};
const orderingCustomer = {
  id: 'cust-ueda',
  company_name: '大分中央生コンクリート協同組合',
  manager_name: '植田',
  organization_id: 'org-coop',
  phone_number: '09012345678',
};
const customerById = { 'cust-ueda': orderingCustomer };
const organizationById = {
  'org-coop': cooperativeOrg,
  'org-agent': agentOrg,
};
const proxyOrder = {
  id: 'ord_57ba89fb',
  customer_id: 'cust-ueda',
  ordered_by: '植田',
  agent_organization_id: 'org-agent',
  customerName: '大分中央生コンクリート協同組合',
};

describe('resolveOrdererLabel', () => {
  it('uses the ordering customer org, not agent_organization_id', () => {
    expect(resolveOrdererLabel(proxyOrder, customerById, organizationById)).toBe(
      '大分中央生コンクリート協同組合 植田',
    );
  });

  it('does not concatenate the trading company name with the person name', () => {
    const label = resolveOrdererLabel(proxyOrder, customerById, organizationById);
    expect(label).not.toContain('トクヤマ通商');
  });

  it('falls back to customers.company_name when organization is missing', () => {
    const customer = { ...orderingCustomer, organization_id: null };
    expect(
      resolveOrdererLabel(proxyOrder, { 'cust-ueda': customer }, {}),
    ).toBe('大分中央生コンクリート協同組合 植田');
  });
});

describe('resolveOrdererOrgName', () => {
  it('prefers organizations.name over agent organization', () => {
    expect(resolveOrdererOrgName(proxyOrder, customerById, organizationById)).toBe(
      '大分中央生コンクリート協同組合',
    );
  });
});

describe('resolveOrderPartyDisplay orderedBy', () => {
  it('keeps 発注者 company name independent of agent_organization_id', () => {
    const party = resolveOrderPartyDisplay(proxyOrder, {
      orderingCustomer,
      organizationById,
    });
    expect(party.orderedByCompanyName).toBe('大分中央生コンクリート協同組合');
    expect(party.orderedByLabel).toBe('大分中央生コンクリート協同組合 植田');
    expect(party.orderedByCompanyName).not.toContain('トクヤマ通商');
  });
});
