import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContractorLinksChecklist } from './AdminOrgSection.jsx';

const desk = {
  id: 'desk',
  company_name: '平和建設',
  manager_name: '',
  phone_number: '',
  organization_id: 'org-1',
  role: 'contractor',
};
const ueno = {
  id: 'ueno',
  company_name: '平和建設',
  manager_name: '上野',
  phone_number: '09000000000',
  organization_id: 'org-1',
  role: 'contractor',
};

describe('ContractorLinksChecklist', () => {
  it('labels a representative row and grays staff covered by that company link', () => {
    const html = renderToStaticMarkup(
      React.createElement(ContractorLinksChecklist, {
        contractors: [desk, ueno],
        selectedIds: new Set(['desk', 'ueno']),
        onToggle: () => {},
        filterText: '',
        onFilterChange: () => {},
        inputClass: 'input',
      }),
    );
    expect(html).toContain('平和建設（代表窓口）＝全担当者');
    expect(html).toContain('全担当者');
    expect(html).toContain('全担当者に含まれる');
    expect(html).toContain('text-slate-400');
    expect(html).toContain('disabled');
  });
});
