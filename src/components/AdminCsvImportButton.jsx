import React, { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeCompanyName } from '../utils/csvImport.js';

function buildDefaultSelection(items) {
  const map = {};
  for (const item of items || []) {
    const key = normalizeCompanyName(item?.name);
    if (key) map[key] = true;
  }
  return map;
}

/**
 * 管理画面 — CSV/Excel一括取込（プレビュー・確認ダイアログ付き）
 */
export function AdminCsvImportButton({
  label = 'CSV一括取込',
  disabled = false,
  parseFile,
  entityLabel = '件',
  previewColumns = [],
  onImport,
  onComplete,
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [contractorSelection, setContractorSelection] = useState({});
  const [tradingSelection, setTradingSelection] = useState({});

  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = '';
  };

  useEffect(() => {
    if (!preview) {
      setContractorSelection({});
      setTradingSelection({});
      return;
    }
    setContractorSelection(buildDefaultSelection(preview.newContractors));
    setTradingSelection(buildDefaultSelection(preview.newTradingCompanies));
  }, [preview]);

  const newContractorCount = preview?.newContractors?.length ?? 0;
  const newTradingCount = preview?.newTradingCompanies?.length ?? 0;
  const selectedContractorCount = useMemo(
    () => Object.values(contractorSelection).filter(Boolean).length,
    [contractorSelection],
  );
  const selectedTradingCount = useMemo(
    () => Object.values(tradingSelection).filter(Boolean).length,
    [tradingSelection],
  );

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    resetInput();
    if (!file) return;

    setError('');
    setBusy(true);
    try {
      const result = await parseFile(file);
      setPreview(result);
    } catch (err) {
      setError(err?.message || 'ファイルの読み込みに失敗しました。');
      setPreview(null);
    } finally {
      setBusy(false);
    }
  };

  const closePreview = () => {
    setPreview(null);
    setError('');
  };

  const handleConfirm = async () => {
    if (!preview?.rows?.length) return;
    const count = preview.rows.length;
    const skippedNote =
      preview.skipped?.length > 0 ? `\n（${preview.skipped.length}行はスキップされます）` : '';
    const registerNote =
      newContractorCount || newTradingCount
        ? `\n（新規登録予定: 業者 ${selectedContractorCount}件 / 商社 ${selectedTradingCount}件）`
        : '';
    if (
      !window.confirm(
        `${count}${entityLabel}を検出しました。取り込みますか？${skippedNote}${registerNote}`,
      )
    ) {
      return;
    }

    setBusy(true);
    setError('');
    try {
      await onImport({
        ...preview,
        registerContractorKeys: { ...contractorSelection },
        registerTradingCompanyKeys: { ...tradingSelection },
      });
      closePreview();
      onComplete?.();
    } catch (err) {
      setError(err?.message || '一括登録に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  const renderNewBadge = (show) =>
    show ? (
      <span className="ml-1 inline-flex rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-black text-emerald-800">
        🆕新規登録
      </span>
    ) : null;

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        className="hidden"
        onChange={handleFile}
      />
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => inputRef.current?.click()}
        className="min-h-[44px] rounded-lg border-2 border-emerald-600 bg-white px-4 text-sm font-black text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
      >
        {busy && !preview ? '読み込み中…' : label}
      </button>

      {error && !preview ? (
        <p className="mt-2 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-xs font-bold text-red-800" role="alert">
          {error}
        </p>
      ) : null}

      {preview ? (
        <div className="fixed inset-0 z-[300] flex items-end justify-center bg-slate-900/50 p-4 sm:items-center">
          <div
            role="dialog"
            aria-modal="true"
            className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
          >
            <h3 className="text-lg font-black text-slate-900">取込プレビュー</h3>
            <p className="mt-1 text-sm font-bold text-emerald-800">
              {preview.rows.length}
              {entityLabel}を登録できます
            </p>

            {newContractorCount > 0 || newTradingCount > 0 ? (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2">
                <p className="text-xs font-black text-emerald-900">
                  新規登録される業者: {newContractorCount}件 / 商社: {newTradingCount}件
                  <span className="ml-1 font-bold text-emerald-700">
                    （チェックOFFで物件のみ・紐付けなし）
                  </span>
                </p>
                {newContractorCount > 0 ? (
                  <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                    {preview.newContractors.map((item) => {
                      const key = normalizeCompanyName(item.name);
                      return (
                        <li key={`c-${key}`}>
                          <label className="flex cursor-pointer items-start gap-2 text-xs font-medium text-slate-800">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600"
                              checked={Boolean(contractorSelection[key])}
                              onChange={(e) =>
                                setContractorSelection((prev) => ({
                                  ...prev,
                                  [key]: e.target.checked,
                                }))
                              }
                            />
                            <span>
                              業者「{item.name}」
                              <span className="text-slate-500">
                                （行 {item.__lines?.join(', ')}）
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
                {newTradingCount > 0 ? (
                  <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto">
                    {preview.newTradingCompanies.map((item) => {
                      const key = normalizeCompanyName(item.name);
                      return (
                        <li key={`t-${key}`}>
                          <label className="flex cursor-pointer items-start gap-2 text-xs font-medium text-slate-800">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600"
                              checked={Boolean(tradingSelection[key])}
                              onChange={(e) =>
                                setTradingSelection((prev) => ({
                                  ...prev,
                                  [key]: e.target.checked,
                                }))
                              }
                            />
                            <span>
                              商社「{item.name}」
                              <span className="text-slate-500">
                                （行 {item.__lines?.join(', ')}）
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                ) : null}
              </div>
            ) : null}

            {preview.warnings?.length > 0 ? (
              <ul className="mt-3 max-h-28 overflow-y-auto rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-900">
                {preview.warnings.slice(0, 12).map((w, i) => (
                  <li key={i} className="list-disc ml-4">
                    {w}
                  </li>
                ))}
                {preview.warnings.length > 12 ? (
                  <li className="ml-4 text-amber-700">…他 {preview.warnings.length - 12} 件</li>
                ) : null}
              </ul>
            ) : null}

            {preview.skipped?.length > 0 ? (
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="text-xs font-black text-slate-600">スキップ行（{preview.skipped.length}）</p>
                <ul className="mt-1 max-h-24 overflow-y-auto text-xs text-slate-700">
                  {preview.skipped.slice(0, 8).map((s) => (
                    <li key={`${s.line}-${s.reason}`}>
                      行{s.line}: {s.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {previewColumns.length > 0 ? (
              <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[480px] border-collapse text-left text-xs">
                  <thead>
                    <tr className="bg-slate-50">
                      {previewColumns.map((col) => (
                        <th key={col.key} className="px-2 py-1.5 font-black text-slate-700">
                          {col.label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 8).map((row, i) => (
                      <tr key={row.__line ?? i} className="border-t border-slate-100">
                        {previewColumns.map((col) => (
                          <td key={col.key} className="px-2 py-1.5 text-slate-800">
                            {col.render ? (
                              col.render(row, {
                                renderNewBadge,
                                contractorSelection,
                                tradingSelection,
                              })
                            ) : (
                              <>
                                {String(row[col.key] ?? '—')}
                                {col.key === 'trading_company_name' &&
                                row.__unmatchedTradingCompanyName &&
                                tradingSelection[
                                  normalizeCompanyName(row.__unmatchedTradingCompanyName)
                                ]
                                  ? renderNewBadge(true)
                                  : null}
                              </>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {preview.rows.length > 8 ? (
                  <p className="border-t border-slate-100 px-2 py-1 text-[10px] text-slate-500">
                    …ほか {preview.rows.length - 8} 件
                  </p>
                ) : null}
              </div>
            ) : null}

            {error ? (
              <p className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800" role="alert">
                {error}
              </p>
            ) : null}

            <div className="mt-5 grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={closePreview}
                className="min-h-[44px] rounded-xl border-2 border-slate-300 bg-white text-sm font-black text-slate-800"
              >
                キャンセル
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleConfirm}
                className="min-h-[44px] rounded-xl bg-emerald-600 text-sm font-black text-white disabled:opacity-50"
              >
                {busy ? '登録中…' : '取り込む'}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
