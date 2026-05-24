import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Circle, ImageOverlay, MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MAP_EDITOR_TOOLS, MAP_STAMP_EMOJI } from '../mapEditorConstants.js';
import {
  boundsFromCenter,
  createAnnotationId,
  DEFAULT_MAP_CENTER,
  DEFAULT_UNLOAD_RADIUS_M,
} from '../utils/mapAnnotations.js';
import { renderAnnotationsSnapshot } from '../utils/mapEditorSnapshot.js';

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
    const la = Number(target.lat);
    const ln = Number(target.lng);
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

function AnnotationOverlay({
  mapRef,
  annotations,
  selected,
  onSelect,
  onUpdateStamp,
  onUpdateUnload,
  onUpdateComment,
  onDeleteSelected,
  disabled,
}) {
  const overlayRef = useRef(null);
  const [, setTick] = useState(0);
  const dragRef = useRef(null);

  const rerender = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const onMove = () => rerender();
    map.on('move zoom resize', onMove);
    return () => {
      map.off('move zoom resize', onMove);
    };
  }, [mapRef, rerender]);

  const latLngToContainer = useCallback(
    (lat, lng) => {
      const map = mapRef.current;
      if (!map) return null;
      const pt = map.latLngToContainerPoint([lat, lng]);
      return { x: pt.x, y: pt.y };
    },
    [mapRef],
  );

  const clientToLatLng = useCallback((map, clientX, clientY) => {
    const rect = map.getContainer().getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return map.containerPointToLatLng([x, y]);
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      const d = dragRef.current;
      const map = mapRef.current;
      if (!d || !map) return;
      if (d.mode === 'move' && d.origin) {
        const cur = clientToLatLng(map, e.clientX, e.clientY);
        const dLat = cur.lat - d.startLatLng.lat;
        const dLng = cur.lng - d.startLatLng.lng;
        if (d.kind === 'stamp') {
          onUpdateStamp?.(d.id, { lat: d.origin.lat + dLat, lng: d.origin.lng + dLng });
        } else if (d.kind === 'unload') {
          onUpdateUnload?.(d.id, { lat: d.origin.lat + dLat, lng: d.origin.lng + dLng });
        } else if (d.kind === 'comment') {
          onUpdateComment?.(d.id, { lat: d.origin.lat + dLat, lng: d.origin.lng + dLng });
        }
      } else if (d.mode === 'resize-stamp') {
        const dx = e.clientX - d.start.x;
        const dy = e.clientY - d.start.y;
        const delta = Math.max(dx, dy);
        const nextScale = Math.min(3, Math.max(0.4, d.startScale + delta / 80));
        onUpdateStamp?.(d.id, { scale: nextScale });
      } else if (d.mode === 'resize-unload') {
        const dx = e.clientX - d.start.x;
        const stamp = annotations.unloadPoints.find((x) => x.id === d.id);
        if (stamp) {
          const nextR = Math.min(50, Math.max(4, d.startRadius + dx / 4));
          onUpdateUnload?.(d.id, { radiusM: nextR });
        }
      }
      rerender();
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [annotations, clientToLatLng, mapRef, onUpdateComment, onUpdateStamp, onUpdateUnload, rerender]);

  const sel = selected;

  return (
    <div ref={overlayRef} className="pointer-events-none absolute inset-0 z-[500] overflow-hidden">
      {(annotations.stamps || []).map((s) => {
        const pos = latLngToContainer(s.lat, s.lng);
        if (!pos) return null;
        const scale = Number(s.scale) > 0 ? Number(s.scale) : 1;
        const size = 36 * scale;
        const isSel = sel?.kind === 'stamp' && sel.id === s.id;
        return (
          <div
            key={s.id}
            className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 select-none"
            style={{ left: pos.x, top: pos.y, width: size, height: size, fontSize: size * 0.85 }}
            onPointerDown={(e) => {
              if (disabled) return;
              e.stopPropagation();
              onSelect?.({ kind: 'stamp', id: s.id });
              const map = mapRef.current;
              if (!map) return;
              dragRef.current = {
                kind: 'stamp',
                id: s.id,
                mode: 'move',
                startLatLng: clientToLatLng(map, e.clientX, e.clientY),
                origin: { lat: s.lat, lng: s.lng },
              };
            }}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.({ kind: 'stamp', id: s.id });
            }}
          >
            <span
              className={
                'flex h-full w-full items-center justify-center drop-shadow-md ' +
                (isSel ? 'ring-2 ring-indigo-500 ring-offset-1 rounded-lg' : '')
              }
            >
              {MAP_STAMP_EMOJI[s.type] || '❓'}
            </span>
            {isSel ? (
              <>
                <button
                  type="button"
                  className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full border-2 border-red-500 bg-white text-xs font-black text-red-600 shadow"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSelected?.();
                  }}
                >
                  ✕
                </button>
                <span
                  className="absolute -bottom-2 -right-2 h-4 w-4 cursor-se-resize rounded-sm border-2 border-indigo-600 bg-white"
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    dragRef.current = {
                      kind: 'stamp',
                      id: s.id,
                      mode: 'resize-stamp',
                      start: { x: e.clientX, y: e.clientY },
                      startScale: scale,
                    };
                  }}
                />
              </>
            ) : null}
          </div>
        );
      })}

      {(annotations.comments || []).map((c) => {
        const pos = latLngToContainer(c.lat, c.lng);
        if (!pos) return null;
        const isSel = sel?.kind === 'comment' && sel.id === c.id;
        return (
          <div
            key={c.id}
            className="pointer-events-auto absolute max-w-[200px] -translate-x-1/2"
            style={{ left: pos.x, top: pos.y - 8 }}
            onPointerDown={(e) => {
              if (disabled) return;
              e.stopPropagation();
              onSelect?.({ kind: 'comment', id: c.id });
              const map = mapRef.current;
              if (!map) return;
              dragRef.current = {
                kind: 'comment',
                id: c.id,
                mode: 'move',
                startLatLng: clientToLatLng(map, e.clientX, e.clientY),
                origin: { lat: c.lat, lng: c.lng },
              };
            }}
            onClick={(e) => {
              e.stopPropagation();
              onSelect?.({ kind: 'comment', id: c.id });
            }}
          >
            <div
              className={
                'relative rounded-lg border-2 bg-white px-2 py-1 text-[11px] font-bold leading-snug text-slate-900 shadow-md ' +
                (isSel ? 'border-indigo-500' : 'border-slate-600')
              }
            >
              {c.text}
              {isSel ? (
                <button
                  type="button"
                  className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-red-400 bg-white text-[10px] font-black text-red-600"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteSelected?.();
                  }}
                >
                  ✕
                </button>
              ) : null}
            </div>
          </div>
        );
      })}

      {sel?.kind === 'unload'
        ? (() => {
            const u = annotations.unloadPoints.find((x) => x.id === sel.id);
            if (!u) return null;
            const pos = latLngToContainer(u.lat, u.lng);
            if (!pos) return null;
            return (
              <div
                className="pointer-events-auto absolute h-5 w-5 -translate-x-1/2 -translate-y-1/2 cursor-se-resize rounded-sm border-2 border-red-600 bg-white shadow"
                style={{
                  left: pos.x + 28,
                  top: pos.y,
                }}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  dragRef.current = {
                    kind: 'unload',
                    id: u.id,
                    mode: 'resize-unload',
                    start: { x: e.clientX, y: e.clientY },
                    startRadius: u.radiusM,
                  };
                }}
              />
            );
          })()
        : null}
    </div>
  );
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
    className = '',
  },
  ref,
) {
  const mapRef = useRef(null);
  const [selected, setSelected] = useState(null);

  const center = annotations?.center || DEFAULT_MAP_CENTER;
  const mapCenter = useMemo(
    () => [Number(center.lat) || DEFAULT_MAP_CENTER.lat, Number(center.lng) || DEFAULT_MAP_CENTER.lng],
    [center.lat, center.lng],
  );
  const mapZoom = Number(center.zoom) || DEFAULT_MAP_CENTER.zoom;

  const overlayBounds = useMemo(() => {
    if (annotations?.imageOverlay?.bounds) return annotations.imageOverlay.bounds;
    return boundsFromCenter(center.lat, center.lng);
  }, [annotations?.imageOverlay?.bounds, center.lat, center.lng]);

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
    if (!selected) return;
    if (selected.kind === 'stamp') {
      patchAnnotations({ stamps: (annotations.stamps || []).filter((s) => s.id !== selected.id) });
    } else if (selected.kind === 'unload') {
      patchAnnotations({ unloadPoints: (annotations.unloadPoints || []).filter((u) => u.id !== selected.id) });
    } else if (selected.kind === 'comment') {
      patchAnnotations({ comments: (annotations.comments || []).filter((c) => c.id !== selected.id) });
    }
    setSelected(null);
  }, [annotations, patchAnnotations, selected]);

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
        setSelected({ kind: 'unload', id });
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
    ],
  );

  function MapClickLayer() {
    useMapEvents({
      click(e) {
        if (activeTool === MAP_EDITOR_TOOLS.PAN) {
          setSelected(null);
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
        if (selected && document.activeElement?.tagName !== 'INPUT') {
          e.preventDefault();
          deleteSelected();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelected, selected]);

  useImperativeHandle(ref, () => ({
    async toDataURL() {
      return renderAnnotationsSnapshot(annotations, {
        baseImageUrl: annotations?.imageOverlay?.url || '',
      });
    },
    getMap: () => mapRef.current,
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
    <div className={'relative min-h-0 flex-1 ' + className}>
      <MapContainer
        center={mapCenter}
        zoom={mapZoom}
        className={'z-0 h-full w-full ' + cursorClass}
        style={{ height: '100%', width: '100%', minHeight: '280px' }}
        scrollWheelZoom
      >
        <MapInstanceBinder mapRef={mapRef} />
        <MapResizeFix />
        <MapFlyTo target={flyTarget} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {annotations?.imageOverlay?.url && overlayBounds ? (
          <ImageOverlay url={annotations.imageOverlay.url} bounds={overlayBounds} opacity={0.92} />
        ) : null}
        <UnloadCircles
          points={annotations.unloadPoints}
          selectedId={selected?.kind === 'unload' ? selected.id : null}
          onSelect={setSelected}
        />
        <MapClickLayer />
      </MapContainer>

      <AnnotationOverlay
        mapRef={mapRef}
        annotations={annotations}
        selected={selected}
        onSelect={setSelected}
        onUpdateStamp={updateStamp}
        onUpdateUnload={updateUnload}
        onUpdateComment={updateComment}
        onDeleteSelected={deleteSelected}
        disabled={disabled}
      />
    </div>
  );
});
