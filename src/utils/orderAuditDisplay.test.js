import { describe, expect, it } from 'vitest';
import {
  auditFieldLabel,
  buildAuditEventView,
  formatAuditChangeValue,
  formatAuditOccurredAtJst,
  formatAuditOccurredAtJstTitle,
  formatDeclineActorNote,
  isAuditEmptyValue,
  normalizeAuditChanges,
  shouldHideAuditChange,
  splitAuditLogs,
} from './orderAuditDisplay.js';

describe('auditFieldLabel', () => {
  it('separates ordered_by and order_data.orderedBy', () => {
    expect(auditFieldLabel('ordered_by')).toEqual({ label: '発注アカウント', known: true });
    expect(auditFieldLabel('order_data.orderedBy')).toEqual({
      label: '現場担当者名',
      known: true,
    });
  });

  it('maps confirmed quantity/mix and accepted_at / factory site', () => {
    expect(auditFieldLabel('order_data.confirmedQuantityM3').label).toBe('確定数量(㎥)');
    expect(auditFieldLabel('order_data.confirmedMixText').label).toBe('確定配合');
    expect(auditFieldLabel('order_data.quantityM3').label).toBe('数量');
    expect(auditFieldLabel('order_data.mixText').label).toBe('配合');
    expect(auditFieldLabel('accepted_at').label).toBe('受注日時');
    expect(auditFieldLabel('order_data.acceptedAt').label).toBe('受注日時');
    expect(auditFieldLabel('order_data.factorySiteId').label).toBe('受注工場');
    expect(auditFieldLabel('order_data.factoryResponseStatus').label).toBe('ステータス');
  });

  it('falls back to raw key for unknown fields', () => {
    expect(auditFieldLabel('order_data.weirdThing')).toEqual({
      label: 'order_data.weirdThing',
      known: false,
    });
  });
});

describe('JST datetime formatting', () => {
  it('converts Z and +00:00 to JST with seconds', () => {
    // 11:07:52Z → 20:07:52 JST
    expect(formatAuditOccurredAtJst('2026-09-30T11:07:52.133Z')).toBe('9/30 20:07:52');
    expect(formatAuditOccurredAtJst('2026-09-30T11:07:02.534449+00:00')).toBe('9/30 20:07:02');
    expect(formatAuditOccurredAtJstTitle('2026-09-30T11:07:52.133Z')).toBe(
      '2026/09/30 20:07:52 (JST)',
    );
  });

  it('formats ISO values inside change cells as JST', () => {
    expect(formatAuditChangeValue('2026-09-30T11:07:52.133Z', 'accepted_at')).toBe(
      '9/30 20:07:52',
    );
    expect(formatAuditChangeValue('2026-09-30T11:07:02.534449+00:00', 'order_data.acceptedAt')).toBe(
      '9/30 20:07:02',
    );
  });
});

describe('empty value normalization', () => {
  it('treats null / empty string / [] / {} as empty', () => {
    expect(isAuditEmptyValue(null)).toBe(true);
    expect(isAuditEmptyValue('')).toBe(true);
    expect(isAuditEmptyValue([])).toBe(true);
    expect(isAuditEmptyValue({})).toBe(true);
    expect(isAuditEmptyValue(false)).toBe(false);
  });

  it('hides empty→empty and empty→false', () => {
    expect(shouldHideAuditChange(null, null)).toBe(true);
    expect(shouldHideAuditChange('', [])).toBe(true);
    expect(shouldHideAuditChange(null, false)).toBe(true);
    expect(shouldHideAuditChange(null, true)).toBe(false);
  });

  it('shows one-sided empty as （未設定）', () => {
    expect(formatAuditChangeValue(null)).toBe('（未設定）');
    expect(formatAuditChangeValue('')).toBe('（未設定）');
    const rows = normalizeAuditChanges([{ field: 'order_data.siteName', before: null, after: '現場A' }]);
    expect(rows.primary[0].beforeText).toBe('（未設定）');
    expect(rows.primary[0].afterText).toBe('現場A');
  });
});

