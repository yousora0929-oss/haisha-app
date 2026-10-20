import { describe, expect, it } from 'vitest';
import {
  buildCompanyCreatePayload,
  formatLoginCredentialCopy,
  mapCompanyCreateError,
  suggestSimilarCompanies,
  validateCompanyCreateForm,
} from './companyCreateForm.js';

describe('mapCompanyCreateError', () => {
  it('maps company exists to the existing organization id', () => {
    expect(mapCompanyCreateError({ message: 'company exists', details: 'org-1' })).toEqual({
      text: '同じ名前の会社がすでにあります',
      existingOrgId: 'org-1',
    });
  });

  it('maps member, phone, and login errors with the detail target', () => {
    expect(mapCompanyCreateError({ message: 'member name required', details: '2' }).text).toBe(
      '2人目の担当者の氏名を入力してください',
    );
    expect(mapCompanyCreateError({ message: 'invalid phone', details: 'company' }).text).toBe(
      '代表電話：電話番号は0から始まる10〜11桁',
    );
    expect(mapCompanyCreateError({ message: 'invalid phone', details: '1' }).text).toBe(
      '1人目：電話番号は0から始まる10〜11桁',
    );
    expect(mapCompanyCreateError({ message: 'login phone required', details: '3' }).text).toBe(
      'ログインさせる場合は電話番号が必要です（3人目）',
    );
    expect(mapCompanyCreateError({ message: 'weak password', details: '1' }).text).toBe(
      'パスワードの生成に失敗しました。再生成してください（1人目）',
    );
    expect(mapCompanyCreateError({ message: 'login phone in use', details: '2' }).text).toBe(
      'この電話番号は別のアカウントでログインに使われています（2人目）',
    );
    expect(mapCompanyCreateError({ message: 'login phone duplicated in form' }).text).toBe(
      '同じログイン番号が2人に入力されています',
    );
    expect(mapCompanyCreateError({ message: 'not authorized' }).text).toBe('権限がありません');
    expect(mapCompanyCreateError({ message: 'company name required' }).text).toBe('社名を入力してください');
  });
});

describe('validateCompanyCreateForm', () => {
  it('requires the company name and each member name', () => {
    expect(validateCompanyCreateForm({ name: '  ', members: [] })).toBe('社名を入力してください');
    expect(
      validateCompanyCreateForm({
        name: '山田建設',
        members: [{ name: '  ', login: false }],
      }),
    ).toBe('1人目の担当者の氏名を入力してください');
  });

  it('requires a phone for login members and rejects duplicate login numbers', () => {
    expect(
      validateCompanyCreateForm({
        name: '山田建設',
        members: [{ name: '山田', phone: '', login: true, password: 'A1234' }],
      }),
    ).toBe('ログインさせる場合は電話番号が必要です（1人目）');
    expect(
      validateCompanyCreateForm({
        name: '山田建設',
        members: [
          { name: '山田', phone: '090-1111-2222', login: true, password: 'A1234' },
          { name: '佐藤', phone: '09011112222', login: true, password: 'B5678' },
        ],
      }),
    ).toBe('同じログイン番号が2人に入力されています');
  });

  it('allows a company with no members', () => {
    expect(validateCompanyCreateForm({ name: '山田建設', members: [] })).toBe('');
  });
});

describe('buildCompanyCreatePayload', () => {
  it('omits the password when login is off', () => {
    const payload = buildCompanyCreatePayload(
      {
        name: ' 山田建設 ',
        furigana: 'ヤマダケンセツ',
        companyPhone: '097-000-1111',
        isCounterCash: true,
        isCreditEligible: false,
        blacklistEnabled: false,
        blacklistReason: '',
        members: [
          { name: '山田', phone: '090-1111-2222', login: true, password: 'A1234' },
          { name: '佐藤', phone: '080-3333-4444', login: false, password: 'SHOULD-DROP' },
        ],
      },
      { type: 'contractor', createdBy: '管理者' },
    );
    expect(payload).toEqual({
      type: 'contractor',
      name: '山田建設',
      furigana: 'ヤマダケンセツ',
      company_phone: '097-000-1111',
      is_counter_cash: true,
      is_credit_eligible: false,
      members: [
        { name: '山田', phone: '090-1111-2222', login: true, password: 'A1234' },
        { name: '佐藤', phone: '080-3333-4444', login: false },
      ],
      blacklist: { enabled: false, reason: '' },
      created_by: '管理者',
    });
    expect(payload.members[1]).not.toHaveProperty('password');
  });
});

describe('suggestSimilarCompanies', () => {
  const orgs = [
    { id: '1', name: '山田建設', furigana: 'ヤマダケンセツ' },
    { id: '2', name: '佐藤工業', furigana: 'サトウコウギョウ' },
    { id: '3', name: '山本組', furigana: '' },
    { id: '4', name: '有限会社鈴木', furigana: '' },
    { id: '5', name: '高橋建材', furigana: '' },
    { id: '6', name: '田中商事', furigana: '' },
  ];

  it('returns at most five partial matches and treats 株式会社 as the same name', () => {
    expect(suggestSimilarCompanies(orgs, '山').map((org) => org.id)).toEqual(['1', '3']);
    expect(suggestSimilarCompanies(orgs, '株式会社山田建設').map((org) => org.id)).toEqual(['1']);
    expect(suggestSimilarCompanies(orgs, '').length).toBe(0);
    expect(suggestSimilarCompanies(orgs, '建').length).toBeLessThanOrEqual(5);
  });
});

describe('formatLoginCredentialCopy', () => {
  it('joins name, phone, and password with spaces and people with newlines', () => {
    expect(
      formatLoginCredentialCopy([
        { name: '山田', phone: '090-1111-2222', password: 'A1234' },
        { name: '佐藤', phone: '080-3333-4444', password: 'B5678' },
      ]),
    ).toBe('山田 090-1111-2222 A1234\n佐藤 080-3333-4444 B5678');
  });
});
