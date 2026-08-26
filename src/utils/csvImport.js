/**
 * CSV 読み込み（UTF-8 BOM / UTF-8 / Shift_JIS 自動判定）とパース
 */

const JP_HEADER_HINTS = [
  '物件名',
  '元請',
  '商社',
  '住所',
  'エリア',
  '業者',
  '電話',
  '担当',
  'パスワード',
  '会社',
  'フリガナ',
];

function scoreJapaneseCsvText(text) {
  const head = String(text || '').slice(0, 4000);
  let score = 0;
  if (/\uFFFD/.test(head)) score -= 20;
  if (/[\u3040-\u30ff\u4e00-\u9fff]/.test(head)) score += 8;
  for (const hint of JP_HEADER_HINTS) {
    if (head.includes(hint)) score += 4;
  }
  if (/Ã.|Â.|ã.|æ.|å./.test(head) && !/[\u3040-\u30ff]/.test(head)) score -= 15;
  return score;
}

function decodeWithLabel(uint8, encoding, stripBom = false) {
  let bytes = uint8;
  if (
    stripBom &&
    encoding === 'utf-8' &&
    bytes.length >= 3 &&
    bytes[0] === 0xef &&
    bytes[1] === 0xbb &&
    bytes[2] === 0xbf
  ) {
    bytes = bytes.subarray(3);
  }
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return null;
  }
}

/**
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function readCsvFileAsText(file) {
  const buffer = await file.arrayBuffer();
  const uint8 = new Uint8Array(buffer);

  const utf8 = decodeWithLabel(uint8, 'utf-8', true);
  const shift =
    decodeWithLabel(uint8, 'shift_jis', false) ||
    decodeWithLabel(uint8, 'windows-932', false);

  const candidates = [];
  if (utf8 != null) candidates.push({ text: utf8, enc: 'utf-8' });
  if (shift != null) candidates.push({ text: shift, enc: 'shift_jis' });

  if (candidates.length === 0) {
    throw new Error('CSVの文字コードを判別できませんでした。');
  }

  candidates.sort((a, b) => scoreJapaneseCsvText(b.text) - scoreJapaneseCsvText(a.text));
  return candidates[0].text.replace(/^\uFEFF/, '');
}

/**
 * RFC4180 風 CSV パース（改行・ダブルクォート対応）
 * @returns {string[][]}
 */
