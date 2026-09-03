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

export const MIX_DESIGN_GRID_COLS = [
  'baseStrength',
  'slump',
  'aggregateSize',
  'cementType',
  'quantityM3',
  'pourDate',
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
    correctionIsAuto: true,
    nominalStrength: '',
    slump: '',
    aggregateSize: '20',
    cementType: 'N',
    aeAdmixture: false,
    quantityM3: '',
    pourDate: '',
    constructionLocation: '',
    waterCementRatio: '',
    unitWaterContent: '',
  };
}

export function createEmptyMixDesignDraft() {
  return {
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
    name: mixDesignAnchorProjectName(order),
    customerId: String(order?.customer_id ?? order?.customerId ?? '').trim() || null,
    siteAddress: String(order?.siteAddress ?? order?.site_address ?? '').trim() || null,
    mainFactoryId:
      String(draft?.requestedToFactoryId || order?.preferred_factory_id || order?.preferredFactoryId || '')
        .trim() || null,
    deliveryArea: String(order?.delivery_area ?? order?.deliveryArea ?? '').trim() || null,
    contractor: resolveOrderContractorDisplayName(order) || null,
    tradingCompanyName: resolveOrderTradingCompanyDisplayName(order) || null,
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
  const copies = parseRequiredInt(draft?.copiesCount);
  const specimen = parseRequiredInt(draft?.testSpecimenCount);
  const vehicle = String(vehicleType || '').trim();
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
    copies_count: copies,
    vehicle_types: vehicle ? [vehicle] : [],
    total_volume_m3: sumMixDesignQuantityM3(draft),
    test_salt: Boolean(draft?.testSalt),
    test_split_pour: Boolean(draft?.testSplitPour),
    test_specimen_count: specimen,
    test_third_party: Boolean(draft?.testThirdParty),
    quote_requested: draft?.quoteRequested === '' || draft?.quoteRequested == null ? null : Boolean(draft.quoteRequested),
    memo: String(draft?.memo || '').trim() || null,
  };
}

export function buildMixDesignItemInsertRows(draft) {
  const items = Array.isArray(draft?.items) ? draft.items : [];
  return items.map((item, index) => {
    const baseStrength = parseRequiredInt(item.baseStrength);
    const correctionValue = parseOptionalNumber(item.correctionValue);
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
      quantity_m3: parseOptionalNumber(item.quantityM3),
      pour_date: String(item.pourDate || '').trim() || null,
      construction_location: String(item.constructionLocation || '').trim() || null,
      water_cement_ratio: parseOptionalNumber(item.waterCementRatio),
      unit_water_content: parseOptionalNumber(item.unitWaterContent),
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
