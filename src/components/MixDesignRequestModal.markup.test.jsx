import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MixDesignRequestModal } from './MixDesignRequestModal.jsx';
import { MixDesignRequestPrint } from './MixDesignRequestPrint.jsx';

describe('MixDesignRequestModal markup', () => {
  it('shows the revised request fields', () => {
    const html = renderToStaticMarkup(
      React.createElement(MixDesignRequestModal, {
        open: true,
        order: { id: 'order-1', siteName: '確認現場' },
        factories: [{ id: 'F1', name: '大分工場' }],
        onClose: () => {},
      }),
    );
    const volumeAt = html.indexOf('全体数量');
    const shipmentAt = html.indexOf('出荷開始時期');
    expect(volumeAt).toBeGreaterThan(-1);
    expect(shipmentAt).toBeGreaterThan(volumeAt);
    expect(html).toContain('現場担当者<br/>連絡先');
    expect(html).toContain('依頼先工場におまかせ');
    const strengthAt = html.indexOf('設計基準強度');
    const aeAt = html.indexOf('高性能AE減水剤あり');
    const quantityAt = html.indexOf('数量（m³）', strengthAt);
    expect(strengthAt).toBeGreaterThan(-1);
    expect(aeAt).toBeGreaterThan(strengthAt);
    expect(quantityAt).toBeGreaterThan(aeAt);
    expect(html).toContain('min-h-[48px] items-center gap-2 text-base text-slate-900');
    expect(html).toContain('65%以下');
    expect(html).toContain('20mm');
    expect(html).toContain('40mm');
    expect(html).toContain('200kg/㎥');
    expect(html).toContain('その他（自由入力）');
    expect(html).not.toContain('初打設日');
    const autoLabel = html.indexOf('補正値を自動計算');
    const autoInput = html.slice(Math.max(0, autoLabel - 180), autoLabel);
    expect(autoInput).not.toContain('checked');

    const printHtml = renderToStaticMarkup(
      React.createElement(MixDesignRequestPrint, {
        header: {
          shipmentStartPeriod: '10月上旬',
          totalVolumeM3: 80,
          siteManagerContact: '090-0000-0000',
        },
        request: {},
        items: [],
      }),
    );
    const printVolumeAt = printHtml.indexOf('全体数量');
    const printShipmentAt = printHtml.indexOf('出荷開始時期');
    expect(printShipmentAt).toBeGreaterThan(printVolumeAt);
    expect(printHtml).toContain('10月上旬');
    expect(printHtml).toContain('現場担当者<br/>連絡先');
    expect(printHtml).not.toContain('初打設日');
  });
});
