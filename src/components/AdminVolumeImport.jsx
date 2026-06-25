import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as db from '../haishaDb.js';

function parseCsvToPreviewRows(text, nameToIdMap) {
  const lines = String(text || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  let start = 0;
  if (/factory_name/i.test(lines[0])) start = 1;

  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(',');
    const factoryName = String(parts[0] ?? '').trim();
    if (!factoryName) continue;

    const rawVol = String(parts[1] ?? '').trim();
    const parsed = parseFloat(rawVol);
    const volumeM3 = Number.isFinite(parsed) ? parsed : null;
    const factoryId = nameToIdMap[factoryName] ?? null;

    rows.push({
      factoryName,
      volumeM3,
      factoryId,
      matched: factoryId != null,
    });
  }
  return rows;
}

function formatVolume(volumeM3) {
  if (volumeM3 == null) return null;
  return `${volumeM3.toLocaleString('ja-JP', { maximumFractionDigits: 1 })} m³`;
}

function formatUpdatedAt(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('ja-JP');
}

/**
 * 管理画面 — 当月出荷量 CSV インポート & 全工場一覧
 */
export function AdminVolumeImport() {
  const fileInputRef = useRef(null);
  const editInputRef = useRef(null);
  const savingRef = useRef(false);

  const [csvText, setCsvText] = useState('');
  const [previewRows, setPreviewRows] = useState([]);
  const [summaryRows, setSummaryRows] = useState([]);
  const [nameToIdMap, setNameToIdMap] = useState({});
  const [editingId, setEditingId] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [initialLoading, setInitialLoading] = useState(true);
  const [summaryReloading, setSummaryReloading] = useState(false);

  const loadSummary = useCallback(async () => {
    const rows = await db.fetchVolumesSummary();
    setSummaryRows(rows);
    return rows;
  }, []);

  const loadInitial = useCallback(async () => {
    setInitialLoading(true);
    setError('');
    try {
      const [map, summary] = await Promise.all([
        db.fetchFactoryNameToIdMap(),
        db.fetchVolumesSummary(),
      ]);
      setNameToIdMap(map);
      setSummaryRows(summary);
    } catch (e) {
      console.error('[AdminVolumeImport] init failed', e);
      setError(e?.message || 'データの取得に失敗しました');
    } finally {
      setInitialLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadInitial();
  }, [loadInitial]);

  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const runPreview = useCallback(
    (text) => {
      const rows = parseCsvToPreviewRows(text, nameToIdMap);
      setPreviewRows(rows);
      return rows;
    },
    [nameToIdMap],
  );

  const sortedSummaryRows = useMemo(
    () =>
      [...summaryRows].sort((a, b) =>
        String(a.factoryName || '').localeCompare(String(b.factoryName || ''), 'ja'),
      ),
    [summaryRows],
  );

  const matchedRows = previewRows.filter((row) => row.matched);
  const skippedRows = previewRows.filter((row) => !row.matched);

  const handleCsvTextChange = (e) => {
    setCsvText(e.target.value);
    setNotice('');
    setError('');
  };

  const handlePreviewClick = () => {
    setNotice('');
    setError('');
    runPreview(csvText);
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;

    setNotice('');
    setError('');
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result ?? '');
      setCsvText(text);
      runPreview(text);
    };
    reader.onerror = () => {
      setError('CSVファイルの読み込みに失敗しました');
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleImport = async () => {
    if (!matchedRows.length) return;
    setImporting(true);
    setError('');
    setNotice('');
    try {
      await db.bulkSaveMonthlyVolumes(
        matchedRows.map((row) => ({
          factoryId: row.factoryId,
          volumeM3: row.volumeM3,
        })),
      );
      await loadSummary();
      setNotice(`${matchedRows.length}件の工場の出荷量を更新しました`);
      setCsvText('');
      setPreviewRows([]);
      window.setTimeout(() => setNotice(''), 5000);
    } catch (e) {
      console.error('[AdminVolumeImport] import failed', e);
      setError(e?.message || 'インポートに失敗しました');
    } finally {
      setImporting(false);
    }
  };

  const handleReloadSummary = async () => {
    setSummaryReloading(true);
    setError('');
    try {
      await loadSummary();
      setNotice('出荷量一覧を再読み込みしました');
      window.setTimeout(() => setNotice(''), 3000);
    } catch (e) {
      console.error('[AdminVolumeImport] reload failed', e);
      setError(e?.message || '再読み込みに失敗しました');
    } finally {
      setSummaryReloading(false);
    }
  };

  const startInlineEdit = (row) => {
    setEditingId(row.factoryId);
    setEditingValue(row.monthlyVolumeM3 != null ? String(row.monthlyVolumeM3) : '');
    setError('');
  };

  const cancelInlineEdit = () => {
    setEditingId(null);
    setEditingValue('');
  };

  const commitInlineEdit = async (factoryId) => {
    if (savingRef.current || editingId !== factoryId) return;

    const raw = editingValue.trim();
    const parsed = raw === '' ? null : Number(raw);
    if (raw !== '' && (!Number.isFinite(parsed) || parsed < 0)) {
      setError('出荷量は 0 以上の数値で入力してください');
      return;
    }

    savingRef.current = true;
    setError('');
    try {
      await db.updateMonthlyVolume(factoryId, parsed);
      const nowIso = new Date().toISOString();
      setSummaryRows((prev) =>
        prev.map((row) =>
          row.factoryId === factoryId
            ? { ...row, monthlyVolumeM3: parsed, volumeUpdatedAt: nowIso }
            : row,
        ),
      );
      setEditingId(null);
      setEditingValue('');
    } catch (e) {
      console.error('[AdminVolumeImport] inline update failed', e);
      setError(e?.message || '出荷量の更新に失敗しました');
    } finally {
      savingRef.current = false;
    }
  };

  const handleEditKeyDown = (e, factoryId) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancelInlineEdit();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      void commitInlineEdit(factoryId);
    }
  };

  return (
    <div className="space-y-10">
      {error ? (
        <p
          className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      {/* 上ブロック: CSVインポート */}
      <section className="rounded-xl border border-gray-200 bg-slate-50/50 p-4 dark:border-gray-700 dark:bg-slate-900/30 sm:p-5">
        <h2 className="text-lg font-black text-gray-900 dark:text-white">📥 CSVインポート</h2>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          フォーマット: <span className="font-mono">factory_name,monthly_volume_m3</span>
        </p>

        <div className="mt-4 space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={initialLoading || importing}
            className="rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-black text-indigo-900 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-200 dark:hover:bg-indigo-900/50"
          >
            CSVファイルを選択
          </button>
          <textarea
            value={csvText}
            onChange={handleCsvTextChange}
            rows={5}
            placeholder={'factory_name,monthly_volume_m3\n山田生コン,1250.5\n東洋コンクリート,980'}
            disabled={initialLoading || importing}
            className="w-full rounded-xl border border-gray-200 bg-white p-3 font-mono text-sm text-gray-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:focus:border-indigo-500"
          />
          <button
            type="button"
            onClick={handlePreviewClick}
            disabled={initialLoading || importing || !csvText.trim()}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
          >
            プレビュー確認
          </button>
        </div>

        {previewRows.length > 0 ? (
          <div className="mt-6 space-y-3">
            <h3 className="text-sm font-black text-gray-900 dark:text-white">
              ▼ プレビュー結果（インポート前確認）
            </h3>
            <ul className="space-y-2">
              {matchedRows.map((row) => (
                <li
                  key={`ok-${row.factoryName}`}
                  className="rounded-lg bg-green-50 px-3 py-2 text-sm font-medium text-green-700 dark:bg-green-950/40 dark:text-green-300"
                >
                  ✅ {row.factoryName} → {formatVolume(row.volumeM3)}
                </li>
              ))}
              {skippedRows.map((row) => (
                <li
                  key={`skip-${row.factoryName}`}
                  className="rounded-lg bg-yellow-50 px-3 py-2 text-sm font-medium text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300"
                >
                  ⚠️ 不明な工場: &quot;{row.factoryName}&quot;（スキップ）
                </li>
              ))}
            </ul>
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
              マッチ {matchedRows.length}件 / スキップ {skippedRows.length}件
            </p>
            {matchedRows.length > 0 ? (
              <button
                type="button"
                onClick={() => void handleImport()}
                disabled={importing}
                className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-black text-white shadow-md hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {importing ? 'インポート中…' : 'この内容でインポート'}
              </button>
            ) : null}
          </div>
        ) : null}
      </section>

      {/* 下ブロック: 全工場出荷量一覧 */}
      <section>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-black text-gray-900 dark:text-white">📊 全工場 当月出荷量一覧</h2>
          <button
            type="button"
            onClick={() => void handleReloadSummary()}
            disabled={initialLoading || summaryReloading}
            className="text-sm font-bold text-gray-500 hover:text-gray-700 disabled:opacity-50 dark:text-gray-400 dark:hover:text-gray-200"
          >
            {summaryReloading ? '読み込み中…' : '🔄 再読み込み'}
          </button>
        </div>

        {initialLoading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">読み込み中…</p>
        ) : sortedSummaryRows.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            エスカレーション設定が登録されている工場がありません。
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
            <table className="min-w-full border-collapse text-left text-sm">
              <thead>
                <tr className="bg-gray-100 text-xs uppercase text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                  <th className="px-4 py-3 font-bold">工場名</th>
                  <th className="px-4 py-3 font-bold">当月出荷量</th>
                  <th className="px-4 py-3 font-bold">最終更新</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {sortedSummaryRows.map((row) => {
                  const isEditing = editingId === row.factoryId;
                  const volumeLabel = formatVolume(row.monthlyVolumeM3);
                  const updatedLabel = formatUpdatedAt(row.volumeUpdatedAt);

                  return (
                    <tr key={row.factoryId} className="bg-white dark:bg-slate-900/50">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                        {row.factoryName}
                      </td>
                      <td className="px-4 py-3">
                        {isEditing ? (
                          <input
                            ref={editInputRef}
                            type="number"
                            min={0}
                            step={0.5}
                            value={editingValue}
                            onChange={(e) => setEditingValue(e.target.value)}
                            onKeyDown={(e) => handleEditKeyDown(e, row.factoryId)}
                            onBlur={() => void commitInlineEdit(row.factoryId)}
                            className="w-28 rounded border border-indigo-300 bg-white px-2 py-1 text-sm font-bold text-gray-900 ring-2 ring-indigo-500 outline-none dark:border-indigo-600 dark:bg-gray-800 dark:text-white"
                            aria-label={`${row.factoryName} の当月出荷量`}
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => startInlineEdit(row)}
                            className="cursor-pointer rounded px-1 py-0.5 text-left hover:bg-indigo-50 dark:hover:bg-indigo-950/30"
                            title="クリックして編集"
                          >
                            {volumeLabel != null ? (
                              <span className="font-medium text-gray-900 dark:text-white">{volumeLabel}</span>
                            ) : (
                              <span className="text-gray-400">─</span>
                            )}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {updatedLabel != null ? (
                          <span className="text-gray-700 dark:text-gray-300">{updatedLabel}</span>
                        ) : (
                          <span className="text-gray-400">─</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
