import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Circle, ImageOverlay, MapContainer, Marker, TileLayer, ZoomControl, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MAP_EDITOR_TOOLS, MAP_STAMP_EMOJI } from '../mapEditorConstants.js';
import {
  applyInitialViewCenter,
  boundsFromCenter,
  createAnnotationId,
  DEFAULT_MAP_CENTER,
  DEFAULT_UNLOAD_RADIUS_M,
} from '../utils/mapAnnotations.js';
import { renderAnnotationsSnapshot } from '../utils/mapEditorSnapshot.js';

/** Leaflet divIcon のデフォルト枠を消す（ズーム時のズレ防止のため iconAnchor を中心に合わせる） */
const LEAFLET_DIV_ICON_CLASS = 'map-editor-leaflet-div-icon';

function createStampDivIcon(emoji, scale, selected) {
  const size = Math.max(24, Math.round(36 * (Number(scale) > 0 ? Number(scale) : 1)));
  const ring = selected
    ? 'box-shadow:0 0 0 3px rgba(99,102,241,0.55);border-radius:10px;'
    : '';
  return L.divIcon({
    className: LEAFLET_DIV_ICON_CLASS,
    html: `<div style="width:${size}px;height:${size}px;font-size:${Math.round(size * 0.88)}px;line-height:1;display:flex;align-items:center;justify-content:center;${ring}">${emoji}</div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function createCommentDivIcon(text, selected) {
  const label = String(text || '').slice(0, 80);
  const border = selected ? '#6366f1' : '#334155';
  const html = `<div style="max-width:200px;padding:6px 8px;border:2px solid ${border};border-radius:8px;background:rgba(255,255,255,0.96);font-size:11px;font-weight:700;line-height:1.35;color:#0f172a;box-shadow:0 2px 6px rgba(0,0,0,0.15);white-space:pre-wrap;">${escapeHtml(label)}</div>`;
  const iconW = Math.min(200, Math.max(80, label.length * 7));
  const iconH = 36;
  return L.divIcon({
    className: LEAFLET_DIV_ICON_CLASS,
    html,
    iconSize: [iconW, iconH],
    iconAnchor: [iconW / 2, iconH],
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
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

function MapFlyTo({ target }) {
  const map = useMap();
  useEffect(() => {
    if (!target) return;
    const la = parseFloat(String(target.lat ?? ''));
    const ln = parseFloat(String(target.lng ?? ''));
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return;
    const zoom = Number(target.zoom) || Math.max(map.getZoom(), 16);
    map.flyTo([la, ln], zoom, { duration: 1.2 });
  }, [target, map]);
  return null;
}

function MapResizeFix() {
  const map = useMap();
  useEffect(() => {
    const t = setTimeout(() => map.invalidateSize(), 120);
    return () => clearTimeout(t);
  }, [map]);
  return null;
}

function UnloadCircles({ points, selectedId, onSelect }) {
  return (
    <>
      {(points || []).map((u) => (
        <Circle
          key={u.id}
          center={[u.lat, u.lng]}
          radius={u.radiusM || DEFAULT_UNLOAD_RADIUS_M}
          pathOptions={{
            color: '#dc2626',
            weight: selectedId === u.id ? 4 : 3,
            fillColor: '#ef4444',
            fillOpacity: 0.2,
          }}
          eventHandlers={{
            click: (e) => {
              L.DomEvent.stopPropagation(e);
              onSelect?.({ kind: 'unload', id: u.id });
            },
          }}
        />
      ))}
    </>
  );
}

function StampMarkers({ stamps, selected, disabled, onSelect, onMove }) {
  return (stamps || []).map((s) => {
    const isSel = selected?.kind === 'stamp' && selected.id === s.id;
    const emoji = MAP_STAMP_EMOJI[s.type] || '❓';
    return (
      <Marker
        key={s.id}
        position={[s.lat, s.lng]}
        draggable={!disabled}
        icon={createStampDivIcon(emoji, s.scale, isSel)}
        zIndexOffset={isSel ? 1200 : 400}
        eventHandlers={{
          click: (e) => {
            L.DomEvent.stopPropagation(e);
            onSelect?.({ kind: 'stamp', id: s.id });
          },
          dragend: (e) => {
            const ll = e.target.getLatLng();
            onMove?.(s.id, { lat: ll.lat, lng: ll.lng });
          },
        }}
      />
    );
  });
}

function CommentMarkers({ comments, selected, disabled, onSelect, onMove }) {
  return (comments || []).map((c) => {
    const isSel = selected?.kind === 'comment' && selected.id === c.id;
    return (
      <Marker
        key={c.id}
        position={[c.lat, c.lng]}
        draggable={!disabled}
        icon={createCommentDivIcon(c.text, isSel)}
        zIndexOffset={isSel ? 1100 : 300}
        eventHandlers={{
          click: (e) => {
            L.DomEvent.stopPropagation(e);
            onSelect?.({ kind: 'comment', id: c.id });
          },
          dragend: (e) => {
            const ll = e.target.getLatLng();
            onMove?.(c.id, { lat: ll.lat, lng: ll.lng });
          },
        }}
      />
    );
  });
}

export const MapEditorInteractive = forwardRef(function MapEditorInteractive(
  {
    annotations,
    onAnnotationsChange,
    activeTool,
    selectedStampType,
    defaultUnloadRadius = DEFAULT_UNLOAD_RADIUS_M,
    flyTarget = null,
    disabled = false,
    selected = null,
    onSelectionChange,
    blueprintOverlayUrl = '',
    className = '',
  },
  ref,
) {
  const mapRef = useRef(null);
  const [internalSelected, setInternalSelected] = useState(null);
  const selection = onSelectionChange ? selected : internalSelected;
  const setSelection = onSelectionChange || setInternalSelected;

  const displayCenter = useMemo(
    () => applyInitialViewCenter(annotations)?.center || DEFAULT_MAP_CENTER,
    [annotations],
  );
  const mapCenter = useMemo(() => {
    const lat = parseFloat(String(displayCenter.lat ?? ''));
    const lng = parseFloat(String(displayCenter.lng ?? ''));
    return [
      Number.isFinite(lat) ? lat : DEFAULT_MAP_CENTER.lat,
      Number.isFinite(lng) ? lng : DEFAULT_MAP_CENTER.lng,
    ];
  }, [displayCenter.lat, displayCenter.lng]);
  const mapZoom = (() => {
    const z = parseFloat(String(displayCenter.zoom ?? ''));
    return Number.isFinite(z) ? z : DEFAULT_MAP_CENTER.zoom;
  })();

  const blueprintUrl = String(blueprintOverlayUrl ?? '').trim();

  const overlayBounds = useMemo(() => {
    if (!blueprintUrl) return null;
    if (annotations?.imageOverlay?.bounds) return annotations.imageOverlay.bounds;
    return boundsFromCenter(displayCenter.lat, displayCenter.lng);
  }, [annotations?.imageOverlay?.bounds, blueprintUrl, displayCenter.lat, displayCenter.lng]);

  const patchAnnotations = useCallback(
    (patch) => {
      if (typeof onAnnotationsChange !== 'function') return;
      onAnnotationsChange({ ...annotations, ...patch });
    },
    [annotations, onAnnotationsChange],
  );

  const updateStamp = useCallback(
    (id, patch) => {
      patchAnnotations({
        stamps: (annotations.stamps || []).map((s) => (s.id === id ? { ...s, ...patch } : s)),
      });
    },
    [annotations.stamps, patchAnnotations],
  );

  const updateUnload = useCallback(
    (id, patch) => {
      patchAnnotations({
        unloadPoints: (annotations.unloadPoints || []).map((u) => (u.id === id ? { ...u, ...patch } : u)),
      });
    },
    [annotations.unloadPoints, patchAnnotations],
  );

  const updateComment = useCallback(
    (id, patch) => {
      patchAnnotations({
        comments: (annotations.comments || []).map((c) => (c.id === id ? { ...c, ...patch } : c)),
      });
    },
    [annotations.comments, patchAnnotations],
  );

  const deleteSelected = useCallback(() => {
    if (!selection) return;
    if (selection.kind === 'stamp') {
      patchAnnotations({ stamps: (annotations.stamps || []).filter((s) => s.id !== selection.id) });
    } else if (selection.kind === 'unload') {
      patchAnnotations({ unloadPoints: (annotations.unloadPoints || []).filter((u) => u.id !== selection.id) });
    } else if (selection.kind === 'comment') {
      patchAnnotations({ comments: (annotations.comments || []).filter((c) => c.id !== selection.id) });
    }
    setSelection(null);
  }, [annotations, patchAnnotations, selection, setSelection]);

  const placeAt = useCallback(
    (lat, lng) => {
      if (disabled) return;
      if (activeTool === MAP_EDITOR_TOOLS.STAMP && selectedStampType) {
        patchAnnotations({
          stamps: [
            ...(annotations.stamps || []),
            {
              id: createAnnotationId('stamp'),
              type: selectedStampType,
              lat,
              lng,
              scale: 1,
            },
          ],
        });
        return;
      }
      if (activeTool === MAP_EDITOR_TOOLS.UNLOAD) {
        const id = createAnnotationId('unload');
        patchAnnotations({
          unloadPoints: [
            ...(annotations.unloadPoints || []),
            { id, lat, lng, radiusM: defaultUnloadRadius },
          ],
        });
        setSelection({ kind: 'unload', id });
        return;
      }
      if (activeTool === MAP_EDITOR_TOOLS.COMMENT) {
        const text = window.prompt('コメントを入力してください', '');
        if (!text || !String(text).trim()) return;
        const id = createAnnotationId('comment');
        patchAnnotations({
          comments: [
            ...(annotations.comments || []),
            { id, lat, lng, text: String(text).trim() },
          ],
        });
      }
    },
    [
      activeTool,
      annotations,
      defaultUnloadRadius,
      disabled,
      patchAnnotations,
      selectedStampType,
      setSelection,
    ],
  );

  function MapClickLayer() {
    useMapEvents({
      click(e) {
        if (activeTool === MAP_EDITOR_TOOLS.PAN) {
          setSelection(null);
          return;
        }
        if (
          activeTool === MAP_EDITOR_TOOLS.STAMP ||
          activeTool === MAP_EDITOR_TOOLS.UNLOAD ||
          activeTool === MAP_EDITOR_TOOLS.COMMENT
        ) {
          placeAt(e.latlng.lat, e.latlng.lng);
        }
      },
    });
    return null;
  }

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selection && document.activeElement?.tagName !== 'INPUT') {
          e.preventDefault();
          deleteSelected();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelected, selection]);

  useImperativeHandle(ref, () => ({
    async toDataURL() {
      return renderAnnotationsSnapshot(annotations, {
        baseImageUrl: annotations?.imageOverlay?.url || '',
      });
    },
    getMap: () => mapRef.current,
    deleteSelected,
  }));

  const cursorClass =
    activeTool === MAP_EDITOR_TOOLS.PAN
      ? 'cursor-grab'
      : activeTool === MAP_EDITOR_TOOLS.STAMP ||
          activeTool === MAP_EDITOR_TOOLS.UNLOAD ||
          activeTool === MAP_EDITOR_TOOLS.COMMENT
        ? 'cursor-crosshair'
        : '';

  return (
    <div className={'relative h-full w-full min-h-0 ' + className}>
      <style>{`
        .${LEAFLET_DIV_ICON_CLASS} {
          background: transparent !important;
          border: none !important;
        }
        .${LEAFLET_DIV_ICON_CLASS} > div {
          transform-origin: center center;
        }
      `}</style>
      <MapContainer
        center={mapCenter}
        zoom={mapZoom}
        zoomControl={false}
        className={'map-editor-leaflet z-0 h-full w-full ' + cursorClass}
        style={{ height: '100%', width: '100%', minHeight: '280px' }}
        scrollWheelZoom
      >
        <ZoomControl position="bottomright" />
        <MapInstanceBinder mapRef={mapRef} />
        <MapResizeFix />
        <MapFlyTo target={flyTarget} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {blueprintUrl && overlayBounds ? (
          <ImageOverlay url={blueprintUrl} bounds={overlayBounds} opacity={0.85} />
        ) : null}
        <UnloadCircles
          points={annotations.unloadPoints}
          selectedId={selection?.kind === 'unload' ? selection.id : null}
          onSelect={setSelection}
        />
        <StampMarkers
          stamps={annotations.stamps}
          selected={selection}
          disabled={disabled}
          onSelect={setSelection}
          onMove={updateStamp}
        />
        <CommentMarkers
          comments={annotations.comments}
          selected={selection}
          disabled={disabled}
          onSelect={setSelection}
          onMove={updateComment}
        />
        <MapClickLayer />
      </MapContainer>
    </div>
  );
});
