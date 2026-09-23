import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { getStrengthOptions, normalizePriceList } from '../../lib/cashPriceCalc.js';

const SLUMP_DEFAULTS = ['8', '12～15', '15', '18', '21'];

function toIntOrNull(raw) {
  if (raw === '' || raw == null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return NaN;
  return Math.trunc(n);
}

function newAreaCode(existing) {
  const used = new Set((existing || []).map((a) => String(a.code || '')));
  let i = 1;
  while (used.has(`area_${i}`)) i += 1;
  return `area_${i}`;
}

function buildGridFromPrices(basePrices) {
  const strengths = new Set();
  const slumps = new Set();
  const cells = { AE: {}, HP: {} };
  for (const p of basePrices || []) {
    strengths.add(p.strength);
    slumps.add(p.slump);
    const key = `${p.strength}|${p.slump}`;
    cells[p.admixture === 'HP' ? 'HP' : 'AE'][key] = String(p.price);
  }
  const strengthRows = [...strengths].sort((a, b) => a - b);
  const slumpCols = [...slumps].sort((a, b) => {
    const na = Number(String(a).match(/(\d+)/)?.[1] || Infinity);
    const nb = Number(String(b).match(/(\d+)/)?.[1] || Infinity);
    return na - nb || String(a).localeCompare(String(b), 'ja');
  });
  return {
    strengthRows: strengthRows.length ? strengthRows : [18, 21, 24],
    slumpCols: slumpCols.length ? slumpCols : [...SLUMP_DEFAULTS],
    cells,
  };
}

function pricesFromGrid(strengthRows, slumpCols, cells) {
  const out = [];
  for (const ad of ['AE', 'HP']) {
    for (const s of strengthRows) {
      for (const sl of slumpCols) {
        const raw = cells[ad]?.[`${s}|${sl}`];
        if (raw === '' || raw == null) continue;
        const price = toIntOrNull(raw);
        if (!Number.isFinite(price) || price <= 0) continue;
        out.push({ strength: Number(s), slump: String(sl), admixture: ad, price });
      }
    }
  }
  return out;
}

/**
 * 窓口価格表エディタ（管理者のみ）
 * @param {{ supabase: object, onSaved?: (priceList: object) => void }} props
 */
export function CashPriceListEditor({ supabase, onSaved }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [rowId, setRowId] = useState('');
  const [name, setName] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [smallSurcharge, setSmallSurcharge] = useState('4000');
  const [bbDiscount, setBbDiscount] = useState('100');
  const [largeBaseLoad, setLargeBaseLoad] = useState('3');
  const [smallBaseLoad, setSmallBaseLoad] = useState('1.5');
  const [emptyLoadRate, setEmptyLoadRate] = useState('1000');
  const [taxPercent, setTaxPercent] = useState('10');
  const [areas, setAreas] = useState([]);
  const [strengthRows, setStrengthRows] = useState([18, 21, 24]);
  const [slumpCols, setSlumpCols] = useState([...SLUMP_DEFAULTS]);
  const [cells, setCells] = useState({ AE: {}, HP: {} });
  const [newStrength, setNewStrength] = useState('');
  const [newSlump, setNewSlump] = useState('');

  const applyRow = useCallback((normalized) => {
    setRowId(normalized.id);
    setName(normalized.name);
    setEffectiveFrom(normalized.effective_from || '');
    setSmallSurcharge(String(normalized.small_vehicle_surcharge));
    setBbDiscount(String(normalized.bb_discount));
    setLargeBaseLoad(String(normalized.large_base_load));
    setSmallBaseLoad(String(normalized.small_base_load));
    setEmptyLoadRate(String(normalized.empty_load_rate));
    setTaxPercent(String(Math.round(normalized.tax_rate * 1000) / 10));
    setAreas(
      (normalized.area_surcharges || []).map((a) => ({
        code: a.code,
        label: a.label,
        amount: String(a.amount),
      })),
    );
    const grid = buildGridFromPrices(normalized.base_prices);
    setStrengthRows(grid.strengthRows);
    setSlumpCols(grid.slumpCols);
    setCells(grid.cells);
  }, []);

  const load = useCallback(async () => {
    if (!supabase) {
      setError('接続できません');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const { data, error: fetchErr } = await supabase
        .from('cash_price_lists')
        .select('*')
        .eq('is_active', true)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      const normalized = normalizePriceList(data);
      if (!normalized?.id) {
        setError('有効な価格表が登録されていません');
        return;
      }
      applyRow(normalized);
    } catch (e) {
      console.error('cash_price_lists editor fetch', e);
      setError(e?.message || '価格表の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, [supabase, applyRow]);

  useEffect(() => {
    void load();
  }, [load]);

  const setCell = (admixture, strength, slump, value) => {
    const key = `${strength}|${slump}`;
    setCells((prev) => ({
      ...prev,
      [admixture]: { ...prev[admixture], [key]: value },
    }));
  };

  const addStrength = () => {
    const n = Number(newStrength);
    if (!Number.isFinite(n) || n <= 0) {
      setError('呼び強度は正の数値で入力してください');
      return;
    }
    if (strengthRows.includes(n)) {
      setError('その呼び強度は既にあります');
      return;
    }
    setStrengthRows((prev) => [...prev, n].sort((a, b) => a - b));
    setNewStrength('');
    setError('');
  };

  const removeStrength = (s) => {
    setStrengthRows((prev) => prev.filter((x) => x !== s));
    setCells((prev) => {
      const next = { AE: { ...prev.AE }, HP: { ...prev.HP } };
      for (const sl of slumpCols) {
        delete next.AE[`${s}|${sl}`];
        delete next.HP[`${s}|${sl}`];
      }
      return next;
    });
  };

  const addSlump = () => {
    const sl = String(newSlump || '').trim();
    if (!sl) {
      setError('スランプを入力してください');
      return;
    }
    if (slumpCols.includes(sl)) {
      setError('そのスランプは既にあります');
      return;
    }
    setSlumpCols((prev) => [...prev, sl]);
    setNewSlump('');
    setError('');
  };

  const removeSlump = (sl) => {
    setSlumpCols((prev) => prev.filter((x) => x !== sl));
    setCells((prev) => {
      const next = { AE: { ...prev.AE }, HP: { ...prev.HP } };
      for (const s of strengthRows) {
        delete next.AE[`${s}|${sl}`];
        delete next.HP[`${s}|${sl}`];
      }
      return next;
    });
  };

  const validate = () => {
    const base_prices = pricesFromGrid(strengthRows, slumpCols, cells);
    if (!base_prices.length) return '基準価格を1件以上入力してください';

    const seen = new Set();
    for (const p of base_prices) {
      const key = `${p.strength}|${p.slump}|${p.admixture}`;
      if (seen.has(key)) return '同一（呼び強度・スランプ・混和剤）の重複があります';
      seen.add(key);
      if (!Number.isInteger(p.price) || p.price <= 0) return '基準価格は0より大きい整数にしてください';
    }

    // also reject non-empty invalid cells
    for (const ad of ['AE', 'HP']) {
      for (const s of strengthRows) {
        for (const sl of slumpCols) {
          const raw = cells[ad]?.[`${s}|${sl}`];
          if (raw === '' || raw == null) continue;
          const price = toIntOrNull(raw);
          if (!Number.isFinite(price) || price <= 0 || !Number.isInteger(price)) {
            return '基準価格は0より大きい整数にしてください（空欄＝その配合なし）';
          }
        }
      }
    }

    if (!areas.length) return '地区を1件以上登録してください';
    for (const a of areas) {
      if (!String(a.label || '').trim()) return '地区の名称は空欄にできません';
      const amt = toIntOrNull(a.amount);
      if (!Number.isFinite(amt) || amt < 0 || !Number.isInteger(amt)) {
        return '地区加算額は0以上の整数にしてください';
      }
    }

    const small = toIntOrNull(smallSurcharge);
    const bb = toIntOrNull(bbDiscount);
    const empty = toIntOrNull(emptyLoadRate);
    if (![small, bb, empty].every((n) => Number.isFinite(n) && n >= 0 && Number.isInteger(n))) {
      return '小型加算・高炉値引・空積単価は0以上の整数にしてください';
    }

    const largeLoad = Number(largeBaseLoad);
    const smallLoad = Number(smallBaseLoad);
    if (!(largeLoad > 0) || !(smallLoad > 0)) return '基準積載量は0より大きくしてください';

    const taxP = Number(taxPercent);
    if (!Number.isFinite(taxP) || taxP < 0) return '税率を確認してください';

    if (!String(name || '').trim()) return '名称を入力してください';
    if (!String(effectiveFrom || '').trim()) return '適用開始日を入力してください';

    return null;
  };

  const handleSave = async () => {
    const msg = validate();
    if (msg) {
      setError(msg);
      return;
    }
    if (!rowId) {
      setError('保存対象の価格表がありません');
      return;
    }
    setSaving(true);
    setError('');
    setToast('');
    try {
      const base_prices = pricesFromGrid(strengthRows, slumpCols, cells);
      const area_surcharges = areas.map((a) => ({
        code: a.code || newAreaCode(areas),
        label: String(a.label).trim(),
        amount: toIntOrNull(a.amount) || 0,
      }));
      const tax_rate = Math.round(Number(taxPercent) * 10) / 1000;
      const payload = {
        name: String(name).trim(),
        effective_from: String(effectiveFrom).slice(0, 10),
        base_prices,
        area_surcharges,
        small_vehicle_surcharge: toIntOrNull(smallSurcharge),
        bb_discount: toIntOrNull(bbDiscount),
        large_base_load: Number(largeBaseLoad),
        small_base_load: Number(smallBaseLoad),
        empty_load_rate: toIntOrNull(emptyLoadRate),
        tax_rate,
        updated_at: new Date().toISOString(),
      };
      const { data, error: upErr } = await supabase
        .from('cash_price_lists')
        .update(payload)
        .eq('id', rowId)
        .select('*')
        .maybeSingle();
      if (upErr) throw upErr;
      const normalized = normalizePriceList(data) || normalizePriceList({ ...payload, id: rowId, is_active: true });
      if (normalized) applyRow(normalized);
      setToast('価格表を保存しました');
      window.setTimeout(() => setToast(''), 3500);
      if (typeof onSaved === 'function') onSaved(normalized);
    } catch (e) {
      console.error('cash_price_lists save', e);
      setError(e?.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const strengthHint = useMemo(() => getStrengthOptions({ base_prices: pricesFromGrid(strengthRows, slumpCols, cells) }), [
    strengthRows,
    slumpCols,
    cells,
  ]);

  if (loading) {
    return <p className="py-6 text-sm font-bold text-slate-500">価格表を読み込み中…</p>;
  }

  return (
    <div className="space-y-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-700 dark:bg-slate-800 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-900 dark:text-slate-100">窓口価格表の編集</h3>
          <p className="mt-1 text-xs text-slate-500">アクティブな価格表を直接更新します（版の複製はしません）</p>
          {strengthHint.length ? (
            <p className="mt-1 text-[11px] text-slate-400">登録強度: {strengthHint.join(', ')}</p>
          ) : null}
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleSave()}
          className="min-h-[44px] rounded-xl border-2 border-indigo-600 bg-indigo-600 px-5 text-sm font-black text-white shadow-sm hover:bg-indigo-700 disabled:opacity-50"
        >
          {saving ? '保存中…' : '保存'}
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border-2 border-red-300 bg-red-50 px-3 py-2 text-sm font-bold text-red-800">{error}</p>
      ) : null}
      {toast ? (
        <p className="rounded-lg border-2 border-emerald-400 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-800">
          {toast}
        </p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="block text-xs font-bold text-slate-600">
          名称
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-300 px-3 text-sm font-semibold"
          />
        </label>
        <label className="block text-xs font-bold text-slate-600">
          適用開始日
          <input
            type="date"
            value={effectiveFrom}
            onChange={(e) => setEffectiveFrom(e.target.value)}
            className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-300 px-3 text-sm font-semibold"
          />
        </label>
        <label className="block text-xs font-bold text-slate-600">
          税率（%）
          <input
            type="number"
            step="0.1"
            value={taxPercent}
            onChange={(e) => setTaxPercent(e.target.value)}
            className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-300 px-3 text-sm font-semibold"
          />
        </label>
        <label className="block text-xs font-bold text-slate-600">
          小型加算（円/㎥）
          <input
            type="number"
            value={smallSurcharge}
            onChange={(e) => setSmallSurcharge(e.target.value)}
            className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-300 px-3 text-sm font-semibold"
          />
        </label>
        <label className="block text-xs font-bold text-slate-600">
          高炉値引（円/㎥）
          <input
            type="number"
            value={bbDiscount}
            onChange={(e) => setBbDiscount(e.target.value)}
            className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-300 px-3 text-sm font-semibold"
          />
        </label>
        <label className="block text-xs font-bold text-slate-600">
          空積単価（円/㎥）
          <input
            type="number"
            value={emptyLoadRate}
            onChange={(e) => setEmptyLoadRate(e.target.value)}
            className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-300 px-3 text-sm font-semibold"
          />
        </label>
        <label className="block text-xs font-bold text-slate-600">
          大型基準積載（㎥）
          <input
            type="number"
            step="0.01"
            value={largeBaseLoad}
            onChange={(e) => setLargeBaseLoad(e.target.value)}
            className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-300 px-3 text-sm font-semibold"
          />
        </label>
        <label className="block text-xs font-bold text-slate-600">
          小型基準積載（㎥）
          <input
            type="number"
            step="0.01"
            value={smallBaseLoad}
            onChange={(e) => setSmallBaseLoad(e.target.value)}
            className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-300 px-3 text-sm font-semibold"
          />
        </label>
      </div>

      {['AE', 'HP'].map((ad) => (
        <div key={ad} className="overflow-x-auto">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-black text-slate-800">
              基準価格 — {ad === 'HP' ? '高性能（HP）' : 'AE'}
            </h4>
            <p className="text-[11px] text-slate-400">空欄＝その配合なし</p>
          </div>
          <table className="min-w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="border border-slate-200 bg-slate-100 px-2 py-2 text-left text-xs font-black">
                  呼び強度＼スランプ
                </th>
                {slumpCols.map((sl) => (
                  <th key={sl} className="border border-slate-200 bg-slate-100 px-2 py-2 text-center text-xs font-black">
                    <div className="flex flex-col items-center gap-1">
                      <span>{sl}</span>
                      <button
                        type="button"
                        onClick={() => removeSlump(sl)}
                        className="text-[10px] font-bold text-red-600 hover:underline"
                      >
                        列削除
                      </button>
                    </div>
                  </th>
                ))}
                <th className="border border-slate-200 bg-slate-50 px-2 py-2 text-xs">操作</th>
              </tr>
            </thead>
            <tbody>
              {strengthRows.map((s) => (
                <tr key={`${ad}-${s}`}>
                  <td className="border border-slate-200 bg-slate-50 px-2 py-1 text-center font-black">{s}</td>
                  {slumpCols.map((sl) => (
                    <td key={`${ad}-${s}-${sl}`} className="border border-slate-200 p-1">
                      <input
                        type="number"
                        inputMode="numeric"
                        value={cells[ad]?.[`${s}|${sl}`] ?? ''}
                        onChange={(e) => setCell(ad, s, sl, e.target.value)}
                        className="min-h-[40px] w-24 rounded border border-slate-300 px-2 text-right text-sm font-semibold tabular-nums"
                        placeholder="—"
                      />
                    </td>
                  ))}
                  <td className="border border-slate-200 px-2 py-1 text-center">
                    <button
                      type="button"
                      onClick={() => removeStrength(s)}
                      className="text-[11px] font-bold text-red-600 hover:underline"
                    >
                      行削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-3">
        <label className="text-xs font-bold text-slate-600">
          呼び強度を追加
          <input
            type="number"
            value={newStrength}
            onChange={(e) => setNewStrength(e.target.value)}
            className="mt-1 block min-h-[44px] w-28 rounded-lg border-2 border-slate-300 px-3 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={addStrength}
          className="min-h-[44px] rounded-lg border-2 border-slate-400 bg-white px-4 text-sm font-black"
        >
          行追加
        </button>
        <label className="text-xs font-bold text-slate-600">
          スランプを追加
          <input
            value={newSlump}
            onChange={(e) => setNewSlump(e.target.value)}
            placeholder="例: 12～15"
            className="mt-1 block min-h-[44px] w-36 rounded-lg border-2 border-slate-300 px-3 text-sm"
          />
        </label>
        <button
          type="button"
          onClick={addSlump}
          className="min-h-[44px] rounded-lg border-2 border-slate-400 bg-white px-4 text-sm font-black"
        >
          列追加
        </button>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-sm font-black text-slate-800">地区加算</h4>
          <button
            type="button"
            onClick={() =>
              setAreas((prev) => [
                ...prev,
                { code: newAreaCode(prev), label: '', amount: '0' },
              ])
            }
            className="min-h-[40px] rounded-lg border-2 border-slate-400 bg-white px-3 text-xs font-black"
          >
            地区を追加
          </button>
        </div>
        <div className="space-y-2">
          {areas.map((a, idx) => (
            <div key={a.code || idx} className="flex flex-wrap items-center gap-2">
              <input
                value={a.label}
                onChange={(e) =>
                  setAreas((prev) =>
                    prev.map((row, i) => (i === idx ? { ...row, label: e.target.value } : row)),
                  )
                }
                placeholder="地区名"
                className="min-h-[44px] min-w-[160px] flex-1 rounded-lg border-2 border-slate-300 px-3 text-sm font-semibold"
              />
              <input
                type="number"
                value={a.amount}
                onChange={(e) =>
                  setAreas((prev) =>
                    prev.map((row, i) => (i === idx ? { ...row, amount: e.target.value } : row)),
                  )
                }
                className="min-h-[44px] w-28 rounded-lg border-2 border-slate-300 px-3 text-right text-sm font-semibold"
              />
              <span className="text-xs font-bold text-slate-500">円/㎥</span>
              <button
                type="button"
                onClick={() => setAreas((prev) => prev.filter((_, i) => i !== idx))}
                className="min-h-[44px] rounded-lg border-2 border-red-300 bg-red-50 px-3 text-xs font-black text-red-700"
              >
                削除
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default CashPriceListEditor;
