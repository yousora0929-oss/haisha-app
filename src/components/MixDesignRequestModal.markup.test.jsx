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
    expect(html).toContain('指定なし');
    const strengthAt = html.indexOf('設計基準強度');
    const aeAt = html.indexOf('高性能AE減水剤あり');
    const quantityAt = html.indexOf('数量（m³）', strengthAt);
    expect(strengthAt).toBeGreaterThan(-1);
    expect(aeAt).toBeGreaterThan(strengthAt);
    expect(quantityAt).toBeGreaterThan(aeAt);
    expect(html).toContain('whitespace-nowrap text-base text-slate-900');
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

    const editableHtml = renderToStaticMarkup(
      React.createElement(MixDesignRequestPrint, {
        editable: true,
        header: { projectName: '現場A', contractorName: '業者A' },
        request: {},
        items: [
          {
            localId: 'item-1',
            baseStrength: '24',
            slump: '15',
            aggregateSize: '20',
            cementType: 'N',
            waterCementRatio: '65',
            unitWaterContent: '185',
            correctionValue: '3',
            correctionIsAuto: false,
            aeAdmixture: true,
            quantityM3: '10',
            pourMonth: '10',
            pourDay: '4',
            constructionLocation: '橋脚',
            memo: '',
          },
        ],
        onItemChange: () => {},
      }),
    );
    expect(editableHtml).toContain('65%以下');
    expect(editableHtml).toContain('185kg/㎥');
    expect(editableHtml).toContain('その他（自由入力）');
    expect(editableHtml).toContain('設計基準強度');
    expect(editableHtml).toContain('スランプ');
    expect(editableHtml).toContain('骨材');
    expect(editableHtml).toContain('構造体補正値');
    expect(editableHtml).toContain('高性能AE減水剤あり');
  });
});
