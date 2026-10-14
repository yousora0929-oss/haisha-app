import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Circle, CircleMarker, MapContainer, Marker, Polyline, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MAP_STAMP_EMOJI } from '../mapEditorConstants.js';
import {
  applyInitialViewCenter,
  DEFAULT_MAP_CENTER,
  DEFAULT_UNLOAD_RADIUS_M,
} from '../utils/mapAnnotations.js';
import { createCommentDivIcon, createStampDivIcon, LEAFLET_DIV_ICON_CLASS } from '../utils/mapEditorStampIcon.js';
import { chooseUnloadLabelPlacement } from '../utils/mapEditorPrintLayout.js';
import { DEFAULT_MAP_BASE_LAYER_ID } from '../mapTiles.js';
import { MapBaseLayerController } from './MapBaseLayerSwitch.jsx';

const UNLOAD_CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

function unloadPrintLabel(index, total) {
  if (total <= 1) return '荷下ろし';
  return `荷下ろし${UNLOAD_CIRCLED[index] || String(index + 1)}`;
}

function createUnloadLabelIcon(text) {
  const label = String(text || '荷下ろし');
  const width = Math.max(72, Math.round(label.length * 16 + 18));
  const height = 28;
  return {
    width,
    height,
    icon: L.divIcon({
      className: LEAFLET_DIV_ICON_CLASS,
      html: `<div style="box-sizing:border-box;width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;background:#fff;border:2px solid #000;color:#000;font-size:12pt;font-weight:700;line-height:1;white-space:nowrap;">${label
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')}</div>`,
      iconSize: [width, height],
      iconAnchor: [width / 2, height / 2],
    }),
  };
}

function radiusPxOnMap(map, latlng, radiusM) {
  const center = map.latLngToContainerPoint(latlng);
  const cos = Math.cos((latlng.lat * Math.PI) / 180) || 1;
  const lng = latlng.lng + radiusM / (111320 * cos);
  const edge = map.latLngToContainerPoint(L.latLng(latlng.lat, lng));
  return Math.max(6, center.distanceTo(edge));
}

function markerObstacle(map, lat, lng, width, height) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const point = map.latLngToContainerPoint([lat, lng]);
  const size = map.getSize();
  if (!size || point.x < -40 || point.y < -40 || point.x > size.x + 40 || point.y > size.y + 40) return null;
  return { x: point.x - width / 2, y: point.y - height / 2, w: width, h: height };
}

