import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as db from '../haishaDb.js';
import { MasterSuggestInput } from './MasterSuggestInput.jsx';

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error || new Error('PDFの読み込みに失敗しました'));
    reader.readAsDataURL(file);
  });
}

function projectSuggestTexts(p) {
  return [p?.name, p?.site_address, p?.delivery_area, p?.id].filter(Boolean);
}

function customerSuggestTexts(c) {
  return [c?.company_name, c?.name, c?.furigana, c?.manager_name, c?.phone_number, c?.id].filter(
    Boolean,
  );
}

function orgSuggestTexts(o) {
  return [o?.name, o?.furigana, o?.id].filter(Boolean);
}

function factorySuggestTexts(f) {
  return [f?.name, f?.id].filter(Boolean);
}

function statusBadge(status) {
  const map = {
    change_proposed: { label: '工場の承諾待ち', className: 'bg-amber-100 text-amber-900 border-amber-300' },
    change_accepted: { label: '承諾済み', className: 'bg-emerald-100 text-emerald-900 border-emerald-300' },
    change_rejected: { label: '拒否されました（要対応）', className: 'bg-red-100 text-red-900 border-red-400' },
    new_confirmed: { label: '確定済み', className: 'bg-sky-100 text-sky-900 border-sky-300' },
    pending: { label: '未処理', className: 'bg-slate-100 text-slate-700 border-slate-300' },
    needs_admin_review: { label: '要管理者確認', className: 'bg-violet-100 text-violet-900 border-violet-300' },
    excluded: { label: '除外', className: 'bg-slate-200 text-slate-600 border-slate-300' },
  };
  const meta = map[status] || { label: status || '—', className: 'bg-slate-100 text-slate-700 border-slate-300' };
  return (
    <span className={'inline-flex rounded-full border px-2 py-0.5 text-[10px] font-black ' + meta.className}>
      {meta.label}
    </span>
  );
}

/**
 * スケジュールPDF取込（Admin / Dispatch 共通）
 * @param {'admin'|'customer'} mode
 * @param {string|null} uploadedBy customer id（customer モードで Edge に渡す）
 * @param {string|null} lockedOrderPlacerName 指定時は発注担当者欄を隠し、この値で確定
 */
