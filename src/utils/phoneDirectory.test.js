import { describe, expect, it } from 'vitest';
import {
  contactActorLabel,
  groupPhoneDirectoryRows,
  isPhoneDirectoryQuery,
  mapAdminContactPhone,
  organizationTypeLabel,
  phoneDirectoryErrorMessage,
  unwrapCreatedOrganization,
} from './phoneDirectory.js';

describe('phoneDirectoryErrorMessage', () => {
  it('maps known database errors', () => {
    expect(phoneDirectoryErrorMessage({ message: 'duplicate phone' })).toBe(
      'この会社にはすでに登録されています',
    );
    expect(phoneDirectoryErrorMessage({ message: 'invalid phone' })).toBe(
      '電話番号は0から始まる10〜11桁で入力してください',
    );
    expect(phoneDirectoryErrorMessage({ details: 'not authorized' })).toBe(
      'この番号を編集する権限がありません（登録した工場のみ）',
    );
  });
});

describe('phone directory search helpers', () => {
  it('treats four or more digits as a phone query', () => {
    expect(isPhoneDirectoryQuery('097-1234')).toBe(true);
    expect(isPhoneDirectoryQuery('123')).toBe(false);
    expect(isPhoneDirectoryQuery('梅田建材')).toBe(false);
  });

  it('groups rows by organization and labels types', () => {
    const groups = groupPhoneDirectoryRows([
      {
        organization_id: 'org-1',
        organization_name: '青木建設',
        organization_type: 'contractor',
        org_created_by_factory_id: 'fac-1',
        source: 'directory',
        phone_display: '097-111-2222',
      },
      {
        organization_id: 'org-1',
        organization_name: '青木建設',
        organization_type: 'contractor',
        source: 'account',
        phone_display: '090-0000-0000',
      },
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].rows).toHaveLength(2);
    expect(groups[0].orgCreatedByFactoryId).toBe('fac-1');
    expect(groups[0].isBlacklisted).toBe(false);
    expect(groups[0].isCounterCash).toBe(false);
    expect(organizationTypeLabel('agent')).toBe('商社');
    expect(organizationTypeLabel('contractor')).toBe('業者');
  });

  it('hides an update stamp when it matches registration', () => {
    const mapped = mapAdminContactPhone({
      id: 'p1',
      organization_id: 'org-1',
      phone: '097-111-2222',
      label: '代表',
      person_name: '山田',
      note: '日中',
      registered_by_factory_id: 'fac-1',
      registered_at: '2026-10-19T01:00:00.000Z',
      updated_at: '2026-10-19T01:00:00.100Z',
    });
    expect(mapped.updatedAt).toBeNull();
    expect(contactActorLabel('fac-1', { 'fac-1': '工場A' })).toBe('工場A');
    expect(contactActorLabel('', {})).toBe('組合');
  });

  it('keeps company blacklist and counter-cash flags on the group', () => {
    const groups = groupPhoneDirectoryRows([
      { organization_id: 'org-2', organization_name: '中村建設', is_blacklisted: true, source: 'directory' },
      { organization_id: 'org-2', organization_name: '中村建設', is_counter_cash: true, source: 'account' },
    ]);
    expect(groups[0].isBlacklisted).toBe(true);
    expect(groups[0].isCounterCash).toBe(true);
  });

  it('reads an existing organization from create_organization_for_phone', () => {
    expect(
      unwrapCreatedOrganization([{ organization_id: 'org-9', created: false }]),
    ).toEqual({ organizationId: 'org-9', created: false, name: '' });
  });
});