function PrintUnloadEmphasis({ annotations }) {
  const map = useMap();
  const [items, setItems] = useState([]);
  const recompute = useCallback(() => {
    const size = map.getSize();
    if (!size || size.x < 8 || size.y < 8) {
      setItems([]);
      return;
    }
    const points = annotations?.unloadPoints || [];
    const obstacles = [];
    for (const stamp of annotations?.stamps || []) {
      const rect = markerObstacle(map, Number(stamp.lat), Number(stamp.lng), 40, 40);
      if (rect) obstacles.push(rect);
    }
    for (const comment of annotations?.comments || []) {
      const text = String(comment.text || '');
      const rect = markerObstacle(map, Number(comment.lat), Number(comment.lng), Math.min(140, 28 + text.length * 12), 36);
      if (rect) obstacles.push(rect);
    }
    const onScreen = [];
    points.forEach((point, index) => {
      const lat = Number(point?.lat);
      const lng = Number(point?.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const center = map.latLngToContainerPoint([lat, lng]);
      if (center.x < 0 || center.y < 0 || center.x > size.x || center.y > size.y) return;
      onScreen.push({ point, index, lat, lng });
    });
    const placed = [];
    const next = [];
    onScreen.forEach((entry, visibleIndex) => {
      const { point, index, lat, lng } = entry;
      const latlng = L.latLng(lat, lng);
      const center = map.latLngToContainerPoint(latlng);
      const label = unloadPrintLabel(visibleIndex, onScreen.length);
      const icon = createUnloadLabelIcon(label);
      const radiusM = Number(point.radiusM) > 0 ? Number(point.radiusM) : DEFAULT_UNLOAD_RADIUS_M;
      const placement = chooseUnloadLabelPlacement({
        centerX: center.x,
        centerY: center.y,
        radiusPx: radiusPxOnMap(map, latlng, radiusM),
        mapWidth: size.x,
        mapHeight: size.y,
        labelWidth: icon.width,
        labelHeight: icon.height,
        obstacles: [...obstacles, ...placed],
      });
      if (!placement) return;
      placed.push(placement.rect);
      const from = map.containerPointToLatLng(L.point(placement.labelEdge.x, placement.labelEdge.y));
      const to = map.containerPointToLatLng(L.point(placement.circleEdge.x, placement.circleEdge.y));
      const anchor = map.containerPointToLatLng(L.point(placement.cx, placement.cy));
      next.push({
        id: point.id || `unload-${index}`,
        lat,
        lng,
        radiusM,
        label,
        icon: icon.icon,
        anchor: [anchor.lat, anchor.lng],
        line: [
          [from.lat, from.lng],
          [to.lat, to.lng],
        ],
      });
    });
    setItems(next);
  }, [annotations, map]);

  useMapEvents({
    move: recompute,
    zoom: recompute,
    moveend: recompute,
    zoomend: recompute,
    resize: recompute,
    viewreset: recompute,
  });

  useEffect(() => {
    recompute();
    const timers = [50, 200, 500, 900, 1400].map((ms) => window.setTimeout(recompute, ms));
    return () => timers.forEach((timer) => window.clearTimeout(timer));
  }, [recompute]);

  return (
    <>
      {items.map((item) => (
        <React.Fragment key={item.id}>
          <Circle
            center={[item.lat, item.lng]}
            radius={item.radiusM}
            interactive={false}
            pathOptions={{ color: '#ffffff', weight: 8, opacity: 1, fill: false }}
          />
          <Circle
            center={[item.lat, item.lng]}
            radius={item.radiusM}
            interactive={false}
            pathOptions={{ color: '#000000', weight: 4, opacity: 1, fillColor: '#000000', fillOpacity: 0.12 }}
          />
          <Polyline
            positions={item.line}
            interactive={false}
            pathOptions={{ color: '#ffffff', weight: 6, opacity: 1 }}
          />
          <Polyline
            positions={item.line}
            interactive={false}
            pathOptions={{ color: '#000000', weight: 2.5, opacity: 1 }}
          />
          <CircleMarker
            center={[item.lat, item.lng]}
            radius={6}
            interactive={false}
            pathOptions={{ color: '#ffffff', weight: 3, fillColor: '#000000', fillOpacity: 1 }}
          />
          <Marker position={item.anchor} icon={item.icon} interactive={false} />
        </React.Fragment>
      ))}
    </>
  );
}

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

function ViewportCommentMarkers({ annotations, mapZoom }) {
  return (annotations?.comments || []).map((c) => (
    <Marker
      key={c.id}
      position={[c.lat, c.lng]}
      icon={createCommentDivIcon(c.text, c.scale, mapZoom, false)}
      interactive={false}
    />
  ));
}

/** 印刷・プレビュー用：スタンプ＋コメント（表示専用・選択なし） */
function ViewportAnnotationLayer({ annotations }) {
  const [mapZoom, setMapZoom] = useState(null);
  return (
    <>
      <MapZoomSync onZoomChange={setMapZoom} />
      <ViewportStampMarkers annotations={annotations} mapZoom={mapZoom} />
      <ViewportCommentMarkers annotations={annotations} mapZoom={mapZoom} />
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
    const delays = fixedHeightPx > 0 ? [50, 200, 500, 900, 1400] : [80, 200, 500];
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
  tileLayerId = DEFAULT_MAP_BASE_LAYER_ID,
  printEmphasis = false,
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

  // 印刷・プレビューは地理院タイル＋注釈のみ（保存済み合成 PNG は重ねない）

  const syncKey = `${mapKey}-${viewport?.lat}-${viewport?.lng}-${viewport?.zoom}-${tileLayerId}`;
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
        maxZoom={20}
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
        {/* 印刷・プレビュー: street(WebGL) は地理院ラスターへ逃がす */}
        <MapBaseLayerController layerId={tileLayerId} forceRaster />
        {printEmphasis ? (
          <PrintUnloadEmphasis annotations={annotations} />
        ) : (
          (annotations?.unloadPoints || []).map((u) => (
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
          ))
        )}
        <ViewportAnnotationLayer annotations={annotations} />
      </MapContainer>
    </div>
  );
}
