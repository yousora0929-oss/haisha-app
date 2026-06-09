import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MAP_STAMP_EMOJI } from '../mapEditorConstants.js';
import {
  applyInitialViewCenter,
  DEFAULT_MAP_CENTER,
  DEFAULT_UNLOAD_RADIUS_M,
} from '../utils/mapAnnotations.js';
import { createStampDivIcon, LEAFLET_DIV_ICON_CLASS } from '../utils/mapEditorStampIcon.js';

function MapZoomSync({ onZoomChange }) {
  const map = useMap();

  useMapEvents({
    zoom() {
      onZoomChange?.(map.getZoom());
    },
    zoomend() {
      onZoomChange?.(map.getZoom());
    },
  });

  useEffect(() => {
    onZoomChange?.(map.getZoom());
  }, [map, onZoomChange]);

  return null;
}

function ViewportStampMarkers({ annotations, mapZoom }) {
  return (annotations?.stamps || []).map((s) => (
    <Marker
      key={s.id}
      position={[s.lat, s.lng]}
      icon={createStampDivIcon(MAP_STAMP_EMOJI[s.type] || '❓', s.scale, mapZoom)}
      interactive={false}
    />
  ));
}

function ViewportStampLayer({ annotations }) {
  const [mapZoom, setMapZoom] = useState(null);
  return (
    <>
      <MapZoomSync onZoomChange={setMapZoom} />
      <ViewportStampMarkers annotations={annotations} mapZoom={mapZoom} />
    </>
  );
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

function MapResizeFix({ fixedHeightPx = 0 }) {
  const map = useMap();
  useEffect(() => {
    const run = () => map.invalidateSize({ animate: false });
    run();
    const delays = fixedHeightPx > 0 ? [50, 200, 500, 900] : [80];
    const timers = delays.map((ms) => window.setTimeout(run, ms));
    const onBeforePrint = () => run();
    window.addEventListener('beforeprint', onBeforePrint);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener('beforeprint', onBeforePrint);
    };
  }, [map, fixedHeightPx]);
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
  fixedHeightPx = 0,
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

  // 印刷・プレビューは OSM タイル＋注釈のみ（保存済み合成 PNG は重ねない）

  const syncKey = `${mapKey}-${viewport?.lat}-${viewport?.lng}-${viewport?.zoom}`;
  const heightPx = Number(fixedHeightPx) > 0 ? Number(fixedHeightPx) : null;
  const rootStyle = heightPx
    ? { height: `${heightPx}px`, width: '100%', minHeight: `${heightPx}px` }
    : undefined;

  return (
    <div
      className={'relative h-full w-full ' + (heightPx ? '' : 'min-h-[200px] ') + className}
      style={rootStyle}
    >
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
        style={
          heightPx
            ? { height: `${heightPx}px`, width: '100%', minHeight: `${heightPx}px` }
            : { height: '100%', width: '100%', minHeight: '200px' }
        }
        scrollWheelZoom
      >
        <MapResizeFix fixedHeightPx={heightPx || 0} />
        {onMapReady ? <MapReadyBridge onMapReady={onMapReady} /> : null}
        <MapViewportSync viewport={viewport} onViewportChange={onViewportChange} syncKey={syncKey} />
        <TileLayer
          attribution='&copy; OpenStreetMap'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          updateWhenIdle={Boolean(heightPx)}
          keepBuffer={heightPx ? 3 : 1}
        />
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
        <ViewportStampLayer annotations={annotations} />
      </MapContainer>
    </div>
  );
}