describe('normalizeAuditChanges', () => {
  it('labels factory site with factory name and id', () => {
    const { primary } = normalizeAuditChanges(
      [{ field: 'factory_site_id', before: null, after: 'FACTORY_08' }],
      { factoryNameById: { FACTORY_08: '㈱旭商 幸崎生コン工場' } },
    );
    expect(primary[0].label).toBe('受注工場');
    expect(primary[0].afterText).toBe('㈱旭商 幸崎生コン工場（FACTORY_08）');
  });

  it('dedupes identical label/before/after rows', () => {
    const { primary } = normalizeAuditChanges([
      { field: 'status', before: 'pending', after: 'accepted' },
      { field: 'order_data.factoryResponseStatus', before: 'pending', after: 'accepted' },
      { field: 'factory_site_id', before: null, after: 'FACTORY_08' },
      { field: 'order_data.factorySiteId', before: null, after: 'FACTORY_08' },
    ]);
    expect(primary.filter((r) => r.label === 'ステータス')).toHaveLength(1);
    expect(primary.filter((r) => r.label === '受注工場')).toHaveLength(1);
  });

  it('puts force-internal labeled noise into internal bucket', () => {
    const { primary, internal } = normalizeAuditChanges([
      { field: 'order_data.displayContractorName', before: '', after: '業者A' },
      { field: 'order_data.quantityM3', before: '1', after: '2' },
    ]);
    expect(primary.map((r) => r.label)).toEqual(['数量']);
    expect(internal.some((r) => r.field.includes('displayContractorName'))).toBe(true);
  });
});

describe('buildAuditEventView', () => {
  it('builds status_changed headline with factory', () => {
    const view = buildAuditEventView(
      {
        event_type: 'status_changed',
        occurred_at: '2026-09-30T11:07:52.133Z',
        actor_role: 'factory',
        actor_name: '工場',
        changes: [
          { field: 'status', before: 'pending', after: 'accepted' },
          { field: 'factory_site_id', before: null, after: 'FACTORY_08' },
        ],
      },
      { factoryNameById: { FACTORY_08: '㈱旭商 幸崎生コン工場' } },
    );
    expect(view.headline).toBe('ステータス: 配車待ち → 受注');
    expect(view.headlineExtra[0]).toContain('受注工場: ㈱旭商 幸崎生コン工場（FACTORY_08）');
    expect(view.occurredAtText).toBe('9/30 20:07:52');
  });
});

describe('formatDeclineActorNote / splitAuditLogs', () => {
  it('hides factory self and pre-record actors', () => {
    expect(
      formatDeclineActorNote({
        actor_role: 'factory',
        actor_id: 'f1',
        factory_id: 'f1',
        actor_name: '工場A',
      }),
    ).toBeNull();
    expect(formatDeclineActorNote({ actor_role: 'admin', actor_name: '管理者' })).toBe(
      '管理者が操作',
    );
  });

  it('splits decline and timeline events', () => {
    const { declines, timeline } = splitAuditLogs([
      { event_type: 'factory_declined' },
      { event_type: 'created' },
      { event_type: 'status_changed' },
    ]);
    expect(declines).toHaveLength(1);
    expect(timeline).toHaveLength(2);
  });
});

/**
 * 受注1回で大量diffが出る実データ相当フィクスチャ。
 * 空→空 / 空→false / url_token / updated_at / camelCase重複 / push_notified_map / 既読キーを含む。
 */
