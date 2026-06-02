import React, { useEffect, useMemo, useRef } from 'react';
import { Circle, ImageOverlay, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MAP_STAMP_EMOJI } from '../mapEditorConstants.js';
import {
  applyInitialViewCenter,
  boundsFromCenter,
  DEFAULT_MAP_CENTER,
  DEFAULT_UNLOAD_RADIUS_M,
} from '../utils/mapAnnotations.js';

const LEAFLET_DIV_ICON_CLASS = 'map-editor-leaflet-div-icon';

function createStampDivIcon(emoji, scale) {
  const size = Math.max(24, Math.round(36 * (Number(scale) > 0 ? Number(scale) : 1)));
  return L.divIcon({
    className: LEAFLET_DIV_ICON_CLASS,
    html: `<div style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.88)}px;line-height:1;display:flex;align-items:center;justify-content:center;">${emoji}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function MapViewportSync({ viewport, onViewportChange, syncKey }) {
  const map = useMap();
  const skipReportRef = useRef(0);

  useEffect(() => {
    if (!viewport) return;
    const lat = Number(viewport.lat);
    const lng = Number(viewport.lng);
    const zoom = Number(viewport.zoom);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    skipReportRef.current += 1;
    map.setView([lat, lng], Number.isFinite(zoom) ? zoom : map.getZoom(), { animate: false });
  }, [viewport?.lat, viewport?.lng, viewport?.zoom, syncKey, map]);

  useMapEvents({
    moveend() {
      if (skipReportRef.current > 0) {
        skipReportRef.current -= 1;
        return;
      }
      const c = map.getCenter();
      onViewportChange?.({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
    },
    zoomend() {
      if (skipReportRef.current > 0) {
        skipReportRef.current -= 1;
        return;
      }
      const c = map.getCenter();
      onViewportChange?.({ lat: c.lat, lng: c.lng, zoom: map.getZoom() });
    },
  });

  return null;
}

function MapResizeFix() {
  const map = useMap();
  useEffect(() => {
    const t = window.setTimeout(() => map.invalidateSize(), 80);
    return () => window.clearTimeout(t);
  }, [map]);
  return null;
}

/**
 * 印刷プレビュー／印刷用：表示専用マップ（パン・ズームのみ）
 */
function MapReadyBridge({ onMapReady }) {
  const map = useMap();
  useEffect(() => {
    onMapReady?.(map);
    return () => onMapReady?.(null);
  }, [map, onMapReady]);
  return null;
}

export function MapEditorViewportMap({
  annotations,
  viewport,
  onViewportChange,
  onMapReady,
  className = '',
  mapKey = 'default',
}) {
  const displayCenter = useMemo(
    () => applyInitialViewCenter(annotations)?.center || DEFAULT_MAP_CENTER,
    [annotations],
  );

  const mapCenter = useMemo(() => {
    const lat = parseFloat(String(viewport?.lat ?? displayCenter.lat ?? ''));
    const lng = parseFloat(String(viewport?.lng ?? displayCenter.lng ?? ''));
    return [
      Number.isFinite(lat) ? lat : DEFAULT_MAP_CENTER.lat,
      Number.isFinite(lng) ? lng : DEFAULT_MAP_CENTER.lng,
    ];
  }, [viewport?.lat, viewport?.lng, displayCenter.lat, displayCenter.lng]);

  const mapZoom = (() => {
    const z = parseFloat(String(viewport?.zoom ?? displayCenter.zoom ?? ''));
    return Number.isFinite(z) ? z : DEFAULT_MAP_CENTER.zoom;
  })();

  const overlayBounds = useMemo(() => {
    if (annotations?.imageOverlay?.bounds) return annotations.imageOverlay.bounds;
    return boundsFromCenter(displayCenter.lat, displayCenter.lng);
  }, [annotations?.imageOverlay?.bounds, displayCenter.lat, displayCenter.lng]);

  const syncKey = `${mapKey}-${viewport?.lat}-${viewport?.lng}-${viewport?.zoom}`;

  return (
    <div className={'relative h-full w-full min-h-[200px] ' + className}>
      <style>{`
        .${LEAFLET_DIV_ICON_CLASS} {
          background: transparent !important;
          border: none !important;
        }
      `}</style>
      <MapContainer
        center={mapCenter}
        zoom={mapZoom}
        className="z-0 h-full w-full cursor-grab"
        style={{ height: '100%', width: '100%', minHeight: '200px' }}
        scrollWheelZoom
      >
        <MapResizeFix />
        {onMapReady ? <MapReadyBridge onMapReady={onMapReady} /> : null}
        <MapViewportSync viewport={viewport} onViewportChange={onViewportChange} syncKey={syncKey} />
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {annotations?.imageOverlay?.url && overlayBounds ? (
          <ImageOverlay url={annotations.imageOverlay.url} bounds={overlayBounds} opacity={0.92} />
        ) : null}
        {(annotations?.unloadPoints || []).map((u) => (
          <Circle
            key={u.id}
            center={[u.lat, u.lng]}
            radius={u.radiusM || DEFAULT_UNLOAD_RADIUS_M}
            pathOptions={{
              color: '#dc2626',
              weight: 3,
              fillColor: '#ef4444',
              fillOpacity: 0.25,
            }}
          />
        ))}
        {(annotations?.stamps || []).map((s) => (
          <Marker
            key={s.id}
            position={[s.lat, s.lng]}
            icon={createStampDivIcon(MAP_STAMP_EMOJI[s.type] || '❓', s.scale)}
            interactive={false}
          />
        ))}
      </MapContainer>
    </div>
  );
}
