import { describe, expect, it } from 'vitest';
import { pickDefaultMeetingSheetName } from './csvImport.js';
import {
  findMeetingHeaderRowIndex,
  findSimilarProjects,
  mapMeetingHeaderIndexes,
  normalizeDeliveryNote,
  normalizeMeetingHeaderCell,
  parseFactoryAssignmentCell,
  parseIsNewProject,
  parseMeetingSheetMatrix,
  parseWarekiPeriod,
} from './meetingImport.js';

describe('meetingImport helpers', () => {
  it('parses Reiwa period to Gregorian dates', () => {
    expect(parseWarekiPeriod('自R8.9.1\n至R9.9.30')).toEqual({
      start: '2026-09-01',
      end: '2027-09-30',
    });
  });

  it('normalizes Excel serial delivery notes', () => {
    expect(normalizeDeliveryNote('10月中旬')).toBe('10月中旬');
    expect(normalizeDeliveryNote(null)).toBe(null);
    // 2026-09-01 approx serial around 45900+
    const note = normalizeDeliveryNote(45936);
    expect(note).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('parses 新・旧', () => {
    expect(parseIsNewProject('新')).toBe(true);
    expect(parseIsNewProject('旧')).toBe(false);
    expect(parseIsNewProject('')).toBe(null);
  });

  it('detects multi-phase factory cells', () => {
    const factories = [
      { id: 'FACTORY_01', name: '千歳生コン' },
      { id: 'FACTORY_12', name: '挾間生コン' },
    ];
    const multi = parseFactoryAssignmentCell('（造成）\n千歳\n（躯体）\n挾間', factories);
    expect(multi.isMultiPhase).toBe(true);
    expect(multi.resolved).toBe(null);

    const single = parseFactoryAssignmentCell('千歳', factories);
    expect(single.isMultiPhase).toBe(false);
    expect(single.resolved).toBe('FACTORY_01');
  });

  it('finds header row and maps columns by header text', () => {
    const matrix = [
      ['注記'],
      ['日付'],
      ['No', '受注先名', '施工業者名\n（元請）', '工事名', '工事場所', '工期', '数量', '割当工場', '納期予定', '備考', '新・旧', '組合提案\nメイン', 'サブ'],
      [1, '〇〇商事', '〇〇建設', 'テスト工事', '大分市', '自R8.9.1至R8.12.31', 100, '千歳', '10月', '', '新', '千歳', '挾間'],
      ['小計'],
    ];
    expect(findMeetingHeaderRowIndex(matrix)).toBe(2);
    const idx = mapMeetingHeaderIndexes(matrix[2]);
    expect(idx.trading).toBe(1);
    expect(idx.contractor).toBe(2);
    expect(idx.name).toBe(3);
    expect(idx.main_factory).toBe(11);
    expect(idx.sub_factory).toBe(12);
    expect(normalizeMeetingHeaderCell('施工業者名\n（元請）')).toContain('施工業者名');
  });

  it('parses sheet until 小計 and skips section labels', () => {
    const factories = [
      { id: 'FACTORY_01', name: '千歳生コン' },
      { id: 'FACTORY_12', name: '挾間生コン' },
    ];
    const matrix = [
      ['注記'],
      ['No', '受注先名', '施工業者名（元請）', '工事名', '工事場所', '工期', '数量', '割当工場', '納期予定', '備考', '新・旧', '組合提案メイン', 'サブ'],
      [1, '商社A', '業者A', '高城南町', '大分市', '自R8.9.1\n至R8.10.1', 12, '千歳', '9月', 'メモ', '新', '千歳', ''],
      ['', '', '', '', '', '', '', '○先行割決', '', '', '', '', ''],
      [2, '商社B', '業者B', '蓄電所PJ', '別府市', '自R8.1.1\n至R9.1.1', 50, '', '', '', '旧', '（造成）\n千歳\n（躯体）\n挾間', ''],
      ['小計', '', '', '', '', '', 62, '', '', '', '', '', ''],
      [99, '商社C', '業者C', '小計後は無視', '大分市', '', 1, '', '', '', '', '千歳', ''],
    ];
    const result = parseMeetingSheetMatrix(matrix, { factories, existingProjects: [] });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].name).toBe('高城南町');
    expect(result.rows[0].main_factory_id).toBe('FACTORY_01');
    expect(result.rows[0].period_start_date).toBe('2026-09-01');
    expect(result.rows[0].is_new_project).toBe(true);
    expect(result.rows[1].name).toBe('蓄電所PJ');
    expect(result.rows[1].main_factory_id).toBe('');
    expect(result.rows[1].__needsManualFactory).toBe(true);
    expect(result.manualFactoryCount).toBeGreaterThanOrEqual(1);
    expect(result.skipped.some((s) => String(s.reason).includes('区切り'))).toBe(true);
  });

  it('finds similar projects by name', () => {
    const hits = findSimilarProjects(
      { name: '高城南町マンション', delivery_area: '大分市' },
      [{ id: '1', name: '高城南町マンション', delivery_area: '大分市' }],
    );
    expect(hits).toHaveLength(1);
    expect(hits[0].reason).toContain('物件名が一致');
  });

  it('picks newest M.D sheet as default', () => {
    expect(pickDefaultMeetingSheetName(['4.7', '9.15', '6.2'])).toBe('9.15');
    expect(pickDefaultMeetingSheetName(['メモ', 'その他'])).toBe('その他');
  });
});
