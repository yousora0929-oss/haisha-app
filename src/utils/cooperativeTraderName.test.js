import { describe, expect, it } from 'vitest';
import {
  COOPERATIVE_OWN_ORG_TRADER_ERROR,
  isCooperativeOwnOrgTraderName,
  normalizeTraderCompareKey,
} from './cooperativeTraderName.js';
import { validateCartLineForm } from './dispatchBulkOrder.js';

describe('normalizeTraderCompareKey', () => {
  it('strips half-width and full-width spaces and applies NFKC', () => {
    expect(normalizeTraderCompareKey('  大分中央生コンクリート協同組合　')).toBe(
      '大分中央生コンクリート協同組合',
    );
    expect(normalizeTraderCompareKey('大分　中央 生コンクリート協同組合')).toBe(
      '大分中央生コンクリート協同組合',
    );
  });
});

describe('isCooperativeOwnOrgTraderName', () => {
  const org = '大分中央生コンクリート協同組合';

  it('blocks cooperative when trader name matches own org name', () => {
    expect(isCooperativeOwnOrgTraderName('cooperative', org, org)).toBe(true);
    expect(isCooperativeOwnOrgTraderName('cooperative', `　${org} `, org)).toBe(true);
  });

  it('allows cooperative when trader name is empty or a different company', () => {
    expect(isCooperativeOwnOrgTraderName('cooperative', '', org)).toBe(false);
    expect(isCooperativeOwnOrgTraderName('cooperative', 'トクヤマ通商㈱', org)).toBe(false);
  });

  it('does not apply to agent even when trader name equals own company name', () => {
    expect(isCooperativeOwnOrgTraderName('agent', 'トクヤマ通商㈱', 'トクヤマ通商㈱')).toBe(false);
  });

  it('does not apply to contractor', () => {
    expect(isCooperativeOwnOrgTraderName('contractor', org, org)).toBe(false);
    expect(isCooperativeOwnOrgTraderName('contractor', '梅田建材', org)).toBe(false);
  });

  it('exports a user-facing error message', () => {
    expect(COOPERATIVE_OWN_ORG_TRADER_ERROR).toContain('商社欄に組合名');
  });
});

function spotContext(overrides) {
  return {
    currentCustomerId: 'cust-1',
    orderKind: 'spot',
    contractorName: '業者A',
    sitePhone: '09000000000',
    quantityM3: '5',
    siteName: '末広町現場',
    deliveryArea: '大分市',
    siteAddressDetail: '末広町',
    siteAddress: '大分市末広町',
    isLocationPending: true,
    allowedDeliveryAreas: [],
    ...overrides,
  };
}

describe('validateCartLineForm cooperative trader rule', () => {
  const today = '2026-09-03';
  const opts = {
    today,
    isPastPreferredDateTime: () => false,
    isGuestSiteOrder: false,
  };
  const org = '大分中央生コンクリート協同組合';

  it('blocks cooperative submitting own org name as trader', () => {
    const missing = validateCartLineForm(
      spotContext({
        currentCustomerRole: 'cooperative',
        currentCustomer: { company_name: org },
        traderName: ` ${org}　`,
      }),
      '2026-09-10',
      opts,
    );
    expect(missing).toContain(COOPERATIVE_OWN_ORG_TRADER_ERROR);
  });

  it('does not block agent submitting own company name as trader', () => {
    const missing = validateCartLineForm(
      spotContext({
        currentCustomerRole: 'agent',
        currentCustomer: { company_name: 'トクヤマ通商㈱' },
        traderName: 'トクヤマ通商㈱',
        isAgentOrCooperative: true,
      }),
      '2026-09-10',
      opts,
    );
    expect(missing).not.toContain(COOPERATIVE_OWN_ORG_TRADER_ERROR);
  });

  it('does not block contractor submitting any trader name', () => {
    const missing = validateCartLineForm(
      spotContext({
        currentCustomerRole: 'contractor',
        currentCustomer: { company_name: '業者A' },
        traderName: '業者A',
      }),
      '2026-09-10',
      opts,
    );
    expect(missing).not.toContain(COOPERATIVE_OWN_ORG_TRADER_ERROR);
  });
});