function buildNoisyAcceptChanges() {
  return [
    { field: 'status', before: 'pending', after: 'accepted' },
    { field: 'order_data.status', before: 'pending', after: 'accepted' },
    { field: 'order_data.factoryResponseStatus', before: 'pending', after: 'accepted' },
    { field: 'factory_site_id', before: null, after: 'FACTORY_08' },
    { field: 'order_data.factory_site_id', before: null, after: 'FACTORY_08' },
    { field: 'order_data.factorySiteId', before: null, after: 'FACTORY_08' },
    { field: 'accepted_at', before: null, after: '2026-09-30T11:07:52.133Z' },
    { field: 'order_data.accepted_at', before: null, after: '2026-09-30T11:07:52.133Z' },
    { field: 'order_data.acceptedAt', before: null, after: '2026-09-30T11:07:52.133Z' },
    { field: 'order_data.confirmedQuantityM3', before: null, after: '12.5' },
    { field: 'order_data.confirmedMixText', before: null, after: '27-18-20' },
    { field: 'order_data.quantityM3', before: '12.5', after: '12.5' },
    { field: 'order_data.mixText', before: '27-18-20', after: '27-18-20' },
    // noise: empty→empty / empty→false
    { field: 'order_data.someFlag', before: null, after: null },
    { field: 'order_data.anotherFlag', before: '', after: false },
    { field: 'order_data.emptyArr', before: [], after: [] },
    { field: 'order_data.emptyObj', before: {}, after: {} },
    // noise: tokens / timestamps / maps / read keys
    { field: 'order_data.url_token', before: null, after: 'tok_abc' },
    { field: 'updated_at', before: '2026-09-30T10:00:00.000Z', after: '2026-09-30T11:07:52.133Z' },
    { field: 'order_data.updated_at', before: null, after: '2026-09-30T11:07:52.133Z' },
    { field: 'order_data.push_notified_map', before: {}, after: { FACTORY_08: true } },
    { field: 'order_data.factory_chat_read_key', before: null, after: 'rk1' },
    { field: 'order_data.factoryChatReadKey', before: null, after: 'rk1' },
    { field: 'order_data.factory_chat_read_at', before: null, after: '2026-09-30T11:08:00.000Z' },
    // force-internal labeled noise + camel/snake copies
    { field: 'order_data.acceptedFactoryLabel', before: null, after: '㈱旭商' },
    { field: 'order_data.factorySiteName', before: null, after: '幸崎' },
    { field: 'order_data.displayTraderName', before: null, after: '商社X' },
    { field: 'order_data.displayContractorName', before: null, after: '業者Y' },
    { field: 'order_data.factoryResponseLocked', before: null, after: true },
    { field: 'order_data.factoryUnlockRequested', before: null, after: false },
    { field: 'order_data.sub_factory_current_index', before: null, after: 0 },
    { field: 'order_data.subFactoryCurrentIndex', before: null, after: 0 },
    // filler internal keys to approach "78 items" volume
    ...Array.from({ length: 46 }, (_, i) => ({
      field: `order_data.internal_noise_${i}`,
      before: i % 3 === 0 ? null : `old${i}`,
      after: i % 5 === 0 ? false : `new${i}`,
    })),
  ];
}

describe('noisy accept event fixture', () => {
  it('keeps default primary rows within 6 meaningful lines', () => {
    const changes = buildNoisyAcceptChanges();
    expect(changes.length).toBeGreaterThanOrEqual(70);

    const factoryNameById = { FACTORY_08: '㈱旭商 幸崎生コン工場' };
    const view = buildAuditEventView(
      {
        event_type: 'status_changed',
        occurred_at: '2026-09-30T11:07:52.133Z',
        actor_role: 'factory',
        changes,
      },
      { factoryNameById },
    );

    const labels = view.primary.map((r) => r.label);
    expect(view.primary.length).toBeLessThanOrEqual(6);
    expect(labels).toEqual(
      expect.arrayContaining(['ステータス', '受注工場', '受注日時', '確定数量(㎥)', '確定配合']),
    );
    // 同一ラベルは1行
    expect(new Set(labels).size).toBe(labels.length);
    // ノイズは内部へ
    expect(view.internal.length).toBeGreaterThan(10);
    expect(view.headline).toBe('ステータス: 配車待ち → 受注');
  });
});
