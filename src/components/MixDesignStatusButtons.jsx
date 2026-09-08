import React from 'react';
import {
  MIX_DESIGN_STATUS_LABELS,
  MIX_DESIGN_STATUS_VALUES,
} from '../utils/mixDesignRequest.js';

/**
 * 配合計画書依頼のステータスを5段階で手動変更するボタン列。
 */
export function MixDesignStatusButtons({
  value,
  onChange,
  disabled = false,
  saving = false,
}) {
  const current = String(value || '').trim();
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-xs font-black text-slate-600">ステータス</legend>
      <div className="flex flex-wrap gap-1.5">
        {MIX_DESIGN_STATUS_VALUES.map((key) => {
          const active = current === key;
          return (
            <button
              key={key}
              type="button"
              disabled={disabled || saving || active}
              onClick={() => onChange?.(key)}
              className={
                'min-h-[40px] rounded-xl border-2 px-3 text-xs font-black transition sm:text-sm ' +
                (active
                  ? 'cursor-default border-indigo-600 bg-indigo-600 text-white'
                  : 'border-slate-200 bg-white text-slate-700 hover:border-slate-400 disabled:cursor-not-allowed disabled:opacity-50')
              }
            >
              {MIX_DESIGN_STATUS_LABELS[key]}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
