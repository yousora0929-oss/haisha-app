import React from 'react';
import { APP_BRAND_NAME } from '../constants/brand.js';
import {
  MIX_DESIGN_VEHICLE_OPTIONS,
  formatConstructionPeriod,
  mixCodeForItem,
  preventMinusKey,
  sanitizeNonNegativeInput,
} from '../utils/mixDesignRequest.js';
import './mixDesignPrint.css';

const LABEL_CELL = { background: '#f7f7f5' };

function formatVehicleLabel(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[、,]/);
  const labels = MIX_DESIGN_VEHICLE_OPTIONS.filter((opt) => list.includes(opt.id)).map((opt) => opt.label);
  if (labels.length) return labels.join('・');
  const raw = list.filter(Boolean).join('、');
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

function submissionLabel(request) {
  if (request?.submissionMethod === 'electronic') return '電子';
  if (request?.submissionMethod === 'original') return '原本';
  return '—';
}

function PrintField({ editable, value, display, onChange, type = 'text', className = '', placeholder = '—' }) {
  if (!editable) {
    return <span>{display ?? (value || placeholder)}</span>;
  }
  const isNumber = type === 'number';
  return (
    <input
      type={isNumber ? 'number' : type}
      min={isNumber ? '0' : undefined}
      value={value ?? ''}
      placeholder={placeholder}
      onKeyDown={isNumber ? preventMinusKey : undefined}
      onChange={(e) => onChange(isNumber ? sanitizeNonNegativeInput(e.target.value) : e.target.value)}
      className={`mix-design-print-input ${className}`.trim()}
    />
  );
}

/**
 * 配合計画書作成依頼の A4 帳票（画面プレビュー / 印刷兼用）
 * editable 時は draft と同じ state を直接更新する。
 */
