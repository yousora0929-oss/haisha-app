import React, { useCallback, useEffect, useState } from 'react';
import * as db from '../haishaDb.js';
import { AdminVolumeImport } from './AdminVolumeImport.jsx';

const SECTION =
  'rounded-2xl border border-gray-200 bg-white p-4 text-gray-900 shadow-md dark:border-gray-700 dark:bg-slate-800 dark:text-white sm:p-6';

const NUM_INPUT_CLASS =
  'w-16 rounded border border-gray-200 bg-white px-2 py-1.5 text-center text-sm font-bold text-gray-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white dark:focus:border-indigo-500';

let stepKeySeq = 0;
function nextStepKey() {
  stepKeySeq += 1;
  return `step-${stepKeySeq}`;
}

function cloneSteps(steps) {
  return (steps || []).map((s) => ({
    _key: s._key || nextStepKey(),
    step_number: s.step_number,
    trigger_minutes: s.trigger_minutes,
    target_factory_count: s.target_factory_count,
  }));
}

function renumberSteps(steps) {
  return steps.map((s, i) => ({ ...s, step_number: i + 1 }));
}

function defaultNewStep(existingSteps) {
  const list = existingSteps || [];
  if (list.length === 0) {
    return { _key: nextStepKey(), step_number: 1, trigger_minutes: 0, target_factory_count: 3 };
  }
  const last = list[list.length - 1];
  return {
    _key: nextStepKey(),
    step_number: list.length + 1,
    trigger_minutes: Math.max(0, (Number(last.trigger_minutes) || 0) + 15),
    target_factory_count: Math.max(1, (Number(last.target_factory_count) || 1) + 2),
  };
}

function buildFactoryDrafts(factories, stepsByFactoryId) {
  const list = (factories || []).filter((f) => f?.id);
  list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja'));
  return list.map((f) => {
    const id = String(f.id);
    const saved = stepsByFactoryId[id] || [];
    const steps =
      saved.length > 0
        ? cloneSteps(
            saved.map((s) => ({
              step_number: s.step_number,
              trigger_minutes: s.trigger_minutes,
              target_factory_count: s.target_factory_count,
            })),
          )
        : [];
    return {
      factory_id: id,
      factory_name: f.name || id,
      steps: renumberSteps(steps),
    };
  });
}

function factoryIdsKey(factories) {
  return (factories || [])
    .map((f) => String(f?.id || ''))
    .filter(Boolean)
    .sort()
    .join('|');
}

/**
 * 管理者画面 — 工場別・多段階エスカレーション設定
 */
