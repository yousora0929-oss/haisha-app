/** 同一 Storage 画像かどうか（クエリ付き URL の揺れを吸収） */
export function urlsReferToSameAsset(a, b) {
  const sa = String(a ?? '').trim();
  const sb = String(b ?? '').trim();
  if (!sa || !sb) return false;
  if (sa === sb) return true;
  try {
    const pa = new URL(sa, 'https://local.invalid').pathname;
    const pb = new URL(sb, 'https://local.invalid').pathname;
    return pa === pb;
  } catch {
    return sa.split('?')[0] === sb.split('?')[0];
  }
}

/**
 * 保存済みの合成 PNG（override / default_map）は編集・印刷プレビューでは
 * Leaflet の ImageOverlay にしない。OSM タイルの上に重ねると荷下ろし周辺が白く隠れる。
 */
export function stripSavedSnapshotOverlay(annotations, displayImageUrl) {
  if (!annotations || typeof annotations !== 'object') return annotations;
  const overlay = annotations.imageOverlay;
  const overlayUrl = String(overlay?.url ?? '').trim();
  if (!overlayUrl) return annotations;

  const display = String(displayImageUrl ?? '').trim();
  if (display && urlsReferToSameAsset(overlayUrl, display)) {
    return { ...annotations, imageOverlay: null };
  }

  return annotations;
}

/** 編集画面で図面オーバーレイを表示してよいか（セッション内アップロードのみ） */
export function shouldShowBlueprintOverlay(mapSource, imageOverlayUrl) {
  return mapSource === 'upload' && Boolean(String(imageOverlayUrl ?? '').trim());
}
