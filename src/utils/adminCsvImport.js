import { getDeliveryAreaValidationMessage } from './deliveryAreas.js';
import { resolveUrlTokenForInsert } from './urlValidation.js';
import {
  CUSTOMER_CSV_ALIASES,
  CUSTOMER_EXPORT_HEADERS,
  downloadCsvWithUtf8Bom,
  mapCsvHeaders,
  parseCsvText,
  PROJECT_CSV_ALIASES,
  PROJECT_EXPORT_HEADERS,
  readCsvFileAsText,
  rowsToObjects,
} from './csvImport.js';

const DEFAULT_CUSTOMER_PASSWORD = '1234';

function cleanCell(value) {
  return String(value ?? '')
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .trim();
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
export async function parseProjectsCsvFile(file, { customers = [], mainFactoryId = '', allowedDeliveryAreas = [] } = {}) {
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

    rows.push({
      name,
      customer_id,
      main_factory_id: mainFactoryId,
      sub_factory_ids: [],
      trading_company_name: trading_company_name || null,
      trading_company: trading_company_name || null,
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

  return { rows, skipped, warnings };
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

    const phone_number = cleanCell(raw.phone_number);
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
    cleanCell(p.trading_company_name || p.trading_company),
    cleanCell(p.site_address),
    cleanCell(p.delivery_area),
  ]);
  return [PROJECT_EXPORT_HEADERS, ...dataRows];
}

/**
 * 業者一覧 → 取込互換 CSV 行（ヘッダー含む）
 */
export function buildCustomersExportRows(customers) {
  const dataRows = (customers || []).map((c) => [
    cleanCell(c.company_name || c.name),
    cleanCell(c.manager_name),
    cleanCell(c.phone_number),
    cleanCell(c.login_password),
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
