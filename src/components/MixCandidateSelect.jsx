import React, { useState } from 'react';
import { preventMinusKey, sanitizeNonNegativeInput } from '../utils/mixDesignRequest.js';

const FIELD =
  'min-h-[48px] w-full rounded-xl border-2 border-slate-200 bg-white px-3 py-2 text-base text-slate-900 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300';

const MIX_OTHER_VALUE = '__other__';

export function candidateOptionMatches(stored, optionValue) {
  const raw = String(stored ?? '').trim();
  if (raw === String(optionValue)) return true;
  const left = Number(raw);
  const right = Number(optionValue);
  return raw !== '' && Number.isFinite(left) && Number.isFinite(right) && left === right;
}

export function candidateOptionLabel(options, value, empty = '—') {
  const stored = value == null ? '' : String(value).trim();
  if (!stored) return empty;
  const list = Array.isArray(options) ? options : [];
  const matched = list.find((option) => candidateOptionMatches(stored, option.value));
  return matched ? matched.label : stored;
}

/** 候補プルダウン＋「その他（自由入力）」。フォームと帳票プレビューで共用する。 */
export function MixCandidateSelect({
  label,
  value,
  onChange,
  options,
  nav,
  disabled = false,
  className = '',
  inputClassName = '',
}) {
  const stored = value == null ? '' : String(value).trim();
  const list = Array.isArray(options) ? options : [];
  const matched = list.find((option) => candidateOptionMatches(stored, option.value)) || null;
  const [otherSelected, setOtherSelected] = useState(false);
  const [trackedStored, setTrackedStored] = useState(stored);
  if (stored !== trackedStored) {
    setTrackedStored(stored);
    if (matched) setOtherSelected(false);
  }
  const isCustom = stored !== '' && !matched;
  const showOther = isCustom || (!disabled && otherSelected);
  const selectValue = showOther ? MIX_OTHER_VALUE : matched ? String(matched.value) : '';
  const controlClass = (inputClassName || FIELD) + (disabled ? ' bg-slate-100 text-slate-500' : '');

  return (
    <label className={className || 'flex flex-col gap-1 text-xs font-bold text-slate-600'}>
      {label ? <span>{label}</span> : null}
      <select
        data-mix-nav={nav || undefined}
        value={selectValue}
        disabled={disabled}
        onKeyDown={(event) => {
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') event.stopPropagation();
        }}
        onChange={(event) => {
          const next = event.target.value;
          if (next === MIX_OTHER_VALUE) {
            setOtherSelected(true);
            if (matched) onChange('');
            return;
          }
          setOtherSelected(false);
          onChange(next);
        }}
        className={controlClass}
      >
        <option value="">選択</option>
        {list.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
        <option value={MIX_OTHER_VALUE}>その他（自由入力）</option>
      </select>
      {showOther ? (
        <input
          type="text"
          inputMode="decimal"
          value={matched ? '' : stored}
          disabled={disabled}
          placeholder="数値を入力"
          onKeyDown={preventMinusKey}
          onChange={(event) => onChange(sanitizeNonNegativeInput(event.target.value))}
          className={controlClass}
        />
      ) : null}
    </label>
  );
}
