import { getDeliveryAreaValidationMessage } from './deliveryAreas.js';
import { findAgentOrganizationByName, resolveProjectTradingCompanyName } from './projectTradingCompany.js';
import { resolveUrlTokenForInsert } from './urlValidation.js';
import {
  CUSTOMER_CSV_ALIASES,
  CUSTOMER_EXPORT_HEADERS,
  TRADING_COMPANY_CSV_ALIASES,
  TRADING_COMPANY_EXPORT_HEADERS,
  downloadCsvWithUtf8Bom,
  formatCsvExcelTextField,
  mapCsvHeaders,
  normalizeCsvImportedText,
  normalizeCsvPhoneNumber,
  parseCsvText,
  PROJECT_CSV_ALIASES,
  PROJECT_EXPORT_HEADERS,
  readCsvFileAsText,
  rowsToObjects,
} from './csvImport.js';

const DEFAULT_CUSTOMER_PASSWORD = '1234';

function cleanCell(value) {
  return normalizeCsvImportedText(value);
}

function findCustomerIdByName(customers, name) {
  const q = cleanCell(name);
  if (!q) return null;
  const exact = (customers || []).find((c) => cleanCell(c.company_name || c.name) === q);
  if (exact?.id) return exact.id;
  const loose = (customers || []).find((c) => {
    const n = cleanCell(c.company_name || c.name);
    return n && (n.includes(q) || q.includes(n));
  });
  return loose?.id ?? null;
}

/**
 * @param {File} file
 * @returns {Promise<{ rows: object[], skipped: { line: number, reason: string }[], warnings: string[] }>}
 */
export async function parseProjectsCsvFile(
  file,
  { customers = [], mainFactoryId = '', allowedDeliveryAreas = [], agentOrganizations = [] } = {},
) {
  const text = await readCsvFileAsText(file);
  const matrix = parseCsvText(text);
  if (matrix.length < 2) {
    throw new Error('データ行がありません（ヘッダー＋1行以上必要です）。');
  }

  const headerIndex = mapCsvHeaders(matrix[0], PROJECT_CSV_ALIASES);
  if (headerIndex.name == null) {
    throw new Error('ヘッダーに「物件名」列が見つかりません。1行目を確認してください。');
  }

  const rawRows = rowsToObjects(matrix, headerIndex);
  const rows = [];
  const skipped = [];
  const warnings = [];
  const unregisteredTradingCompanies = new Set();

  if (!mainFactoryId) {
    throw new Error('メイン工場が未登録のため、物件の一括取込はできません。先に工場マスタを登録してください。');
  }

  for (const raw of rawRows) {
    const line = raw.__line;
    const name = cleanCell(raw.name);
    if (!name) {
      skipped.push({ line, reason: '物件名が空のためスキップ' });
      continue;
    }

    const delivery_area = cleanCell(raw.delivery_area);
    const site_address = cleanCell(raw.site_address);
    const trading_company_name = cleanCell(raw.trading_company_name);
    const contractorDisplayName = cleanCell(raw.contractor_display_name);
    const contractorName = cleanCell(raw.contractor);

    if (delivery_area && site_address) {
      const full = `${delivery_area} ${site_address}`;
      const msg = getDeliveryAreaValidationMessage(full, allowedDeliveryAreas);
      if (msg && allowedDeliveryAreas.length > 0) {
        skipped.push({ line, reason: msg });
        continue;
      }
    }

    const customer_id = findCustomerIdByName(customers, contractorName);
    if (contractorName && !customer_id) {
      warnings.push(`行${line}: 元請業者「${contractorName}」は業者マスタに未登録のため、物件のみ登録します。`);
    }

    let trading_company_organization_id = null;
    if (trading_company_name) {
      const agentOrg = findAgentOrganizationByName(agentOrganizations, trading_company_name);
      if (agentOrg?.id) {
        trading_company_organization_id = agentOrg.id;
      } else {
        unregisteredTradingCompanies.add(trading_company_name);
      }
    }

    rows.push({
      name,
      customer_id,
      main_factory_id: mainFactoryId,
      sub_factory_ids: [],
      trading_company_name: trading_company_name || null,
      trading_company: trading_company_name || null,
      trading_company_organization_id,
      contractor_display_name: contractorDisplayName || null,
      contractor: null,
      sub_contractor_name: null,
      delivery_area: delivery_area || null,
      site_address: site_address || null,
      lat: null,
      lng: null,
      folder_url: null,
      sheet_url: null,
      url_token: resolveUrlTokenForInsert({}),
      __line: line,
      __contractorLabel: contractorName,
    });
  }

  if (rows.length === 0) {
    throw new Error('取り込み可能な物件がありません。');
  }

  if (unregisteredTradingCompanies.size > 0) {
    const list = [...unregisteredTradingCompanies].sort((a, b) => a.localeCompare(b, 'ja'));
    warnings.push(`未登録商社名: ${unregisteredTradingCompanies.size}件（${list.join('、')}）`);
  }

  return { rows, skipped, warnings };
}

/**
 * @param {File} file
 */
