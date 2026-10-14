import React, { useMemo } from 'react';
import { buildOperationInstructionPrintGrid } from '../utils/mapEditorPrintDetails.js';

function CompactRow({ row }) {
  return (
    <tr className="map-editor-print-grid-row">
      <th className="map-editor-print-grid-label">{row.leftLabel}</th>
      <td className="map-editor-print-grid-value">{row.leftValue}</td>
      <th className="map-editor-print-grid-label">{row.rightLabel}</th>
      <td
        className={
          'map-editor-print-grid-value' + (row.rightEmphasis ? ' map-editor-print-grid-phone' : '')
        }
      >
        {row.rightValue}
      </td>
    </tr>
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

  const heading = model.heading;

  return (
    <section className="map-editor-print-details-block print:break-inside-avoid">
      <header className="map-editor-print-instruction-header">
        <h1 className="map-editor-print-doc-title">運行指示書</h1>
        {heading?.mode === 'nameAndAddress' ? (
          <>
            <p className="map-editor-print-site-name">{heading.siteName}</p>
            <p className="map-editor-print-site-address">{heading.address}</p>
          </>
        ) : (
          <p className="map-editor-print-site-address-only">{heading?.address || '—'}</p>
        )}
      </header>
      <table className="map-editor-print-grid-table">
        <tbody>
          {(model.compactRows || []).map((row) => (
            <CompactRow key={row.leftLabel} row={row} />
          ))}
        </tbody>
      </table>
    </section>
  );
}