export function AdminScheduleImportSection({
  factories = [],
  mode = 'admin',
  uploadedBy = null,
  lockedOrderPlacerName = null,
}) {
  const isCustomerMode = mode === 'customer';
  const showOrderPlacerInput = !isCustomerMode && lockedOrderPlacerName == null;
  const [view, setView] = useState('list'); // upload | list | detail
  const [batches, setBatches] = useState([]);
  const [batch, setBatch] = useState(null);
  const [rows, setRows] = useState([]);
  const [projects, setProjects] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [organizations, setOrganizations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedRowIds, setSelectedRowIds] = useState(() => new Set());
  const [draftRows, setDraftRows] = useState({});
  const [projectQuery, setProjectQuery] = useState('');
  const [contractorQuery, setContractorQuery] = useState('');
  const [orgQuery, setOrgQuery] = useState('');
  const [factoryQueryByRowId, setFactoryQueryByRowId] = useState({});
  const [orderPlacerName, setOrderPlacerName] = useState('');

  const factoryNameById = useMemo(
    () => Object.fromEntries((factories || []).map((f) => [String(f.id), f.name || f.id])),
    [factories],
  );

  const loadMasters = useCallback(async () => {
    const [projs, custs, orgs] = await Promise.all([
      db.fetchProjects(),
      db.fetchCustomers(),
      db.fetchOrganizations(),
    ]);
    setProjects(Array.isArray(projs) ? projs : []);
    setCustomers(Array.isArray(custs) ? custs : []);
    setOrganizations(Array.isArray(orgs) ? orgs : []);
  }, []);

  const loadBatchList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await db.fetchScheduleImportBatchSummaries();
      setBatches(list);
    } catch (e) {
      console.error(e);
      setError('バッチ一覧の取得に失敗しました');
    } finally {
      setLoading(false);
    }
  }, []);

  const openBatchDetail = useCallback(
    async (batchId) => {
      setLoading(true);
      setError('');
      setNotice('');
      try {
        await loadMasters();
        const [b, r] = await Promise.all([
          db.fetchScheduleImportBatchById(batchId),
          db.fetchScheduleImportRowsByBatchId(batchId),
        ]);
        if (!b) throw new Error('バッチが見つかりません');
        setBatch(b);
        setRows(r);
        const header = b.header_raw || {};
        setProjectQuery(String(header.project_name || '').trim());
        setContractorQuery(String(header.contractor_name || '').trim());
        setOrgQuery(String(header.trading_company_name || '').trim());
        setOrderPlacerName(
          lockedOrderPlacerName != null
            ? String(lockedOrderPlacerName)
            : db.guessOrderPlacerNameFromHeader(header),
        );
        const drafts = {};
        const selected = new Set();
        for (const row of r) {
          drafts[row.id] = {
            quantity_m3: row.quantity_m3,
            delivery_time: row.delivery_time,
            vehicle_type: row.vehicle_type,
            mix_design: row.mix_design,
            has_test: row.has_test,
            notes: row.notes,
          };
          if (
            row.factory_id &&
            row.row_status === 'pending' &&
            row.row_confidence === 'high' &&
            (row.match_type === 'new' || !row.match_type)
          ) {
            selected.add(row.id);
          }
        }
        setDraftRows(drafts);
        setSelectedRowIds(selected);
        setView('detail');
      } catch (e) {
        console.error(e);
        setError(e?.message || 'バッチ詳細の取得に失敗しました');
      } finally {
        setLoading(false);
      }
    },
    [loadMasters, lockedOrderPlacerName],
  );

  useEffect(() => {
    if (view === 'list') void loadBatchList();
  }, [view, loadBatchList]);

  const unresolvedFactoryRows = useMemo(
    () => rows.filter((r) => r.row_status === 'pending' && !r.factory_id),
    [rows],
  );
  const newCandidateRows = useMemo(
    () =>
      rows.filter((r) => {
        if (!r.factory_id) return false;
        if (r.row_status === 'new_confirmed') return true;
        if (r.row_status !== 'pending') return false;
        // 物件未解決でマッチ未実行の行は match_type が null のまま残る → 新規候補として扱う
        return r.match_type === 'new' || !r.match_type;
      }),
    [rows],
  );
  const changeRows = useMemo(
    () =>
      rows.filter((r) =>
        ['change_proposed', 'change_accepted', 'change_rejected'].includes(r.row_status),
      ),
    [rows],
  );
  const reviewRows = useMemo(
    () =>
      rows.filter(
        (r) =>
          r.match_type === 'ambiguous_multi_match' || r.row_status === 'needs_admin_review',
      ),
    [rows],
  );

  const handleUpload = async (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !String(file.name || '').toLowerCase().endsWith('.pdf')) {
      window.alert('PDFファイルを選択してください');
      return;
    }
    setUploading(true);
    setError('');
    setNotice('');
    try {
      const pdfBase64 = await fileToBase64(file);
      const result = await db.invokeScheduleImportExtract({
        pdfBase64,
        sourceFileName: file.name,
        uploadedBy: uploadedBy || undefined,
      });
      const batchId = result?.batch_id;
      if (!batchId) throw new Error('バッチIDが返りませんでした');
      setNotice(
        `抽出完了：新規 ${result?.summary?.new_rows ?? 0} / 変更提案 ${result?.summary?.change_proposed ?? 0} / 要確認 ${result?.summary?.needs_admin_review ?? 0}`,
      );
      await openBatchDetail(batchId);
    } catch (e) {
      console.error(e);
      setError(e?.message || 'PDF抽出に失敗しました');
    } finally {
      setUploading(false);
    }
  };

  const saveBatchLinks = async (patch) => {
    if (!batch?.id) return;
    try {
      const updated = await db.updateScheduleImportBatch(batch.id, patch);
      setBatch(updated);
      setNotice('ヘッダー紐づけを保存しました');
    } catch (e) {
      console.error(e);
      window.alert('保存に失敗しました');
    }
  };

  const resolveFactoryForRow = async (row, factory) => {
    if (!row?.id || !factory?.id) return;
    try {
      await db.upsertFactoryAlias(factory.id, row.factory_name_raw);
      const updated = await db.updateScheduleImportRow(row.id, {
        factory_id: factory.id,
        match_type: row.match_type || 'new',
        row_status: row.row_status === 'pending' ? 'pending' : row.row_status,
      });
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, ...updated } : r)));
      if (updated.match_type === 'new' && updated.row_confidence === 'high') {
        setSelectedRowIds((prev) => new Set(prev).add(row.id));
      }
      setNotice(`工場「${factory.name || factory.id}」を紐づけ、エイリアスを学習しました`);
    } catch (e) {
      console.error(e);
      window.alert('工場の解決に失敗しました');
    }
  };

  const updateDraft = (rowId, key, value) => {
    setDraftRows((prev) => ({
      ...prev,
      [rowId]: { ...(prev[rowId] || {}), [key]: value },
    }));
  };

  const persistDraftRow = async (rowId) => {
    const draft = draftRows[rowId];
    if (!draft) return;
    try {
      const updated = await db.updateScheduleImportRow(rowId, {
        quantity_m3: draft.quantity_m3,
        delivery_time: draft.delivery_time,
        vehicle_type: draft.vehicle_type,
        mix_design: draft.mix_design,
        has_test: draft.has_test,
        notes: draft.notes,
      });
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...updated } : r)));
    } catch (e) {
      console.error(e);
      window.alert('行の保存に失敗しました');
    }
  };

  const toggleRowSelected = (rowId, on) => {
    setSelectedRowIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  };

  const selectAllHighConfidence = () => {
    const next = new Set();
    for (const row of newCandidateRows) {
      if (row.row_status === 'new_confirmed') continue;
      if (row.row_confidence === 'high') next.add(row.id);
    }
    setSelectedRowIds(next);
  };

  const confirmSelected = async () => {
    if (!batch?.project_id) {
      window.alert('物件を先に選択してください');
      return;
    }
    const targets = newCandidateRows
      .filter((r) => selectedRowIds.has(r.id) && r.row_status !== 'new_confirmed')
      .map((r) => ({
        ...r,
        ...(draftRows[r.id] || {}),
      }));
    if (!targets.length) {
      window.alert('確定する行を選択してください');
      return;
    }
    if (!window.confirm(`選択した ${targets.length} 件を注文として確定しますか？`)) return;
    setConfirming(true);
    setError('');
    try {
      // persist drafts first
      for (const row of targets) {
        await db.updateScheduleImportRow(row.id, {
          quantity_m3: row.quantity_m3,
          delivery_time: row.delivery_time,
          vehicle_type: row.vehicle_type,
          mix_design: row.mix_design,
          has_test: row.has_test,
          notes: row.notes,
        });
      }
      const result = await db.confirmScheduleImportNewRows({
        batch,
        rows: targets,
        projects,
        factories,
        customers,
        orderedBy:
          lockedOrderPlacerName != null ? String(lockedOrderPlacerName) : orderPlacerName,
        actingCustomerId: isCustomerMode ? uploadedBy : null,
      });
      setNotice(`${result.created.length} 件の注文を作成しました`);
      await openBatchDetail(batch.id);
      const confirmedIds = new Set((result.rowResults || []).map((x) => x.rowId));
      setSelectedRowIds((prev) => {
        const next = new Set(prev);
        for (const id of confirmedIds) next.delete(id);
        return next;
      });
    } catch (e) {
      console.error(e);
      setError(e?.message || '一括確定に失敗しました');
    } finally {
      setConfirming(false);
    }
  };

  const excludeReviewRow = async (rowId) => {
    if (!window.confirm('この行を無視（除外）しますか？')) return;
    try {
      const updated = await db.updateScheduleImportRow(rowId, { row_status: 'excluded' });
      setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, ...updated } : r)));
    } catch (e) {
      console.error(e);
      window.alert('除外に失敗しました');
    }
  };

  const selectedProject = projects.find((p) => String(p.id) === String(batch?.project_id));
  const selectedContractor = customers.find(
    (c) => String(c.id) === String(batch?.contractor_customer_id),
  );
  const selectedOrg = organizations.find(
    (o) => String(o.id) === String(batch?.agent_organization_id),
  );

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-md sm:p-6 dark:border-slate-700 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900 dark:text-white">スケジュール取込</h2>
          <p className="mt-1 text-sm font-medium text-slate-500">
            {isCustomerMode
              ? '配車スケジュールPDFを読み取り、新規注文の一括確定と工場エイリアス学習を行います（元PDFは保存しません）。発注担当者はログイン中のあなたになります。'
              : '配車スケジュールPDFを読み取り、新規注文の一括確定と工場エイリアス学習を行います（元PDFは保存しません）。'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setView('list');
              setBatch(null);
              setRows([]);
              setError('');
            }}
            className={
              'min-h-[44px] rounded-lg border-2 px-4 text-sm font-black ' +
              (view === 'list'
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300')
            }
          >
            バッチ一覧
          </button>
          <button
            type="button"
            onClick={() => {
              setView('upload');
              setError('');
              setNotice('');
            }}
            className={
              'min-h-[44px] rounded-lg border-2 px-4 text-sm font-black ' +
              (view === 'upload'
                ? 'border-indigo-600 bg-indigo-600 text-white'
                : 'border-slate-200 bg-white text-slate-700 hover:border-indigo-300')
            }
          >
            PDFアップロード
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-bold text-red-800">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-900">
          {notice}
        </p>
      ) : null}

      {view === 'upload' ? (
        <div className="mt-6 rounded-xl border-2 border-dashed border-indigo-300 bg-indigo-50/50 p-6">
          <p className="text-sm font-bold text-indigo-950">PDFを選択して抽出を開始</p>
          <p className="mt-1 text-xs font-medium text-indigo-900/70">
            アップロードしたPDFはサーバーに保存せず、抽出結果のみDBへ残します。
          </p>
          <input
            type="file"
            accept="application/pdf,.pdf"
            disabled={uploading}
            className="mt-4 block w-full text-sm font-bold text-slate-700 file:mr-4 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-4 file:py-2 file:text-sm file:font-black file:text-white hover:file:bg-indigo-700"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void handleUpload(file);
            }}
          />
          {uploading ? (
            <p className="mt-3 text-sm font-black text-indigo-800">抽出中…（数十秒かかることがあります）</p>
          ) : null}
        </div>
      ) : null}

      {view === 'list' ? (
        <div className="mt-6">
          {loading ? <p className="text-sm font-bold text-slate-500">読み込み中…</p> : null}
          {!loading && batches.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm font-bold text-slate-500">
              まだ取込バッチがありません。「PDFアップロード」から開始してください。
            </p>
          ) : null}
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b-2 border-slate-200 bg-slate-50">
                  <th className="px-3 py-2 font-black text-slate-700">取込日時</th>
                  <th className="px-3 py-2 font-black text-slate-700">ファイル名</th>
                  <th className="px-3 py-2 font-black text-slate-700">ステータス</th>
                  <th className="px-3 py-2 font-black text-slate-700">新規</th>
                  <th className="px-3 py-2 font-black text-slate-700">変更提案</th>
                  <th className="px-3 py-2 font-black text-slate-700">要確認</th>
                  <th className="px-3 py-2 font-black text-slate-700">確定済</th>
                  <th className="px-3 py-2 font-black text-slate-700" />
                </tr>
              </thead>
              <tbody>
                {batches.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50/80">
                    <td className="px-3 py-2.5 font-bold tabular-nums text-slate-700">
                      {b.created_at ? new Date(b.created_at).toLocaleString('ja-JP') : '—'}
                    </td>
                    <td className="px-3 py-2.5 font-bold text-slate-800">{b.source_file_name || '—'}</td>
                    <td className="px-3 py-2.5">{statusBadge(b.status)}</td>
                    <td className="px-3 py-2.5 font-black text-slate-800">{b.summary?.newCount ?? 0}</td>
                    <td className="px-3 py-2.5 font-black text-slate-800">
                      {b.summary?.changeProposedCount ?? 0}
                    </td>
                    <td className="px-3 py-2.5 font-black text-slate-800">
                      {b.summary?.needsReviewCount ?? 0}
                    </td>
                    <td className="px-3 py-2.5 font-black text-slate-800">
                      {b.summary?.confirmedCount ?? 0}
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <button
                        type="button"
                        onClick={() => void openBatchDetail(b.id)}
                        className="rounded border border-indigo-400 bg-indigo-50 px-3 py-1.5 text-xs font-black text-indigo-900 hover:bg-indigo-100"
                      >
                        詳細
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {view === 'detail' && batch ? (
        <div className="mt-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                setView('list');
                void loadBatchList();
              }}
              className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3 text-sm font-black text-slate-700 hover:bg-slate-50"
            >
              ← 一覧へ戻る
            </button>
            <p className="text-xs font-bold text-slate-500">
              バッチID: <span className="font-mono">{batch.id}</span>
            </p>
          </div>

          {/* Header */}
          <div className="rounded-xl border-2 border-slate-200 bg-slate-50 p-4">
            <h3 className="text-base font-black text-slate-900">ヘッダー情報</h3>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="font-bold text-slate-500">抽出・物件名</dt>
                <dd className="font-black text-slate-900">{batch.header_raw?.project_name || '—'}</dd>
              </div>
              <div>
                <dt className="font-bold text-slate-500">抽出・業者名</dt>
                <dd className="font-black text-slate-900">{batch.header_raw?.contractor_name || '—'}</dd>
              </div>
              <div>
                <dt className="font-bold text-slate-500">抽出・商社名</dt>
                <dd className="font-black text-slate-900">
                  {batch.header_raw?.trading_company_name || '—'}
                </dd>
              </div>
              <div>
                <dt className="font-bold text-slate-500">組合名</dt>
                <dd className="font-black text-slate-900">
                  {batch.header_raw?.cooperative_name || '—'}
                </dd>
              </div>
              <div>
                <dt className="font-bold text-slate-500">抽出・発注担当者（coordinator）</dt>
                <dd className="font-black text-slate-900">
                  {batch.header_raw?.coordinator_name || '—'}
                </dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-bold text-slate-500">現場住所</dt>
                <dd className="font-black text-slate-900">{batch.header_raw?.site_address || '—'}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="font-bold text-slate-500">現場担当者</dt>
                <dd className="font-bold text-slate-800">
                  {(() => {
                    const contacts =
                      (batch.site_contacts_raw || []).length > 0
                        ? batch.site_contacts_raw
                        : Array.isArray(batch.header_raw?.site_contacts)
                          ? batch.header_raw.site_contacts
                          : [];
                    return contacts.length
                      ? contacts
                          .map((c) => `${c.name || '?'}${c.phone ? `（${c.phone}）` : ''}`)
                          .join(' / ')
                      : '—';
                  })()}
                </dd>
              </div>
            </dl>

            <div className="mt-4 grid gap-4 sm:grid-cols-1 lg:grid-cols-3">
              <div>
                <MasterSuggestInput
                  label="物件（必須）"
                  value={projectQuery}
                  onValueChange={setProjectQuery}
                  items={projects}
                  getItemKey={(p) => String(p.id)}
                  getItemLabel={(p) => String(p.name || p.id)}
                  getSearchTexts={projectSuggestTexts}
                  onSelect={(p) => {
                    setProjectQuery(String(p.name || ''));
                    void saveBatchLinks({ project_id: p.id });
                  }}
                  emptyHint="該当する物件がありません"
                  inputClassName="min-h-[44px] rounded-lg border-2 border-slate-200 px-3 py-2 text-sm"
                />
                {selectedProject ? (
                  <p className="mt-1 text-xs font-bold text-emerald-700">
                    選択中: {selectedProject.name}
                  </p>
                ) : (
                  <p className="mt-1 text-xs font-bold text-amber-700">
                    該当する物件が見つからない場合は、先に物件管理画面で登録してください。
                  </p>
                )}
              </div>
              <div>
                <MasterSuggestInput
                  label="業者（元請）"
                  value={contractorQuery}
                  onValueChange={setContractorQuery}
                  items={customers}
                  getItemKey={(c) => String(c.id)}
                  getItemLabel={(c) => {
                    const company = String(c.company_name || c.name || '').trim();
                    const manager = String(c.manager_name || '').trim();
                    const phone = String(c.phone_number || '').trim();
                    const suffix = [manager, phone].filter(Boolean).join(' / ');
                    return suffix ? `${company}（${suffix}）` : company || String(c.id);
                  }}
                  getSearchTexts={customerSuggestTexts}
                  onSelect={(c) => {
                    setContractorQuery(String(c.company_name || c.name || ''));
                    void saveBatchLinks({ contractor_customer_id: c.id });
                  }}
                  emptyHint="該当する業者がありません"
                  inputClassName="min-h-[44px] rounded-lg border-2 border-slate-200 px-3 py-2 text-sm"
                />
                {selectedContractor ? (
                  <p className="mt-1 text-xs font-bold text-emerald-700">
                    選択中: {selectedContractor.company_name || selectedContractor.name}
                  </p>
                ) : null}
              </div>
              <div>
                <MasterSuggestInput
                  label="商社（組織）"
                  value={orgQuery}
                  onValueChange={setOrgQuery}
                  items={organizations.filter((o) => String(o.type || '') === 'agent')}
                  getItemKey={(o) => String(o.id)}
                  getItemLabel={(o) => String(o.name || o.id)}
                  getSearchTexts={orgSuggestTexts}
                  onSelect={(o) => {
                    setOrgQuery(String(o.name || ''));
                    void saveBatchLinks({ agent_organization_id: o.id });
                  }}
                  emptyHint="該当する商社がありません"
                  inputClassName="min-h-[44px] rounded-lg border-2 border-slate-200 px-3 py-2 text-sm"
                />
                {selectedOrg ? (
                  <p className="mt-1 text-xs font-bold text-emerald-700">選択中: {selectedOrg.name}</p>
                ) : null}
              </div>
            </div>

            {showOrderPlacerInput ? (
            <div className="mt-4 max-w-md">
              <label className="block text-xs font-black text-slate-600">
                発注担当者名
                <input
                  type="text"
                  value={orderPlacerName}
                  onChange={(e) => setOrderPlacerName(e.target.value)}
                  placeholder="確定時に全行共通の ordered_by として設定"
                  className="mt-1 min-h-[44px] w-full rounded-lg border-2 border-slate-200 px-3 py-2 text-sm font-bold text-slate-900 outline-none focus:border-indigo-400"
                />
              </label>
              <p className="mt-1 text-[11px] font-bold text-slate-500">
                組合名末尾の氏名や抽出結果から初期値を入れています。必要に応じて修正してください（空欄のままでも確定できます）。
              </p>
            </div>
            ) : isCustomerMode ? (
              <p className="mt-4 text-xs font-bold text-slate-600">
                発注担当者（ordered_by）: {lockedOrderPlacerName || orderPlacerName || '（ログイン中の担当者名）'}
              </p>
            ) : null}
          </div>

          {/* Unresolved factories */}
          <div className="rounded-xl border-2 border-amber-300 bg-amber-50/60 p-4">
            <h3 className="text-base font-black text-amber-950">
              工場名未解決（{unresolvedFactoryRows.length}）
            </h3>
            {unresolvedFactoryRows.length === 0 ? (
              <p className="mt-2 text-sm font-bold text-amber-900/70">未解決の工場はありません</p>
            ) : (
              <ul className="mt-3 space-y-3">
                {unresolvedFactoryRows.map((row) => (
                  <li
                    key={row.id}
                    className="rounded-lg border border-amber-200 bg-white p-3 dark:bg-slate-900"
                  >
                    <p className="text-sm font-black text-slate-900">
                      {row.row_date} {row.delivery_time || ''} ／ {row.factory_name_raw}
                    </p>
                    <div className="mt-2 max-w-md">
                      <MasterSuggestInput
                        label="工場を選択"
                        value={factoryQueryByRowId[row.id] || ''}
                        onValueChange={(v) =>
                          setFactoryQueryByRowId((prev) => ({ ...prev, [row.id]: v }))
                        }
                        items={factories}
                        getItemKey={(f) => String(f.id)}
                        getItemLabel={(f) => String(f.name || f.id)}
                        getSearchTexts={factorySuggestTexts}
                        onSelect={(f) => {
                          setFactoryQueryByRowId((prev) => ({
                            ...prev,
                            [row.id]: String(f.name || f.id),
                          }));
                          void resolveFactoryForRow(row, f);
                        }}
                        placeholder="工場名で検索"
                        emptyHint="該当する工場がありません"
                        inputClassName="min-h-[44px] rounded-lg border-2 border-slate-200 px-3 py-2 text-sm"
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* New candidates */}
          <div className="rounded-xl border-2 border-sky-300 bg-sky-50/50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-base font-black text-sky-950">
                新規候補（{newCandidateRows.filter((r) => r.row_status !== 'new_confirmed').length}）
              </h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={selectAllHighConfidence}
                  className="min-h-[40px] rounded-lg border border-sky-400 bg-white px-3 text-xs font-black text-sky-900 hover:bg-sky-100"
                >
                  high confidence をすべて選択
                </button>
                <button
                  type="button"
                  disabled={confirming}
                  onClick={() => void confirmSelected()}
                  className="min-h-[40px] rounded-lg bg-sky-600 px-4 text-xs font-black text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  {confirming
                    ? '確定中…'
                    : `選択した${[...selectedRowIds].filter((id) => newCandidateRows.some((r) => r.id === id && r.row_status !== 'new_confirmed')).length}件を確定する`}
                </button>
              </div>
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b-2 border-sky-200 bg-white/80">
                    <th className="px-2 py-2 font-black text-slate-700">選択</th>
                    <th className="px-2 py-2 font-black text-slate-700">日付</th>
                    <th className="px-2 py-2 font-black text-slate-700">時間</th>
                    <th className="px-2 py-2 font-black text-slate-700">工場</th>
                    <th className="px-2 py-2 font-black text-slate-700">数量</th>
                    <th className="px-2 py-2 font-black text-slate-700">車両</th>
                    <th className="px-2 py-2 font-black text-slate-700">配合</th>
                    <th className="px-2 py-2 font-black text-slate-700">試験</th>
                    <th className="px-2 py-2 font-black text-slate-700">備考</th>
                    <th className="px-2 py-2 font-black text-slate-700">信頼度</th>
                  </tr>
                </thead>
                <tbody>
                  {newCandidateRows.map((row) => {
                    const draft = draftRows[row.id] || row;
                    const confirmed = row.row_status === 'new_confirmed';
                    const low = row.row_confidence === 'low';
                    return (
                      <tr
                        key={row.id}
                        className={
                          'border-b border-sky-100 ' +
                          (low ? 'bg-amber-100/70 ' : 'bg-white/70 ') +
                          (confirmed ? 'opacity-60 ' : '')
                        }
                        title={row.row_confidence_reason || undefined}
                      >
                        <td className="px-2 py-2">
                          <input
                            type="checkbox"
                            disabled={confirmed}
                            checked={selectedRowIds.has(row.id)}
                            onChange={(e) => toggleRowSelected(row.id, e.target.checked)}
                          />
                        </td>
                        <td className="px-2 py-2 font-bold tabular-nums">{row.row_date}</td>
                        <td className="px-2 py-2">
                          <input
                            className="min-h-[36px] w-20 rounded border border-slate-200 px-2 text-sm font-bold"
                            value={draft.delivery_time || ''}
                            disabled={confirmed}
                            onChange={(e) => updateDraft(row.id, 'delivery_time', e.target.value)}
                            onBlur={() => void persistDraftRow(row.id)}
                          />
                        </td>
                        <td className="px-2 py-2 font-bold">
                          {factoryNameById[row.factory_id] || row.factory_name_raw}
                        </td>
                        <td className="px-2 py-2">
                          <input
                            className="min-h-[36px] w-20 rounded border border-slate-200 px-2 text-sm font-bold"
                            value={draft.quantity_m3 ?? ''}
                            disabled={confirmed}
                            onChange={(e) => updateDraft(row.id, 'quantity_m3', e.target.value)}
                            onBlur={() => void persistDraftRow(row.id)}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <select
                            className="min-h-[36px] rounded border border-slate-200 px-2 text-sm font-bold"
                            value={draft.vehicle_type || ''}
                            disabled={confirmed}
                            onChange={(e) => {
                              updateDraft(row.id, 'vehicle_type', e.target.value);
                              void db
                                .updateScheduleImportRow(row.id, { vehicle_type: e.target.value })
                                .then((updated) =>
                                  setRows((prev) =>
                                    prev.map((r) => (r.id === row.id ? { ...r, ...updated } : r)),
                                  ),
                                );
                            }}
                          >
                            <option value="大型">大型</option>
                            <option value="小型">小型</option>
                            <option value="large">large</option>
                            <option value="small">small</option>
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            className="min-h-[36px] w-28 rounded border border-slate-200 px-2 text-sm font-bold"
                            value={draft.mix_design || ''}
                            disabled={confirmed}
                            onChange={(e) => updateDraft(row.id, 'mix_design', e.target.value)}
                            onBlur={() => void persistDraftRow(row.id)}
                          />
                        </td>
                        <td className="px-2 py-2">
                          <select
                            className="min-h-[36px] rounded border border-slate-200 px-2 text-sm font-bold"
                            value={
                              draft.has_test === true ? 'true' : draft.has_test === false ? 'false' : ''
                            }
                            disabled={confirmed}
                            onChange={(e) => {
                              const v =
                                e.target.value === 'true'
                                  ? true
                                  : e.target.value === 'false'
                                    ? false
                                    : null;
                              updateDraft(row.id, 'has_test', v);
                              void db.updateScheduleImportRow(row.id, { has_test: v }).then((updated) =>
                                setRows((prev) =>
                                  prev.map((r) => (r.id === row.id ? { ...r, ...updated } : r)),
                                ),
                              );
                            }}
                          >
                            <option value="">—</option>
                            <option value="true">有</option>
                            <option value="false">無</option>
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <input
                            className="min-h-[36px] w-28 rounded border border-slate-200 px-2 text-sm font-bold"
                            value={draft.notes || ''}
                            disabled={confirmed}
                            onChange={(e) => updateDraft(row.id, 'notes', e.target.value)}
                            onBlur={() => void persistDraftRow(row.id)}
                          />
                        </td>
                        <td className="px-2 py-2">
                          {confirmed ? (
                            statusBadge('new_confirmed')
                          ) : (
                            <span
                              className={
                                'inline-flex rounded-full px-2 py-0.5 text-[10px] font-black ' +
                                (low ? 'bg-amber-400 text-amber-950' : 'bg-emerald-200 text-emerald-900')
                              }
                              title={row.row_confidence_reason || ''}
                            >
                              {row.row_confidence}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Change proposals */}
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <h3 className="text-base font-black text-slate-900">変更提案（{changeRows.length}）</h3>
            {changeRows.length === 0 ? (
              <p className="mt-2 text-sm font-bold text-slate-500">該当する行はありません</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {changeRows.map((row) => (
                  <li
                    key={row.id}
                    className={
                      'rounded-lg border px-3 py-2 ' +
                      (row.row_status === 'change_rejected'
                        ? 'border-red-400 bg-red-50'
                        : 'border-slate-200 bg-slate-50')
                    }
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-black text-slate-800">
                        {row.row_date} {row.delivery_time || ''} ／{' '}
                        {factoryNameById[row.factory_id] || row.factory_name_raw} ／{' '}
                        {row.quantity_m3 ?? '—'}m³
                      </p>
                      {statusBadge(row.row_status)}
                    </div>
                    {row.row_status === 'change_rejected' ? (
                      <p className="mt-1 text-xs font-bold text-red-800">
                        工場が拒否しました。管理者側で個別対応が必要です。
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Needs review */}
          <div className="rounded-xl border border-violet-300 bg-violet-50/50 p-4">
            <h3 className="text-base font-black text-violet-950">
              要管理者確認（{reviewRows.length}）
            </h3>
            {reviewRows.length === 0 ? (
              <p className="mt-2 text-sm font-bold text-violet-900/70">該当する行はありません</p>
            ) : (
              <ul className="mt-3 space-y-2">
                {reviewRows.map((row) => (
                  <li
                    key={row.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-violet-200 bg-white px-3 py-2"
                  >
                    <p className="text-sm font-black text-slate-800">
                      {row.row_date} {row.delivery_time || ''} ／ {row.factory_name_raw} ／{' '}
                      {row.quantity_m3 ?? '—'}m³
                      <span className="ml-2 text-xs font-bold text-violet-700">
                        ({row.match_type || row.row_status})
                      </span>
                    </p>
                    {row.row_status === 'excluded' ? (
                      statusBadge('excluded')
                    ) : (
                      <button
                        type="button"
                        onClick={() => void excludeReviewRow(row.id)}
                        className="rounded border border-slate-400 bg-white px-3 py-1.5 text-xs font-black text-slate-700 hover:bg-slate-100"
                      >
                        この行は無視する
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {(batch.extraction_notes || []).length > 0 ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
              <p className="font-black text-slate-800">抽出メモ</p>
              <ul className="mt-1 list-disc pl-5">
                {batch.extraction_notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {loading && view === 'detail' ? (
        <p className="mt-4 text-sm font-bold text-slate-500">読み込み中…</p>
      ) : null}
    </section>
  );
}
