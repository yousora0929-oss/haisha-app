import { TIME_SLOTS } from '../haishaConstants.js';
import { combineDeliveryAddress } from './deliveryAreas.js';
import { resolveOrderSiteDisplayName, sanitizeSiteNameValue } from './siteNameDisplay.js';
import { resolveSiteContactName, resolveSitePhone } from './orderContactInfo.js';
import { formatPhoneNumberJP } from './phoneFormat.js';
import { formatYmdWithWeekday } from './orderGrouping.js';

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

/** 配合は 18-8-20BB のように、セメント記号を末尾へつなげて出す */
function formatPrintMixCode(order) {
  const raw = formatMixLabel(order);
  if (raw === '—') return '—';
  const matched = raw.match(/^(\d+)-(\d+)-(\d+)\s*([A-Za-z]+)?$/);
  if (!matched) return raw;
  const code = matched[4] ? matched[4].toUpperCase() : '';
  return `${matched[1]}-${matched[2]}-${matched[3]}${code}`;
}

function formatUnloadDurationLabel(order) {
  const labeled = field(order.unloadDurationLabel ?? order.unload_duration_label);
  if (labeled !== '—') return labeled;
  const raw = String(
    order.unloadDuration ??
      order.unload_duration ??
      order.unloadDurationMinutes ??
      order.unload_duration_minutes ??
      order.unloadingTime ??
      '',
  ).trim();
  if (!raw) return '30分（標準）';
  if (raw === '15') return '15分';
  if (raw === '30') return '30分（標準）';
  if (raw === '45') return '45分';
  if (raw === '60') return '60分（手押し車など時間要）';
  if (raw === '95_plus') return '95分以上（要相談）';
  return raw;
}

/** 空白と全角半角の差を除いて現場名と住所を比べる */
export function normalizePrintPlaceText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\s\u3000]+/g, '')
    .trim()
    .toLowerCase();
}

function explicitSiteName(order, project) {
  const candidates = [
    order?.siteName,
    order?.site_name,
    order?.projectName,
    order?.project_name,
    project?.name,
  ];
  for (const raw of candidates) {
    const clean = sanitizeSiteNameValue(raw);
    if (clean && clean !== '（現場名未設定）') return clean;
  }
  return '';
}

function buildPrintHeading(siteName, address) {
  const samePlace =
    Boolean(normalizePrintPlaceText(siteName)) &&
    normalizePrintPlaceText(siteName) === normalizePrintPlaceText(address);
  if (!siteName || samePlace) {
    return { mode: 'addressOnly', address: address && address !== '—' ? address : '—' };
  }
  return { mode: 'nameAndAddress', siteName, address: address || '—' };
}

function formatPrintDateLabel(dateStr) {
  const raw = String(dateStr ?? '').trim();
  if (!raw) return '—';
  const iso = raw.slice(0, 10);
  return formatYmdWithWeekday(iso) || formatPreferredDateLabel(raw);
}

function formatDeliveryDateTime(dateLabel, timeLabel) {
  const date = dateLabel && dateLabel !== '—' ? dateLabel : '';
  const time = String(timeLabel || '').trim();
  const timeOk = Boolean(time) && time !== '—';
  if (date && timeOk) return `${date} ${time}`;
  return date || (timeOk ? time : '—');
}

function formatQuantityAndVehicle(quantityLabel, vehicleLabel) {
  const qty = quantityLabel && quantityLabel !== '—' ? String(quantityLabel).replace(/\s+/g, '') : '—';
  const vehicle = vehicleLabel || '—';
  if (qty === '—' && vehicle === '—') return '—';
  return `${qty}・${vehicle}`;
}

/**
 * 運行指示書（A4上半分）用グリッドデータ
 * cells は既存の詳細セクション用。画面は compactRows と heading を使う。
 */
export function buildOperationInstructionPrintGrid(order, project, siteTitle) {
  if (!order) {
    return {
      siteTitle: siteTitle || '—',
      siteName: '—',
      address: '—',
      heading: { mode: 'addressOnly', address: '—' },
      cells: [],
      compactRows: [],
    };
  }

  const resolvedSiteName = resolveOrderSiteDisplayName(order, project) || '—';
  const siteName = explicitSiteName(order, project);
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

  const dateSource = order.preferredDate ?? order.preferred_date ?? order.delivery_date;
  const dateLabel = formatPreferredDateLabel(dateSource);
  const printDateLabel = formatPrintDateLabel(dateSource);
  const timeLabel = formatTimeSlotLabel(
    order.timeSlot ?? order.time_slot ?? order.preferredTimeSlot,
  );

  const qtyRaw = order.quantityM3 ?? order.quantity_m3 ?? order.quantityCube ?? order.quantity;
  const quantityLabel =
    qtyRaw !== '' && qtyRaw != null && String(qtyRaw).trim() !== ''
      ? `${String(qtyRaw).trim()} ㎥`
      : '—';
  const vehicleLabel = formatVehicleLabel(order);

  const orderedBy = field(resolveSiteContactName(order));
  const phone = field(formatPhoneNumberJP(resolveSitePhone(order)));

  const deliveryArea = order.deliveryArea ?? order.delivery_area ?? project?.delivery_area ?? '';
  const addressDetail = order.siteAddressDetail ?? order.site_address_detail ?? '';
  const address =
    field(order.siteAddress ?? order.site_address) !== '—'
      ? field(order.siteAddress ?? order.site_address)
      : field(combineDeliveryAddress(deliveryArea, addressDetail) || project?.site_address);

  const heading = buildPrintHeading(siteName, address);
  const deliveryWhen = formatDeliveryDateTime(printDateLabel, timeLabel);

  return {
    siteTitle: siteTitle || resolvedSiteName,
    siteName: resolvedSiteName,
    address,
    heading,
    compactRows: [
      {
        leftLabel: '配達日時',
        leftValue: deliveryWhen,
        rightLabel: '荷下ろし時間',
        rightValue: formatUnloadDurationLabel(order),
      },
      {
        leftLabel: '配合',
        leftValue: formatPrintMixCode(order),
        rightLabel: '数量・車両',
        rightValue: formatQuantityAndVehicle(quantityLabel, vehicleLabel),
      },
      {
        leftLabel: '発注業者（元請）',
        leftValue: contractor,
        rightLabel: '担当商社',
        rightValue: trader,
      },
      {
        leftLabel: '現場担当',
        leftValue: orderedBy,
        rightLabel: '連絡先',
        rightValue: phone,
        rightEmphasis: true,
      },
    ],
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
        rightLabel: '荷下ろし時間',
        rightValue: formatUnloadDurationLabel(order),
      },
      {
        section: '出荷数量',
        leftLabel: '予定数量',
        leftValue: quantityLabel,
        rightLabel: '指定車両',
        rightValue: vehicleLabel,
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
