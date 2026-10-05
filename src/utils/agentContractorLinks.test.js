import { describe, expect, it } from 'vitest';
import {
  agentContractorLinkScopeForRow,
  contractorIdsForAgentLinks,
  describeAgentContractorLinks,
  expandContractorIdsForAgentLinks,
} from './agentContractorLinks.js';

const desk = {
  id: 'desk',
  role: 'contractor',
  organization_id: 'org-1',
  company_name: '平和建設',
  manager_name: '',
  phone_number: '',
};
const ueno = {
  id: 'ueno',
  role: 'contractor',
  organization_id: 'org-1',
  company_name: '平和建設',
  manager_name: '上野',
  phone_number: '09000000000',
};
const other = {
  id: 'other',
  role: 'contractor',
  organization_id: 'org-2',
  company_name: '首藤建設',
  manager_name: '山田',
  phone_number: '09011111111',
};

describe('agentContractorLinkScopeForRow', () => {
  it('uses company only when both contact fields are empty', () => {
    expect(agentContractorLinkScopeForRow(desk)).toBe('company');
    expect(agentContractorLinkScopeForRow(ueno)).toBe('person');
    expect(agentContractorLinkScopeForRow({ manager_name: '', phone_number: '03' })).toBe('person');
    expect(agentContractorLinkScopeForRow(null)).toBe('person');
  });
});

describe('contractorIdsForAgentLinks', () => {
  it('drops person rows covered by a selected company anchor in the same organization', () => {
    expect(contractorIdsForAgentLinks(['desk', 'ueno', 'other'], [desk, ueno, other])).toEqual([
      'desk',
      'other',
    ]);
  });
});

describe('expandContractorIdsForAgentLinks', () => {
  it('expands company scope to every contractor row in the organization', () => {
    const ids = expandContractorIdsForAgentLinks(
      [{ contractor_customer_id: 'desk', scope: 'company' }],
      [desk, ueno, other],
    );
    expect(ids.sort()).toEqual(['desk', 'ueno']);
  });

  it('expands from the link organization when the anchor row is not loaded', () => {
    expect(
      expandContractorIdsForAgentLinks(
        [
          {
            contractor_customer_id: 'desk',
            scope: 'company',
            contractor_organization_id: 'org-1',
          },
        ],
        [ueno],
      ).sort(),
    ).toEqual(['desk', 'ueno']);
  });

  it('keeps a person link to that one row', () => {
    expect(
      expandContractorIdsForAgentLinks(
        [{ contractor_customer_id: 'ueno', scope: 'person' }],
        [desk, ueno, other],
      ),
    ).toEqual(['ueno']);
  });
});

describe('describeAgentContractorLinks', () => {
  it('marks an individual link as included when a company link covers the same organization', () => {
    const rows = describeAgentContractorLinks(
      [
        { contractor_customer_id: 'desk', scope: 'company' },
        { contractor_customer_id: 'ueno', scope: 'person' },
      ],
      [desk, ueno, other],
    );
    const company = rows.find((row) => row.scope === 'company');
    const included = rows.find((row) => row.included);
    expect(company?.memberIds.sort()).toEqual(['desk', 'ueno']);
    expect(included?.contractor.id).toBe('ueno');
  });
});
