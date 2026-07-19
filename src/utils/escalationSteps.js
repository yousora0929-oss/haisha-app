/** 管理画面 factory_escalation_steps 未設定時のデフォルト（AdminEscalationSection と同等） */
export const DEFAULT_ESCALATION_STEPS = [
  { step_number: 1, trigger_minutes: 0, target_factory_count: 3 },
  { step_number: 2, trigger_minutes: 15, target_factory_count: 5 },
  { step_number: 3, trigger_minutes: 30, target_factory_count: 8 },
];

export function normalizeEscalationStepsList(steps) {
  const list = Array.isArray(steps) ? steps : [];
  return list
    .map((s) => ({
      step_number: Number(s?.step_number) || 0,
      trigger_minutes: Math.max(0, Number(s?.trigger_minutes) || 0),
      target_factory_count: Math.max(1, Number(s?.target_factory_count) || 1),
    }))
    .filter((s) => s.step_number >= 1)
    .sort((a, b) => a.trigger_minutes - b.trigger_minutes || a.step_number - b.step_number);
}

export function getEscalationStepsForAnchor(anchorFactoryId, escalationStepsByFactoryId) {
  const anchor = String(anchorFactoryId || '').trim();
  const map = escalationStepsByFactoryId && typeof escalationStepsByFactoryId === 'object'
    ? escalationStepsByFactoryId
    : {};
  const configured = anchor ? normalizeEscalationStepsList(map[anchor]) : [];
  return configured.length ? configured : DEFAULT_ESCALATION_STEPS;
}

/** 経過分数に対して有効な段階（trigger_minutes が最大かつ <= minutes） */
export function getActiveEscalationStep(steps, effectiveMinutes) {
  const minutes = Number.isFinite(Number(effectiveMinutes)) ? Number(effectiveMinutes) : 0;
  const list = normalizeEscalationStepsList(steps?.length ? steps : DEFAULT_ESCALATION_STEPS);
  let active = list[0];
  for (const step of list) {
    if (minutes >= step.trigger_minutes) active = step;
  }
  return active || { step_number: 1, trigger_minutes: 0, target_factory_count: 1 };
}

export function getNextEscalationThreshold(steps, effectiveMinutes) {
  if (!Number.isFinite(Number(effectiveMinutes))) return null;
  const minutes = Number(effectiveMinutes);
  const list = normalizeEscalationStepsList(steps?.length ? steps : DEFAULT_ESCALATION_STEPS);
  for (const step of list) {
    if (step.trigger_minutes > minutes) return step.trigger_minutes;
  }
  return null;
}

export function formatEscalationStepLabel(step, nextThreshold, effectiveMinutes) {
  const count = Math.max(1, Number(step?.target_factory_count) || 1);
  const trigger = Math.max(0, Number(step?.trigger_minutes) || 0);
  if (nextThreshold == null) {
    return `${trigger}分+: 近い順 ${count} 工場`;
  }
  return `${trigger}分+: 近い順 ${count} 工場 · 次段階まで ${Math.max(0, nextThreshold - (Number(effectiveMinutes) || 0))}分`;
}

/** エスカレーション最終段階の対象工場数 */
export function finalEscalationTargetCount(steps) {
  const list = normalizeEscalationStepsList(steps?.length ? steps : DEFAULT_ESCALATION_STEPS);
  const last = list[list.length - 1];
  return Math.max(1, Number(last?.target_factory_count) || 1);
}

/**
 * 全社拒否閾値を実在工場数でクランプ（設定15 > 実工場13 で永遠に発火しないバグ対策）
 * @param {unknown} steps
 * @param {number} realFactoryCount
 */
export function clampedFullRejectionThreshold(steps, realFactoryCount) {
  const real = Math.max(1, Math.floor(Number(realFactoryCount)) || 1);
  return Math.min(finalEscalationTargetCount(steps), real);
}
