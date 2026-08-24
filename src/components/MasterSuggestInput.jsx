import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { filterSuggestItems } from '../utils/masterSuggest.js';

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

const DEFAULT_LIST_MAX_HEIGHT_PX = 240; // 従来の max-h-60 相当（フォールバック用）
const MIN_USABLE_SPACE_PX = 120; // これ未満のスペースなら反転を検討
const VIEWPORT_EDGE_MARGIN_PX = 8;
const FOCUS_SCROLL_DELAY_MS = 250; // キーボードのアニメーション待ち（保険）
/** Tailwind sm 相当。狭い画面のみ候補リストに高さ制限＋内部スクロールを付ける */
const NARROW_VIEWPORT_MQ = '(max-width: 639px)';

function isNarrowViewport() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true;
  return window.matchMedia(NARROW_VIEWPORT_MQ).matches;
}

const INPUT_CLASS =
  'min-h-[56px] w-full rounded-xl border-2 border-slate-200 bg-white px-4 py-3 text-base text-gray-900 placeholder:text-slate-400 outline-none focus:border-slate-400 focus:ring-2 focus:ring-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-gray-100 dark:placeholder:text-slate-500 dark:focus:border-slate-500';

const OPTION_CLASS =
  'w-full px-4 py-3.5 text-left text-base font-medium text-gray-900 hover:bg-indigo-50 active:bg-indigo-100 dark:text-gray-100 dark:hover:bg-slate-700 dark:active:bg-slate-600 touch-manipulation';

