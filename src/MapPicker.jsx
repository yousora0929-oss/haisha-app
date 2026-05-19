import { useEffect, useMemo, useRef } from 'react';
import { MapContainer, TileLayer, Marker, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

/** Leaflet デフォルトアイコンが Vite で壊れる問題の対策 */
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
});

const OITA_CENTER = [33.238, 131.609];
const DEFAULT_ZOOM = 10;
const MARKER_ZOOM = 14;

function isValidCoordPair(pair) {
  return (
    Array.isArray(pair) &&
    pair.length === 2 &&
    Number.isFinite(pair[0]) &&
    Number.isFinite(pair[1]) &&
    pair[0] >= -90 &&
    pair[0] <= 90 &&
    pair[1] >= -180 &&
    pair[1] <= 180
  );
}

function parseCoordPair(latRaw, lngRaw) {
  const la = parseFloat(String(latRaw ?? '').trim());
  const ln = parseFloat(String(lngRaw ?? '').trim());
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return [la, ln];
}

function formatCoord(n) {
  return String(Math.round(n * 1e6) / 1e6);
}

function MapClickHandler({ onPick }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

/** マーカー位置が変わったとき地図中心を追従（手入力・編集読み込み時） */
function MapViewSync({ position }) {
  const map = useMap();
  useEffect(() => {
    if (!position) return;
    map.setView(position, Math.max(map.getZoom(), MARKER_ZOOM));
  }, [position, map]);
  return null;
}

/** 住所検索など：表示中心だけ移動（マーカー・確定座標は変更しない） */
function MapPanSync({ panTarget }) {
  const map = useMap();
  useEffect(() => {
    if (!panTarget) return;
    const la = Number(panTarget.lat);
    const ln = Number(panTarget.lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
    map.setView([la, ln], Math.max(map.getZoom(), MARKER_ZOOM));
  }, [panTarget, map]);
  return null;
}

function MapInstanceBinder({ mapRef }) {
  const map = useMap();
  useEffect(() => {
    mapRef.current = map;
    return () => {
      if (mapRef.current === map) mapRef.current = null;
    };
  }, [map, mapRef]);
  return null;
}

/**
 * 地図クリックで緯度・経度を選ぶピッカー
 * @param {{
 *   lat: string,
 *   lng: string,
 *   onPositionChange?: (lat: string, lng: string) => void,
 *   className?: string,
 *   interactive?: boolean,
 *   panTarget?: { lat: number, lng: number, key?: number|string } | null,
 * }} props
 */
export function MapPicker({ lat, lng, onPositionChange, className = '', interactive = true, panTarget = null }) {
  const mapRef = useRef(null);
  const position = useMemo(() => parseCoordPair(lat, lng), [lat, lng]);
  const panPosition = useMemo(() => parseCoordPair(panTarget?.lat, panTarget?.lng), [panTarget]);
  const centerCandidate = position ?? panPosition ?? OITA_CENTER;
  const center = isValidCoordPair(centerCandidate) ? centerCandidate : OITA_CENTER;
  const zoom = position ? MARKER_ZOOM : DEFAULT_ZOOM;

  const handlePick = (la, ln) => {
    if (typeof onPositionChange === 'function') {
      onPositionChange(formatCoord(la), formatCoord(ln));
    }
  };

  const handleResetToPosition = () => {
    if (!position || !mapRef.current) return;
    mapRef.current.setView(position, Math.max(mapRef.current.getZoom(), MARKER_ZOOM));
  };

  return (
    <div className={'overflow-hidden rounded-lg border-2 border-slate-300 bg-slate-100 ' + className}>
      <p className="border-b border-slate-200 bg-white px-2 py-1.5 text-[10px] font-bold text-slate-600">
        {interactive
          ? '地図をクリックして現場位置を指定（OpenStreetMap）'
          : '物件マスタの位置（確認用・変更不可）'}
      </p>
      <div className="relative">
        <MapContainer
          center={center}
          zoom={zoom}
          className="z-0 h-64 min-h-[300px] w-full sm:h-72"
          style={{ height: '300px', minHeight: '300px', width: '100%' }}
          scrollWheelZoom
        >
          <MapInstanceBinder mapRef={mapRef} />
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          {position ? <Marker position={position} /> : null}
          {interactive ? <MapClickHandler onPick={handlePick} /> : null}
          <MapViewSync position={position} />
          {panTarget ? <MapPanSync panTarget={panTarget} /> : null}
        </MapContainer>
        {position ? (
          <button
            type="button"
            onClick={handleResetToPosition}
            className="absolute bottom-4 right-4 z-[500] rounded-lg border border-gray-200 bg-white p-2 text-sm font-bold text-gray-700 shadow-md hover:bg-gray-50 active:scale-[0.98]"
          >
            現場位置に戻る
          </button>
        ) : null}
      </div>
    </div>
  );
}
