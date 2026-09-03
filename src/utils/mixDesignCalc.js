// 呼び強度規格値リスト。39は存在しない（36の次は40）
export const NOMINAL_STRENGTH_LIST = [18, 21, 24, 27, 30, 33, 36, 40, 42, 45, 48, 50, 54, 60];
export const SLUMP_CANDIDATES = [8, 10, 12, 15, 18, 21];
export const AGGREGATE_SIZE_CANDIDATES = [20, 25, 40];

// 与えられた値以上で最小の規格値に切り上げる
export function roundUpToNominalStrength(rawValue) {
  for (const v of NOMINAL_STRENGTH_LIST) {
    if (v >= rawValue) return v;
  }
  return rawValue;
}

// correction_value_rules の該当年度・地域・セメント種別のルールから、
// 打設日(Date)に一致する補正値を検索する。年またぎレンジに対応。
// rules引数は事前にSupabaseから取得したその地域・セメント種別の行の配列。
export function lookupCorrectionValue(pourDate, rules) {
  const m = pourDate.getMonth() + 1;
  const d = pourDate.getDate();
  const v = m * 100 + d;
  for (const rule of rules) {
    const s = rule.date_start_month * 100 + rule.date_start_day;
    const e = rule.date_end_month * 100 + rule.date_end_day;
    const inRange = s <= e ? (v >= s && v <= e) : (v >= s || v <= e);
    if (inRange) return { value: rule.correction_value, label: rule.category_label };
  }
  return null; // 該当なし＝手入力を促す
}

// 配合コード文字列を組み立てる
// 例: "36（30+6N）-15-20N・高性能"
export function buildMixCode({
  baseStrength,
  correctionValue,
  nominalStrength,
  cementType,
  slump,
  aggregateSize,
  aeAdmixture,
}) {
  const correctionPart = correctionValue != null
    ? `（${baseStrength}+${correctionValue}${cementType}）`
    : '';
  const nominalPart = correctionValue != null ? `${nominalStrength}${correctionPart}` : `${baseStrength}`;
  const aePart = aeAdmixture ? '・高性能' : '';
  return `${nominalPart}-${slump}-${aggregateSize}${cementType}${aePart}`;
}
