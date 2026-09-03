import {
  buildMixCode,
  lookupCorrectionValue,
  roundUpToNominalStrength,
} from './mixDesignCalc.js';
import { parseMixSpec } from './dispatchBulkOrder.js';
import { resolveOrderSiteDisplayName } from './siteNameDisplay.js';
import {
  resolveOrderContractorDisplayName,
  resolveOrderTradingCompanyDisplayName,
} from './orderPartyInfo.js';

export const MIX_DESIGN_REGIONS = ['大分市・挟間町', '湯布院・庄内'];

export const MIX_DESIGN_VEHICLE_OPTIONS = [
  { id: 'large', label: '大型車' },
  { id: 'small', label: '小型車' },
  { id: 'partial_small', label: '一部小型車' },
];

export const MIX_DESIGN_GRID_COLS = [
  'baseStrength',
  'slump',
  'aggregateSize',
  'cementType',
  'quantityM3',
  'pourMonth',
  'pourDay',
  'constructionLocation',
  'waterCementRatio',
  'unitWaterContent',
  'correctionValue',
];

export function createEmptyMixDesignItem() {
  return {
    localId: `mixitem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    baseStrength: '',
    correctionValue: '',
    correctionIsAuto: false,
    nominalStrength: '',
    slump: '',
    aggregateSize: '20',
    cementType: 'N',
    aeAdmixture: false,
    quantityM3: '',
    pourDate: '',
    pourMonth: '',
    pourDay: '',
    pourYearOverride: '',
    pourDateOutOfRange: false,
    constructionLocation: '',
    waterCementRatio: '',
    unitWaterContent: '',
  };
}

export function createEmptyMixDesignDraft() {
  return {
    projectName: '',
    contractorName: '',
    primeContractorName: '',
    traderName: '',
    siteAddress: '',
    periodStart: '',
    periodEnd: '',
    vehicleTypes: [],
    siteManagerName: '',
    siteManagerContact: '',
    region: MIX_DESIGN_REGIONS[0],
    requestedToFactoryId: '',
    items: [createEmptyMixDesignItem()],
    submissionMethod: '',
    submissionEmail: '',
    creationDateSpecified: false,
    creationDate: '',
    requestedBy: '',
    copiesCount: '',
    testSalt: false,
    testSplitPour: false,
    testSpecimenCount: '',
    testThirdParty: false,
    quoteRequested: false,
    memo: '',
  };
}

export function parseOptionalNumber(value) {
  const raw = String(value ?? '').trim();
  if (raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function parseRequiredInt(value) {
  const n = parseOptionalNumber(value);
  if (n == null) return null;
  return Math.trunc(n);
}

export function fiscalYearOfDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const month = date.getMonth() + 1;
  return month >= 4 ? date.getFullYear() : date.getFullYear() - 1;
}

export function parseIsoDateLocal(iso) {
  const raw = String(iso || '').trim();
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatIsoDateLocal(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return '';
  if (y < 1900 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return '';
  const date = new Date(y, m - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) return '';
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function pourPartsFromIso(iso) {
  const date = parseIsoDateLocal(iso);
  if (!date) return { pourMonth: '', pourDay: '' };
  return { pourMonth: String(date.getMonth() + 1), pourDay: String(date.getDate()) };
}

function dateInPeriod(date, start, end) {
  if (!date) return false;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

export function resolvePourDateFromPeriod({
  month,
  day,
  periodStart,
  periodEnd,
  yearOverride,
} = {}) {
  const m = Number(month);
  const d = Number(day);
  if (!Number.isInteger(m) || !Number.isInteger(d) || m < 1 || m > 12 || d < 1 || d > 31) {
    return { pourDate: '', outOfRange: false, needsYear: false, years: [] };
  }

  const overrideYear = Number(yearOverride);
  if (Number.isInteger(overrideYear) && overrideYear >= 1900 && overrideYear <= 2100) {
    const iso = formatIsoDateLocal(overrideYear, m, d);
    return { pourDate: iso, outOfRange: !iso, needsYear: false, years: [overrideYear] };
  }

  const start = parseIsoDateLocal(periodStart);
  const end = parseIsoDateLocal(periodEnd);
  if (!start && !end) {
    return { pourDate: '', outOfRange: true, needsYear: true, years: [new Date().getFullYear()] };
  }

  const startYear = start ? start.getFullYear() : end.getFullYear();
  const endYear = end ? end.getFullYear() : startYear;
  const years = [...new Set([startYear, startYear + 1, endYear])].filter(
    (y) => Number.isInteger(y) && y >= 1900 && y <= 2100,
  );

  if (startYear === endYear) {
    const iso = formatIsoDateLocal(startYear, m, d);
    const date = parseIsoDateLocal(iso);
    const ok = dateInPeriod(date, start, end);
    return { pourDate: ok ? iso : '', outOfRange: !ok, needsYear: !ok, years };
  }

  const candidates = years
    .map((y) => {
      const iso = formatIsoDateLocal(y, m, d);
      const date = parseIsoDateLocal(iso);
      return { iso, date, year: y, ok: dateInPeriod(date, start, end) };
    })
    .filter((c) => c.iso);

  const hits = candidates.filter((c) => c.ok);
  if (hits.length === 1) {
    return { pourDate: hits[0].iso, outOfRange: false, needsYear: false, years };
  }
  if (hits.length > 1) {
    return { pourDate: hits[0].iso, outOfRange: false, needsYear: false, years };
  }
  return { pourDate: '', outOfRange: true, needsYear: true, years };
}

export function pourYearChoices(periodStart, periodEnd, extraYears = []) {
  const start = parseIsoDateLocal(periodStart);
  const end = parseIsoDateLocal(periodEnd);
  const current = new Date().getFullYear();
  const base = [current, current + 1];
  if (start) base.push(start.getFullYear(), start.getFullYear() + 1);
  if (end) base.push(end.getFullYear());
  for (const y of extraYears) {
    const n = Number(y);
    if (Number.isInteger(n)) base.push(n);
  }
  return [...new Set(base)].filter((y) => y >= 1900 && y <= 2100).sort((a, b) => a - b);
}

export function applyPourDateResolution(item, periodStart, periodEnd) {
  const next = { ...item };
  if (!String(next.pourMonth || '').trim() && !String(next.pourDay || '').trim() && next.pourDate) {
    const parts = pourPartsFromIso(next.pourDate);
    next.pourMonth = parts.pourMonth;
    next.pourDay = parts.pourDay;
  }
  const resolved = resolvePourDateFromPeriod({
    month: next.pourMonth,
    day: next.pourDay,
    periodStart,
    periodEnd,
    yearOverride: next.pourYearOverride,
  });
  next.pourDate = resolved.pourDate;
  next.pourDateOutOfRange = Boolean(resolved.outOfRange);
  return next;
}

export function formatConstructionPeriod(periodStart, periodEnd) {
  const a = parseIsoDateLocal(periodStart);
  const b = parseIsoDateLocal(periodEnd);
  const fmt = (date) => `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
  if (a && b) return `${fmt(a)} ～ ${fmt(b)}`;
  if (a) return `${fmt(a)} ～`;
  if (b) return `～ ${fmt(b)}`;
  return '';
}

export function sanitizeNonNegativeInput(value) {
  let raw = String(value ?? '').replace(/[−ー]/g, '-');
  if (raw.includes('-')) raw = raw.replace(/-/g, '');
  if (raw === '') return '';
  const n = Number(raw);
  if (Number.isFinite(n) && n < 0) return '0';
  return raw;
}

export function clampNonNegativeNumber(value) {
  const n = parseOptionalNumber(value);
  if (n == null) return null;
  return n < 0 ? 0 : n;
}

export function preventMinusKey(event) {
  if (event?.key === '-' || event?.key === 'Minus' || event?.key === 'Subtract') {
    event.preventDefault();
  }
}

export function toggleMixDesignVehicle(current, id) {
  const key = String(id || '').trim();
  const list = Array.isArray(current) ? current.map(String) : [];
  if (!key) return list;
  return list.includes(key) ? list.filter((v) => v !== key) : [...list, key];
}

export function rulesForLookup(allRules, { region, cementType, pourDate }) {
  const list = Array.isArray(allRules) ? allRules : [];
  const regionKey = String(region || '').trim();
  const cement = String(cementType || '').trim();
  const fy = fiscalYearOfDate(pourDate);
  const matched = list.filter((rule) => {
    if (String(rule.region || '') !== regionKey) return false;
    if (String(rule.cement_type || '') !== cement) return false;
    if (fy != null && Number(rule.fiscal_year) !== fy) return false;
    return true;
  });
  if (matched.length) return matched;
  // 該当年度が無いときは同地域・同セメントの最新年度を使う
  const fallback = list
    .filter(
      (rule) =>
        String(rule.region || '') === regionKey && String(rule.cement_type || '') === cement,
    )
    .slice()
    .sort((a, b) => Number(b.fiscal_year) - Number(a.fiscal_year));
  const latestYear = fallback[0] ? Number(fallback[0].fiscal_year) : null;
  return latestYear == null ? [] : fallback.filter((rule) => Number(rule.fiscal_year) === latestYear);
}

export function computeNominalStrength(baseStrength, correctionValue) {
  const base = parseRequiredInt(baseStrength);
  if (base == null) return null;
  const correction = parseOptionalNumber(correctionValue);
  const raw = correction == null ? base : base + correction;
  return roundUpToNominalStrength(raw);
}

export function applyAutoCorrection(item, allRules, region) {
  let next = { ...item };
  if (next.correctionIsAuto) {
    const pourDate = parseIsoDateLocal(next.pourDate);
    if (!pourDate) {
      next = { ...next, correctionValue: '', correctionLabel: '' };
    } else {
      const lookupRules = rulesForLookup(allRules, {
        region,
        cementType: next.cementType,
        pourDate,
      });
      const hit = lookupCorrectionValue(pourDate, lookupRules);
      next = {
        ...next,
        correctionValue: hit ? String(hit.value) : '',
        correctionLabel: hit?.label || '',
      };
    }
  }
  return {
    ...next,
    nominalStrength: computeNominalStrength(next.baseStrength, next.correctionValue) ?? '',
  };
}

export function mixCodeForItem(item) {
  const baseStrength = parseRequiredInt(item?.baseStrength);
  const slump = parseRequiredInt(item?.slump);
  const aggregateSize = parseRequiredInt(item?.aggregateSize);
  if (baseStrength == null || slump == null || aggregateSize == null) return '';
  const correctionValue = parseOptionalNumber(item?.correctionValue);
  const nominalStrength = computeNominalStrength(baseStrength, correctionValue);
  return buildMixCode({
    baseStrength,
    correctionValue,
    nominalStrength,
    cementType: item?.cementType || 'N',
    slump,
    aggregateSize,
    aeAdmixture: Boolean(item?.aeAdmixture),
  });
}

export function validateMixDesignDraft(draft) {
  const missing = [];
  if (!String(draft?.region || '').trim()) missing.push('地域');
  const items = Array.isArray(draft?.items) ? draft.items : [];
  if (!items.length) missing.push('配合パターン');
  items.forEach((item, index) => {
    const n = index + 1;
    if (parseRequiredInt(item.baseStrength) == null) missing.push(`配合${n}の設計基準強度`);
    if (parseRequiredInt(item.slump) == null) missing.push(`配合${n}のスランプ`);
    if (parseRequiredInt(item.aggregateSize) == null) missing.push(`配合${n}の骨材`);
    if (!['N', 'BB'].includes(String(item.cementType || ''))) missing.push(`配合${n}のセメント種別`);
  });
  return [...new Set(missing)];
}

export function sumMixDesignQuantityM3(draft) {
  const items = Array.isArray(draft?.items) ? draft.items : [];
  let total = 0;
  let any = false;
  for (const item of items) {
    const n = parseOptionalNumber(item.quantityM3);
    if (n == null) continue;
    total += n;
    any = true;
  }
  return any ? total : null;
}

export function earliestPourDate(draft) {
  const items = Array.isArray(draft?.items) ? draft.items : [];
  const dates = items.map((item) => String(item.pourDate || '').trim()).filter(Boolean).sort();
  return dates[0] || '';
}

export function mixDesignAnchorProjectName(order) {
  const site = resolveOrderSiteDisplayName(order);
  if (site) return site;
  const id = String(order?.id || '').trim();
  return id ? `スポット注文より自動作成（注文ID: ${id}）` : 'スポット注文より自動作成';
}

export function prefillMixDesignDraft(order, project, requestedBy = '') {
  const draft = createEmptyMixDesignDraft();
  draft.requestedBy = String(requestedBy || '').trim();

  draft.projectName =
    String(project?.name || '').trim() ||
    resolveOrderSiteDisplayName(order) ||
    '';
  draft.contractorName =
    resolveOrderContractorDisplayName(order) ||
    String(project?.contractor || '').trim();
  draft.siteAddress =
    String(project?.site_address || '').trim() ||
    String(order?.siteAddress ?? order?.site_address ?? '').trim();
  draft.primeContractorName = String(
    project?.contractor_display_name || project?.contractor || draft.contractorName || '',
  ).trim();
  draft.traderName =
    resolveOrderTradingCompanyDisplayName(order) ||
    String(project?.trading_company_name || '').trim();
  const contacts = Array.isArray(project?.site_contacts) ? project.site_contacts : [];
  const firstContact = contacts.find((c) => c && (c.name || c.phone)) || null;
  draft.siteManagerName = String(firstContact?.name || order?.siteContactName || order?.site_contact_name || '').trim();
  draft.siteManagerContact = String(firstContact?.phone || order?.sitePhone || order?.site_phone || '').trim();
  const vehicle = String(order?.vehicleType || '').trim();
  draft.vehicleTypes = vehicle ? [vehicle] : [];

  const factoryId = String(
    order?.preferred_factory_id ??
      order?.preferredFactoryId ??
      project?.main_factory_id ??
      project?.mainFactoryId ??
      '',
  ).trim();
  draft.requestedToFactoryId = factoryId;

  const mixRaw = String(order?.confirmedMixText ?? order?.mixText ?? '')
    .replace(/・高性能.*$/, '')
    .trim();
  const parsed = parseMixSpec(mixRaw);
  const qty = order?.confirmedQuantityM3 ?? order?.quantityM3 ?? '';

  if (parsed) {
    const cement = String(parsed.cement || 'N').toUpperCase() === 'BB' ? 'BB' : 'N';
    draft.items = [
      {
        ...createEmptyMixDesignItem(),
        baseStrength: parsed.strength,
        slump: parsed.slump,
        aggregateSize: parsed.aggregate,
        cementType: cement,
        aeAdmixture: /高性能/.test(String(order?.confirmedMixText ?? order?.mixText ?? '')),
        quantityM3: qty == null ? '' : String(qty),
      },
    ];
  } else if (qty != null && String(qty).trim() !== '') {
    draft.items[0] = { ...draft.items[0], quantityM3: String(qty) };
  }

  return draft;
}

export function buildMixDesignAnchorProjectPayload(order, draft) {
  return {
    name: String(draft?.projectName || '').trim() || mixDesignAnchorProjectName(order),
    customerId: String(order?.customer_id ?? order?.customerId ?? '').trim() || null,
    siteAddress: String(draft?.siteAddress || order?.siteAddress || order?.site_address || '').trim() || null,
    mainFactoryId:
      String(draft?.requestedToFactoryId || order?.preferred_factory_id || order?.preferredFactoryId || '')
        .trim() || null,
    deliveryArea: String(order?.delivery_area ?? order?.deliveryArea ?? '').trim() || null,
    contractor: String(draft?.contractorName || '').trim() || resolveOrderContractorDisplayName(order) || null,
    tradingCompanyName:
      String(draft?.traderName || '').trim() || resolveOrderTradingCompanyDisplayName(order) || null,
  };
}

export function mixDesignHeaderFromOrder(order, project) {
  const projectName =
    String(project?.name || '').trim() ||
    resolveOrderSiteDisplayName(order) ||
    mixDesignAnchorProjectName(order);

  const siteContactParts = [
    order?.siteContactName ?? order?.site_contact_name ?? order?.orderedBy,
    order?.sitePhone ?? order?.site_phone ?? order?.phone_number,
  ]
    .map((v) => String(v || '').trim())
    .filter(Boolean);

  return {
    projectName,
    contractorName: resolveOrderContractorDisplayName(order) || String(project?.contractor || '').trim(),
    traderName:
      resolveOrderTradingCompanyDisplayName(order) || String(project?.trading_company_name || '').trim(),
    siteContact: siteContactParts.join(' / '),
    primeContractorName: String(
      project?.contractor_display_name ||
        project?.contractor ||
        resolveOrderContractorDisplayName(order) ||
        '',
    ).trim(),
    siteAddress: String(project?.site_address || order?.siteAddress || order?.site_address || '').trim(),
    constructionPeriod: '',
    vehicleTypes: order?.vehicleType ? [order.vehicleType] : [],
    siteManagerName: '',
    siteManagerContact: '',
  };
}

export function resolveMixDesignProjectId(insertedOrders, selectedProjectId) {
  const list = Array.isArray(insertedOrders) ? insertedOrders : [];
  for (const order of list) {
    const id = String(order?.project_id ?? order?.projectId ?? '').trim();
    if (id) return id;
  }
  return String(selectedProjectId || '').trim();
}

export function buildMixDesignRequestInsertRow({
  projectId,
  draft,
  requestedBy,
  preferredFactoryId,
  vehicleType,
}) {
  const pid = String(projectId || '').trim();
  if (!pid) throw new Error('配合計画書依頼の物件IDがありません');
  const factoryId = String(draft?.requestedToFactoryId || preferredFactoryId || '').trim();
  const copies = clampNonNegativeNumber(draft?.copiesCount);
  const specimen = clampNonNegativeNumber(draft?.testSpecimenCount);
  const vehicles = Array.isArray(draft?.vehicleTypes)
    ? draft.vehicleTypes.map(String).filter(Boolean)
    : [];
  const fallbackVehicle = String(vehicleType || '').trim();
  return {
    project_id: pid,
    requested_to_factory_id: factoryId || null,
    requested_by: String(requestedBy || '').trim() || null,
    status: 'requested',
    submission_method: ['original', 'electronic'].includes(String(draft?.submissionMethod || ''))
      ? draft.submissionMethod
      : null,
    submission_email: String(draft?.submissionEmail || '').trim() || null,
    creation_date_specified: Boolean(draft?.creationDateSpecified),
    creation_date: draft?.creationDateSpecified && draft?.creationDate ? draft.creationDate : null,
    copies_count: copies == null ? null : Math.trunc(copies),
    vehicle_types: vehicles.length ? vehicles : fallbackVehicle ? [fallbackVehicle] : [],
    total_volume_m3: sumMixDesignQuantityM3(draft),
    test_salt: Boolean(draft?.testSalt),
    test_split_pour: Boolean(draft?.testSplitPour),
    test_specimen_count: specimen == null ? null : Math.trunc(specimen),
    test_third_party: Boolean(draft?.testThirdParty),
    quote_requested: draft?.quoteRequested === '' || draft?.quoteRequested == null ? null : Boolean(draft.quoteRequested),
    memo: String(draft?.memo || '').trim() || null,
    prime_contractor_name: String(draft?.primeContractorName || '').trim() || null,
    trading_company_name: String(draft?.traderName || '').trim() || null,
    site_manager_name: String(draft?.siteManagerName || '').trim() || null,
    site_manager_contact: String(draft?.siteManagerContact || '').trim() || null,
    period_start: String(draft?.periodStart || '').trim() || null,
    period_end: String(draft?.periodEnd || '').trim() || null,
  };
}

export function buildMixDesignItemInsertRows(draft) {
  const items = Array.isArray(draft?.items) ? draft.items : [];
  return items.map((item, index) => {
    const baseStrength = parseRequiredInt(item.baseStrength);
    const correctionValue = clampNonNegativeNumber(item.correctionValue);
    const pourDate = String(item.pourDate || '').trim();
    return {
      sort_order: index,
      base_strength: baseStrength,
      correction_value: correctionValue,
      correction_is_auto: Boolean(item.correctionIsAuto),
      nominal_strength: computeNominalStrength(baseStrength, correctionValue),
      slump: parseRequiredInt(item.slump),
      aggregate_size: parseRequiredInt(item.aggregateSize),
      cement_type: String(item.cementType || 'N'),
      ae_admixture: Boolean(item.aeAdmixture),
      quantity_m3: clampNonNegativeNumber(item.quantityM3),
      pour_date: pourDate || null,
      construction_location: String(item.constructionLocation || '').trim() || null,
      water_cement_ratio: clampNonNegativeNumber(item.waterCementRatio),
      unit_water_content: clampNonNegativeNumber(item.unitWaterContent),
    };
  });
}

export function handleMixDesignNavKeyDown(event, { rowCount, colCount = MIX_DESIGN_GRID_COLS.length } = {}) {
  const key = event?.key;
  if (!['Enter', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(key)) return;
  const nav = event.target?.getAttribute?.('data-mix-nav');
  if (!nav) return;
  const [rowRaw, colRaw] = nav.split(',');
  const row = Number(rowRaw);
  const col = Number(colRaw);
  if (!Number.isInteger(row) || !Number.isInteger(col)) return;
  const rows = Number(rowCount) || 0;
  const cols = Number(colCount) || MIX_DESIGN_GRID_COLS.length;
  let nextRow = row;
  let nextCol = col;
  if (key === 'Enter' || key === 'ArrowDown') nextRow = Math.min(rows - 1, row + 1);
  if (key === 'ArrowUp') nextRow = Math.max(0, row - 1);
  if (key === 'ArrowLeft') nextCol = Math.max(0, col - 1);
  if (key === 'ArrowRight') nextCol = Math.min(cols - 1, col + 1);
  if (nextRow === row && nextCol === col) return;
  event.preventDefault();
  const next = event.currentTarget?.querySelector?.(`[data-mix-nav="${nextRow},${nextCol}"]`);
  if (next && typeof next.focus === 'function') next.focus();
}

export function selectAllOnFocus(event) {
  const el = event?.target;
  if (!el || typeof el.select !== 'function') return;
  window.requestAnimationFrame(() => {
    try {
      el.select();
    } catch {
      /* ignore */
    }
  });
}
