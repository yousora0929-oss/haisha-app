import { describe, expect, it } from 'vitest';
import {
  buildMixDesignAcceptUrl,
  buildMixDesignEmailFactoryOptions,
  buildMixDesignFactoryMail,
  buildMixDesignMailto,
  formatMixDesignAcceptedAt,
  isValidMixDesignAcceptToken,
  parseMixDesignAcceptTokenFromPath,
} from './mixDesignAccept.js';

const TOKEN_A = '11111111-2222-4333-a444-555555555555';
const TOKEN_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';

describe('parseMixDesignAcceptTokenFromPath', () => {
  it('reads /mix-design/accept/:token', () => {
    expect(parseMixDesignAcceptTokenFromPath(`/mix-design/accept/${TOKEN_A}`)).toBe(TOKEN_A);
  });

  it('ignores unrelated paths', () => {
    expect(parseMixDesignAcceptTokenFromPath('/order/abc')).toBe('');
  });
});

describe('buildMixDesignAcceptUrl', () => {
  it('builds origin + token path', () => {
    expect(buildMixDesignAcceptUrl(TOKEN_A, 'https://example.test/')).toBe(
      `https://example.test/mix-design/accept/${TOKEN_A}`,
    );
  });

  it('rejects invalid tokens', () => {
    expect(isValidMixDesignAcceptToken('not-a-uuid')).toBe(false);
    expect(buildMixDesignAcceptUrl('not-a-uuid', 'https://example.test')).toBe('');
  });
});

describe('buildMixDesignFactoryMail', () => {
  it('fills subject and body per factory', () => {
    const a = buildMixDesignFactoryMail({
      factoryName: '大分工場',
      projectName: '駅前現場',
      contractorName: '山田建設',
      requesterName: '佐藤',
      requesterAffiliation: '配車課',
      acceptUrl: `https://app.test/mix-design/accept/${TOKEN_A}`,
    });
    const b = buildMixDesignFactoryMail({
      factoryName: '別府工場',
      projectName: '駅前現場',
      contractorName: '山田建設',
      requesterName: '佐藤',
      requesterAffiliation: '配車課',
      acceptUrl: `https://app.test/mix-design/accept/${TOKEN_B}`,
    });
    expect(a.subject).toBe('【配合計画書ご依頼】駅前現場（山田建設）');
    expect(a.body).toContain('大分工場 様');
    expect(a.body).toContain('配車課 佐藤です。');
    expect(a.body).toContain(TOKEN_A);
    expect(b.body).toContain('別府工場 様');
    expect(b.body).toContain(TOKEN_B);
    expect(a.body).not.toContain(TOKEN_B);
  });
});

describe('buildMixDesignMailto', () => {
  it('encodes subject and body', () => {
    const href = buildMixDesignMailto({
      to: 'plant@example.test',
      subject: '件名',
      body: '本文\nURL',
    });
    expect(href.startsWith('mailto:plant%40example.test?')).toBe(true);
    expect(href).toContain(`subject=${encodeURIComponent('件名')}`);
    expect(href).toContain(`body=${encodeURIComponent('本文\nURL')}`);
  });

  it('allows empty recipient', () => {
    const href = buildMixDesignMailto({ to: '', subject: '件名', body: '本文' });
    expect(href.startsWith('mailto:?')).toBe(true);
  });
});

describe('buildMixDesignEmailFactoryOptions', () => {
  it('uses a distinct accept URL per factory', () => {
    const options = buildMixDesignEmailFactoryOptions(
      [
        { factory_id: 'f1', accept_token: TOKEN_A },
        { factory_id: 'f2', accept_token: TOKEN_B },
      ],
      [
        { id: 'f1', name: '大分工場' },
        { id: 'f2', name: '別府工場' },
      ],
      'https://app.test',
    );
    expect(options).toHaveLength(2);
    expect(options[0].acceptUrl).toContain(TOKEN_A);
    expect(options[1].acceptUrl).toContain(TOKEN_B);
    expect(options[0].acceptUrl).not.toBe(options[1].acceptUrl);
  });
});

describe('formatMixDesignAcceptedAt', () => {
  it('formats yyyy/mm/dd HH:mm', () => {
    expect(formatMixDesignAcceptedAt('2026-09-07T01:05:00+09:00')).toMatch(/^2026\/09\/07 \d{2}:\d{2}$/);
  });
});
