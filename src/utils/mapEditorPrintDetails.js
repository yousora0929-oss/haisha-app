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

/**
 * 地図エディタ印刷用の物件・出荷明細
 * @param {object|null} order
 * @param {object|null} project
 */
export function buildMapEditorPrintDetailSections(order, project) {
  if (!order) {
    return { siteSection: [], shipmentSection: [] };
  }

  const siteName = resolveOrderSiteDisplayName(order, project) || '—';
  const prime =
    String(
      order.primeContractorName ||
        order.prime_contractor_name ||
        project?.contractor ||
        project?.sub_contractor_name ||
        '',
    ).trim() || '—';
  const trader =
    String(
      order.trading_company_name ||
        order.tradingCompanyName ||
        order.traderName ||
        order.projectTradingCompanyName ||
        '',
    ).trim();
  const contractorLine = trader ? `${prime}（商社: ${trader}）` : prime;

  const deliveryArea = order.deliveryArea ?? order.delivery_area ?? project?.delivery_area ?? '';
  const addressDetail = order.siteAddressDetail ?? order.site_address_detail ?? '';
  const combinedAddr =
    String(order.siteAddress ?? order.site_address ?? '').trim() ||
    combineDeliveryAddress(deliveryArea, addressDetail) ||
    String(project?.site_address ?? '').trim() ||
    '—';

  const orderedBy = String(order.orderedBy ?? order.ordered_by ?? '').trim() || '—';
  const phone =
    String(order.sitePhone ?? order.phone ?? order.site_phone ?? order.phone_number ?? '').trim() || '—';

  const dateLabel = formatPreferredDateLabel(order.preferredDate ?? order.preferred_date ?? order.delivery_date);
  const timeLabel = formatTimeSlotLabel(order.timeSlot ?? order.time_slot ?? order.preferredTimeSlot);
  const dateTimeLabel = timeLabel ? `${dateLabel} ${timeLabel}` : dateLabel;

  const qtyRaw = order.quantityM3 ?? order.quantity_m3 ?? order.quantityCube ?? order.quantity;
  const quantityLabel =
    qtyRaw !== '' && qtyRaw != null && String(qtyRaw).trim() !== '' ? `${String(qtyRaw).trim()} ㎥` : '—';

  const mix = parseMixComponents(order.mixText ?? order.mix ?? order.confirmedMixText ?? '');
  const mixDisplay =
    mix.raw && mix.raw !== '—'
      ? `${mix.strength !== '—' ? mix.strength : '—'} - ${mix.slump !== '—' ? mix.slump : '—'} - ${mix.aggregate !== '—' ? mix.aggregate : '—'} - ${mix.cement !== '—' ? mix.cement : '—'}`
      : '—';

  const hasTest = order.has_test === true || order.hasTest === true;

  return {
    siteSection: [
      { label: '物件名（現場名）', value: siteName },
      { label: '元請業者', value: contractorLine },
      { label: '現場住所', value: combinedAddr },
      { label: '発注担当者', value: orderedBy },
      { label: '担当者連絡先', value: phone },
    ],
    shipmentSection: [
      { label: '配達日時', value: dateTimeLabel },
      { label: '予定数量', value: quantityLabel },
      { label: '配合（呼び強度）', value: mix.strength },
      { label: 'スランプ', value: mix.slump },
      { label: '粗骨材', value: mix.aggregate },
      { label: 'セメント種別', value: mix.cement },
      { label: '配合（表示）', value: mixDisplay },
      { label: '試験', value: hasTest ? '試験あり' : '試験なし' },
    ],
  };
}
