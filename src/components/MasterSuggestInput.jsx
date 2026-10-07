import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DIRECT_TRADE_SUGGEST_ITEM, filterSuggestItems } from '../utils/masterSuggest.js';

// useId の代替（React 18未満 / Chrome 109 対応）
let _suggestIdCounter = 0;
function useStableId() {
  const ref = useRef(null);
  if (ref.current === null) {
    ref.current = `cl-suggest-${++_suggestIdCounter}`;
  }
  return ref.current;
}

const LIST_CLASS =
  'absolute left-0 right-0 z-[9999] touch-pan-y overscroll-contain rounded-md border border-gray-200 bg-white pb-2 text-gray-900 shadow-2xl dark:border-gray-700 dark:bg-gray-800 dark:text-white';

const MIN_USABLE_SPACE_PX = 120; // これ未満のスペースなら反転を検討
const VIEWPORT_EDGE_MARGIN_PX = 8;
const INPUT_CLASS =
  'min-h-[56px] w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-base text-gray-900 placeholder:text-slate-400 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100 dark:placeholder:text-slate-500 dark:focus:border-slate-500';

const OPTION_CLASS =
  'min-h-[44px] w-full px-4 py-3.5 text-left text-base font-medium text-gray-900 hover:bg-indigo-50 active:bg-indigo-100 dark:text-gray-100 dark:hover:bg-slate-700 dark:active:bg-slate-600 touch-manipulation';

const FAVORITE_OPTION_CLASS =
  'min-h-[44px] w-full px-4 py-3 text-left text-base font-bold text-amber-950 hover:bg-amber-100/80 active:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-900/40 dark:active:bg-amber-900/50 touch-manipulation';

const TAP_MOVE_THRESHOLD_PX = 10;

function emptyPointerState() {
  return { pointerId: null, startX: 0, startY: 0, moved: false, item: null };
}

