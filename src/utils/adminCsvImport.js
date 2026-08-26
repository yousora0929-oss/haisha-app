import { getDeliveryAreaValidationMessage } from './deliveryAreas.js';
import { findAgentOrganizationByName, resolveProjectTradingCompanyName } from './projectTradingCompany.js';
import { findSalesStaffByName } from './salesStaff.js';
import { resolveUrlTokenForInsert } from './urlValidation.js';
import {
  CUSTOMER_CSV_ALIASES,
  CUSTOMER_EXPORT_HEADERS,
  downloadCsvWithUtf8Bom,
  formatCsvExcelTextField,
  mapCsvHeaders,
  normalizeCompanyName,
  normalizeCsvImportedText,
  normalizeCsvPhoneNumber,
  parseSpreadsheetFile,
  PROJECT_CSV_ALIASES,
  PROJECT_EXPORT_HEADERS,
  rowsToObjects,
  stripLegalFormCompletely,
  TRADING_COMPANY_CSV_ALIASES,
  TRADING_COMPANY_EXPORT_HEADERS,
} from './csvImport.js';

const DEFAULT_CUSTOMER_PASSWORD = '1234';

function cleanCell(value) {
  return normalizeCsvImportedText(value);
}

function splitCommaList(raw) {
  return String(raw ?? '')
    .split(/[,、]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 現場担当者 raw → [{name, phone}] */
export function parseSiteContactsRaw(raw) {
  const parts = splitCommaList(raw);
  const out = [];
  for (const part of parts) {
    const colon = part.indexOf(':');
    const colonFull = part.indexOf('：');
    let sep = -1;
    if (colon >= 0 && colonFull >= 0) sep = Math.min(colon, colonFull);
    else if (colon >= 0) sep = colon;
    else if (colonFull >= 0) sep = colonFull;
    if (sep >= 0) {
      const name = part.slice(0, sep).trim();
      const phone = normalizeCsvPhoneNumber(part.slice(sep + 1));
      if (name || phone) out.push({ name: name || '', phone: phone || '' });
    } else if (part) {
      out.push({ name: part, phone: '' });
    }
  }
  return out;
}

/** [{name, phone}] → 表示・編集用文字列 */
export function formatSiteContactsRaw(contacts) {
  if (!Array.isArray(contacts) || contacts.length === 0) return '';
  return contacts
    .map((c) => {
      const name = String(c?.name ?? '').trim();
      const phone = String(c?.phone ?? '').trim();
      if (name && phone) return `${name}:${phone}`;
      return name || phone;
    })
    .filter(Boolean)
    .join(',');
}

function findFactoryByExactName(factories, name) {
  const q = cleanCell(name);
  if (!q) return null;
  return (factories || []).find((f) => f && cleanCell(f.name) === q) || null;
}

/** 工場名（カンマ区切り可）→ { ids, labels, unmatchedNames } */
export function resolveFactoryNames(namesRaw, factories) {
  const names = Array.isArray(namesRaw)
    ? namesRaw.map((n) => cleanCell(n)).filter(Boolean)
    : splitCommaList(namesRaw);
  const ids = [];
  const labels = [];
  const unmatchedNames = [];
  const seen = new Set();
  for (const name of names) {
    const hit = findFactoryByExactName(factories, name);
    if (hit?.id) {
      const id = String(hit.id);
      if (!seen.has(id)) {
        seen.add(id);
        ids.push(id);
        labels.push(cleanCell(hit.name) || name);
      }
    } else {
      unmatchedNames.push(name);
    }
  }
  return { ids, labels, unmatchedNames };
}

export function resolveSalesAdminFromName(name, salesStaff) {
  const display = cleanCell(name);
  if (!display) {
    return { sales_admin_id: '', sales_admin_name: '', warning: '' };
  }
  const hit = findSalesStaffByName(salesStaff, display);
  if (hit) {
    return {
      sales_admin_id: String(hit.id),
      sales_admin_name: String(hit.name),
      warning: '',
    };
  }
  return {
    sales_admin_id: '',
    sales_admin_name: display,
    warning: '⚠️担当営業がマスタに未登録',
  };
}

function findCustomerIdByNormalizedName(customers, name) {
  const q = normalizeCompanyName(name);
  if (!q) return null;
  const exact = (customers || []).find(
    (c) => normalizeCompanyName(c.company_name || c.name) === q,
  );
  return exact?.id ?? null;
}

function findTradingCompanyByNormalizedName(tradingCompanies, name) {
  const q = normalizeCompanyName(name);
  if (!q) return null;
  return (
    (tradingCompanies || []).find((t) => normalizeCompanyName(t.name) === q) || null
  );
}

function findAgentOrgByNormalizedName(agentOrganizations, name) {
  return findAgentOrganizationByName(agentOrganizations, name);
}

/**
 * 商社名マッチ（通常正規化 → 法人格完全除去の一意一致で自動補正）
 */
export function resolveTradingCompanyForImport(name, { tradingCompanies = [], agentOrganizations = [] } = {}) {
  const trading_company_name = cleanCell(name);
  if (!trading_company_name) {
    return {
      trading_company_name: null,
      trading_company: null,
      trading_company_organization_id: null,
      __unmatchedTradingCompanyName: undefined,
      __tradingNotes: [],
    };
  }

  const notes = [];
  let resolvedName = trading_company_name;
  let agentOrg = findAgentOrgByNormalizedName(agentOrganizations, resolvedName);
  let knownTrading = findTradingCompanyByNormalizedName(tradingCompanies, resolvedName);

  if (!agentOrg && !knownTrading) {
    const strippedInput = stripLegalFormCompletely(resolvedName);
    if (strippedInput) {
      const candidates = [];
      const seen = new Set();
      const pushCandidate = (displayName) => {
        const d = cleanCell(displayName);
        if (!d) return;
        const key = normalizeCompanyName(d);
        if (!key || seen.has(key)) return;
        if (stripLegalFormCompletely(d) !== strippedInput) return;
        seen.add(key);
        candidates.push(d);
      };
      for (const t of tradingCompanies || []) pushCandidate(t?.name);
      for (const o of agentOrganizations || []) {
        if (o && String(o.type || '') === 'agent') pushCandidate(o.name);
        else if (o?.name) pushCandidate(o.name);
      }
      if (candidates.length === 1) {
        resolvedName = candidates[0];
        notes.push(`✏️「${trading_company_name}」→「${resolvedName}」に自動補正`);
        agentOrg = findAgentOrgByNormalizedName(agentOrganizations, resolvedName);
        knownTrading = findTradingCompanyByNormalizedName(tradingCompanies, resolvedName);
      } else if (candidates.length >= 2) {
        notes.push(
          `⚠️法人格の省略により複数候補あり: ${candidates.slice(0, 5).join(' / ')}${
            candidates.length > 5 ? ' など' : ''
          }。商社名セルで正しいものを選択してください`,
        );
      }
    }
  }

  let trading_company_organization_id = null;
  let __unmatchedTradingCompanyName;
  if (agentOrg?.id) {
    trading_company_organization_id = agentOrg.id;
  } else if (!knownTrading) {
    __unmatchedTradingCompanyName = resolvedName;
  }

  return {
    trading_company_name: resolvedName || null,
    trading_company: resolvedName || null,
    trading_company_organization_id,
    __unmatchedTradingCompanyName,
    __tradingNotes: notes,
  };
}

function upsertNamedEntity(map, name, line) {
  const key = normalizeCompanyName(name);
  if (!key) return;
  const display = cleanCell(name) || key;
  const existing = map.get(key);
  if (existing) {
    if (!existing.__lines.includes(line)) existing.__lines.push(line);
    return;
  }
  map.set(key, { name: display, __lines: [line] });
}

/**
 * プレビュー編集後の再解決（工場・営業・商社・現場担当）
 * @param {object} row
 * @param {{
 *   factories?: object[],
 *   salesStaff?: object[],
 *   customers?: object[],
 *   tradingCompanies?: object[],
 *   agentOrganizations?: object[],
 *   defaultMainFactoryId?: string,
 * }} ctx
 */
export function reresolveProjectImportRow(row, ctx = {}) {
  const {
    factories = [],
    salesStaff = [],
    customers = [],
    tradingCompanies = [],
    agentOrganizations = [],
    defaultMainFactoryId = '',
  } = ctx;
  const next = { ...row };
  const notes = [];

  // メイン工場
  const mainLabel = cleanCell(next.__mainFactoryLabel ?? '');
  if (mainLabel) {
    const mainHit = findFactoryByExactName(factories, mainLabel);
    if (mainHit?.id) {
      next.main_factory_id = String(mainHit.id);
      next.__mainFactoryLabel = cleanCell(mainHit.name) || mainLabel;
    } else {
      next.main_factory_id = '';
      notes.push('⚠️工場名不一致');
    }
  } else if (next.main_factory_id) {
    const byId = (factories || []).find((f) => String(f.id) === String(next.main_factory_id));
    next.__mainFactoryLabel = byId ? cleanCell(byId.name) : '';
  } else if (defaultMainFactoryId) {
    next.main_factory_id = String(defaultMainFactoryId);
    const byId = (factories || []).find((f) => String(f.id) === String(defaultMainFactoryId));
    next.__mainFactoryLabel = byId ? cleanCell(byId.name) : '';
  }

  // サブ工場（ラベル文字列から）
  const subRaw = cleanCell(next.__subFactoryLabels ?? '');
  if (subRaw || Array.isArray(next.sub_factory_ids)) {
    const resolved = resolveFactoryNames(subRaw, factories);
    next.sub_factory_ids = resolved.ids.filter((id) => id !== String(next.main_factory_id || ''));
    next.__subFactoryLabels = resolved.labels.join(',');
    if (resolved.unmatchedNames.length > 0) {
      notes.push(`⚠️サブ工場名不一致: ${resolved.unmatchedNames.join('、')}`);
    }
  }

  // 組合担当営業
  const sales = resolveSalesAdminFromName(next.sales_admin_name, salesStaff);
  next.sales_admin_id = sales.sales_admin_id || null;
  next.sales_admin_name = sales.sales_admin_name || null;
  if (sales.warning) notes.push(sales.warning);

  // 現場担当者（編集用文字列があれば再パース）
  if (Object.prototype.hasOwnProperty.call(next, '__siteContactsRaw')) {
    next.site_contacts = parseSiteContactsRaw(next.__siteContactsRaw);
    next.__siteContactsRaw = formatSiteContactsRaw(next.site_contacts);
  } else {
    next.site_contacts = Array.isArray(next.site_contacts) ? next.site_contacts : [];
    next.__siteContactsRaw = formatSiteContactsRaw(next.site_contacts);
  }

  // 商社
  const trading = resolveTradingCompanyForImport(next.trading_company_name, {
    tradingCompanies,
    agentOrganizations,
  });
  next.trading_company_name = trading.trading_company_name;
  next.trading_company = trading.trading_company;
  next.trading_company_organization_id = trading.trading_company_organization_id;
  if (trading.__unmatchedTradingCompanyName) {
    next.__unmatchedTradingCompanyName = trading.__unmatchedTradingCompanyName;
  } else {
    delete next.__unmatchedTradingCompanyName;
  }
  for (const n of trading.__tradingNotes || []) notes.push(n);

  // 業者ラベルからの customer_id 再解決（任意）
  const contractorLabel = cleanCell(next.__contractorLabel ?? '');
  if (contractorLabel) {
    const customer_id = findCustomerIdByNormalizedName(customers, contractorLabel);
    next.customer_id = customer_id;
    if (customer_id) {
      delete next.__unmatchedContractorName;
    } else {
      next.__unmatchedContractorName = contractorLabel;
    }
  }

  next.__rowNotes = notes;
  return next;
}

/**
 * @param {File} file
 * @returns {Promise<{
 *   rows: object[],
 *   skipped: { line: number, reason: string }[],
 *   warnings: string[],
 *   newTradingCompanies: { name: string, __lines: number[] }[],
 *   newContractors: { name: string, __lines: number[] }[],
 * }>}
 */
export async function parseProjectsCsvFile(
  file,
  {
    customers = [],
    tradingCompanies = [],
    mainFactoryId = '',
    allowedDeliveryAreas = [],
    agentOrganizations = [],
    factories = [],
    salesStaff = [],
  } = {},
) {
  const matrix = await parseSpreadsheetFile(file);
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
  const newContractorMap = new Map();
  const newTradingMap = new Map();

  if (!mainFactoryId && !(factories || []).length) {
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
    const contractorDisplayName = cleanCell(raw.contractor_display_name);
    const contractorName = cleanCell(raw.contractor);
    const billingTargetRaw = cleanCell(raw.billing_target);
    const billing_target = billingTargetRaw.includes('下請') ? 'sub' : 'main';
    const trading_contact_name = cleanCell(raw.trading_contact_name);
    const trading_contact_phone = normalizeCsvPhoneNumber(raw.trading_contact_phone);
    const site_contacts = parseSiteContactsRaw(raw.site_contacts_raw);
    const rowNotes = [];

    if (delivery_area && site_address) {
      const full = `${delivery_area} ${site_address}`;
      const msg = getDeliveryAreaValidationMessage(full, allowedDeliveryAreas);
      if (msg && allowedDeliveryAreas.length > 0) {
        skipped.push({ line, reason: msg });
        continue;
      }
    }

    // メイン工場
    const mainFactoryName = cleanCell(raw.main_factory_name);
    let resolvedMainId = '';
    let mainFactoryLabel = '';
    if (mainFactoryName) {
      const hit = findFactoryByExactName(factories, mainFactoryName);
      if (hit?.id) {
        resolvedMainId = String(hit.id);
        mainFactoryLabel = cleanCell(hit.name) || mainFactoryName;
      } else {
        rowNotes.push('⚠️工場名不一致');
        mainFactoryLabel = mainFactoryName;
      }
    } else if (mainFactoryId) {
      resolvedMainId = String(mainFactoryId);
      const byId = (factories || []).find((f) => String(f.id) === String(mainFactoryId));
      mainFactoryLabel = byId ? cleanCell(byId.name) : '';
    }

    // サブ工場
    const subResolved = resolveFactoryNames(raw.sub_factory_names, factories);
    const sub_factory_ids = subResolved.ids.filter((id) => id !== resolvedMainId);
    if (subResolved.unmatchedNames.length > 0) {
      rowNotes.push(`⚠️サブ工場名不一致: ${subResolved.unmatchedNames.join('、')}`);
    }

    // 組合担当営業
    const sales = resolveSalesAdminFromName(raw.sales_admin_name, salesStaff);
    if (sales.warning) rowNotes.push(sales.warning);

    const customer_id = findCustomerIdByNormalizedName(customers, contractorName);
    let __unmatchedContractorName;
    if (contractorName && !customer_id) {
      upsertNamedEntity(newContractorMap, contractorName, line);
      __unmatchedContractorName = contractorName;
    }

    const trading = resolveTradingCompanyForImport(raw.trading_company_name, {
      tradingCompanies,
      agentOrganizations,
    });
    for (const n of trading.__tradingNotes || []) rowNotes.push(n);
    if (trading.__unmatchedTradingCompanyName) {
      upsertNamedEntity(newTradingMap, trading.__unmatchedTradingCompanyName, line);
    }

    for (const note of rowNotes) {
      warnings.push(`行${line}: ${note}`);
    }

    rows.push({
      name,
      customer_id,
      main_factory_id: resolvedMainId,
      sub_factory_ids,
      trading_company_name: trading.trading_company_name,
      trading_company: trading.trading_company,
      trading_company_organization_id: trading.trading_company_organization_id,
      trading_contact_name: trading_contact_name || null,
      trading_contact_phone: trading_contact_phone || null,
      site_contacts,
      sales_admin_id: sales.sales_admin_id || null,
      sales_admin_name: sales.sales_admin_name || null,
      contractor_display_name: contractorDisplayName || null,
      contractor: null,
      sub_contractor_name: null,
      billing_target,
      delivery_area: delivery_area || null,
      site_address: site_address || null,
      lat: null,
      lng: null,
      folder_url: null,
      sheet_url: null,
      url_token: resolveUrlTokenForInsert({}),
      __line: line,
      __contractorLabel: contractorName,
      __mainFactoryLabel: mainFactoryLabel,
      __subFactoryLabels: subResolved.labels.join(','),
      __siteContactsRaw: formatSiteContactsRaw(site_contacts),
      __rowNotes: rowNotes,
      ...(__unmatchedContractorName ? { __unmatchedContractorName } : {}),
      ...(trading.__unmatchedTradingCompanyName
        ? { __unmatchedTradingCompanyName: trading.__unmatchedTradingCompanyName }
        : {}),
    });
  }

  if (rows.length === 0) {
    throw new Error('取り込み可能な物件がありません。');
  }

  const newContractors = [...newContractorMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'ja'),
  );
  const newTradingCompanies = [...newTradingMap.values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'ja'),
  );

  return { rows, skipped, warnings, newTradingCompanies, newContractors };
}

