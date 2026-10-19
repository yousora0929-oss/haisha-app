import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BLACKLIST_NOTE, CompanyBlacklistNote, CompanyStatusBadges } from './CompanyStatusBadges.jsx';

describe('CompanyStatusBadges', () => {
  it('shows the confirmation badge before the cash badge and keeps the note off the reason', () => {
    const html = renderToStaticMarkup(
      React.createElement(
        'div',
        null,
        React.createElement(CompanyStatusBadges, { isBlacklisted: true, isCounterCash: true }),
        React.createElement(CompanyBlacklistNote, { isBlacklisted: true }),
      ),
    );
    const confirmAt = html.indexOf('要確認');
    const cashAt = html.indexOf('窓口現金');
    expect(confirmAt).toBeGreaterThan(-1);
    expect(cashAt).toBeGreaterThan(confirmAt);
    expect(html).toContain(BLACKLIST_NOTE);
    expect(html).not.toContain('理由');
  });

  it('renders nothing when both flags are off', () => {
    const html = renderToStaticMarkup(
      React.createElement(CompanyStatusBadges, { isBlacklisted: false, isCounterCash: false }),
    );
    expect(html).toBe('');
  });
});
