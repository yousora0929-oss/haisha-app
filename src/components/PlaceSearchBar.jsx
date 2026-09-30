import React, { useState } from 'react';
import { searchPlaces } from '../utils/gsiGeocode.js';

/**
 * 場所検索（ボタン / Enter のみ。候補タップで onSelect）
 * @param {{
 *   onSelect: (place: { lat: number, lng: number, label: string }) => void,
 *   disabled?: boolean,
 *   className?: string,
 *   inputClassName?: string,
 *   placeholder?: string,
 * }} props
 */
export function PlaceSearchBar({
  onSelect,
  disabled = false,
  className = '',
  inputClassName = '',
  placeholder = '住所・地名で場所を検索',
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [message, setMessage] = useState('');

  const runSearch = async () => {
    const q = String(query || '').trim();
    if (!q || searching || disabled) return;
    setSearching(true);
    setMessage('');
    setResults([]);
    try {
      const places = await searchPlaces(q);
      if (!places.length) {
        setMessage('見つかりません。町名や番地の表記を変えてください');
        return;
      }
      setResults(places);
    } catch (err) {
      console.warn('[PlaceSearchBar] search failed', err);
      setMessage('検索に失敗しました。しばらくしてから再度お試しください');
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className={'relative ' + className}>
      <div className="flex gap-1.5">
        <input
          type="search"
          value={query}
          disabled={disabled || searching}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setMessage('');
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void runSearch();
            }
          }}
          className={
            inputClassName ||
            'min-h-[40px] flex-1 rounded-lg border border-slate-300 bg-white px-2.5 text-sm text-slate-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200'
          }
          aria-label="場所検索"
        />
        <button
          type="button"
          disabled={disabled || searching || !String(query || '').trim()}
          onClick={() => void runSearch()}
          className="min-h-[40px] shrink-0 rounded-lg border border-indigo-600 bg-indigo-600 px-3 text-sm font-black text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {searching ? '検索中…' : '検索'}
        </button>
      </div>
      {message ? (
        <p className="mt-1 text-[11px] font-bold text-amber-800">{message}</p>
      ) : null}
      {results.length > 0 ? (
        <ul className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white text-sm shadow-md">
          {results.map((place, idx) => (
            <li key={`${place.lat},${place.lng},${idx}`}>
              <button
                type="button"
                className="w-full px-3 py-2.5 text-left font-medium text-slate-800 hover:bg-indigo-50 active:bg-indigo-100"
                onClick={() => {
                  onSelect?.(place);
                  setResults([]);
                  setMessage('');
                }}
              >
                {place.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
