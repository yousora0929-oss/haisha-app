import React, { useCallback, useId, useMemo, useRef, useState } from 'react';
import { filterSuggestItems } from '../utils/masterSuggest.js';

const LIST_CLASS =
  'absolute left-0 right-0 top-full z-[9999] mt-1 max-h-60 overflow-y-auto rounded-md border border-gray-200 bg-white text-gray-900 shadow-2xl dark:border-gray-700 dark:bg-gray-800 dark:text-white';

const INPUT_CLASS =
  'min-h-[56px] w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-base text-gray-900 placeholder:text-slate-400 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100 dark:placeholder:text-slate-500 dark:focus:border-slate-500';

const OPTION_CLASS =
  'w-full px-4 py-3.5 text-left text-base font-medium text-gray-900 hover:bg-indigo-50 active:bg-indigo-100 dark:text-gray-100 dark:hover:bg-slate-700 dark:active:bg-slate-600';

/**
 * iOS Safari 対応カスタムサジェスト（datalist 非使用）
 */
export function MasterSuggestInput({
  label,
  htmlFor,
  name,
  value,
  onValueChange,
  items = [],
  getItemKey,
  getItemLabel,
  getSearchTexts,
  onSelect,
  placeholder = '',
  disabled = false,
  autoComplete = 'off',
  required = false,
  emptyHint = '該当する候補がありません',
  inputClassName = '',
}) {
  const autoId = useId();
  const inputId = htmlFor || `suggest-${autoId.replace(/:/g, '')}`;
  const [panelOpen, setPanelOpen] = useState(false);
  const blurTimerRef = useRef(null);

  const resolveSearchTexts = useCallback(
    (item) => {
      if (getSearchTexts) return getSearchTexts(item);
      const labelText = getItemLabel(item);
      return [labelText, getItemKey?.(item)];
    },
    [getSearchTexts, getItemLabel, getItemKey],
  );

  const filtered = useMemo(
    () => filterSuggestItems(items, value, resolveSearchTexts),
    [items, value, resolveSearchTexts],
  );

  const showList = panelOpen && !disabled && (String(value ?? '').trim().length > 0 || filtered.length > 0);

  const openPanel = () => {
    if (blurTimerRef.current) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setPanelOpen(true);
  };

  const closePanelSoon = () => {
    blurTimerRef.current = window.setTimeout(() => setPanelOpen(false), 220);
  };

  const pickItem = (item, e) => {
    e?.preventDefault?.();
    if (blurTimerRef.current) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    const labelText = getItemLabel(item);
    onValueChange(labelText);
    onSelect?.(item);
    setPanelOpen(false);
  };

  return (
    <div className="flex flex-col gap-2">
      {label != null && label !== '' ? (
        <label htmlFor={inputId} className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
          {label}
        </label>
      ) : null}
      <div className="relative">
        <input
          id={inputId}
          name={name}
          type="text"
          autoComplete={autoComplete}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          required={required}
          onChange={(e) => {
            onValueChange(e.target.value);
            openPanel();
          }}
          onFocus={openPanel}
          onBlur={closePanelSoon}
          className={INPUT_CLASS + (inputClassName ? ` ${inputClassName}` : '')}
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={showList ? `${inputId}-listbox` : undefined}
        />
        {showList ? (
          <ul
            id={`${inputId}-listbox`}
            className={LIST_CLASS}
            role="listbox"
            aria-label={typeof label === 'string' ? `${label}の候補` : '候補一覧'}
          >
            {filtered.length === 0 ? (
              <li className="px-4 py-3 text-sm font-medium text-slate-500 dark:text-slate-400" role="presentation">
                {emptyHint}
              </li>
            ) : (
              filtered.map((item) => {
                const key = getItemKey(item);
                return (
                  <li key={key} role="option">
                    <button
                      type="button"
                      className={OPTION_CLASS}
                      onMouseDown={(e) => pickItem(item, e)}
                      onTouchStart={(e) => pickItem(item, e)}
                    >
                      {getItemLabel(item)}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
