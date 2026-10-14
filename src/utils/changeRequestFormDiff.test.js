import { describe, expect, it } from 'vitest';
import { expandChangeRequestKeys } from './changeRequestItems.js';
import {
  changeRequestLabelsForKeys,
  changeRequestValuesEqual,
  classifyChangeRequestReload,
  editedChangeRequestFormFields,
  filterChangeRequestPatchToEditedFields,
} from './changeRequestFormDiff.js';

const blankForm = {
  preferredDate: '2026-10-15',
  timeSlot: '480',
  vehicleType: 'large',
  quantityM3: '3',
  unloadDuration: '30',
  mixText: '18-8-20BB',
  siteName: '現場A',
  siteAddress: '大分市',
  sitePhone: '',
  hasTest: false,
  contractorCustomerId: '',
  contractorName: '山田建設',
  agentOrganizationId: '',
  traderName: '',
  tradingAgentCustomerId: '',
};

describe('editedChangeRequestFormFields', () => {
  it('treats null, undefined, and blank as the same', () => {
    expect(changeRequestValuesEqual(null, '')).toBe(true);
    expect(changeRequestValuesEqual(undefined, '')).toBe(true);
    expect(changeRequestValuesEqual(null, undefined)).toBe(true);
    expect(editedChangeRequestFormFields({ traderName: null }, { traderName: '' })).toEqual([]);
    expect(editedChangeRequestFormFields({ traderName: undefined }, { traderName: '' })).toEqual([]);
    expect(editedChangeRequestFormFields({ quantityM3: null }, { quantityM3: '' })).toEqual([]);
  });

  it('does not treat an untouched blank trader name as an edit when only quantity changes', () => {
    const current = { ...blankForm, quantityM3: '4' };
    expect(editedChangeRequestFormFields(blankForm, current)).toEqual(['quantityM3']);
  });
});

describe('filterChangeRequestPatchToEditedFields', () => {
  it('drops trader keys, including ones expand would add, when the trader field was not edited', () => {
    const patch = {
      quantityM3: '4',
      traderName: '大陽機材',
      trading_company_name: '大陽機材',
      projectTradingCompanyName: '大陽機材',
      displayTraderName: '大陽機材',
      agent_organization_id: null,
    };
    const filtered = filterChangeRequestPatchToEditedFields(patch, ['quantityM3']);
    expect(filtered).toEqual({ quantityM3: '4' });
    const expanded = [...expandChangeRequestKeys(Object.keys(filtered))];
    expect(expanded).toEqual(expect.arrayContaining(['quantityM3', 'confirmedQuantityM3']));
    expect(expanded).not.toContain('traderName');
    expect(expanded).not.toContain('trading_company_name');
    expect(expanded).not.toContain('projectTradingCompanyName');
    expect(expanded).not.toContain('displayTraderName');
  });

  it('keeps trader keys only after the trader field is edited', () => {
    const patch = {
      traderName: '新商社',
      trading_company_name: '新商社',
      projectTradingCompanyName: '新商社',
    };
    expect(filterChangeRequestPatchToEditedFields(patch, ['traderName'])).toEqual(patch);
  });
});

describe('classifyChangeRequestReload', () => {
  it('keeps my edit when latest matches base and adopts latest for untouched fields', () => {
    const result = classifyChangeRequestReload({
      baseOrder: { quantityM3: '3', mixText: '18-8-20BB', traderName: '' },
      latestOrder: { quantityM3: '3', mixText: '21-8-20BB', traderName: '' },
      initialForm: blankForm,
      currentForm: { ...blankForm, quantityM3: '5' },
    });
    expect(result.conflictFields || result.conflicts).toEqual([]);
    expect(result.keepFields).toContain('quantityM3');
    expect(result.adoptFields).toContain('mixText');
    expect(result.adoptFields).toContain('traderName');
  });

  it('marks only the field that both sides changed', () => {
    const result = classifyChangeRequestReload({
      baseOrder: { quantityM3: '3', mixText: '18-8-20BB' },
      latestOrder: { quantityM3: '9', mixText: '18-8-20BB' },
      initialForm: blankForm,
      currentForm: { ...blankForm, quantityM3: '5', mixText: '24-8-20BB' },
    });
    expect(result.conflicts.map((row) => row.field)).toEqual(['quantityM3']);
    expect(result.keepFields).toEqual(expect.arrayContaining(['quantityM3', 'mixText']));
    expect(result.conflicts[0].keys).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: 'quantityM3', base: '3', latest: '9' }),
      ]),
    );
  });

  it('does not mark a conflict when my input already matches latest', () => {
    const result = classifyChangeRequestReload({
      baseOrder: { quantityM3: '3' },
      latestOrder: { quantityM3: '5' },
      initialForm: blankForm,
      currentForm: { ...blankForm, quantityM3: '5' },
    });
    expect(result.conflicts).toEqual([]);
    expect(result.keepFields).toContain('quantityM3');
  });
});

describe('changeRequestLabelsForKeys', () => {
  it('uses the on-screen label for a conflicting key', () => {
    expect(changeRequestLabelsForKeys(['quantityM3', 'confirmedQuantityM3'])).toEqual(['数量']);
    expect(changeRequestLabelsForKeys(['trading_company_name'])).toEqual(['商社']);
  });
});
