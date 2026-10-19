import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminBlacklistPanel, filterOrganizationCandidates, submitBlacklistAdd } from './AdminBlacklistPanel.jsx';

const orgs = [
  { id: 'c1', name: '青木建設', furigana: 'アオキケンセツ', type: 'contractor' },
  { id: 'a1', name: '梅田建材', furigana: 'ウメダケンザイ', type: 'agent' },
  { id: 'c2', name: '中村建設', furigana: '', type: 'contractor' },
];

describe('AdminBlacklistPanel', () => {
  it('matches company names and marks companies already on the blacklist', () => {
    const rows = filterOrganizationCandidates(orgs, '建設', { c1: { organization_id: 'c1' } });
    expect(rows.map((row) => row.name)).toEqual(['青木建設', '中村建設']);
    expect(rows[0].listed).toBe(true);
    expect(rows[1].listed).toBe(false);
    expect(filterOrganizationCandidates(orgs, 'ウメダ', {})[0].type).toBe('agent');
  });

  it('starts collapsed and keeps the add control off the company card markup', () => {
    const html = renderToStaticMarkup(
      React.createElement(AdminBlacklistPanel, {
        organizations: orgs,
        blacklistById: {
          c1: { organization_id: 'c1', reason: '入金遅れ', created_at: '2026-10-19T00:00:00.000Z', created_by: '管理者' },
        },
        onChanged: () => {},
        onFocusOrganization: () => {},
      }),
    );
    expect(html).toContain('ブラックリスト（1件）');
    expect(html).toContain('＋追加');
    expect(html).not.toContain('青木建設');
    expect(html).not.toContain('ブラックリストに追加');
  });

  it('creates a company, then blacklists it and stores the phone', async () => {
    const calls = [];
    const result = await submitBlacklistAdd({
      selection: { isNew: true, name: 'テスト建設', type: 'contractor' },
      reason: '確認',
      phone: '097-000-0000',
      createdBy: '管理者',
      blacklistById: {},
      createOrganization: async (input) => {
        calls.push(['create', input]);
        return [{ organization_id: 'new-1', created: true }];
      },
      addBlacklist: async (input) => {
        calls.push(['blacklist', input]);
      },
      registerPhone: async (input) => {
        calls.push(['phone', input]);
      },
    });
    expect(result.status).toBe('ok');
    expect(result.createdCompany).toBe(true);
    expect(calls.map((call) => call[0])).toEqual(['create', 'blacklist', 'phone']);
    expect(calls[2][1]).toMatchObject({ organizationId: 'new-1', phone: '097-000-0000', label: '代表' });
  });

  it('continues onto an existing company and stops when that company is already listed', async () => {
    const added = [];
    const existing = await submitBlacklistAdd({
      selection: { isNew: true, name: '青木建設', type: 'contractor' },
      blacklistById: {},
      createOrganization: async () => [{ organization_id: 'c1', created: false }],
      addBlacklist: async (input) => {
        added.push(input.organizationId);
      },
      registerPhone: async () => {},
    });
    expect(existing.notice).toBe('既存の『青木建設』に登録します');
    expect(existing.status).toBe('ok');
    expect(added).toEqual(['c1']);

    const listed = await submitBlacklistAdd({
      selection: { isNew: true, name: '青木建設', type: 'agent' },
      blacklistById: { c1: { organization_id: 'c1' } },
      createOrganization: async () => [{ organization_id: 'c1', created: false }],
      addBlacklist: async () => {
        throw new Error('should not insert');
      },
      registerPhone: async () => {},
    });
    expect(listed.status).toBe('stopped');
    expect(listed.error).toBe('登録済みです');
    expect(listed.notice).toBe('既存の『青木建設』に登録します');
  });

  it('keeps the created company when the blacklist insert fails, and ignores a duplicate phone', async () => {
    const failed = await submitBlacklistAdd({
      selection: { isNew: true, name: '新規商社', type: 'agent' },
      createOrganization: async () => [{ organization_id: 'a9', created: true }],
      addBlacklist: async () => {
        throw new Error('insert failed');
      },
      registerPhone: async () => {
        throw new Error('should not register');
      },
    });
    expect(failed.createdCompany).toBe(true);
    expect(failed.error).toBe('会社は作成しましたが、ブラックリスト登録に失敗しました');

    const duplicate = await submitBlacklistAdd({
      selection: { id: 'c2', name: '中村建設', listed: false },
      phone: '097-111-2222',
      blacklistById: {},
      createOrganization: async () => {
        throw new Error('should not create');
      },
      addBlacklist: async () => {},
      registerPhone: async () => {
        throw new Error('duplicate phone');
      },
    });
    expect(duplicate.status).toBe('ok');
    expect(duplicate.phoneWarning).toBe('');

    const invalid = await submitBlacklistAdd({
      selection: { id: 'c2', name: '中村建設' },
      phone: '123',
      blacklistById: {},
      createOrganization: async () => {},
      addBlacklist: async () => {},
      registerPhone: async () => {
        throw new Error('invalid phone');
      },
    });
    expect(invalid.status).toBe('ok');
    expect(invalid.phoneWarning).toContain('電話番号は登録できませんでした');
  });
});