export function MixDesignRequestPrint({
  header,
  request,
  items,
  className = '',
  editable = false,
  onHeaderChange,
  onRequestChange,
  onItemChange,
}) {
  const rows = Array.isArray(items) ? items : [];
  const total = header?.totalVolumeM3 ?? request?.totalVolumeM3;
  const requester = String(request?.requestedBy || header?.requestedBy || '').trim();
  const patchHeader = (patch) => onHeaderChange?.(patch);
  const patchRequest = (patch) => onRequestChange?.(patch);
  const periodText =
    header?.constructionPeriod || formatConstructionPeriod(header?.periodStart, header?.periodEnd);

  return (
    <div className={`mix-design-print-sheet ${className}`.trim()}>
      <h1 className="mix-design-print-title">配合計画書 作成依頼</h1>
      <table className="mix-design-print-meta">
        <tbody>
          <tr>
            <th style={LABEL_CELL}>工事名</th>
            <td>
              <PrintField
                editable={editable}
                value={header?.projectName}
                onChange={(v) => patchHeader({ projectName: v })}
              />
            </td>
            <th style={LABEL_CELL}>業者名</th>
            <td>
              <PrintField
                editable={editable}
                value={header?.contractorName}
                onChange={(v) => patchHeader({ contractorName: v })}
              />
            </td>
          </tr>
          <tr>
            <th style={LABEL_CELL}>商社</th>
            <td>
              <PrintField
                editable={editable}
                value={header?.traderName}
                onChange={(v) => patchHeader({ traderName: v })}
              />
            </td>
            <th style={LABEL_CELL}>現場担当者</th>
            <td>
              <PrintField
                editable={editable}
                value={header?.siteManagerName}
                onChange={(v) => patchHeader({ siteManagerName: v })}
              />
            </td>
          </tr>
          <tr>
            <th style={LABEL_CELL}>元請名</th>
            <td>
              <PrintField
                editable={editable}
                value={header?.primeContractorName}
                onChange={(v) => patchHeader({ primeContractorName: v })}
              />
            </td>
            <th style={LABEL_CELL}>現場担当者連絡先</th>
            <td>
              <PrintField
                editable={editable}
                value={header?.siteManagerContact}
                onChange={(v) => patchHeader({ siteManagerContact: v })}
              />
            </td>
          </tr>
          <tr>
            <th style={LABEL_CELL}>現場住所</th>
            <td colSpan={3}>
              <PrintField
                editable={editable}
                value={header?.siteAddress}
                onChange={(v) => patchHeader({ siteAddress: v })}
              />
            </td>
          </tr>
          <tr>
            <th style={LABEL_CELL}>工期</th>
            <td>
              {editable ? (
                <div className="mix-design-print-period">
                  <input
                    type="date"
                    value={header?.periodStart || ''}
                    onChange={(e) => patchHeader({ periodStart: e.target.value })}
                    className="mix-design-print-input"
                  />
                  <span>～</span>
                  <input
                    type="date"
                    value={header?.periodEnd || ''}
                    onChange={(e) => patchHeader({ periodEnd: e.target.value })}
                    className="mix-design-print-input"
                  />
                </div>
              ) : (
                periodText || '—'
              )}
            </td>
            <th style={LABEL_CELL}>初打設日</th>
            <td>{formatDate(header?.firstPourDate)}</td>
          </tr>
          <tr>
            <th style={LABEL_CELL}>車両</th>
            <td>
              {editable ? (
                <div className="mix-design-print-vehicles">
                  {MIX_DESIGN_VEHICLE_OPTIONS.map((opt) => (
                    <label key={opt.id}>
                      <input
                        type="checkbox"
                        checked={(header?.vehicleTypes || []).includes(opt.id)}
                        onChange={() => {
                          const current = Array.isArray(header?.vehicleTypes) ? header.vehicleTypes : [];
                          const next = current.includes(opt.id)
                            ? current.filter((v) => v !== opt.id)
                            : [...current, opt.id];
                          patchHeader({ vehicleTypes: next });
                        }}
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              ) : (
                formatVehicleLabel(header?.vehicleTypes ?? request?.vehicleTypes)
              )}
            </td>
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
                <PrintField
                  editable={editable}
                  type="number"
                  value={item.waterCementRatio}
                  display={item.waterCementRatio != null && item.waterCementRatio !== '' ? item.waterCementRatio : '—'}
                  onChange={(v) => onItemChange?.(index, { waterCementRatio: v })}
                />
              </td>
              <td className="mix-design-print-center">
                <PrintField
                  editable={editable}
                  type="number"
                  value={item.unitWaterContent}
                  display={item.unitWaterContent != null && item.unitWaterContent !== '' ? item.unitWaterContent : '—'}
                  onChange={(v) => onItemChange?.(index, { unitWaterContent: v })}
                />
              </td>
              <td className="mix-design-print-right">
                <PrintField
                  editable={editable}
                  type="number"
                  value={item.quantityM3}
                  display={item.quantityM3 != null && item.quantityM3 !== '' ? item.quantityM3 : '—'}
                  onChange={(v) => onItemChange?.(index, { quantityM3: v })}
                />
              </td>
              <td className="mix-design-print-right">
                {editable ? (
                  <div className="mix-design-print-period">
                    <PrintField
                      editable
                      type="number"
                      value={item.pourMonth}
                      placeholder="月"
                      onChange={(v) => onItemChange?.(index, { pourMonth: v })}
                    />
                    <span>/</span>
                    <PrintField
                      editable
                      type="number"
                      value={item.pourDay}
                      placeholder="日"
                      onChange={(v) => onItemChange?.(index, { pourDay: v })}
                    />
                  </div>
                ) : (
                  formatDate(item.pourDate)
                )}
              </td>
              <td className="mix-design-print-loc">
                <PrintField
                  editable={editable}
                  value={item.constructionLocation}
                  display={item.constructionLocation || '—'}
                  onChange={(v) => onItemChange?.(index, { constructionLocation: v })}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <table className="mix-design-print-meta mix-design-print-footer-table">
        <tbody>
          <tr>
            <th style={LABEL_CELL}>提出方法</th>
            <td>
              {editable ? (
                <select
                  value={request?.submissionMethod || ''}
                  onChange={(e) => patchRequest({ submissionMethod: e.target.value })}
                  className="mix-design-print-input"
                >
                  <option value="">未指定</option>
                  <option value="original">原本</option>
                  <option value="electronic">電子</option>
                </select>
              ) : (
                submissionLabel(request)
              )}
            </td>
            <th style={LABEL_CELL}>宛先</th>
            <td>
              <PrintField
                editable={editable}
                type="email"
                value={request?.submissionEmail}
                onChange={(v) => patchRequest({ submissionEmail: v })}
              />
            </td>
          </tr>
          <tr>
            <th style={LABEL_CELL}>備考</th>
            <td colSpan={3}>
              {editable ? (
                <textarea
                  value={request?.memo || ''}
                  onChange={(e) => patchRequest({ memo: e.target.value })}
                  rows={2}
                  className="mix-design-print-input mix-design-print-memo"
                />
              ) : (
                request?.memo || '—'
              )}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="mix-design-print-signoff">
        <p className="mix-design-print-requester">
          {editable ? (
            <PrintField
              editable
              value={request?.requestedBy || header?.requestedBy}
              onChange={(v) => {
                patchRequest({ requestedBy: v });
                patchHeader({ requestedBy: v });
              }}
            />
          ) : (
            requester || '—'
          )}
        </p>
        <p className="mix-design-print-issuer">{APP_BRAND_NAME} 発行</p>
      </div>
    </div>
  );
}
