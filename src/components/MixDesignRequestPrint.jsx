import React from 'react';
import { APP_BRAND_NAME } from '../constants/brand.js';
import { mixCodeForItem } from '../utils/mixDesignRequest.js';
import './mixDesignPrint.css';

const LABEL_CELL = { background: '#f7f7f5' };

function formatVehicleLabel(value) {
  const raw = Array.isArray(value) ? value.join('、') : String(value || '');
  if (raw.includes('large') && raw.includes('small')) return '大型・小型';
  if (raw.includes('large')) return '大型';
  if (raw.includes('small')) return '小型';
  return raw || '—';
}

function formatDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return '—';
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return raw;
  return `${Number(m[1])}/${Number(m[2])}/${Number(m[3])}`;
}

function yn(value) {
  return value ? '要' : '不要';
}

function testItemsLabel(request) {
  const parts = [];
  if (request?.testSalt) parts.push('塩化物');
  if (request?.testSplitPour) parts.push('分割打設');
  if (request?.testSpecimenCount != null && request.testSpecimenCount !== '') {
    parts.push(`供試体 ${request.testSpecimenCount}本`);
  }
  if (request?.testThirdParty) parts.push('第三者試験');
  return parts.length ? parts.join('／') : 'なし';
}

function submissionLabel(request) {
  if (request?.submissionMethod === 'electronic') return '電子';
  if (request?.submissionMethod === 'original') return '原本';
  return '—';
}

/**
 * 配合計画書作成依頼の A4 帳票（画面プレビュー / 印刷兼用）
 */
export function MixDesignRequestPrint({ header, request, items, className = '' }) {
  const rows = Array.isArray(items) ? items : [];
  const total = header?.totalVolumeM3 ?? request?.totalVolumeM3;
  const requester = String(request?.requestedBy || header?.requestedBy || '').trim();

  return (
    <div className={`mix-design-print-sheet ${className}`.trim()}>
      <h1 className="mix-design-print-title">配合計画書 作成依頼</h1>
      <table className="mix-design-print-meta">
        <tbody>
          <tr>
            <th style={LABEL_CELL}>工事名</th>
            <td>{header?.projectName || '—'}</td>
            <th style={LABEL_CELL}>業者名</th>
            <td>{header?.contractorName || '—'}</td>
          </tr>
          <tr>
            <th style={LABEL_CELL}>商社</th>
            <td>{header?.traderName || '—'}</td>
            <th style={LABEL_CELL}>現場担当者連絡先</th>
            <td>{header?.siteContact || '—'}</td>
          </tr>
          <tr>
            <th style={LABEL_CELL}>元請名</th>
            <td>{header?.primeContractorName || '—'}</td>
            <th style={LABEL_CELL}>現場住所</th>
            <td>{header?.siteAddress || '—'}</td>
          </tr>
          <tr>
            <th style={LABEL_CELL}>工期</th>
            <td>{header?.constructionPeriod || '—'}</td>
            <th style={LABEL_CELL}>初打設日</th>
            <td>{formatDate(header?.firstPourDate)}</td>
          </tr>
          <tr>
            <th style={LABEL_CELL}>車両</th>
            <td>{formatVehicleLabel(header?.vehicleTypes ?? request?.vehicleTypes)}</td>
            <th style={LABEL_CELL}>全体数量</th>
            <td>{total != null && total !== '' ? `${total} m³` : '—'}</td>
          </tr>
        </tbody>
      </table>

      <table className="mix-design-print-items">
        <thead>
          <tr>
            <th style={LABEL_CELL}>No</th>
            <th style={LABEL_CELL}>配合</th>
            <th style={LABEL_CELL}>W/C</th>
            <th style={LABEL_CELL}>単位水量</th>
            <th style={LABEL_CELL}>数量</th>
            <th style={LABEL_CELL}>打設日</th>
            <th style={LABEL_CELL}>施工箇所</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((item, index) => (
            <tr key={item.localId || item.id || index}>
              <td className="mix-design-print-no">{index + 1}</td>
              <td className="mix-design-print-code">{mixCodeForItem(item) || '—'}</td>
              <td className="mix-design-print-center">
                {item.waterCementRatio != null && item.waterCementRatio !== '' ? item.waterCementRatio : '—'}
              </td>
              <td className="mix-design-print-center">
                {item.unitWaterContent != null && item.unitWaterContent !== '' ? item.unitWaterContent : '—'}
              </td>
              <td className="mix-design-print-right">
                {item.quantityM3 != null && item.quantityM3 !== '' ? item.quantityM3 : '—'}
              </td>
              <td className="mix-design-print-right">{formatDate(item.pourDate)}</td>
              <td className="mix-design-print-loc">{item.constructionLocation || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="mix-design-print-meta mix-design-print-footer-table">
        <tbody>
          <tr>
            <th style={LABEL_CELL}>試験項目</th>
            <td colSpan={3}>{testItemsLabel(request)}</td>
          </tr>
          <tr>
            <th style={LABEL_CELL}>提出方法</th>
            <td>{submissionLabel(request)}</td>
            <th style={LABEL_CELL}>宛先</th>
            <td>{request?.submissionEmail || '—'}</td>
          </tr>
          <tr>
            <th style={LABEL_CELL}>お見積書要否</th>
            <td>{request?.quoteRequested == null ? '—' : yn(request.quoteRequested)}</td>
            <th style={LABEL_CELL}>備考</th>
            <td>{request?.memo || '—'}</td>
          </tr>
        </tbody>
      </table>

      <div className="mix-design-print-signoff">
        <p className="mix-design-print-requester">{requester || '—'}</p>
        <p className="mix-design-print-issuer">{APP_BRAND_NAME} 発行</p>
      </div>
    </div>
  );
}
