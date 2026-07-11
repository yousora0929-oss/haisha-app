import React from 'react';

/** ナンバー種別（事業用／自家用）を色分けして目立たせるバッジ */
export function PlateCategoryBadge({ category }) {
  if (category === 'business') {
    return (
      <span className="inline-flex items-center rounded-md border-2 border-emerald-600 bg-emerald-500 px-2 py-1 text-xs font-black text-white shadow-sm dark:border-emerald-400 dark:bg-emerald-600">
        事業用
      </span>
    );
  }
  if (category === 'private') {
    return (
      <span className="inline-flex items-center rounded-md border-2 border-slate-400 bg-slate-100 px-2 py-1 text-xs font-black text-slate-700 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-100">
        自家用
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md border-2 border-amber-400 bg-amber-50 px-2 py-1 text-xs font-black text-amber-800 dark:border-amber-500 dark:bg-amber-950/50 dark:text-amber-200">
      種別未設定
    </span>
  );
}
