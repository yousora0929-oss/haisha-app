import { describe, expect, it } from 'vitest';
import { buildMapEditorPrintDetailSections, buildOperationInstructionPrintGrid } from './mapEditorPrintDetails.js';
import { chooseUnloadLabelPlacement } from './mapEditorPrintLayout.js';

function order(overrides = {}) {
  return {
    preferredDate: '2026-10-16',
    timeSlot: '510',
    quantityM3: 0.5,
    vehicleType: 'large',
    mixText: '21-18-20',
    contractorName: '元請建設',
    trading_company_name: '梅田建材',
    siteContactName: '山田',
    sitePhone: '09012345678',
    siteAddress: '大阪市北区1-2-3',
    ...overrides,
  };
}

describe('buildOperationInstructionPrintGrid heading', () => {
  it('shows the site name and address on separate lines when they differ', () => {
    const grid = buildOperationInstructionPrintGrid(
      order({ siteName: '北現場', siteAddress: '大阪市北区1-2-3' }),
      null,
      '北現場',
    );
    expect(grid.heading).toEqual({
      mode: 'nameAndAddress',
      siteName: '北現場',
      address: '大阪市北区1-2-3',
    });
  });

  it('shows only the address when the site name is empty', () => {
    const grid = buildOperationInstructionPrintGrid(
      order({ siteName: '', projectName: '', siteAddress: '大阪市北区1-2-3' }),
      { name: '' },
      '大阪市北区1-2-3',
    );
    expect(grid.heading.mode).toBe('addressOnly');
    expect(grid.heading.address).toBe('大阪市北区1-2-3');
  });

  it('treats a name that matches the address aside from width and spaces as the same place', () => {
    const grid = buildOperationInstructionPrintGrid(
      order({ siteName: 'ＡＢＣ　町', siteAddress: 'ABC 町' }),
      null,
      'ＡＢＣ　町',
    );
    expect(grid.heading.mode).toBe('addressOnly');
    expect(grid.heading.address).toBe('ABC 町');
  });

  it('keeps a long site name for a two-line clamp', () => {
    const longName = 'とても長い現場名'.repeat(8);
    const grid = buildOperationInstructionPrintGrid(
      order({ siteName: longName, siteAddress: '大阪市北区1-2-3' }),
      null,
      longName,
    );
    expect(grid.heading.mode).toBe('nameAndAddress');
    expect(grid.heading.siteName).toBe(longName);
  });
});

describe('buildOperationInstructionPrintGrid compact rows', () => {
  it('packs delivery with weekday, mix code, parties, and contact', () => {
    const grid = buildOperationInstructionPrintGrid(order(), null, '北現場');
    expect(grid.compactRows.map((row) => [row.leftLabel, row.leftValue, row.rightLabel, row.rightValue])).toEqual([
      ['配達日時', '2026/10/16㈮ 8:30', '荷下ろし時間', '30分（標準）'],
      ['配合', '21-18-20', '数量・車両', '0.5㎥・大型'],
      ['発注業者（元請）', '元請建設', '担当商社', '梅田建材'],
      ['現場担当', '山田', '連絡先', expect.any(String)],
    ]);
    expect(grid.compactRows[3].rightEmphasis).toBe(true);
    expect(grid.cells).toHaveLength(5);
    expect(grid.cells[0].leftLabel).toBe('配達日付');
    expect(buildMapEditorPrintDetailSections(order(), null).siteSection.length).toBe(10);
  });

  it('keeps blank contact fields as dashes', () => {
    const grid = buildOperationInstructionPrintGrid(
      order({ siteContactName: '', sitePhone: '', orderedBy: '', site_contact_name: '' }),
      null,
      '北現場',
    );
    expect(grid.compactRows[3].leftValue).toBe('—');
    expect(grid.compactRows[3].rightValue).toBe('—');
  });

  it('prints the mix with the cement code attached', () => {
    const normal = buildOperationInstructionPrintGrid(order({ mixText: '21-15-20N' }), null, '北現場');
    expect(normal.compactRows[1].leftValue).toBe('21-15-20N');
    const blast = buildOperationInstructionPrintGrid(order({ mixText: '18-8-20bb' }), null, '北現場');
    expect(blast.compactRows[1].leftValue).toBe('18-8-20BB');
    expect(blast.compactRows[1].rightLabel).toBe('数量・車両');
  });
});

describe('chooseUnloadLabelPlacement', () => {
  const base = {
    centerX: 200,
    centerY: 200,
    radiusPx: 20,
    mapWidth: 500,
    mapHeight: 400,
    labelWidth: 80,
    labelHeight: 28,
    gapPx: 85,
  };

  it('returns null when the unload point is outside the map', () => {
    expect(chooseUnloadLabelPlacement({ ...base, centerX: -5 })).toBeNull();
    expect(chooseUnloadLabelPlacement({ ...base, centerY: 420 })).toBeNull();
  });

  it('prefers the upper right when that spot is free', () => {
    const placed = chooseUnloadLabelPlacement({ ...base, obstacles: [] });
    expect(placed.id).toBe('ne');
  });

  it('moves to another direction when the upper right overlaps a stamp', () => {
    const blocked = chooseUnloadLabelPlacement({ ...base, obstacles: [] });
    const placed = chooseUnloadLabelPlacement({
      ...base,
      obstacles: [{ ...blocked.rect, x: blocked.rect.x - 2, y: blocked.rect.y - 2 }],
    });
    expect(placed.id).not.toBe('ne');
  });

  it('falls back to the upper right when every direction is blocked', () => {
    const placed = chooseUnloadLabelPlacement({
      ...base,
      obstacles: [{ x: 0, y: 0, w: 500, h: 400 }],
    });
    expect(placed.id).toBe('ne');
  });
});
