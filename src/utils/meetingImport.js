/** 割決会議資料（特殊帳票）専用パーサー */

import {
  listExcelSheetNames,
  normalizeCompanyName,
  readExcelSheetMatrix,
  resolveFactoryId,
} from './csvImport.js';
import {
  resolveTradingCompanyForImport,
} from './adminCsvImport.js';
import { resolveUrlTokenForInsert } from './urlValidation.js';

const REIWA_OFFSET = 2018; // 令和1年 = 2019年

/** ヘッダー照合用に空白・改行を除去 */
export function normalizeMeetingHeaderCell(value) {
  return String(value ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[\n\r\t]/g, '')
    .replace(/\s+/g, '')
    .trim();
}

function cellText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return String(value).replace(/\r\n/g, '\n').trim();
}

function cellMultiline(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return String(value).replace(/\r\n/g, '\n').trim();
}

/**
 * 和暦(令和)の日付文字列 "自R8.9.1\n至R9.9.30" を解析
 * @param {unknown} raw
 * @returns {{ start: string|null, end: string|null }}
 */
export function parseWarekiPeriod(raw) {
  const text = String(raw ?? '');
  const pattern = /R(\d+)\.(\d+)\.(\d+)/g;
  const dates = [];
  let m;
  while ((m = pattern.exec(text)) !== null) {
    const year = REIWA_OFFSET + Number(m[1]);
    const month = String(m[2]).padStart(2, '0');
    const day = String(m[3]).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
  }
  return { start: dates[0] || null, end: dates[1] || null };
}

/**
 * Excelの日付シリアル値 or 自由記述テキスト
 * @param {unknown} raw
 * @returns {string|null}
 */
export function normalizeDeliveryNote(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(excelEpoch.getTime() + raw * 86400000);
    if (Number.isNaN(d.getTime())) return String(raw);
    return d.toISOString().slice(0, 10);
  }
  const text = String(raw).replace(/\r\n/g, '\n').trim();
  return text || null;
}

/**
 * 「新・旧」列
 * @param {unknown} raw
 * @returns {boolean|null}
 */
export function parseIsNewProject(raw) {
  const text = cellText(raw);
  if (!text) return null;
  if (text === '新' || text.startsWith('新')) return true;
  if (text === '旧' || text.startsWith('旧')) return false;
  return null;
}

/**
 * 数量セル
 * @param {unknown} raw
 * @returns {number|null}
 */