export async function parseTradingCompaniesCsvFile(file) {
  const text = await readCsvFileAsText(file);
  const matrix = parseCsvText(text);
  if (matrix.length < 2) {
    throw new Error('データ行がありません（ヘッダー＋1行以上必要です）。');
  }

  const headerIndex = mapCsvHeaders(matrix[0], TRADING_COMPANY_CSV_ALIASES);
  if (headerIndex.name == null) {
    throw new Error('ヘッダーに「商社名」列が見つかりません。1行目を確認してください。');
  }

  const rawRows = rowsToObjects(matrix, headerIndex);
  const rows = [];
  const skipped = [];

  for (const raw of rawRows) {
    const line = raw.__line;
    const name = cleanCell(raw.name);
    if (!name) {
      skipped.push({ line, reason: '商社名が空のためスキップ' });
      continue;
    }
    rows.push({ name, __line: line });
  }

  if (rows.length === 0) {
    throw new Error('取り込み可能な商社がありません。');
  }

  return { rows, skipped, warnings: [] };
}

/**
 * @param {File} file
 */
export async function parseCustomersCsvFile(file) {
  const text = await readCsvFileAsText(file);
  const matrix = parseCsvText(text);
  if (matrix.length < 2) {
    throw new Error('データ行がありません（ヘッダー＋1行以上必要です）。');
  }

  const headerIndex = mapCsvHeaders(matrix[0], CUSTOMER_CSV_ALIASES);
  if (headerIndex.company_name == null) {
    throw new Error('ヘッダーに「業者名」列が見つかりません。1行目を確認してください。');
  }

  const rawRows = rowsToObjects(matrix, headerIndex);
  const rows = [];
  const skipped = [];
  const warnings = [];

  for (const raw of rawRows) {
    const line = raw.__line;
    const company_name = cleanCell(raw.company_name);
    if (!company_name) {
      skipped.push({ line, reason: '業者名が空のためスキップ' });
      continue;
    }

    const phone_number = normalizeCsvPhoneNumber(raw.phone_number);
    if (!phone_number) {
      skipped.push({ line, reason: '電話番号が空のためスキップ' });
      continue;
    }

    let login_password = cleanCell(raw.login_password);
    if (!login_password) {
      login_password = DEFAULT_CUSTOMER_PASSWORD;
      warnings.push(`行${line}: ログインパスワード未入力のため初期値「${DEFAULT_CUSTOMER_PASSWORD}」を設定します。`);
    }

    rows.push({
      company_name,
      furigana: cleanCell(raw.furigana) || null,
      manager_name: cleanCell(raw.manager_name) || null,
      phone_number,
      login_password,
      __line: line,
    });
  }

  if (rows.length === 0) {
    throw new Error('取り込み可能な業者がありません。');
  }

  return { rows, skipped, warnings };
}

/** DB insert 用にメタフィールドを除去 */
export function stripImportMeta(row) {
  const { __line, __contractorLabel, ...rest } = row;
  return rest;
}

function exportDateSuffix() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * 物件一覧 → 取込互換 CSV 行（ヘッダー含む）
 */
export function buildProjectsExportRows(projects, customers = []) {
  const customerNameById = new Map(
    (customers || []).map((c) => [String(c.id), cleanCell(c.company_name || c.name)]),
  );
  const dataRows = (projects || []).map((p) => [
    cleanCell(p.name),
    customerNameById.get(String(p.customer_id || '')) || '',
    cleanCell(p.contractor_display_name),
    cleanCell(resolveProjectTradingCompanyName(p)),
    cleanCell(p.site_address),
    cleanCell(p.delivery_area),
  ]);
  return [PROJECT_EXPORT_HEADERS, ...dataRows];
}

/**
 * 商社一覧 → 取込互換 CSV 行（ヘッダー含む）
 */
export function buildTradingCompaniesExportRows(tradingCompanies) {
  const dataRows = (tradingCompanies || []).map((t) => [cleanCell(t.name)]);
  return [TRADING_COMPANY_EXPORT_HEADERS, ...dataRows];
}

/**
 * 業者一覧 → 取込互換 CSV 行（ヘッダー含む）
 */
export function buildCustomersExportRows(customers) {
  const dataRows = (customers || []).map((c) => [
    cleanCell(c.company_name || c.name),
    cleanCell(c.furigana),
    cleanCell(c.manager_name),
    formatCsvExcelTextField(c.phone_number),
    formatCsvExcelTextField(c.login_password),
  ]);
  return [CUSTOMER_EXPORT_HEADERS, ...dataRows];
}

export function downloadProjectsExportCsv(projects, customers) {
  const rows = buildProjectsExportRows(projects, customers);
  downloadCsvWithUtf8Bom(`projects_export_${exportDateSuffix()}.csv`, rows);
}

export function downloadCustomersExportCsv(customers) {
  const rows = buildCustomersExportRows(customers);
  downloadCsvWithUtf8Bom(`customers_export_${exportDateSuffix()}.csv`, rows);
}

/** 組織ツリー（担当者一覧）→ 業者取込互換 CSV */
export function buildOrgMembersExportRows(orgs) {
  const members = [];
  for (const org of orgs || []) {
    for (const m of org.members || []) {
      members.push({
        company_name: org.name,
        furigana: m.furigana,
        manager_name: m.manager_name,
        phone_number: m.phone_number,
        login_password: m.login_password,
      });
    }
  }
  return buildCustomersExportRows(members);
}

export function downloadOrgMembersExportCsv(orgs, filenamePrefix = 'org_members') {
  const rows = buildOrgMembersExportRows(orgs);
  downloadCsvWithUtf8Bom(`${filenamePrefix}_export_${exportDateSuffix()}.csv`, rows);
}

export function downloadTradingCompaniesExportCsv(tradingCompanies) {
  const rows = buildTradingCompaniesExportRows(tradingCompanies);
  downloadCsvWithUtf8Bom(`trading_companies_export_${exportDateSuffix()}.csv`, rows);
}
