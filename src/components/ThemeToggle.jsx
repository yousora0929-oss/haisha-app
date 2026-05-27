import React, { useEffect, useId, useRef, useState } from 'react';
import { THEME_MODE_LABELS, THEME_MODES } from '../utils/theme.js';
import { useTheme } from './ThemeProvider.jsx';

const BTN =
  'min-h-[36px] rounded-lg border-2 px-2.5 py-1 text-[11px] font-black shadow-sm transition sm:min-h-[40px] sm:px-3 sm:text-xs';

/**
 * テーマ切替（Light / Dark / OS Sync）
 * デフォルトは OS Sync（prefers-color-scheme に追従）
 */
export function ThemeToggle({ className = '', compact = false }) {
  const { mode, effective, setMode } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const icon = effective === 'dark' ? '🌙' : '☀️';
  const label = compact ? icon : `${icon} テーマ`;

  return (
    <div ref={rootRef} className={'relative inline-block ' + className}>
      <button
        type="button"
        className={
          BTN +
          ' cursor-pointer border-slate-300 bg-white text-slate-800 hover:border-indigo-400 hover:bg-indigo-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:border-indigo-500 dark:hover:bg-slate-700'
        }
        aria-expanded={open}
        aria-controls={panelId}
        title={`Theme: ${THEME_MODE_LABELS[mode]} (${effective === 'dark' ? 'Dark' : 'Light'} active)`}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open ? (
        <div
          id={panelId}
          role="listbox"
          aria-label="テーマを選択"
          className="absolute right-0 top-full z-[100] mt-1.5 w-44 rounded-xl border-2 border-slate-200 bg-white p-2 shadow-xl dark:border-slate-600 dark:bg-slate-800"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="px-2 py-1 text-[10px] font-black uppercase tracking-wide text-slate-500 dark:text-slate-400">
            Theme
          </p>
          {THEME_MODES.map((id) => {
            const active = mode === id;
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={active}
                className={
                  'mt-1 flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs font-black ' +
                  (active
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-800 hover:bg-slate-100 dark:text-slate-100 dark:hover:bg-slate-700')
                }
                onClick={() => {
                  setMode(id);
                  setOpen(false);
                }}
              >
                <span>
                  {id === 'light' ? '☀️' : id === 'dark' ? '🌙' : '💻'} {THEME_MODE_LABELS[id]}
                </span>
                {active ? <span aria-hidden>✓</span> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