/**
 * @param {File} file
 */
export async function parseCustomersCsvFile(file) {
  const matrix = await parseSpreadsheetFile(file);
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

/**
 * @param {File} file
 */
export async function parseTradingCompaniesCsvFile(file) {
  const matrix = await parseSpreadsheetFile(file);
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
  const warnings = [];
  const seen = new Set();

  for (const raw of rawRows) {
    const line = raw.__line;
    const name = cleanCell(raw.name);
    if (!name) {
      skipped.push({ line, reason: '商社名が空のためスキップ' });
      continue;
    }
    const key = normalizeCompanyName(name);
    if (seen.has(key)) {
      skipped.push({ line, reason: `商社名「${name}」が重複のためスキップ` });
      continue;
    }
    seen.add(key);
    rows.push({ name, __line: line });
  }

  if (rows.length === 0) {
    throw new Error('取り込み可能な商社がありません。');
  }

  return { rows, skipped, warnings };
}

/** DB insert 用にメタフィールドを除去 */
export function stripImportMeta(row) {
  const {
    __line,
    __contractorLabel,
    __unmatchedContractorName,
    __unmatchedTradingCompanyName,
    __mainFactoryLabel,
    __subFactoryLabels,
    __siteContactsRaw,
    __rowNotes,
    __tradingNotes,
    ...rest
  } = row;
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
export function buildProjectsExportRows(projects, customers = [], factories = []) {
  const customerNameById = new Map(
    (customers || []).map((c) => [String(c.id), cleanCell(c.company_name || c.name)]),
  );
  const factoryNameById = new Map(
    (factories || []).map((f) => [String(f.id), cleanCell(f.name)]),
  );
  const dataRows = (projects || []).map((p) => {
    const subNames = (Array.isArray(p.sub_factory_ids) ? p.sub_factory_ids : [])
      .map((id) => factoryNameById.get(String(id)) || '')
      .filter(Boolean)
      .join(',');
    return [
      cleanCell(p.name),
      customerNameById.get(String(p.customer_id || '')) || '',
      cleanCell(p.contractor_display_name),
      cleanCell(resolveProjectTradingCompanyName(p)),
      cleanCell(p.site_address),
      cleanCell(p.delivery_area),
      p.billing_target === 'sub' ? '下請' : '元請',
      factoryNameById.get(String(p.main_factory_id || '')) || '',
      subNames,
      cleanCell(p.trading_contact_name),
      formatCsvExcelTextField(p.trading_contact_phone),
      formatSiteContactsRaw(p.site_contacts),
      cleanCell(p.sales_admin_name),
    ];
  });
  return [PROJECT_EXPORT_HEADERS, ...dataRows];
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

export function buildTradingCompaniesExportRows(tradingCompanies) {
  const dataRows = (tradingCompanies || []).map((t) => [cleanCell(t.name)]);
  return [TRADING_COMPANY_EXPORT_HEADERS, ...dataRows];
}

export function downloadProjectsExportCsv(projects, customers, factories) {
  const rows = buildProjectsExportRows(projects, customers, factories);
  downloadCsvWithUtf8Bom(`projects_export_${exportDateSuffix()}.csv`, rows);
}

export function downloadCustomersExportCsv(customers) {
  const rows = buildCustomersExportRows(customers);
  downloadCsvWithUtf8Bom(`customers_export_${exportDateSuffix()}.csv`, rows);
}

export function downloadTradingCompaniesExportCsv(tradingCompanies) {
  const rows = buildTradingCompaniesExportRows(tradingCompanies);
  downloadCsvWithUtf8Bom(`trading_companies_export_${exportDateSuffix()}.csv`, rows);
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
