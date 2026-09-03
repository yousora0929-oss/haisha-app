import {
  buildMixCode,
  lookupCorrectionValue,
  roundUpToNominalStrength,
} from './mixDesignCalc.js';

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
