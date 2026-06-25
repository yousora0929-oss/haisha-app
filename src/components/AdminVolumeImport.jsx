import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  if (volumeM3 == null) return '—';
  return `${volumeM3.toLocaleString('ja-JP', { maximumFractionDigits: 1 })} m³`;
}

/**
 * 管理画面 — 当月出荷量 CSV インポート
 */
export function AdminVolumeImport() {
  const fileInputRef = useRef(null);
  const [csvText, setCsvText] = useState('');
  const [previewRows, setPreviewRows] = useState([]);
  const [nameToIdMap, setNameToIdMap] = useState({});
  const [importing, setImporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [mapLoading, setMapLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setMapLoading(true);
      setError('');
      try {
        const map = await db.fetchFactoryNameToIdMap();
        if (!cancelled) setNameToIdMap(map);
      } catch (e) {
        console.error('[AdminVolumeImport] fetchFactoryNameToIdMap failed', e);
        if (!cancelled) setError(e?.message || '工場マスタの取得に失敗しました');
      } finally {
        if (!cancelled) setMapLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const runPreview = useCallback(
    (text) => {
      const rows = parseCsvToPreviewRows(text, nameToIdMap);
      setPreviewRows(rows);
      return rows;
    },
    [nameToIdMap],
  );

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

  const matchedRows = previewRows.filter((row) => row.matched);
  const skippedRows = previewRows.filter((row) => !row.matched);

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

  return (
    <div>
      <h2 className="text-lg font-black text-gray-900 dark:text-white">📥 当月出荷量 CSVインポート</h2>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        工場名と当月出荷量（m³）の CSV を取り込み、エスカレーション優先度スコアリングに反映します。
      </p>

      {error ? (
        <p
          className="mt-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800 dark:border-red-800 dark:bg-red-950/50 dark:text-red-200"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
          role="status"
        >
          {notice}
        </p>
      ) : null}

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
          disabled={mapLoading || importing}
          className="rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm font-black text-indigo-900 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-200 dark:hover:bg-indigo-900/50"
        >
          CSVファイルを選択
        </button>
        <p className="text-xs text-slate-500 dark:text-slate-400">または下記に貼り付け</p>
        <textarea
          value={csvText}
          onChange={handleCsvTextChange}
          rows={6}
          placeholder={'factory_name,monthly_volume_m3\n山田生コン,1250.5\n東洋コンクリート,980'}
          disabled={mapLoading || importing}
          className="w-full rounded-xl border border-gray-200 bg-white p-3 font-mono text-sm text-gray-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:focus:border-indigo-500"
        />
        <button
          type="button"
          onClick={handlePreviewClick}
          disabled={mapLoading || importing || !csvText.trim()}
          className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-bold text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:hover:bg-gray-600"
        >
          プレビュー確認
        </button>
      </div>

      {mapLoading ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">工場マスタを読み込み中…</p>
      ) : previewRows.length > 0 ? (
        <div className="mt-6 space-y-3">
          <h3 className="text-sm font-black text-gray-900 dark:text-white">▼ プレビュー（解析結果）</h3>
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
                ⚠️ 不明な工場: &quot;{row.factoryName}&quot;（スキップされます）
              </li>
            ))}
          </ul>
          <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
            マッチ: {matchedRows.length}件 / スキップ: {skippedRows.length}件
          </p>
          {matchedRows.length > 0 ? (
            <button
              type="button"
              onClick={() => void handleImport()}
              disabled={importing}
              className="rounded-xl bg-indigo-600 px-6 py-3 text-sm font-black text-white shadow-md hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {importing ? 'インポート中…' : 'この内容でインポート'}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
