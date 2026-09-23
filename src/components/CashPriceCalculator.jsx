import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  calcBothVehicles,
  formatMixLabel,
  getAdmixtureOptions,
  getSlumpOptions,
  getStrengthOptions,
  normalizePriceList,
} from '../lib/cashPriceCalc.js';

function yen(n) {
  if (!Number.isFinite(n)) return '—';
  return `${Math.trunc(n).toLocaleString('ja-JP')}円`;
}

function SegmentButton({ active, disabled, onClick, children, className = '' }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={
        'min-h-[44px] rounded-lg border-2 px-3 text-sm font-black transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 ' +
        (active
          ? 'border-sky-600 bg-sky-600 text-white shadow-sm'
          : 'border-slate-300 bg-white text-slate-800 hover:border-sky-400 hover:bg-sky-50') +
        (className ? ` ${className}` : '')
      }
    >
      {children}
    </button>
  );
}

function ResultRow({ label, value, emphasize = false, note = '' }) {
  return (
    <div className={'flex items-baseline justify-between gap-2 ' + (emphasize ? 'mt-1' : '')}>
      <span className={'text-xs ' + (emphasize ? 'font-black text-slate-900' : 'font-semibold text-slate-600')}>
        {label}
        {note ? <span className="ml-1 font-normal text-slate-400">{note}</span> : null}
      </span>
      <span className={'tabular-nums ' + (emphasize ? 'text-base font-black text-slate-900' : 'text-sm font-bold text-slate-800')}>
        {value}
      </span>
    </div>
  );
}

function VehicleCard({ title, result, selected, onSelect, emptyRate, baseLoad }) {
  if (!result?.ok) {
    return (
      <button
        type="button"
        onClick={onSelect}
        className={
          'min-h-[120px] w-full rounded-2xl border-2 p-3 text-left transition ' +
          (selected ? 'border-sky-600 bg-sky-50 shadow-md' : 'border-slate-200 bg-white hover:border-slate-300')
        }
      >
        <p className="text-sm font-black text-slate-800">{title}</p>
        <p className="mt-3 text-xs font-semibold text-amber-700">{result?.error || '計算できません'}</p>
      </button>
    );
  }

  const emptyNote =
    result.emptyLoadAmount > 0
      ? `（基準${baseLoad}㎥未満 +${result.emptyLoadAmount.toLocaleString('ja-JP')}円）`
      : '';

  return (
    <button
      type="button"
      onClick={onSelect}
      className={
        'w-full rounded-2xl border-2 p-3 text-left transition ' +
        (selected
          ? 'border-sky-600 bg-sky-50 shadow-md ring-2 ring-sky-200'
          : 'border-slate-200 bg-white hover:border-sky-300')
      }
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-black text-slate-900">{title}</p>
        {selected ? (
          <span className="rounded-md bg-sky-600 px-2 py-0.5 text-[10px] font-black text-white">採用</span>
        ) : null}
      </div>
      <div className="space-y-1">
        <ResultRow label="基準価格" value={yen(result.basePrice)} />
        <ResultRow label="地区加算" value={yen(result.areaAmount)} />
        <ResultRow label="小型加算" value={yen(result.smallAmount)} />
        <ResultRow
          label="高炉値引"
          value={result.bbAmount ? `−${result.bbAmount.toLocaleString('ja-JP')}円` : yen(0)}
        />
        <ResultRow label="単価" value={yen(result.unitPrice)} emphasize />
        <ResultRow label="材料代" value={yen(result.materialAmount)} />
        <ResultRow
          label="空積増し"
          value={yen(result.emptyLoadAmount)}
          note={emptyNote || (emptyRate != null ? `（基準${baseLoad}㎥）` : '')}
        />
        <ResultRow label="小計" value={yen(result.subtotal)} />
        <ResultRow label="消費税" value={yen(result.tax)} />
        <ResultRow label="合計" value={yen(result.total)} emphasize />
      </div>
    </button>
  );
}

/**
 * 窓口現金 概算計算機（工場／管理者共用）
 * @param {{ supabase: object, onClose?: () => void, refreshKey?: number|string }} props
 */