const FAVORITE_HEADER_CLASS =
  'sticky top-0 z-10 border-b border-amber-200/80 bg-amber-50/90 px-4 py-2 text-[11px] font-black tracking-wide text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200';

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
  /** 候補の右側に小さく添える補助表示（入力値には反映されない） */
  getItemSubLabel,
  getSearchTexts,
  onSelect,
  placeholder = '',
  disabled = false,
  autoComplete = 'off',
  required = false,
  emptyHint = '一致する候補がありません',
  inputClassName = '',
  /** 空欄フォーカス時のみ表示するピン留め候補（よく使う地名など） */
  pinnedItems = [],
  pinnedSectionLabel = '⭐ よく使うエリア',
  /** true: 空欄時はピン留めのみ表示（マスタ全件は出さない） */
  emptyQueryShowsPinnedOnly = false,
  searchResultLimit = 80,
  /** 検索結果に関係なく、リスト最上部へ固定する候補（商社なしなど） */
  leadingItems = [],
  /** 選択後は結果カードだけにし、「変更」で検索を開き直す */
  summarizeSelection = false,
  onInputKeyDown,
  inputProps = {},
  labelClassName = '',
  compact = false,
}) {
  const autoId = useStableId();
  const inputId = htmlFor || autoId;
  const [panelOpen, setPanelOpen] = useState(false);
  const [selectionLocked, setSelectionLocked] = useState(false);
  const [lockedLabel, setLockedLabel] = useState('');
  const reopenFocusRef = useRef(false);
  const blurTimerRef = useRef(null);
  const ignoreBlurRef = useRef(false);
  const pointerRef = useRef(emptyPointerState());
  const pickItemRef = useRef(null);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const [placement, setPlacement] = useState({
    openUp: false,
    maxHeight: 360,
    left: 0,
    width: 0,
    top: null,
    bottom: null,
  });

  const queryTrimmed = String(value ?? '').trim();
  const isEmptyQuery = queryTrimmed.length === 0;

  const resolveSearchTexts = useCallback(
    (item) => {
      if (getSearchTexts) return getSearchTexts(item);
      const labelText = getItemLabel(item);
      return [labelText, getItemKey?.(item)];
    },
    [getSearchTexts, getItemLabel, getItemKey],
  );

  const leadingList = useMemo(() => {
    const raw = Array.isArray(leadingItems) ? leadingItems : [];
    const seen = new Set();
    const out = [];
    for (const item of raw) {
      if (item == null) continue;
      const key = String(getItemKey(item));
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }, [leadingItems, getItemKey]);

  const pinnedList = useMemo(() => {
    const raw = Array.isArray(pinnedItems) ? pinnedItems : [];
    const seen = new Set();
    const out = [];
    for (const item of raw) {
      if (item == null) continue;
      const key = getItemKey(item);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
    return out;
  }, [pinnedItems, getItemKey]);

  const filtered = useMemo(() => {
    if (isEmptyQuery && emptyQueryShowsPinnedOnly) return [];
    const leadingKeys = new Set(leadingList.map((item) => String(getItemKey(item))));
    return filterSuggestItems(items, value, resolveSearchTexts, searchResultLimit).filter(
      (item) => !leadingKeys.has(String(getItemKey(item))),
    );
  }, [
    items,
    value,
    resolveSearchTexts,
    isEmptyQuery,
    emptyQueryShowsPinnedOnly,
    searchResultLimit,
    leadingList,
    getItemKey,
  ]);

  const showLeading = panelOpen && !disabled && leadingList.length > 0;
  const showPinned = panelOpen && !disabled && isEmptyQuery && pinnedList.length > 0;
  const showFiltered =
    panelOpen &&
    !disabled &&
    filtered.length > 0 &&
    (!isEmptyQuery || !emptyQueryShowsPinnedOnly);
  const showEmpty =
    panelOpen &&
    !disabled &&
    !isEmptyQuery &&
    filtered.length === 0 &&
    !(emptyQueryShowsPinnedOnly && pinnedList.length > 0);
  const showList = showLeading || showPinned || showFiltered || showEmpty;

  const openPanel = useCallback(() => {
    if (blurTimerRef.current) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setPanelOpen(true);
  }, []);

  const closePanelSoon = () => {
    if (ignoreBlurRef.current) return;
    blurTimerRef.current = window.setTimeout(() => setPanelOpen(false), 220);
  };

  const handleFocus = useCallback(() => {
    openPanel();
  }, [openPanel]);

  useEffect(() => {
    if (!summarizeSelection || !selectionLocked) return;
    if (String(value || '').trim()) return;
    if (lockedLabel === DIRECT_TRADE_SUGGEST_ITEM.name) return;
    setSelectionLocked(false);
    setLockedLabel('');
  }, [value, summarizeSelection, selectionLocked, lockedLabel]);

  useLayoutEffect(() => {
    if (!showList) return undefined;

    function recalcPlacement() {
      const wrapperEl = wrapperRef.current;
      if (!wrapperEl) return;

      const rect = wrapperEl.getBoundingClientRect();
      const vv = typeof window !== 'undefined' ? window.visualViewport : null;
      const viewportHeight = vv ? vv.height : window.innerHeight;
      const viewportOffsetTop = vv ? vv.offsetTop : 0;

      const spaceBelow = viewportOffsetTop + viewportHeight - rect.bottom;
      const spaceAbove = rect.top - viewportOffsetTop;
      const cap = Math.max(160, Math.round(viewportHeight * 0.45));
      const openUp = spaceBelow < MIN_USABLE_SPACE_PX && spaceAbove > spaceBelow;
      const available = openUp ? spaceAbove : spaceBelow;

      setPlacement({
        openUp,
        maxHeight: Math.max(120, Math.min(cap, Math.floor(available - VIEWPORT_EDGE_MARGIN_PX))),
        left: rect.left,
        width: rect.width,
        top: openUp ? null : rect.bottom + 4,
        bottom: openUp ? viewportOffsetTop + viewportHeight - rect.top + 4 : null,
      });
    }

    recalcPlacement();

    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    vv?.addEventListener('resize', recalcPlacement);
    vv?.addEventListener('scroll', recalcPlacement);
    window.addEventListener('resize', recalcPlacement);
    document.addEventListener('scroll', recalcPlacement, true);

    return () => {
      vv?.removeEventListener('resize', recalcPlacement);
      vv?.removeEventListener('scroll', recalcPlacement);
      window.removeEventListener('resize', recalcPlacement);
      document.removeEventListener('scroll', recalcPlacement, true);
    };
  }, [showList]);

  const pickItem = useCallback(
    (item) => {
      if (blurTimerRef.current) {
        window.clearTimeout(blurTimerRef.current);
        blurTimerRef.current = null;
      }
      if (summarizeSelection) ignoreBlurRef.current = true;
      const labelText = getItemLabel(item);
      const direct = Boolean(item?.directTrade);
      onValueChange(direct ? '' : labelText);
      onSelect?.(item);
      setPanelOpen(false);
      if (summarizeSelection) {
        setLockedLabel(labelText);
        setSelectionLocked(true);
      }
    },
    [getItemLabel, onValueChange, onSelect, summarizeSelection],
  );

  pickItemRef.current = pickItem;

  const markPointerMoved = useCallback((clientX, clientY) => {
    const s = pointerRef.current;
    if (s.pointerId == null) return;
    if (
      Math.abs(clientX - s.startX) > TAP_MOVE_THRESHOLD_PX ||
      Math.abs(clientY - s.startY) > TAP_MOVE_THRESHOLD_PX
    ) {
      s.moved = true;
    }
  }, []);

  const beginOptionPointer = useCallback((e, item) => {
    e.preventDefault();
    pointerRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      item,
    };
  }, []);

  const finishOptionPointer = useCallback((e) => {
    const s = pointerRef.current;
    if (s.pointerId !== e.pointerId) return;
    e.preventDefault();
    const item = s.item;
    const moved = s.moved;
    pointerRef.current = emptyPointerState();
    if (!moved && item != null) pickItemRef.current?.(item);
  }, []);

  const cancelOptionPointer = useCallback((e) => {
    if (pointerRef.current.pointerId === e.pointerId) {
      pointerRef.current = emptyPointerState();
    }
  }, []);

  const renderOptionButton = (item, className, extraContent = null) => {
    const subLabel = getItemSubLabel ? String(getItemSubLabel(item) ?? '').trim() : '';
    return (
      <button
        type="button"
        className={className}
        onPointerDown={(e) => beginOptionPointer(e, item)}
        onPointerMove={(e) => markPointerMoved(e.clientX, e.clientY)}
        onPointerUp={finishOptionPointer}
        onPointerCancel={cancelOptionPointer}
      >
        {extraContent}
        {getItemLabel(item)}
        {subLabel ? (
          <span className="ml-2 text-xs font-medium text-slate-500 dark:text-slate-400">
            {subLabel}
          </span>
        ) : null}
      </button>
    );
  };

  const reopenSelection = useCallback(() => {
    ignoreBlurRef.current = false;
    reopenFocusRef.current = true;
    setSelectionLocked(false);
    setPanelOpen(true);
  }, []);

  useEffect(() => {
    if (selectionLocked || !reopenFocusRef.current) return;
    reopenFocusRef.current = false;
    inputRef.current?.focus();
  }, [selectionLocked]);

  const inputMinHOverridden = compact || /\bmin-h-/.test(String(inputClassName || ''));
  const baseInputClass = inputMinHOverridden
    ? INPUT_CLASS.replace('min-h-[56px] ', '').replace('px-4 py-3 ', 'px-3 py-2 ')
    : INPUT_CLASS;

  if (summarizeSelection && selectionLocked) {
    return (
      <div className={compact ? 'flex flex-col gap-1' : 'flex flex-col gap-2'}>
        {label != null && label !== '' ? (
          <span
            className={
              labelClassName ||
              'block text-sm font-semibold text-slate-700 dark:text-slate-300'
            }
          >
            {label}
          </span>
        ) : null}
        <div className="flex items-center gap-2 rounded-xl border-2 border-indigo-200 bg-indigo-50/70 px-3 py-2 dark:border-indigo-500/40 dark:bg-indigo-950/30">
          <span className="min-w-0 flex-1 break-words text-base font-bold text-gray-900 dark:text-gray-100">
            {lockedLabel || value}
          </span>
          <button
            type="button"
            className="min-h-[44px] shrink-0 rounded-lg bg-white px-4 text-sm font-black text-indigo-700 shadow-sm ring-1 ring-indigo-200 touch-manipulation dark:bg-slate-800 dark:text-indigo-200"
            onClick={reopenSelection}
          >
            変更
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={compact ? 'flex flex-col gap-1' : 'flex flex-col gap-2'}>
      {label != null && label !== '' ? (
        <label
          htmlFor={inputId}
          className={
            labelClassName ||
            'block text-sm font-semibold text-slate-700 dark:text-slate-300'
          }
        >
          {label}
        </label>
      ) : null}
      <div className="relative" ref={wrapperRef}>
        <input
          id={inputId}
          ref={inputRef}
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
          onFocus={handleFocus}
          onBlur={closePanelSoon}
          className={baseInputClass + (inputClassName ? ` ${inputClassName}` : '')}
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={showList ? `${inputId}-listbox` : undefined}
          {...inputProps}
          onKeyDown={(e) => {
            inputProps?.onKeyDown?.(e);
            onInputKeyDown?.(e);
          }}
        />
        {showList ? (
          <ul
            id={`${inputId}-listbox`}
            className={LIST_CLASS}
            role="listbox"
            aria-label={typeof label === 'string' ? `${label}の候補` : '候補一覧'}
            onPointerMove={(e) => markPointerMoved(e.clientX, e.clientY)}
            style={{
              position: 'fixed',
              left: placement.left,
              width: placement.width || undefined,
              right: 'auto',
              maxHeight: `${placement.maxHeight}px`,
              overflowY: 'auto',
              top: placement.top == null ? 'auto' : placement.top,
              bottom: placement.bottom == null ? 'auto' : placement.bottom,
              marginTop: 0,
              marginBottom: 0,
            }}
          >
            {showLeading
              ? leadingList.map((item) => (
                  <li key={`lead-${getItemKey(item)}`} role="option" className="sticky top-0 z-10 border-b border-slate-200 bg-white dark:border-slate-600 dark:bg-slate-800">
                    {renderOptionButton(item, OPTION_CLASS)}
                  </li>
                ))
              : null}
            {showPinned ? (
              <>
                <li className={FAVORITE_HEADER_CLASS} role="presentation">
                  {pinnedSectionLabel}
                </li>
                {pinnedList.map((item) => {
                  const key = `fav-${getItemKey(item)}`;
                  return (
                    <li key={key} role="option" className="bg-amber-50/50 dark:bg-amber-950/20">
                      {renderOptionButton(
                        item,
                        FAVORITE_OPTION_CLASS,
                        <span className="mr-1.5" aria-hidden>
                          ⭐
                        </span>,
                      )}
                    </li>
                  );
                })}
              </>
            ) : null}
            {showFiltered
              ? filtered.map((item) => {
                  const key = getItemKey(item);
                  const isPinnedHit = pinnedList.some((p) => getItemKey(p) === key);
                  return (
                    <li
                      key={key}
                      role="option"
                      className={isPinnedHit ? 'bg-amber-50/30 dark:bg-amber-950/15' : undefined}
                    >
                      {renderOptionButton(
                        item,
                        OPTION_CLASS,
                        isPinnedHit ? (
                          <span className="mr-1.5 text-amber-600 dark:text-amber-400" aria-hidden>
                            ⭐
                          </span>
                        ) : null,
                      )}
                    </li>
                  );
                })
              : null}
            {showEmpty ? (
              <li className="px-4 py-3 text-sm font-medium text-slate-500 dark:text-slate-400" role="presentation">
                {emptyHint}
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