export function AdminEscalationSection({ factories = [] }) {
  const [activeTab, setActiveTab] = useState('escalation');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [tableReady, setTableReady] = useState(true);
  const [distanceWeight, setDistanceWeight] = useState(0.7);
  const [volumeByFactory, setVolumeByFactory] = useState({});
  const [weightSaving, setWeightSaving] = useState(false);
  const [volumeSavingId, setVolumeSavingId] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [meta, weight, volumes] = await Promise.all([
        db.fetchEscalationStepsMeta(),
        db.fetchEscalationDistanceWeight(),
        db.fetchMonthlyVolumeByFactory(),
      ]);
      setTableReady(Boolean(meta?.tableReady));
      if (!meta?.tableReady) {
        setError(db.ESCALATION_STEPS_MIGRATION_HINT);
      }
      setDistanceWeight(weight);
      setVolumeByFactory(volumes || {});
      setRows(buildFactoryDrafts(factories, meta?.byFactory || {}));
    } catch (e) {
      console.error('[AdminEscalationSection] load failed', e);
      setTableReady(false);
      setError(e?.message || 'エスカレーション設定の取得に失敗しました');
      setRows(buildFactoryDrafts(factories, {}));
    } finally {
      setLoading(false);
    }
  }, [factories]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let unsub = () => {};
    void (async () => {
      try {
        const subscribe = db?.subscribeEscalationStepsRealtime;
        if (typeof subscribe !== 'function') return;
        unsub = await subscribe((payload) => {
          if (payload?.table === 'factory_escalation_steps') void load();
        });
      } catch (e) {
        console.warn('[AdminEscalationSection] realtime subscribe skipped', e);
      }
    })();
    return () => unsub();
  }, [load]);

  const factoryIds = factoryIdsKey(factories);

  useEffect(() => {
    if (loading) return;
    setRows((prev) => {
      const prevById = new Map(prev.map((r) => [r.factory_id, r]));
      return buildFactoryDrafts(
        factories,
        Object.fromEntries(
          [...prevById.entries()].map(([id, r]) => [id, r.steps.map(({ step_number, trigger_minutes, target_factory_count }) => ({
            step_number,
            trigger_minutes,
            target_factory_count,
          }))]),
        ),
      );
    });
  }, [factoryIds, factories, loading]);

  const addStep = (factoryId) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.factory_id !== factoryId) return r;
        const next = defaultNewStep(r.steps);
        return { ...r, steps: renumberSteps([...r.steps, next]) };
      }),
    );
  };

  const removeStep = (factoryId, stepKey) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.factory_id !== factoryId) return r;
        return {
          ...r,
          steps: renumberSteps(r.steps.filter((s) => s._key !== stepKey)),
        };
      }),
    );
  };

  const updateStepField = (factoryId, stepKey, field, value) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.factory_id !== factoryId) return r;
        return {
          ...r,
          steps: r.steps.map((s) => {
            if (s._key !== stepKey) return s;
            return { ...s, [field]: value };
          }),
        };
      }),
    );
  };

  const copyFirstFactoryStepsToAll = () => {
    if (rows.length === 0) return;
    const template = cloneSteps(rows[0].steps);
    setRows((prev) =>
      prev.map((r, idx) =>
        idx === 0
          ? r
          : {
              ...r,
              steps: renumberSteps(
                template.map((s) => ({
                  _key: nextStepKey(),
                  step_number: s.step_number,
                  trigger_minutes: s.trigger_minutes,
                  target_factory_count: s.target_factory_count,
                })),
              ),
            },
      ),
    );
    setNotice('先頭工場のエスカレーション段階を全工場へコピーしました');
    window.setTimeout(() => setNotice(''), 4000);
  };

  const handleSaveAll = async () => {
    if (!tableReady) {
      setError(db.ESCALATION_STEPS_MIGRATION_HINT);
      return;
    }
    setSaving(true);
    setError('');
    setNotice('');
    try {
      for (const row of rows) {
        await db.saveEscalationSteps(
          row.factory_id,
          row.steps.map(({ trigger_minutes, target_factory_count }) => ({
            trigger_minutes,
            target_factory_count,
          })),
        );
      }
      setNotice('全工場のエスカレーションルールを保存しました');
      await load();
      window.setTimeout(() => setNotice(''), 4000);
    } catch (e) {
      console.error('[AdminEscalationSection] save failed', e);
      setError(e?.message || '保存に失敗しました');
    } finally {
      setSaving(false);
    }
  };

  const handleSaveWeight = async () => {
    setWeightSaving(true);
    setError('');
    setNotice('');
    try {
      await db.saveEscalationDistanceWeight(distanceWeight);
      setNotice('スコアリング重みを保存しました');
      window.setTimeout(() => setNotice(''), 4000);
    } catch (e) {
      console.error('[AdminEscalationSection] weight save failed', e);
      setError(e?.message || 'スコアリング重みの保存に失敗しました');
    } finally {
      setWeightSaving(false);
    }
  };

  const handleSaveVolume = async (factoryId, factoryName) => {
    const raw = volumeByFactory[factoryId];
    const value = raw === '' || raw == null ? null : Number(raw);
    if (value != null && (!Number.isFinite(value) || value < 0)) {
      setError('出荷量は 0 以上の数値で入力してください');
      return;
    }
    setVolumeSavingId(factoryId);
    setError('');
    setNotice('');
    try {
      await db.saveMonthlyVolumeForFactory(factoryId, value);
      setNotice(`${factoryName} の出荷量を更新しました`);
      window.setTimeout(() => setNotice(''), 4000);
    } catch (e) {
      console.error('[AdminEscalationSection] volume save failed', e);
      setError(e?.message || '出荷量の保存に失敗しました');
    } finally {
      setVolumeSavingId('');
    }
  };

  const distanceWeightPercent = Math.round(distanceWeight * 100);
  const capacityWeightPercent = 100 - distanceWeightPercent;

  const tabButtonClass = (tab) =>
    tab === activeTab
      ? 'border-b-2 border-indigo-600 px-4 py-2 text-sm font-black text-indigo-700 dark:border-indigo-400 dark:text-indigo-300'
      : 'border-b-2 border-transparent px-4 py-2 text-sm font-bold text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200';

  return (
    <section className={SECTION}>
      <nav className="-mx-1 mb-6 flex flex-wrap gap-1 border-b border-gray-200 dark:border-gray-700">
        <button type="button" className={tabButtonClass('escalation')} onClick={() => setActiveTab('escalation')}>
          エスカレーション設定
        </button>
        <button type="button" className={tabButtonClass('volume-import')} onClick={() => setActiveTab('volume-import')}>
          出荷量インポート
        </button>
      </nav>

      {activeTab === 'volume-import' ? (
        <AdminVolumeImport />
      ) : (
        <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-gray-900 dark:text-white">🚨 工場別・多段階エスカレーション設定</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            注文から経過した分数ごとに通知工場数を設定します。
            距離スコアと当月出荷量スコアを合算して優先順位を決定します（管理者のみ）。
          </p>
        </div>
        {rows.length > 0 ? (
          <button
            type="button"
            onClick={copyFirstFactoryStepsToAll}
            className="rounded-lg border border-indigo-300 bg-indigo-50 px-3 py-2 text-xs font-black text-indigo-900 hover:bg-indigo-100 dark:border-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-200 dark:hover:bg-indigo-900/60"
            title="先頭工場の全段階を他工場へ丸ごとコピー"
          >
            先頭工場の設定を全工場にコピー
          </button>
        ) : null}
      </div>

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

      {!loading ? (
        <article className="mt-4 rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 dark:border-indigo-800 dark:bg-indigo-950/30">
          <h3 className="text-sm font-black text-gray-900 dark:text-white">📊 エスカレーション優先度スコアリング</h3>
          <div className="mt-3 space-y-2">
            <label className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-slate-700 dark:text-slate-300">
              <span className="shrink-0 font-bold">距離スコア重み:</span>
              <input
                type="range"
                min={0}
                max={100}
                step={5}
                value={distanceWeightPercent}
                onChange={(e) => setDistanceWeight(Number(e.target.value) / 100)}
                disabled={!tableReady}
                className="h-2 min-w-[12rem] flex-1 cursor-pointer accent-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label="距離スコア重み"
              />
              <span className="w-10 shrink-0 text-right font-black text-indigo-700 dark:text-indigo-300">
                {distanceWeightPercent}%
              </span>
            </label>
            <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
              キャパスコア重み: {capacityWeightPercent}%（自動）
            </p>
          </div>
          <div className="mt-3 flex justify-end">
            <button
              type="button"
              onClick={() => void handleSaveWeight()}
              disabled={weightSaving || !tableReady}
              className="rounded-lg border border-indigo-300 bg-white px-4 py-2 text-xs font-black text-indigo-900 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-600 dark:bg-slate-800 dark:text-indigo-200 dark:hover:bg-indigo-900/50"
            >
              {weightSaving ? '保存中…' : '保存'}
            </button>
          </div>
        </article>
      ) : null}

      {loading ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">読み込み中…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">登録されている工場がありません。</p>
      ) : (
        <div className="mt-6 space-y-4">
          {rows.map((factory, factoryIndex) => (
            <article
              key={factory.factory_id}
              className="rounded-xl border border-gray-200 bg-slate-50/80 p-4 dark:border-gray-700 dark:bg-slate-900/50"
            >
              <h3 className="text-base font-black text-gray-900 dark:text-white">
                {factory.factory_name}
                {factoryIndex === 0 ? (
                  <span className="ml-2 text-[10px] font-bold text-indigo-600 dark:text-indigo-300">
                    （一括コピーの元）
                  </span>
                ) : null}
              </h3>

              <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-gray-600 dark:bg-gray-800">
                <span className="font-bold text-slate-700 dark:text-slate-300">当月出荷量:</span>
                <input
                  type="number"
                  min={0}
                  step={0.5}
                  value={volumeByFactory[factory.factory_id] ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    setVolumeByFactory((prev) => ({
                      ...prev,
                      [factory.factory_id]: v === '' ? '' : Number(v),
                    }));
                  }}
                  className={`${NUM_INPUT_CLASS} w-24`}
                  aria-label={`${factory.factory_name} の当月出荷量`}
                  disabled={!tableReady}
                />
                <span className="text-slate-600 dark:text-slate-400">m³</span>
                <button
                  type="button"
                  onClick={() => void handleSaveVolume(factory.factory_id, factory.factory_name)}
                  disabled={volumeSavingId === factory.factory_id || !tableReady}
                  className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1 text-xs font-black text-indigo-900 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50 dark:border-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-200 dark:hover:bg-indigo-900/50"
                >
                  {volumeSavingId === factory.factory_id ? '更新中…' : '更新'}
                </button>
              </div>

              {factory.steps.length === 0 ? (
                <p className="mt-2 text-xs font-medium text-slate-500 dark:text-slate-400">
                  ステップがありません。「＋ ステップを追加」で段階を設定してください。
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {factory.steps.map((step, stepIndex) => (
                    <li
                      key={step._key}
                      className="flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm dark:border-gray-600 dark:bg-gray-800"
                    >
                      <span className="shrink-0 font-black text-indigo-700 dark:text-indigo-300">
                        [ {stepIndex + 1} ]段階目：
                      </span>
                      <span className="text-slate-700 dark:text-slate-300">注文から</span>
                      <input
                        type="number"
                        min={0}
                        value={step.trigger_minutes}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10);
                          updateStepField(
                            factory.factory_id,
                            step._key,
                            'trigger_minutes',
                            Number.isFinite(n) && n >= 0 ? n : 0,
                          );
                        }}
                        className={NUM_INPUT_CLASS}
                        aria-label={`${factory.factory_name} ${stepIndex + 1}段階目の分数`}
                      />
                      <span className="text-slate-700 dark:text-slate-300">分後に、近い順</span>
                      <input
                        type="number"
                        min={1}
                        value={step.target_factory_count}
                        onChange={(e) => {
                          const n = parseInt(e.target.value, 10);
                          updateStepField(
                            factory.factory_id,
                            step._key,
                            'target_factory_count',
                            Number.isFinite(n) && n >= 1 ? n : 1,
                          );
                        }}
                        className={NUM_INPUT_CLASS}
                        aria-label={`${factory.factory_name} ${stepIndex + 1}段階目の工場数`}
                      />
                      <span className="text-slate-700 dark:text-slate-300">工場に通知</span>
                      <button
                        type="button"
                        onClick={() => removeStep(factory.factory_id, step._key)}
                        className="ml-auto shrink-0 rounded border border-red-200 bg-red-50 px-2 py-1 text-xs font-black text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-900/50"
                        aria-label={`${stepIndex + 1}段階目を削除`}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <button
                type="button"
                onClick={() => addStep(factory.factory_id)}
                className="mt-3 rounded-lg border border-dashed border-indigo-300 bg-indigo-50/80 px-3 py-2 text-xs font-black text-indigo-800 hover:bg-indigo-100 dark:border-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-200 dark:hover:bg-indigo-900/40"
              >
                ＋ ステップを追加
              </button>
            </article>
          ))}
        </div>
      )}

      <div className="mt-8 flex justify-end border-t border-gray-200 pt-6 dark:border-gray-700">
        <button
          type="button"
          disabled={saving || loading || rows.length === 0 || !tableReady}
          onClick={() => void handleSaveAll()}
          className="min-h-[52px] rounded-xl border-2 border-blue-500 bg-blue-600 px-8 text-sm font-black text-white shadow-lg shadow-blue-900/30 transition hover:bg-blue-500 active:scale-[0.99] disabled:cursor-not-allowed disabled:border-slate-500 disabled:bg-slate-600 dark:border-blue-400 dark:bg-blue-500 dark:shadow-blue-950/50 dark:hover:bg-blue-400"
        >
          {saving ? '保存中…' : '全工場のエスカレーションルールを一括保存'}
        </button>
      </div>
        </>
      )}
    </section>
  );
}