export function CashPriceCalculator({ supabase, onClose, refreshKey = 0 }) {
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [priceList, setPriceList] = useState(null);

  const [strength, setStrength] = useState(null);
  const [slump, setSlump] = useState('');
  const [admixture, setAdmixture] = useState('');
  const [cement, setCement] = useState('N');
  const [quantity, setQuantity] = useState('');
  const [areaCode, setAreaCode] = useState('');
  const [vehicle, setVehicle] = useState('large');

  const loadPriceList = useCallback(async () => {
    if (!supabase) {
      setFetchError('接続できません');
      setPriceList(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFetchError('');
    try {
      const { data, error } = await supabase
        .from('cash_price_lists')
        .select('*')
        .eq('is_active', true)
        .maybeSingle();
      if (error) throw error;
      const normalized = normalizePriceList(data);
      if (!normalized) {
        setFetchError('有効な価格表が登録されていません');
        setPriceList(null);
      } else {
        setPriceList(normalized);
      }
    } catch (e) {
      console.error('cash_price_lists fetch', e);
      setFetchError(e?.message || '価格表の取得に失敗しました');
      setPriceList(null);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void loadPriceList();
  }, [loadPriceList, refreshKey]);

  const strengthOptions = useMemo(() => (priceList ? getStrengthOptions(priceList) : []), [priceList]);
  const slumpOptions = useMemo(
    () => (priceList && strength != null ? getSlumpOptions(priceList, strength) : []),
    [priceList, strength],
  );
  const admixtureOptions = useMemo(
    () => (priceList && strength != null && slump ? getAdmixtureOptions(priceList, strength, slump) : []),
    [priceList, strength, slump],
  );

  useEffect(() => {
    if (strength != null && !strengthOptions.includes(strength)) {
      setStrength(null);
      setSlump('');
      setAdmixture('');
    }
  }, [strength, strengthOptions]);

  useEffect(() => {
    if (slump && !slumpOptions.includes(slump)) {
      setSlump('');
      setAdmixture('');
    }
  }, [slump, slumpOptions]);

  useEffect(() => {
    if (!slump) return;
    if (admixtureOptions.length === 1) {
      setAdmixture(admixtureOptions[0]);
      return;
    }
    if (admixture && !admixtureOptions.includes(admixture)) {
      setAdmixture('');
    }
  }, [slump, admixture, admixtureOptions]);

  const clearAll = () => {
    setStrength(null);
    setSlump('');
    setAdmixture('');
    setCement('N');
    setQuantity('');
    setAreaCode('');
    setVehicle('large');
  };

  const qtyNum = quantity === '' ? NaN : Number(quantity);
  const both = useMemo(() => {
    if (!priceList || strength == null || !slump || !admixture || !areaCode || !Number.isFinite(qtyNum)) {
      return null;
    }
    return calcBothVehicles({
      priceList,
      strength,
      slump,
      admixture,
      cement,
      quantity: qtyNum,
      areaCode,
    });
  }, [priceList, strength, slump, admixture, cement, qtyNum, areaCode]);

  const selectedResult = both?.[vehicle] || null;
  const mixLabel = formatMixLabel({ strength, slump, cement, admixture });

  const bumpQty = (delta) => {
    const cur = Number.isFinite(qtyNum) ? qtyNum : 0;
    const next = Math.round((cur + delta) * 100) / 100;
    setQuantity(String(Math.max(0, Math.min(100, next))));
  };

  return (
    <div className="flex max-h-[min(92dvh,920px)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border-2 border-slate-200 bg-slate-50 shadow-2xl">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-3">
        <div>
          <h2 className="text-base font-black text-slate-900">窓口現金 概算計算</h2>
          {mixLabel ? <p className="mt-0.5 text-xs font-semibold text-slate-500">{mixLabel}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={clearAll}
            className="min-h-[44px] rounded-lg border-2 border-slate-300 bg-white px-3 text-sm font-black text-slate-700 hover:bg-slate-100"
          >
            クリア
          </button>
          {typeof onClose === 'function' ? (
            <button
              type="button"
              onClick={onClose}
              className="min-h-[44px] rounded-lg border-2 border-slate-300 bg-white px-3 text-sm font-black text-slate-700 hover:bg-slate-100"
              aria-label="閉じる"
            >
              ×
            </button>
          ) : null}
        </div>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {loading ? (
          <p className="py-8 text-center text-sm font-bold text-slate-500">価格表を読み込み中…</p>
        ) : fetchError ? (
          <p className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-6 text-center text-sm font-bold text-amber-900">
            {fetchError}
          </p>
        ) : (
          <>
            <section>
              <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">① 配合</p>
              <p className="mb-1 text-[11px] font-bold text-slate-500">呼び強度</p>
              <div className="flex flex-wrap gap-2">
                {strengthOptions.map((s) => (
                  <SegmentButton
                    key={s}
                    active={strength === s}
                    onClick={() => {
                      setStrength(s);
                      setSlump('');
                      setAdmixture('');
                    }}
                  >
                    {s}
                  </SegmentButton>
                ))}
              </div>
              <p className="mb-1 mt-3 text-[11px] font-bold text-slate-500">スランプ</p>
              <div className="flex flex-wrap gap-2">
                {(strength != null ? slumpOptions : []).map((sl) => (
                  <SegmentButton
                    key={sl}
                    active={slump === sl}
                    disabled={strength == null}
                    onClick={() => {
                      setSlump(sl);
                      setAdmixture('');
                    }}
                  >
                    {sl}
                  </SegmentButton>
                ))}
                {strength != null && slumpOptions.length === 0 ? (
                  <span className="text-xs text-slate-400">選択肢なし</span>
                ) : null}
              </div>
              <p className="mb-1 mt-3 text-[11px] font-bold text-slate-500">混和剤</p>
              <div className="flex flex-wrap gap-2">
                {['AE', 'HP'].map((ad) => {
                  const available = admixtureOptions.includes(ad);
                  return (
                    <SegmentButton
                      key={ad}
                      active={admixture === ad}
                      disabled={!slump || !available}
                      onClick={() => setAdmixture(ad)}
                    >
                      {ad === 'HP' ? '高性能' : 'AE'}
                    </SegmentButton>
                  );
                })}
              </div>
              <p className="mb-1 mt-3 text-[11px] font-bold text-slate-500">セメント</p>
              <div className="flex flex-wrap gap-2">
                <SegmentButton active={cement === 'N'} onClick={() => setCement('N')}>
                  N
                </SegmentButton>
                <SegmentButton active={cement === 'BB'} onClick={() => setCement('BB')}>
                  BB
                </SegmentButton>
              </div>
            </section>

            <section>
              <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">② 数量（㎥）</p>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => bumpQty(-0.25)}
                  className="min-h-[44px] min-w-[72px] rounded-lg border-2 border-slate-300 bg-white px-3 text-sm font-black text-slate-800 hover:bg-slate-100"
                >
                  −0.25
                </button>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  max="100"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="min-h-[44px] w-28 rounded-lg border-2 border-slate-300 bg-white px-3 text-center text-base font-black tabular-nums text-slate-900"
                  placeholder="0.00"
                />
                <span className="text-sm font-black text-slate-600">㎥</span>
                <button
                  type="button"
                  onClick={() => bumpQty(0.25)}
                  className="min-h-[44px] min-w-[72px] rounded-lg border-2 border-slate-300 bg-white px-3 text-sm font-black text-slate-800 hover:bg-slate-100"
                >
                  +0.25
                </button>
              </div>
            </section>

            <section>
              <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">③ 地区</p>
              <div className="flex flex-wrap gap-2">
                {(priceList?.area_surcharges || []).map((a) => (
                  <SegmentButton
                    key={a.code}
                    active={areaCode === a.code}
                    onClick={() => setAreaCode(a.code)}
                    className="max-w-full"
                  >
                    {a.label}
                  </SegmentButton>
                ))}
              </div>
            </section>

            <section>
              <p className="mb-2 text-xs font-black uppercase tracking-wide text-slate-500">④ 結果（大型／小型）</p>
              {!both ? (
                <p className="rounded-xl border border-dashed border-slate-300 bg-white px-3 py-6 text-center text-xs font-semibold text-slate-500">
                  配合・数量・地区を入力すると概算が表示されます
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <VehicleCard
                    title="大型"
                    result={both.large}
                    selected={vehicle === 'large'}
                    onSelect={() => setVehicle('large')}
                    baseLoad={priceList.large_base_load}
                    emptyRate={priceList.empty_load_rate}
                  />
                  <VehicleCard
                    title="小型"
                    result={both.small}
                    selected={vehicle === 'small'}
                    onSelect={() => setVehicle('small')}
                    baseLoad={priceList.small_base_load}
                    emptyRate={priceList.empty_load_rate}
                  />
                </div>
              )}
            </section>

            {priceList ? (
              <p className="text-[11px] leading-relaxed text-slate-500">
                {priceList.name}
                {priceList.effective_from ? `（${priceList.effective_from}〜）` : ''}
                に基づく概算・税込。時間外・休日割増等は含みません
              </p>
            ) : null}
          </>
        )}
      </div>

      <div className="border-t-2 border-slate-200 bg-white px-4 py-3">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold text-slate-500">
              採用：{vehicle === 'small' ? '小型' : '大型'}
              {selectedResult?.ok ? '' : '（未確定）'}
            </p>
            <p className="text-2xl font-black tabular-nums text-slate-900 sm:text-3xl">
              {selectedResult?.ok ? yen(selectedResult.total) : '—'}
            </p>
          </div>
          <p className="pb-1 text-xs font-semibold text-slate-400">税込合計</p>
        </div>
      </div>
    </div>
  );
}

export default CashPriceCalculator;