const FAVORITE_OPTION_CLASS =
  'w-full px-4 py-3 text-left text-base font-bold text-amber-950 hover:bg-amber-100/80 active:bg-amber-100 dark:text-amber-100 dark:hover:bg-amber-900/40 dark:active:bg-amber-900/50 touch-manipulation';

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
}) {
  const autoId = useStableId();
  const inputId = htmlFor || autoId;
  const [panelOpen, setPanelOpen] = useState(false);
  const blurTimerRef = useRef(null);
  const pointerRef = useRef(emptyPointerState());
  const pickItemRef = useRef(null);
  const wrapperRef = useRef(null);
  const inputRef = useRef(null);
  const focusScrollCleanupRef = useRef(null);
  const [placement, setPlacement] = useState({
    openUp: false,
    /** @type {number|null} 狭い画面のみ px。PC は null（高さ制限なし） */
    maxHeight: DEFAULT_LIST_MAX_HEIGHT_PX,
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
    return filterSuggestItems(items, value, resolveSearchTexts, searchResultLimit);
  }, [items, value, resolveSearchTexts, isEmptyQuery, emptyQueryShowsPinnedOnly, searchResultLimit]);

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
  const showList = showPinned || showFiltered || showEmpty;

  const openPanel = useCallback(() => {
    if (blurTimerRef.current) {
      window.clearTimeout(blurTimerRef.current);
      blurTimerRef.current = null;
    }
    setPanelOpen(true);
  }, []);

  const closePanelSoon = () => {
    blurTimerRef.current = window.setTimeout(() => setPanelOpen(false), 220);
  };

  const handleFocus = useCallback(() => {
    openPanel();

    // PC ではキーボードでビューポートが縮まないため、不要な scrollIntoView を避ける
    if (!isNarrowViewport()) return;

    if (typeof focusScrollCleanupRef.current === 'function') {
      focusScrollCleanupRef.current();
      focusScrollCleanupRef.current = null;
    }

    const scrollToTop = () => {
      const el = inputRef.current;
      if (!el || typeof el.scrollIntoView !== 'function') return;
      el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };

    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    if (vv) {
      let done = false;
      const onceResize = () => {
        if (done) return;
        done = true;
        scrollToTop();
        vv.removeEventListener('resize', onceResize);
      };
      vv.addEventListener('resize', onceResize);
      const timerId = window.setTimeout(() => {
        vv.removeEventListener('resize', onceResize);
        if (!done) {
          done = true;
          scrollToTop();
        }
      }, FOCUS_SCROLL_DELAY_MS);
      focusScrollCleanupRef.current = () => {
        done = true;
        vv.removeEventListener('resize', onceResize);
        window.clearTimeout(timerId);
      };
    } else {
      const timerId = window.setTimeout(scrollToTop, FOCUS_SCROLL_DELAY_MS);
      focusScrollCleanupRef.current = () => {
        window.clearTimeout(timerId);
      };
    }
  }, [openPanel]);

  useEffect(() => {
    return () => {
      if (typeof focusScrollCleanupRef.current === 'function') {
        focusScrollCleanupRef.current();
        focusScrollCleanupRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!showList) return undefined;

    function recalcPlacement() {
      const wrapperEl = wrapperRef.current;
      if (!wrapperEl) return;

      // PC: 高さ制限・内部スクロールを付けず、ページ全体スクロールに任せる
      if (!isNarrowViewport()) {
        setPlacement({ openUp: false, maxHeight: null });
        return;
      }

      const rect = wrapperEl.getBoundingClientRect();
      const vv = typeof window !== 'undefined' ? window.visualViewport : null;
      const viewportHeight = vv ? vv.height : window.innerHeight;
      const viewportOffsetTop = vv ? vv.offsetTop : 0;

      const spaceBelow = viewportOffsetTop + viewportHeight - rect.bottom;
      const spaceAbove = rect.top - viewportOffsetTop;

      if (spaceBelow < MIN_USABLE_SPACE_PX && spaceAbove > spaceBelow) {
        setPlacement({
          openUp: true,
          maxHeight: Math.max(120, Math.floor(spaceAbove - VIEWPORT_EDGE_MARGIN_PX)),
        });
      } else {
        setPlacement({
          openUp: false,
          maxHeight: Math.max(
            120,
            Math.min(
              DEFAULT_LIST_MAX_HEIGHT_PX * 2,
              Math.floor(spaceBelow - VIEWPORT_EDGE_MARGIN_PX),
            ),
          ),
        });
      }
    }

    recalcPlacement();

    const vv = typeof window !== 'undefined' ? window.visualViewport : null;
    const mq =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia(NARROW_VIEWPORT_MQ)
        : null;
    vv?.addEventListener('resize', recalcPlacement);
    vv?.addEventListener('scroll', recalcPlacement);
    window.addEventListener('resize', recalcPlacement);
    mq?.addEventListener?.('change', recalcPlacement);

    return () => {
      vv?.removeEventListener('resize', recalcPlacement);
      vv?.removeEventListener('scroll', recalcPlacement);
      window.removeEventListener('resize', recalcPlacement);
      mq?.removeEventListener?.('change', recalcPlacement);
    };
  }, [showList]);

  const pickItem = useCallback(
    (item) => {
      if (blurTimerRef.current) {
        window.clearTimeout(blurTimerRef.current);
        blurTimerRef.current = null;
      }
      const labelText = getItemLabel(item);
      onValueChange(labelText);
      onSelect?.(item);
      setPanelOpen(false);
    },
    [getItemLabel, onValueChange, onSelect],
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

  const renderOptionButton = (item, className, extraContent = null) => (
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
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      {label != null && label !== '' ? (
        <label htmlFor={inputId} className="block text-sm font-semibold text-slate-700 dark:text-slate-300">
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
            onPointerMove={(e) => markPointerMoved(e.clientX, e.clientY)}
            style={{
              // 狭い画面のみ内部スクロール。PC は maxHeight なしでページスクロールに任せる
              ...(placement.maxHeight != null
                ? { maxHeight: `${placement.maxHeight}px`, overflowY: 'auto' }
                : { overflowY: 'visible' }),
              ...(placement.openUp
                ? { top: 'auto', bottom: '100%', marginBottom: '4px' }
                : { top: '100%', marginTop: '4px' }),
            }}
          >
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