export function parsePlannedQuantity(raw) {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const text = cellText(raw).replace(/,/g, '').replace(/m³|m3|㎥/gi, '').trim();
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/**
 * メイン/サブの工場セルが単一工場か、フェーズ分割（複数行）かを判定
 * @param {unknown} raw
 * @param {{ id?: string, name?: string }[]} factories
 */
export function parseFactoryAssignmentCell(raw, factories) {
  const text = cellMultiline(raw);
  if (!text) return { resolved: null, isMultiPhase: false, rawText: text };
  const lines = text
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  const hasPhaseMarker = /^[（(].+[）)]$/.test(lines[0] || '');
  const nonMarkerLines = lines.filter((l) => !/^[（(].+[）)]$/.test(l));
  const uniqueFactoryLines = [...new Set(nonMarkerLines)];
  if (hasPhaseMarker || uniqueFactoryLines.length > 1) {
    return { resolved: null, isMultiPhase: true, rawText: text };
  }
  const resolved = resolveFactoryId(uniqueFactoryLines[0] || text, factories);
  return { resolved, isMultiPhase: false, rawText: text };
}

/**
 * ヘッダー行の列インデックスを特定（列番号ハードコード禁止）
 * @param {unknown[]} headerRow
 */
export function mapMeetingHeaderIndexes(headerRow) {
  const row = Array.isArray(headerRow) ? headerRow : [];
  const idx = {
    no: null,
    trading: null,
    contractor: null,
    name: null,
    delivery_area: null,
    period: null,
    quantity: null,
    assigned_display: null,
    delivery_note: null,
    notes: null,
    is_new: null,
    main_factory: null,
    sub_factory: null,
  };

  for (let i = 0; i < row.length; i += 1) {
    const n = normalizeMeetingHeaderCell(row[i]);
    if (!n) continue;
    if (idx.no == null && (n === 'No' || n === 'NO' || n === '番号')) idx.no = i;
    else if (idx.trading == null && n.includes('受注先名')) idx.trading = i;
    else if (idx.contractor == null && n.includes('施工業者')) idx.contractor = i;
    else if (idx.name == null && (n === '工事名' || n.includes('工事名'))) idx.name = i;
    else if (idx.delivery_area == null && (n === '工事場所' || n.includes('工事場所'))) idx.delivery_area = i;
    else if (idx.period == null && (n === '工期' || n.includes('工期'))) idx.period = i;
    else if (idx.quantity == null && (n === '数量' || n.includes('数量'))) idx.quantity = i;
    else if (idx.assigned_display == null && n.includes('割当工場')) idx.assigned_display = i;
    else if (idx.delivery_note == null && n.includes('納期予定')) idx.delivery_note = i;
    else if (idx.notes == null && (n === '備考' || n.endsWith('備考'))) idx.notes = i;
    else if (idx.is_new == null && (n.includes('新・旧') || n === '新旧' || n.includes('新旧'))) idx.is_new = i;
    else if (
      idx.main_factory == null &&
      ((n.includes('組合提案') && n.includes('メイン')) || n === 'メイン')
    ) {
      idx.main_factory = i;
    } else if (
      idx.sub_factory == null &&
      (n === 'サブ' || (n.includes('組合提案') && n.includes('サブ')))
    ) {
      idx.sub_factory = i;
    }
  }
  return idx;
}

/**
 * 「受注先名」と「施工業者名」の両方を含む行をヘッダーとする
 * @param {unknown[][]} matrix
 * @returns {number}
 */
export function findMeetingHeaderRowIndex(matrix) {
  const rows = Array.isArray(matrix) ? matrix : [];
  for (let i = 0; i < rows.length; i += 1) {
    const joined = (Array.isArray(rows[i]) ? rows[i] : [])
      .map((c) => normalizeMeetingHeaderCell(c))
      .join('|');
    if (joined.includes('受注先名') && joined.includes('施工業者')) return i;
  }
  return -1;
}

function getCell(row, index) {
  if (index == null || index < 0) return '';
  return Array.isArray(row) ? row[index] : '';
}

function isSubtotalRow(row, idx) {
  const noText = cellText(getCell(row, idx.no));
  if (noText.includes('小計')) return true;
  const assigned = cellText(getCell(row, idx.assigned_display));
  if (assigned.includes('小計')) return true;
  // H列相当（割当工場列）以外にも「小計」だけの行
  const any = (Array.isArray(row) ? row : []).some((c) => cellText(c) === '小計');
  return any && !cellText(getCell(row, idx.name)) && !cellText(getCell(row, idx.trading));
}

function isSectionLabelRow(row, idx) {
  const no = cellText(getCell(row, idx.no));
  const trading = cellText(getCell(row, idx.trading));
  const contractor = cellText(getCell(row, idx.contractor));
  const name = cellText(getCell(row, idx.name));
  if (no || trading || contractor || name) return false;
  const assigned = cellText(getCell(row, idx.assigned_display));
  const main = cellText(getCell(row, idx.main_factory));
  const notes = cellText(getCell(row, idx.notes));
  // 「○先行割決」など H列相当だけ値がある区切り行
  return Boolean(assigned || main || notes);
}

function factoryLabelById(factories, id, fallback = '') {
  const hit = (factories || []).find((f) => f && String(f.id) === String(id));
  return hit ? cellText(hit.name) || fallback : fallback;
}

function findCustomerIdByNormalizedName(customers, name) {
  const q = normalizeCompanyName(name);
  if (!q) return null;
  const exact = (customers || []).find(
    (c) => normalizeCompanyName(c.company_name || c.name) === q,
  );
  return exact?.id ?? null;
}

function upsertNamedEntity(map, name, line) {
  const key = normalizeCompanyName(name);
  if (!key) return;
  const prev = map.get(key);
  if (prev) {
    if (line != null && !prev.__lines.includes(line)) prev.__lines.push(line);
    return;
  }
  map.set(key, { name: String(name).trim(), __lines: line != null ? [line] : [] });
}

/**
 * 既存物件との類似チェック（名前の正規化一致・部分一致）
 * @param {{ name?: string, delivery_area?: string|null, contractor_display_name?: string|null, __contractorLabel?: string }} candidate
 * @param {object[]} existingProjects
 * @returns {{ id: string, name: string, reason: string }[]}
 */
export function findSimilarProjects(candidate, existingProjects) {
  const name = normalizeCompanyName(candidate?.name);
  if (!name) return [];
  const area = normalizeCompanyName(candidate?.delivery_area);
  const contractor = normalizeCompanyName(
    candidate?.__contractorLabel || candidate?.contractor_display_name || candidate?.contractor,
  );
  const out = [];
  for (const p of existingProjects || []) {
    const pname = normalizeCompanyName(p?.name);
    if (!pname) continue;
    let reason = '';
    if (pname === name) reason = '物件名が一致';
    else if (pname.includes(name) || name.includes(pname)) reason = '物件名が類似';
    if (!reason) continue;
    const pArea = normalizeCompanyName(p?.delivery_area);
    const pContractor = normalizeCompanyName(
      p?.contractor_display_name || p?.contractor || p?.sub_contractor_name,
    );
    if (area && pArea && area === pArea) reason += '・エリア一致';
    if (contractor && pContractor && contractor === pContractor) reason += '・業者一致';
    out.push({
      id: String(p.id || ''),
      name: String(p.name || ''),
      reason,
    });
    if (out.length >= 5) break;
  }
  return out;
}

/**
 * 会議資料シート1枚を物件取込行へ変換
 */
export function parseMeetingSheetMatrix(
  matrix,
  {
    customers = [],
    tradingCompanies = [],
    agentOrganizations = [],
    factories = [],
    existingProjects = [],
    sheetName = '',
  } = {},
) {
  const headerRowIndex = findMeetingHeaderRowIndex(matrix);
  if (headerRowIndex < 0) {
    throw new Error(
      'ヘッダー行（「受注先名」「施工業者名」を含む行）が見つかりません。シートを確認してください。',
    );
  }
  const headerIndexes = mapMeetingHeaderIndexes(matrix[headerRowIndex]);
  if (headerIndexes.name == null) {
    throw new Error('ヘッダーに「工事名」列が見つかりません。');
  }
  if (headerIndexes.trading == null || headerIndexes.contractor == null) {
    throw new Error('ヘッダーに「受注先名」または「施工業者名」列が見つかりません。');
  }

  const rows = [];
  const skipped = [];
  const warnings = [];
  const newContractorMap = new Map();
  const newTradingMap = new Map();
  let manualFactoryCount = 0;

  for (let r = headerRowIndex + 1; r < matrix.length; r += 1) {
    const row = Array.isArray(matrix[r]) ? matrix[r] : [];
    const line = r + 1;
    if (!row.some((c) => cellText(c) !== '')) continue;

    if (isSubtotalRow(row, headerIndexes)) {
      break;
    }
    if (isSectionLabelRow(row, headerIndexes)) {
      skipped.push({ line, reason: '区切りラベル行のためスキップ' });
      continue;
    }

    const name = cellText(getCell(row, headerIndexes.name));
    if (!name) {
      skipped.push({ line, reason: '工事名が空のためスキップ' });
      continue;
    }

    const meetingNo = cellText(getCell(row, headerIndexes.no));
    const tradingName = cellText(getCell(row, headerIndexes.trading));
    const contractorName = cellText(getCell(row, headerIndexes.contractor));
    const delivery_area = cellText(getCell(row, headerIndexes.delivery_area)) || null;
    const periodRaw = cellMultiline(getCell(row, headerIndexes.period));
    const period = parseWarekiPeriod(periodRaw);
    const planned_quantity_m3 = parsePlannedQuantity(getCell(row, headerIndexes.quantity));
    const assignedDisplay = cellMultiline(getCell(row, headerIndexes.assigned_display));
    const planned_delivery_note = normalizeDeliveryNote(getCell(row, headerIndexes.delivery_note));
    const notes = cellMultiline(getCell(row, headerIndexes.notes)) || null;
    const is_new_project = parseIsNewProject(getCell(row, headerIndexes.is_new));

    const mainCell = parseFactoryAssignmentCell(getCell(row, headerIndexes.main_factory), factories);
    const subCell = parseFactoryAssignmentCell(getCell(row, headerIndexes.sub_factory), factories);
    const rowNotes = [];

    let main_factory_id = '';
    let __mainFactoryLabel = '';
    let sub_factory_ids = [];
    let __subFactoryLabels = '';
    let __needsManualFactory = false;

    if (mainCell.isMultiPhase || subCell.isMultiPhase) {
      __needsManualFactory = true;
      manualFactoryCount += 1;
      const rawText = mainCell.isMultiPhase ? mainCell.rawText : subCell.rawText;
      rowNotes.push(
        `⚠️工期中に工場が複数回切り替わる可能性があります（内容: "${rawText}"）。手動で工場を設定してください`,
      );
    } else {
      if (mainCell.rawText) {
        if (mainCell.resolved) {
          main_factory_id = String(mainCell.resolved);
          __mainFactoryLabel = factoryLabelById(factories, main_factory_id, mainCell.rawText);
        } else {
          __needsManualFactory = true;
          manualFactoryCount += 1;
          __mainFactoryLabel = mainCell.rawText;
          rowNotes.push(`⚠️メイン工場名不一致: ${mainCell.rawText}`);
        }
      }
      if (subCell.rawText) {
        if (subCell.isMultiPhase) {
          // already handled
        } else if (subCell.resolved) {
          const sid = String(subCell.resolved);
          if (sid !== main_factory_id) {
            sub_factory_ids = [sid];
            __subFactoryLabels = factoryLabelById(factories, sid, subCell.rawText);
          }
        } else {
          rowNotes.push(`⚠️サブ工場名不一致: ${subCell.rawText}`);
          __subFactoryLabels = subCell.rawText;
        }
      }
    }

    if (!main_factory_id && !__needsManualFactory && !mainCell.rawText) {
      __needsManualFactory = true;
      manualFactoryCount += 1;
      rowNotes.push('⚠️組合提案メインが空のため、工場は手動設定が必要です');
    }

    const customer_id = findCustomerIdByNormalizedName(customers, contractorName);
    let __unmatchedContractorName;
    if (contractorName && !customer_id) {
      upsertNamedEntity(newContractorMap, contractorName, line);
      __unmatchedContractorName = contractorName;
    }

    const trading = resolveTradingCompanyForImport(tradingName, {
      tradingCompanies,
      agentOrganizations,
    });
    for (const n of trading.__tradingNotes || []) rowNotes.push(n);
    if (trading.__unmatchedTradingCompanyName) {
      upsertNamedEntity(newTradingMap, trading.__unmatchedTradingCompanyName, line);
    }

    const similar = findSimilarProjects(
      {
        name,
        delivery_area,
        contractor_display_name: contractorName || null,
        __contractorLabel: contractorName,
      },
      existingProjects,
    );
    if (similar.length) {
      rowNotes.push(
        `⚠️類似物件の可能性: ${similar.map((s) => `${s.name}（${s.reason}）`).join(' / ')}`,
      );
    }

    for (const note of rowNotes) {
      warnings.push(`行${line}: ${note}`);
    }

    rows.push({
      name,
      customer_id,
      main_factory_id,
      sub_factory_ids,
      trading_company_name: trading.trading_company_name,
      trading_company: trading.trading_company,
      trading_company_organization_id: trading.trading_company_organization_id,
      trading_contact_name: null,
      trading_contact_phone: null,
      site_contacts: [],
      sales_admin_id: null,
      sales_admin_name: null,
      contractor_display_name: contractorName || null,
      contractor: null,
      sub_contractor_name: null,
      billing_target: 'main',
      delivery_area,
      site_address: null,
      lat: null,
      lng: null,
      folder_url: null,
      sheet_url: null,
      url_token: resolveUrlTokenForInsert({}),
      period_start_date: period.start,
      period_end_date: period.end,
      planned_quantity_m3,
      planned_delivery_note,
      notes,
      is_new_project,
      __line: line,
      __sheetName: sheetName,
      __meetingNo: meetingNo || null,
      __contractorLabel: contractorName,
      __mainFactoryLabel,
      __subFactoryLabels,
      __assignedDisplay: assignedDisplay || null,
      __periodRaw: periodRaw || null,
      __siteContactsRaw: '',
      __rowNotes: rowNotes,
      __needsManualFactory,
      __similarProjects: similar,
      ...(__unmatchedContractorName ? { __unmatchedContractorName } : {}),
      ...(trading.__unmatchedTradingCompanyName
        ? { __unmatchedTradingCompanyName: trading.__unmatchedTradingCompanyName }
        : {}),
      ...((trading.__tradingCandidates || []).length > 0
        ? { __tradingCandidates: trading.__tradingCandidates }
        : {}),
    });
  }

  if (rows.length === 0) {
    throw new Error('取り込み可能な物件がありません（データ行が見つかりませんでした）。');
  }

  const newContractors = [...newContractorMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'ja'),
  );
  const newTradingCompanies = [...newTradingMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'ja'),
  );

  return {
    rows,
    skipped,
    warnings,
    newTradingCompanies,
    newContractors,
    manualFactoryCount,
    headerRowIndex,
    sheetName,
  };
}

/**
 * 割決会議資料 Excel をパース
 * @param {File} file
 * @param {{ sheetName?: string, customers?: object[], tradingCompanies?: object[], agentOrganizations?: object[], factories?: object[], existingProjects?: object[] }} [ctx]
 */
export async function parseMeetingProjectsFile(file, ctx = {}) {
  const sheetName = String(ctx.sheetName || '').trim();
  const { sheetName: resolvedSheet, matrix } = await readExcelSheetMatrix(file, {
    sheetName: sheetName || undefined,
    raw: true,
  });
  return parseMeetingSheetMatrix(matrix, { ...ctx, sheetName: resolvedSheet });
}

export { listExcelSheetNames };
