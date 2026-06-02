import React, { useMemo } from 'react';
import { buildMapEditorPrintDetailSections } from '../utils/mapEditorPrintDetails.js';

function DetailTable({ title, rows }) {
  if (!rows?.length) return null;
  return (
    <section className="map-editor-print-details-block">
      <h2 className="map-editor-print-details-heading">{title}</h2>
      <table className="map-editor-print-details-table w-full border-collapse text-[10pt]">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-slate-200">
              <th className="w-[32%] bg-slate-50 px-3 py-2 text-left align-top font-bold text-slate-600">
                {row.label}
              </th>
              <td className="px-3 py-2 align-top font-semibold text-slate-900">{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * 印刷用：物件詳細（発注内容）A4明細表
 */
export function MapEditorPrintDetails({ order, project, siteTitle }) {
  const { siteSection, shipmentSection } = useMemo(
    () => buildMapEditorPrintDetailSections(order, project),
    [order, project],
  );

  return (
    <div className="map-editor-print-details-section map-editor-print-only px-0 py-0">
      <header className="map-editor-print-details-title mb-4 border-b-2 border-slate-800 pb-2">
        <h1 className="text-[14pt] font-black text-slate-900">発注内容・物件詳細</h1>
        {siteTitle ? <p className="mt-1 text-[11pt] font-bold text-slate-600">{siteTitle}</p> : null}
      </header>
      <DetailTable title="現場情報" rows={siteSection} />
      <DetailTable title="出荷情報" rows={shipmentSection} />
    </div>
  );
}
