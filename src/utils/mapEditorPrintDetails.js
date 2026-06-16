import { TIME_SLOTS } from '../haishaConstants.js';
import { combineDeliveryAddress } from './deliveryAreas.js';
import { resolveOrderSiteDisplayName } from './siteNameDisplay.js';

/** 配合文字列を 強度-スランプ-粗骨材-セメント に分解 */
export function parseMixComponents(mixText) {
  const raw = String(mixText ?? '').trim();
  const m = raw.match(/^(\d+)-(\d+)-(\d+)([A-Za-z]+)$/);
  if (!m) {
    return { raw: raw || '—', strength: '—', slump: '—', aggregate: '—', cement: '—' };
  }
  return {
    raw,
    strength: m[1],
    slump: m[2],
    aggregate: m[3],
    cement: m[4].toUpperCase(),
  };
}

export function formatPreferredDateLabel(dateStr) {
  const date = String(dateStr ?? '').trim();
  if (!date) return '—';
  const p = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (p) return `${p[1]}/${Number(p[2])}/${Number(p[3])}`;
  return date;
}

export function formatTimeSlotLabel(slotValue) {
  const v = String(slotValue ?? '').trim();
  if (!v) return '';
  const hit = TIME_SLOTS.find((s) => String(s.value) === v);
  return hit?.label || v;
}

function formatVehicleLabel(order) {
  const raw = String(
    order?.vehicleType ?? order?.vehicle_type ?? order?.car_size ?? order?.vehicleLabel ?? '',
  )
    .trim()
    .toLowerCase();
  if (!raw) return '—';
  if (raw === 'large' || raw === 'big' || raw.includes('大型')) return '大型';
  if (raw === 'small' || raw.includes('小型')) return '小型';
  return raw;
}

function field(value) {
  const s = String(value ?? '').trim();
  return s || '—';
}

function formatMixLabel(order) {
  return field(
    order.confirmedMixText ??
      order.confirmed_mix_text ??
      order.mixText ??
      order.mix_text,
  );
}

function formatPouringTimeLabel(order) {
  const explicit = field(
    order.timePointLabel ??
      order.time_point_label ??
      order.timeSlotLabel ??
      order.time_slot_label,
  );
  if (explicit !== '—') return explicit;
  const slotLabel = formatTimeSlotLabel(
    order.timeSlot ?? order.time_slot ?? order.preferredTimeSlot,
  );
  return slotLabel || '—';
}

/**
 * 運行指示書（A4上半分）用グリッドデータ
 */
export function buildOperationInstructionPrintGrid(order, project, siteTitle) {
  if (!order) {
    return { siteTitle: siteTitle || '—', siteName: '—', address: '—', cells: [] };
  }

  const siteName = resolveOrderSiteDisplayName(order, project) || '—';
  const contractor = field(
    order.contractorName ??
      order.contractor_name ??
      order.contractor ??
      project?.contractor ??
      project?.sub_contractor_name,
  );
  const trader = field(
    order.trading_company_name ??
      order.tradingCompanyName ??
      order.traderName ??
      order.projectTradingCompanyName,
  );

  const dateLabel = formatPreferredDateLabel(
    order.preferredDate ?? order.preferred_date ?? order.delivery_date,
  );
  const timeLabel = formatTimeSlotLabel(
    order.timeSlot ?? order.time_slot ?? order.preferredTimeSlot,
  );

  const qtyRaw = order.quantityM3 ?? order.quantity_m3 ?? order.quantityCube ?? order.quantity;
  const quantityLabel =
    qtyRaw !== '' && qtyRaw != null && String(qtyRaw).trim() !== ''
      ? `${String(qtyRaw).trim()} ㎥`
      : '—';

  const orderedBy = field(order.orderedBy ?? order.ordered_by);
  const phone = field(
    order.sitePhone ?? order.phone ?? order.site_phone ?? order.phone_number,
  );

  const deliveryArea = order.deliveryArea ?? order.delivery_area ?? project?.delivery_area ?? '';
  const addressDetail = order.siteAddressDetail ?? order.site_address_detail ?? '';
  const address =
    field(order.siteAddress ?? order.site_address) !== '—'
      ? field(order.siteAddress ?? order.site_address)
      : field(combineDeliveryAddress(deliveryArea, addressDetail) || project?.site_address);

  return {
    siteTitle: siteTitle || siteName,
    siteName,
    address,
    cells: [
      {
        section: '配送日時',
        leftLabel: '配達日付',
        leftValue: dateLabel,
        rightLabel: '配達時間',
        rightValue: timeLabel || '—',
      },
      {
        section: '打設内容',
        leftLabel: '配合',
        leftValue: formatMixLabel(order),
        rightLabel: '打設時間',
        rightValue: formatPouringTimeLabel(order),
      },
      {
        section: '出荷数量',
        leftLabel: '予定数量',
        leftValue: quantityLabel,
        rightLabel: '指定車両',
        rightValue: formatVehicleLabel(order),
      },
      {
        section: '関係業者',
        leftLabel: '発注業者（元請）',
        leftValue: contractor,
        rightLabel: '担当商社',
        rightValue: trader,
      },
      {
        section: '現場担当',
        leftLabel: '現場担当者名',
        leftValue: orderedBy,
        rightLabel: '担当者連絡先',
        rightValue: phone,
      },
    ],
  };
}

export function buildMapEditorPrintDetailSections(order, project) {
  const grid = buildOperationInstructionPrintGrid(order, project);
  if (!order) {
    return { siteSection: [], shipmentSection: [] };
  }
  return {
    siteSection: grid.cells.flatMap((c) => [
      { label: `${c.section}（${c.leftLabel}）`, value: c.leftValue },
      { label: c.rightLabel, value: c.rightValue },
    ]),
    shipmentSection: [
      { label: '物件名', value: grid.siteName },
      { label: '住所', value: grid.address },
    ],
  };
}
