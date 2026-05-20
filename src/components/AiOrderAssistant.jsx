import React from 'react';

/**
 * 新規発注フォーム上部の AI 入力エリア
 */
export function AiOrderAssistant({ value, onChange, onSubmit, loading, notice }) {
  return (
    <section
      className="rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50/95 via-white to-white p-4 shadow-sm sm:p-5"
      aria-labelledby="ai-order-assistant-title"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex rounded-full bg-indigo-600 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-white">
          AI
        </span>
        <h3 id="ai-order-assistant-title" className="text-base font-black text-slate-900 sm:text-lg">
          AIに注文を頼む
        </h3>
      </div>
      <p className="mt-1.5 text-xs font-medium leading-relaxed text-slate-600 sm:text-sm">
        注文内容を文章で入力すると、Gemini が希望日時・数量・配合などを読み取り、フォームに自動入力します。
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={loading}
        rows={3}
        placeholder="例：明日の朝8時半に、呼び強度21、スランプ18、粗骨材20mmを3㎥お願いします"
        className="mt-3 min-h-[88px] w-full resize-y rounded-xl border-2 border-indigo-200/80 bg-white px-4 py-3 text-sm font-medium text-slate-900 placeholder:text-slate-400 outline-none transition focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 disabled:cursor-not-allowed disabled:bg-slate-100"
        aria-describedby="ai-order-assistant-hint"
      />
      <p id="ai-order-assistant-hint" className="mt-1 text-[11px] font-medium text-slate-500">
        日付・時刻・呼び強度・スランプ・骨材・数量を含めると精度が上がります。
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onSubmit}
          disabled={loading || !String(value || '').trim()}
          className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl border-2 border-indigo-700 bg-indigo-600 px-5 py-2.5 text-sm font-black text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-300 disabled:text-slate-500"
        >
          {loading ? (
            <>
              <span
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                aria-hidden="true"
              />
              解析中…
            </>
          ) : (
            'AIで入力欄を埋める'
          )}
        </button>
        {loading ? (
          <p className="text-sm font-bold text-indigo-800" role="status" aria-live="polite">
            AIが注文内容を読み取っています...
          </p>
        ) : null}
        {!loading && notice ? (
          <p className="text-sm font-black text-emerald-700" role="status" aria-live="polite">
            {notice}
          </p>
        ) : null}
      </div>
    </section>
  );
}
