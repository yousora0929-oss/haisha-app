import React, { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeCompanyName } from '../utils/csvImport.js';
import { collectNewEntitiesFromProjectRows } from '../utils/adminCsvImport.js';

function buildDefaultSelection(items) {
  const map = {};
  for (const item of items || []) {
    const key = normalizeCompanyName(item?.name);
    if (key) map[key] = true;
  }
  return map;
}

function cloneRows(rows) {
  try {
    return structuredClone(rows || []);
  } catch {
    return JSON.parse(JSON.stringify(rows || []));
  }
}

/**
 * 管理画面 — CSV/Excel一括取込（プレビュー・確認ダイアログ付き）
 *
 * previewColumns の各列:
 * - key, label
 * - editable?: boolean
 * - editType?: 'text' | 'select'
 * - options?: { value: string, label: string }[] | ((row) => options)
 * - getValue?: (row) => string
 * - applyValue?: (row, value) => object  // 編集後の行を返す（再解決など）
 * - render?: (row, ctx) => ReactNode  // 非編集時、または editable でも補助表示
 */
export function AdminCsvImportButton({
  label = 'CSV一括取込',
  disabled = false,
  parseFile,
  entityLabel = '件',
  previewColumns = [],
  onImport,
  onComplete,
  /** 物件取込などで全行を編集可能にする */
  editablePreview = false,
}) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [editedRows, setEditedRows] = useState([]);
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
      setEditedRows([]);
      return;
    }
    setContractorSelection(buildDefaultSelection(preview.newContractors));
    setTradingSelection(buildDefaultSelection(preview.newTradingCompanies));
    setEditedRows(cloneRows(preview.rows));
  }, [preview]);

  const newEntities = useMemo(() => {
    if (!preview) return { newContractors: [], newTradingCompanies: [] };
    if (editablePreview) return collectNewEntitiesFromProjectRows(editedRows);
    return {
      newContractors: preview.newContractors || [],
      newTradingCompanies: preview.newTradingCompanies || [],
    };
  }, [preview, editablePreview, editedRows]);

  const newContractorCount = newEntities.newContractors.length;
  const newTradingCount = newEntities.newTradingCompanies.length;
  const selectedContractorCount = useMemo(
    () =>
      newEntities.newContractors.filter(
        (item) => contractorSelection[normalizeCompanyName(item.name)] !== false,
      ).length,
    [newEntities, contractorSelection],
  );
  const selectedTradingCount = useMemo(
    () =>
      newEntities.newTradingCompanies.filter(
        (item) => tradingSelection[normalizeCompanyName(item.name)] !== false,
      ).length,
    [newEntities, tradingSelection],
  );

  const displayRows = editablePreview ? editedRows : preview?.rows || [];

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
    setEditedRows([]);
    setError('');
  };

  const updateEditedRow = (index, updater) => {
    setEditedRows((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) return prev;
      next[index] = typeof updater === 'function' ? updater(current) : { ...current, ...updater };
      return next;
    });
  };

  const handleConfirm = async () => {
    const rowsForImport = editablePreview ? editedRows : preview?.rows;
    if (!rowsForImport?.length) return;

    // 物件名必須の再チェック
    const emptyName = rowsForImport.find((r) => !String(r?.name || '').trim());
    if (emptyName) {
      setError(`行${emptyName.__line ?? '?'}：物件名が空です。プレビューで入力してください。`);
      return;
    }
    if (editablePreview) {
      const missingFactory = rowsForImport.find((r) => !String(r?.main_factory_id || '').trim());
      if (missingFactory) {
        setError(
          `行${missingFactory.__line ?? '?'}：メイン工場が未設定です。工場名を選択してください。`,
        );
        return;
      }
    }

    const count = rowsForImport.length;
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

    const registerContractorKeys = { ...contractorSelection };
    const registerTradingCompanyKeys = { ...tradingSelection };
    for (const item of newEntities.newContractors) {
      const key = normalizeCompanyName(item.name);
      if (key && registerContractorKeys[key] === undefined) registerContractorKeys[key] = true;
    }
    for (const item of newEntities.newTradingCompanies) {
      const key = normalizeCompanyName(item.name);
      if (key && registerTradingCompanyKeys[key] === undefined) registerTradingCompanyKeys[key] = true;
    }

    setBusy(true);
    setError('');
    try {
      await onImport({
        ...preview,
        rows: rowsForImport,
        newContractors: newEntities.newContractors,
        newTradingCompanies: newEntities.newTradingCompanies,
        registerContractorKeys,
        registerTradingCompanyKeys,
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

  const renderCell = (col, row, rowIndex) => {
    const ctx = {
      renderNewBadge,
      contractorSelection,
      tradingSelection,
    };
    if (editablePreview && col.editable) {
      const value =
        typeof col.getValue === 'function' ? col.getValue(row) : String(row[col.key] ?? '');
      const options =
        typeof col.options === 'function' ? col.options(row) : col.options || [];
      const editType = typeof col.editType === 'function' ? col.editType(row) : col.editType;
      const apply = (nextVal) => {
        updateEditedRow(rowIndex, (prev) => {
          if (typeof col.applyValue === 'function') return col.applyValue(prev, nextVal);
          return { ...prev, [col.key]: nextVal };
        });
      };
      const showNew =
        (col.key === 'trading_company_name' &&
          row.__unmatchedTradingCompanyName &&
          tradingSelection[normalizeCompanyName(row.__unmatchedTradingCompanyName)] !== false) ||
        (col.key === 'contractor' &&
          row.__unmatchedContractorName &&
          contractorSelection[normalizeCompanyName(row.__unmatchedContractorName)] !== false);
      const control =
        editType === 'select' ? (
          <select
            className="min-h-[32px] w-full min-w-[7rem] rounded border border-slate-300 bg-white px-1 py-0.5 text-xs text-slate-900"
            value={value}
            onChange={(e) => apply(e.target.value)}
          >
            {(options || []).map((opt) => (
              <option key={String(opt.value)} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            className="min-h-[32px] w-full min-w-[6rem] rounded border border-slate-300 bg-white px-1.5 py-0.5 text-xs text-slate-900"
            value={value}
            placeholder={col.placeholder || ''}
            onChange={(e) => apply(e.target.value)}
          />
        );
      return (
        <>
          {control}
          {showNew ? renderNewBadge(true) : null}
        </>
      );
    }
    if (col.render) return col.render(row, ctx);
    return (
      <>
        {String(row[col.key] ?? '—')}
        {col.key === 'trading_company_name' &&
        row.__unmatchedTradingCompanyName &&
        tradingSelection[normalizeCompanyName(row.__unmatchedTradingCompanyName)] !== false
          ? renderNewBadge(true)
          : null}
      </>
    );
  };

  const previewLimit = editablePreview ? displayRows.length : Math.min(8, displayRows.length);

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
            className="max-h-[90vh] w-full max-w-7xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl"
          >
            <h3 className="text-lg font-black text-slate-900">取込プレビュー</h3>
            <p className="mt-1 text-sm font-bold text-emerald-800">
              {displayRows.length}
              {entityLabel}を登録できます
              {editablePreview ? (
                <span className="ml-2 text-xs font-bold text-slate-600">（セルを編集してから取り込めます）</span>
              ) : null}
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
                    {newEntities.newContractors.map((item) => {
                      const key = normalizeCompanyName(item.name);
                      return (
                        <li key={`c-${key}`}>
                          <label className="flex cursor-pointer items-start gap-2 text-xs font-medium text-slate-800">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600"
                              checked={contractorSelection[key] !== false}
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
                    {newEntities.newTradingCompanies.map((item) => {
                      const key = normalizeCompanyName(item.name);
                      return (
                        <li key={`t-${key}`}>
                          <label className="flex cursor-pointer items-start gap-2 text-xs font-medium text-slate-800">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600"
                              checked={tradingSelection[key] !== false}
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
                <table className="w-full min-w-[1100px] border-collapse text-left text-xs">
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
                    {displayRows.slice(0, previewLimit).map((row, i) => (
                      <tr key={row.__line ?? i} className="border-t border-slate-100 align-top">
                        {previewColumns.map((col) => (
                          <td key={col.key} className="px-2 py-1.5 text-slate-800">
                            {renderCell(col, row, i)}
                            {col.key === 'name' && Array.isArray(row.__rowNotes) && row.__rowNotes.length > 0 ? (
                              <ul className="mt-1 space-y-0.5 text-[10px] font-bold text-amber-800">
                                {row.__rowNotes.map((n) => (
                                  <li key={n}>{n}</li>
                                ))}
                              </ul>
                            ) : null}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!editablePreview && (preview.rows?.length || 0) > 8 ? (
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
