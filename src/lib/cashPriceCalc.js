/**
 * 窓口現金売り 概算計算（純関数・UI/Supabase非依存）
 */

function toNumber(value, fallback = 0) {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function toInt(value, fallback = 0) {
  return Math.trunc(toNumber(value, fallback));
}

function isPlainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeSlump(value) {
  return String(value ?? '').trim();
}

function slumpSortKey(slump) {
  const m = String(slump || '').match(/(\d+)/);
  return m ? Number(m[1]) : Number.POSITIVE_INFINITY;
}

/**
 * DB行の numeric 文字列・jsonb を計算用に整える
 * @param {object|null|undefined} row
 */
export function normalizePriceList(row) {
  if (!isPlainObject(row)) return null;
  const base_prices = Array.isArray(row.base_prices)
    ? row.base_prices
        .filter((p) => p && typeof p === 'object')
        .map((p) => ({
          strength: toNumber(p.strength),
          slump: normalizeSlump(p.slump),
          admixture: String(p.admixture || '').trim() === 'HP' ? 'HP' : 'AE',
          price: toInt(p.price),
        }))
        .filter((p) => p.strength > 0 && p.slump && p.price > 0)
    : [];
  const area_surcharges = Array.isArray(row.area_surcharges)
    ? row.area_surcharges
        .filter((a) => a && typeof a === 'object')
        .map((a) => ({
          code: String(a.code ?? '').trim(),
          label: String(a.label ?? '').trim(),
          amount: toInt(a.amount),
        }))
        .filter((a) => a.code && a.label)
    : [];

  return {
    id: row.id != null ? String(row.id) : '',
    name: String(row.name ?? '').trim() || '窓口価格表',
    effective_from: row.effective_from != null ? String(row.effective_from).slice(0, 10) : '',
    is_active: row.is_active !== false,
    updated_at: row.updated_at != null ? String(row.updated_at) : '',
    base_prices,
    area_surcharges,
    small_vehicle_surcharge: toInt(row.small_vehicle_surcharge, 4000),
    bb_discount: toInt(row.bb_discount, 100),
    large_base_load: toNumber(row.large_base_load, 3),
    small_base_load: toNumber(row.small_base_load, 1.5),
    empty_load_rate: toInt(row.empty_load_rate, 1000),
    tax_rate: toNumber(row.tax_rate, 0.1),
  };
}

/** 存在する呼び強度（昇順） */
export function getStrengthOptions(priceList) {
  const list = normalizePriceList(priceList) || priceList;
  const set = new Set();
  for (const p of list?.base_prices || []) {
    if (Number.isFinite(p.strength) && p.strength > 0) set.add(p.strength);
  }
  return [...set].sort((a, b) => a - b);
}

/** 指定強度のスランプ（先頭数値で昇順） */
export function getSlumpOptions(priceList, strength) {
  const list = normalizePriceList(priceList) || priceList;
  const s = toNumber(strength);
  const set = new Set();
  for (const p of list?.base_prices || []) {
    if (p.strength === s && p.slump) set.add(p.slump);
  }
  return [...set].sort((a, b) => slumpSortKey(a) - slumpSortKey(b) || String(a).localeCompare(String(b), 'ja'));
}

/** 指定強度・スランプの混和剤選択肢 */
export function getAdmixtureOptions(priceList, strength, slump) {
  const list = normalizePriceList(priceList) || priceList;
  const s = toNumber(strength);
  const sl = normalizeSlump(slump);
  const set = new Set();
  for (const p of list?.base_prices || []) {
    if (p.strength === s && p.slump === sl) set.add(p.admixture);
  }
  const order = ['AE', 'HP'];
  return order.filter((a) => set.has(a));
}

function findBasePrice(priceList, strength, slump, admixture) {
  const s = toNumber(strength);
  const sl = normalizeSlump(slump);
  const ad = String(admixture || '').trim() === 'HP' ? 'HP' : 'AE';
  return (priceList?.base_prices || []).find(
    (p) => p.strength === s && p.slump === sl && p.admixture === ad,
  );
}

function findArea(priceList, areaCode) {
  const code = String(areaCode ?? '').trim();
  if (!code) return null;
  return (priceList?.area_surcharges || []).find((a) => a.code === code) || null;
}

/**
 * @param {{
 *   priceList: object,
 *   strength: number|string,
 *   slump: string,
 *   admixture: 'AE'|'HP',
 *   cement: 'N'|'BB',
 *   quantity: number|string,
 *   vehicle: 'large'|'small',
 *   areaCode: string,
 * }} params
 */
export function calcCashPrice(params = {}) {
  const priceList = normalizePriceList(params.priceList) || params.priceList;
  if (!priceList || !Array.isArray(priceList.base_prices)) {
    return { ok: false, error: '価格表を読み込めません' };
  }

  const quantity = toNumber(params.quantity, NaN);
  if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 100) {
    return { ok: false, error: '数量を確認してください' };
  }

  const area = findArea(priceList, params.areaCode);
  if (!area) {
    return { ok: false, error: '地区を選択してください' };
  }

  const baseRow = findBasePrice(priceList, params.strength, params.slump, params.admixture);
  if (!baseRow) {
    return { ok: false, error: '価格表にない配合です（協組へ確認）' };
  }

  const vehicle = String(params.vehicle || '').trim() === 'small' ? 'small' : 'large';
  const cement = String(params.cement || '').trim() === 'BB' ? 'BB' : 'N';
  const basePrice = toInt(baseRow.price);
  const areaAmount = toInt(area.amount);
  const smallAmount = vehicle === 'small' ? toInt(priceList.small_vehicle_surcharge) : 0;
  const bbAmount = cement === 'BB' ? toInt(priceList.bb_discount) : 0;
  const unitPrice = basePrice + areaAmount + smallAmount - bbAmount;

  const qtyCenti = Math.round(quantity * 100);
  const baseLoad = vehicle === 'small' ? toNumber(priceList.small_base_load) : toNumber(priceList.large_base_load);
  const baseLoadCenti = Math.round(baseLoad * 100);
  const emptyRate = toInt(priceList.empty_load_rate);
  const emptyLoadAmount =
    qtyCenti < baseLoadCenti
      ? Math.floor(((baseLoadCenti - qtyCenti) * emptyRate) / 100)
      : 0;

  const materialAmount = Math.floor((unitPrice * qtyCenti) / 100);
  const subtotal = materialAmount + emptyLoadAmount;
  const taxMilli = Math.round(toNumber(priceList.tax_rate) * 1000);
  const tax = Math.floor((subtotal * taxMilli) / 1000);
  const total = subtotal + tax;

  return {
    ok: true,
    basePrice,
    areaAmount,
    smallAmount,
    bbAmount,
    unitPrice,
    baseLoad,
    emptyLoadAmount,
    materialAmount,
    subtotal,
    tax,
    total,
    vehicle,
    cement,
    quantity: qtyCenti / 100,
    areaLabel: area.label,
  };
}

/** 大型・小型の両方を計算 */
export function calcBothVehicles(params = {}) {
  return {
    large: calcCashPrice({ ...params, vehicle: 'large' }),
    small: calcCashPrice({ ...params, vehicle: 'small' }),
  };
}

/** 配合ラベル（粗骨材20固定） */
export function formatMixLabel({ strength, slump, cement, admixture }) {
  const s = toNumber(strength);
  const sl = normalizeSlump(slump);
  const c = String(cement || '').trim() === 'BB' ? 'BB' : 'N';
  const ad = String(admixture || '').trim() === 'HP' ? '高性能' : 'AE';
  if (!s || !sl) return '';
  return `${s}-${sl}-20 ${c}（${ad}）`;
}
