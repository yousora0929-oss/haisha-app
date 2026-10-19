import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminBlacklistPanel, filterOrganizationCandidates } from './AdminBlacklistPanel.jsx';

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
});
