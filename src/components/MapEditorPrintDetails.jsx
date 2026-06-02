import React, { useMemo } from 'react';
import { buildOperationInstructionPrintGrid } from '../utils/mapEditorPrintDetails.js';

function GridRow({ cell }) {
  return (
    <>
    <tr className="map-editor-print-grid-row border-b border-slate-300">
      <th
        colSpan={2}
        className="border border-slate-300 bg-slate-100 px-2 py-1 text-left text-[9pt] font-black text-slate-700"
      >
        {cell.section}
      </th>
    </tr>
    <tr className="border-b border-slate-300">
      <td className="w-1/2 border border-slate-300 px-2 py-1.5 align-top">
        <p className="text-[8pt] font-bold text-slate-500">{cell.leftLabel}</p>
        <p className="text-[10pt] font-black leading-snug text-slate-900">{cell.leftValue}</p>
      </td>
      <td className="w-1/2 border border-slate-300 px-2 py-1.5 align-top">
        <p className="text-[8pt] font-bold text-slate-500">{cell.rightLabel}</p>
        <p className="text-[10pt] font-black leading-snug text-slate-900">{cell.rightValue}</p>
      </td>
    </tr>
    </>
  );
}

/**
 * 運行指示書 — A4上半分の自動帳票グリッド
 */
export function MapEditorPrintDetails({ order, project, siteTitle }) {
  const model = useMemo(
    () => buildOperationInstructionPrintGrid(order, project, siteTitle),
    [order, project, siteTitle],
  );

  if (!order) return null;

  return (
    <section className="map-editor-print-details-block print:break-inside-avoid">
      <header className="map-editor-print-instruction-header mb-2 border-b-2 border-slate-800 pb-1">
        <h1 className="text-[13pt] font-black leading-tight text-slate-900">運行指示書</h1>
        <p className="mt-0.5 text-[10pt] font-bold text-slate-700">{model.siteTitle}</p>
        {model.address && model.address !== '—' ? (
          <p className="mt-0.5 text-[9pt] font-semibold text-slate-600">{model.address}</p>
        ) : null}
      </header>
      <table className="map-editor-print-grid-table w-full border-collapse border border-slate-400">
        <tbody>
          {model.cells.map((cell) => (
            <GridRow key={cell.section} cell={cell} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
