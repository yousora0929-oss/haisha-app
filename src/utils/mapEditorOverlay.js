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

const SAVED_MAP_STORAGE_PATH = '/storage/v1/object/public/maps/';

/** maps バケットに保存された合成スナップショット PNG の URL かどうか */
export function isSavedMapSnapshotUrl(url) {
  const s = String(url ?? '').trim();
  if (!s) return false;
  try {
    return new URL(s, 'https://local.invalid').pathname.includes(SAVED_MAP_STORAGE_PATH);
  } catch {
    return s.includes(SAVED_MAP_STORAGE_PATH);
  }
}

/**
 * 保存済みの合成 PNG（override / default_map）は編集・印刷プレビューでは
 * Leaflet の ImageOverlay にしない。OSM タイルの上に重ねると荷下ろし周辺が白く隠れる。
 * また、保存 PNG を imageOverlay に残したまま再保存すると古い PNG を背景として
 * 再焼き込みしてしまうため、maps バケットの URL は表示中 URL と一致しなくても除去する
 * （過去の保存で古い URL が残ったデータの自己修復）。
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
  if (isSavedMapSnapshotUrl(overlayUrl)) {
    return { ...annotations, imageOverlay: null };
  }

  return annotations;
}

/** 編集画面で図面オーバーレイを表示してよいか（セッション内アップロードのみ） */
export function shouldShowBlueprintOverlay(mapSource, imageOverlayUrl) {
  return mapSource === 'upload' && Boolean(String(imageOverlayUrl ?? '').trim());
}