export function parseCsvText(text) {
  const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < normalized.length; i += 1) {
    const c = normalized[i];
    const next = normalized[i + 1];

    if (inQuotes) {
      if (c === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') {
        inQuotes = false;
      } else {
        cell += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += c;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows
    .map((r) => r.map((c) => String(c ?? '').trim()))
    .filter((r) => r.some((c) => c !== ''));
}

function normalizeHeaderKey(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[（）()]/g, '');
}

/**
 * ヘッダー行から列インデックスを解決
 * @param {string[]} headers
 * @param {Record<string, string[]>} aliasMap fieldKey -> 別名リスト
 */
export function mapCsvHeaders(headers, aliasMap) {
  const normalized = headers.map(normalizeHeaderKey);
  const indexByField = {};

  for (const [field, aliases] of Object.entries(aliasMap)) {
    const aliasNorm = aliases.map((a) => normalizeHeaderKey(a));
    const idx = normalized.findIndex((h) => aliasNorm.some((a) => h === a || h.includes(a) || a.includes(h)));
    if (idx >= 0) indexByField[field] = idx;
  }

  return indexByField;
}

/**
 * @param {string[][]} rows
 * @param {Record<string, number>} headerIndex
 */
export function rowsToObjects(rows, headerIndex) {
  const dataRows = rows.slice(1);
  return dataRows.map((cells, lineIndex) => {
    const obj = { __line: lineIndex + 2 };
    for (const [field, idx] of Object.entries(headerIndex)) {
      if (idx == null || idx < 0) obj[field] = '';
      else obj[field] = normalizeCsvImportedText(cells[idx] ?? '');
    }
    return obj;
  });
}

export const PROJECT_CSV_ALIASES = {
  name: ['物件名', 'name', '現場名', 'プロジェクト名', 'サイト名'],
  contractor: ['元請業者', '元請', 'contractor', '業者元請', '業者（元請）', '業者'],
  contractor_display_name: [
    '業者名（表記用）',
    '業者名（自由入力）',
    'contractor_display_name',
    '表記用業者名',
    '業者表記',
  ],
  trading_company_name: ['商社名', '商社', 'trading_company_name', 'trading_company', '担当商社'],
  site_address: ['現場住所', '住所', 'site_address', '町名', '町名・地名', '現場住所詳細'],
  delivery_area: ['エリア', '納入エリア', 'delivery_area', '市町村', '配送エリア'],
  billing_target: ['請求先', 'billing_target', '請求区分'],
  main_factory_name: ['工場', 'メイン工場', '工場（メイン）', 'main_factory', '出荷工場'],
  sub_factory_names: ['サブ工場', '工場（サブ）', 'サブ工場（複数可）', 'sub_factory', '応援工場'],
  trading_contact_name: ['商社担当者', '商社担当者名', 'trading_contact_name', '商社ご担当'],
  trading_contact_phone: ['商社担当者電話', '商社担当者連絡先', 'trading_contact_phone'],
  site_contacts_raw: ['現場担当者', '現場ご担当', 'site_contacts', '現場担当者（名前:電話）'],
  sales_admin_name: ['組合担当営業', '担当営業', 'sales_admin_name', '営業担当'],
};

export const TRADING_COMPANY_CSV_ALIASES = {
  name: ['商社名', 'name', '商社', 'trading_company_name', '会社名'],
};

export const CUSTOMER_CSV_ALIASES = {
  company_name: ['業者名', '会社名', 'company_name', 'name', '業者名（会社名）', '元請業者'],
  furigana: ['フリガナ', 'ふりがな', 'furigana', 'カナ', '業者名フリガナ'],
  manager_name: ['担当者名', '代表担当者名', 'manager_name', '担当者', '担当'],
  phone_number: ['電話番号', 'phone_number', '電話', '連絡先', 'ログインid', 'ログインID'],
  login_password: ['ログインパスワード', 'login_password', 'パスワード', 'PW', 'pw'],
};

/** CSV取込フォーマットと一致するエクスポート用ヘッダー */
export const PROJECT_EXPORT_HEADERS = [
  '物件名',
  '元請業者',
  '業者名（表記用）',
  '商社名',
  '現場住所',
  'エリア',
  '請求先',
  'メイン工場',
  'サブ工場',
  '商社担当者',
  '商社担当者電話',
  '現場担当者',
  '組合担当営業',
];
export const CUSTOMER_EXPORT_HEADERS = ['業者名', 'フリガナ', '担当者名', '電話番号', 'ログインパスワード'];
export const TRADING_COMPANY_EXPORT_HEADERS = ['商社名'];

/**
 * CSV / Excel 由来のセル値を文字列として正規化（数値化・式の解除）
 * @param {unknown} value
 */
export function normalizeCsvImportedText(value) {
  let s = String(value ?? '')
    .replace(/\r\n/g, ' ')
    .replace(/\n/g, ' ')
    .trim();
  if (s.startsWith('\t')) s = s.slice(1).trim();
  if (s.startsWith("'")) s = s.slice(1).trim();
  const excelFormula = /^="(.*)"$/s.exec(s);
  if (excelFormula) {
    s = excelFormula[1].replace(/""/g, '"').trim();
  }
  return s;
}

/**
 * 電話番号フィールド用（先頭0落ちの復元を含む）
 * @param {unknown} value
 */
export function normalizeCsvPhoneNumber(value) {
  const s = normalizeCsvImportedText(value);
  if (!s) return '';
  const digitsOnly = s.replace(/\D/g, '');
  if (!digitsOnly) return s;
  // Excel が数値化して先頭0が消えた携帯・市外局番（10桁）を補正
  if (/^[789]\d{9}$/.test(digitsOnly)) {
    return `0${digitsOnly}`;
  }
  if (digitsOnly.length === 10 && /^\d+$/.test(s)) {
    return `0${digitsOnly}`;
  }
  if (s.includes('-') || s.includes('(')) {
    return s;
  }
  return digitsOnly.length >= 10 ? digitsOnly : s;
}

/**
 * Excel で数値化されないようテキストとして出力（先頭タブ）
 * @param {unknown} value
 */
export function formatCsvExcelTextField(value) {
  const s = normalizeCsvImportedText(value);
  if (!s) return '';
  if (/^[\d\-+()]+$/.test(s)) {
    return `\t${s}`;
  }
  return s;
}

/** RFC4180 風セルエスケープ */
export function escapeCsvCell(value) {
  const s = String(value ?? '').replace(/\r?\n/g, ' ');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * 2次元配列 → CSV文字列（CRLF）
 * @param {string[][]} rows
 */
export function rowsToCsvString(rows) {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

const UTF8_BOM_BYTES = new Uint8Array([0xef, 0xbb, 0xbf]);

/**
 * UTF-8 BOM 付き CSV をブラウザダウンロード（Excel 文字化け防止）
 * @param {string} filename
 * @param {string[][]} rows
 */
export function downloadCsvWithUtf8Bom(filename, rows) {
  if (typeof document === 'undefined') return;
  const csvContent = rowsToCsvString(rows);
  const blob = new Blob([UTF8_BOM_BYTES, csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * 業者名・商社名の名寄せ用正規化
 * - 空白・全角括弧を統一し、法人格表記ゆれを種類別トークンへ置換（位置は維持）
 * - 前株/後株・法人格の種類違い・支店名は別文字列のまま（誤マージ防止）
 * @param {unknown} raw
 * @returns {string}
 */
const LEGAL_FORM_RULES = [
  { pattern: /株式会社|㈱|\(株\)/g, token: '[KK]' },
  { pattern: /有限会社|㈲|\(有\)/g, token: '[YK]' },
  { pattern: /合同会社|㈾|\(同\)/g, token: '[GD]' },
  { pattern: /合資会社|\(資\)/g, token: '[GS]' },
  { pattern: /合名会社|\(名\)/g, token: '[GM]' },
];

export function normalizeCompanyName(raw) {
  let s = String(raw ?? '').trim();
  s = s.replace(/\u3000/g, ' ').replace(/\s+/g, ' ');
  s = s.replace(/[（）]/g, (m) => (m === '（' ? '(' : ')'));
  for (const { pattern, token } of LEGAL_FORM_RULES) {
    s = s.replace(pattern, token);
  }
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** 法人格を位置問わず完全除去した比較キー（法人格省略の吸収用。normalizeCompanyName とは別） */
const LEGAL_FORM_STRIP_WORDS = [
  '株式会社',
  '有限会社',
  '合同会社',
  '合資会社',
  '合名会社',
  '㈱',
  '㈲',
  '㈾',
  '㈳',
  '㈴',
];

export function stripLegalFormCompletely(raw) {
  let s = String(raw ?? '').trim();
  s = s.replace(/\u3000/g, ' ').replace(/\s+/g, ' ');
  s = s.replace(/[（）]/g, (m) => (m === '（' ? '(' : ')'));
  s = s.replace(/\((株|有|同|資|名)\)/g, '');
  for (const w of LEGAL_FORM_STRIP_WORDS) s = s.split(w).join('');
  return s.replace(/\s+/g, ' ').trim();
}

function spreadsheetExt(file) {
  const name = String(file?.name || '').toLowerCase();
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i) : '';
}

/**
 * CSV / Excel を共通の string[][] matrix に変換
 * @param {File} file
 * @returns {Promise<string[][]>}
 */
export async function parseSpreadsheetFile(file) {
  if (!file) throw new Error('ファイルが選択されていません。');
  const ext = spreadsheetExt(file);
  const isExcel = ext === '.xlsx' || ext === '.xls';
  const isCsv = ext === '.csv' || (!ext && /csv|text\/plain/i.test(String(file.type || '')));

  if (isExcel) {
    const XLSX = await import('xlsx');
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array' });
    const sheetName = workbook.SheetNames?.[0];
    if (!sheetName) throw new Error('Excelファイルにシートがありません。');
    const sheet = workbook.Sheets[sheetName];
    const matrix = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: '',
    });
    return (Array.isArray(matrix) ? matrix : [])
      .map((r) => (Array.isArray(r) ? r : []).map((c) => String(c ?? '').trim()))
      .filter((r) => r.some((c) => c !== ''));
  }

  if (!isCsv && ext && ext !== '.csv') {
    throw new Error('対応形式は .csv / .xlsx / .xls です。');
  }

  const text = await readCsvFileAsText(file);
  return parseCsvText(text);
}
