import React, { useRef, useState } from 'react';

/**
 * 管理画面 — CSV一括取込（プレビュー・確認ダイアログ付き）
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

  const resetInput = () => {
    if (inputRef.current) inputRef.current.value = '';
  };

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
      setError(err?.message || 'CSVの読み込みに失敗しました。');
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
    if (!window.confirm(`${count}${entityLabel}を検出しました。取り込みますか？${skippedNote}`)) {
      return;
    }

    setBusy(true);
    setError('');
    try {
      await onImport(preview);
      closePreview();
      onComplete?.();
    } catch (err) {
      setError(err?.message || '一括登録に失敗しました。');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
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
            <h3 className="text-lg font-black text-slate-900">CSV取込プレビュー</h3>
            <p className="mt-1 text-sm font-bold text-emerald-800">
              {preview.rows.length}
              {entityLabel}を登録できます
            </p>

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
                            {col.render ? col.render(row) : String(row[col.key] ?? '—')}
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
