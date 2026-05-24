import React from 'react';
import { MAP_EDITOR_TOOLS, MAP_STAMP_DEFS } from '../mapEditorConstants.js';
import { DEFAULT_UNLOAD_RADIUS_M } from '../utils/mapAnnotations.js';

const TOOL_BTN =
  'flex w-full flex-col items-center gap-0.5 rounded-xl border-2 px-1 py-2 text-[10px] font-black transition active:scale-95 disabled:opacity-40 sm:text-[11px]';

export function MapEditorToolbar({
  activeTool,
  onToolChange,
  selectedStampType,
  onStampTypeChange,
  selectedUnloadRadius,
  onUnloadRadiusChange,
  disabled = false,
}) {
  const toolActive = (t) =>
    activeTool === t
      ? 'border-indigo-500 bg-indigo-50 text-indigo-900 shadow-[0_0_0_2px_rgba(99,102,241,0.2)]'
      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50';

  return (
    <aside className="flex w-[4.5rem] shrink-0 flex-col gap-2 border-r border-slate-200 bg-slate-50 p-2 sm:w-52 sm:p-3">
      <p className="hidden text-[10px] font-black uppercase tracking-wide text-slate-500 sm:block">ツール</p>
      <button
        type="button"
        disabled={disabled}
        className={TOOL_BTN + ' ' + toolActive(MAP_EDITOR_TOOLS.PAN)}
        onClick={() => onToolChange(MAP_EDITOR_TOOLS.PAN)}
        title="地図を移動"
      >
        <span className="text-lg">✋</span>
        <span className="hidden sm:inline">移動</span>
      </button>
      <button
        type="button"
        disabled={disabled}
        className={TOOL_BTN + ' ' + toolActive(MAP_EDITOR_TOOLS.UNLOAD)}
        onClick={() => onToolChange(MAP_EDITOR_TOOLS.UNLOAD)}
        title="荷下ろし地点（赤〇）"
      >
        <span className="text-lg">🔴</span>
        <span className="leading-tight">荷下ろし</span>
      </button>
      <button
        type="button"
        disabled={disabled}
        className={TOOL_BTN + ' ' + toolActive(MAP_EDITOR_TOOLS.STAMP)}
        onClick={() => onToolChange(MAP_EDITOR_TOOLS.STAMP)}
        title="スタンプ配置"
      >
        <span className="text-lg">📌</span>
        <span className="hidden sm:inline">スタンプ</span>
      </button>
      <button
        type="button"
        disabled={disabled}
        className={TOOL_BTN + ' ' + toolActive(MAP_EDITOR_TOOLS.COMMENT)}
        onClick={() => onToolChange(MAP_EDITOR_TOOLS.COMMENT)}
        title="コメント"
      >
        <span className="text-lg">💬</span>
        <span className="hidden sm:inline">コメント</span>
      </button>

      {activeTool === MAP_EDITOR_TOOLS.UNLOAD ? (
        <div className="mt-1 rounded-lg border border-red-200 bg-red-50 p-2">
          <label className="text-[10px] font-bold text-red-900" htmlFor="unload-radius">
            円の半径（m）
          </label>
          <input
            id="unload-radius"
            type="range"
            min={4}
            max={40}
            step={1}
            disabled={disabled}
            value={selectedUnloadRadius ?? DEFAULT_UNLOAD_RADIUS_M}
            onChange={(e) => onUnloadRadiusChange?.(Number(e.target.value))}
            className="mt-1 w-full"
          />
          <p className="mt-0.5 text-center text-[10px] font-black text-red-800">
            {selectedUnloadRadius ?? DEFAULT_UNLOAD_RADIUS_M} m
          </p>
        </div>
      ) : null}

      {activeTool === MAP_EDITOR_TOOLS.STAMP ? (
        <div className="mt-1 flex flex-1 flex-col gap-1 overflow-y-auto sm:max-h-[40vh]">
          <p className="hidden text-[10px] font-bold text-slate-500 sm:block">種類を選択</p>
          {MAP_STAMP_DEFS.map((def) => (
            <button
              key={def.type}
              type="button"
              disabled={disabled}
              aria-pressed={selectedStampType === def.type}
              onClick={() => onStampTypeChange(def.type)}
              className={
                'flex min-h-[44px] items-center gap-2 rounded-lg border-2 px-2 py-1.5 text-left transition active:scale-95 disabled:opacity-50 ' +
                (selectedStampType === def.type
                  ? 'border-indigo-500 bg-indigo-50'
                  : 'border-slate-200 bg-white hover:bg-slate-50')
              }
            >
              <span className="text-xl">{def.emoji}</span>
              <span className="hidden text-[11px] font-bold leading-tight text-slate-800 sm:inline">{def.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
