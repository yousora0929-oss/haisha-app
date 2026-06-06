import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { MAP_STAMP_EMOJI, MAP_STAMP_PICKER_DEFS } from '../mapEditorConstants.js';

const BLANK_CANVAS_W = 800;
const BLANK_CANVAS_H = 600;

function fitImageToArea(imgW, imgH, areaW, areaH) {
  const scale = Math.min(areaW / imgW, areaH / imgH);
  return {
    w: Math.floor(imgW * scale),
    h: Math.floor(imgH * scale),
  };
}

/**
 * HTML5 Canvas 地図スタンプ配置
 * - 座標は 0〜1 の比率で保持
 * - blankCanvas: 背景URLが無いとき白紙で編集可能
 */
export const MapEditorCanvas = forwardRef(function MapEditorCanvas(
  {
    baseImageUrl,
    blankCanvas = false,
    stamps,
    onStampsChange,
    selectedType,
    disabled = false,
    className = '',
  },
  ref,
) {
  const canvasRef = useRef(null);
  const viewportRef = useRef(null);
  const areaRef = useRef(null);
  const wrapRef = useRef(null);
  const bgImageRef = useRef(null);
  const layoutRef = useRef({ cssW: 0, cssH: 0, dpr: 1 });
  const pinchRef = useRef({ active: false, startDist: 0, startScale: 1, scale: 1 });

  const [bgLoaded, setBgLoaded] = useState(false);
  const [bgError, setBgError] = useState(false);
  const [isBlankLayout, setIsBlankLayout] = useState(false);

  const drawStamps = useCallback(
    (ctx, cssW, cssH) => {
      const fontSize = Math.max(24, Math.min(cssW, cssH) * 0.08);
      ctx.font = `${fontSize}px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const s of stamps || []) {
        const px = s.x * cssW;
        const py = s.y * cssH;
        const emoji = MAP_STAMP_EMOJI[s.type] || '❓';
        ctx.save();
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 2;
        ctx.fillText(emoji, px, py);
        ctx.restore();
      }
    },
    [stamps],
  );

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const img = bgImageRef.current;
    const { cssW, cssH } = layoutRef.current;
    if (!canvas || !ctx || !bgLoaded || cssW <= 0 || cssH <= 0) return;

    ctx.clearRect(0, 0, cssW, cssH);

    if (img?.naturalWidth) {
      ctx.drawImage(img, 0, 0, cssW, cssH);
    } else if (isBlankLayout) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, cssW, cssH);
      ctx.strokeStyle = '#e2e8f0';
      ctx.lineWidth = 1;
      const step = Math.max(40, Math.floor(Math.min(cssW, cssH) / 12));
      for (let x = 0; x <= cssW; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, cssH);
        ctx.stroke();
      }
      for (let y = 0; y <= cssH; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(cssW, y);
        ctx.stroke();
      }
    }

    drawStamps(ctx, cssW, cssH);
  }, [bgLoaded, drawStamps, isBlankLayout]);

  const syncCanvasResolution = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const { cssW, cssH } = layoutRef.current;
    layoutRef.current.dpr = dpr;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  const layoutCanvas = useCallback(() => {
    const area = areaRef.current;
    if (!area) return;

    const areaRect = area.getBoundingClientRect();
    const img = bgImageRef.current;

    if (img?.naturalWidth) {
      const fitted = fitImageToArea(
        img.naturalWidth,
        img.naturalHeight,
        areaRect.width - 16,
        areaRect.height - 16,
      );
      layoutRef.current.cssW = fitted.w;
      layoutRef.current.cssH = fitted.h;
      setIsBlankLayout(false);
    } else if (blankCanvas) {
      const fitted = fitImageToArea(
        BLANK_CANVAS_W,
        BLANK_CANVAS_H,
        areaRect.width - 16,
        areaRect.height - 16,
      );
      layoutRef.current.cssW = fitted.w;
      layoutRef.current.cssH = fitted.h;
      setIsBlankLayout(true);
    } else {
      return;
    }

    if (wrapRef.current) {
      wrapRef.current.style.width = `${layoutRef.current.cssW}px`;
      wrapRef.current.style.height = `${layoutRef.current.cssH}px`;
    }

    syncCanvasResolution();
    setBgLoaded(true);
    redraw();
  }, [blankCanvas, redraw, syncCanvasResolution]);

  useEffect(() => {
    if (baseImageUrl) {
      setBgError(false);
      setBgLoaded(false);
      setIsBlankLayout(false);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        bgImageRef.current = img;
        setBgLoaded(false);
        layoutCanvas();
      };
      img.onerror = () => {
        bgImageRef.current = null;
        setBgError(true);
        setBgLoaded(false);
        if (blankCanvas) {
          setBgError(false);
          layoutCanvas();
        }
      };
      img.src = baseImageUrl;
      return;
    }

    bgImageRef.current = null;
    if (blankCanvas) {
      setBgError(false);
      layoutCanvas();
    } else {
      setBgLoaded(false);
      setBgError(true);
    }
  }, [baseImageUrl, blankCanvas, layoutCanvas]);

  useEffect(() => {
    redraw();
  }, [stamps, redraw]);

  useEffect(() => {
    let timer;
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(layoutCanvas, 100);
    };
    window.addEventListener('resize', onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, [layoutCanvas]);

  useImperativeHandle(ref, () => ({
    toDataURL(type = 'image/png') {
      const canvas = canvasRef.current;
      if (!canvas) return '';
      redraw();
      return canvas.toDataURL(type);
    },
    relayout: layoutCanvas,
  }));

  const clientToRatio = useCallback((clientX, clientY) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) return null;
    return { x, y };
  }, []);

  const placeStamp = useCallback(
    (clientX, clientY) => {
      if (disabled || !selectedType || typeof onStampsChange !== 'function') return;
      const ratio = clientToRatio(clientX, clientY);
      if (!ratio) return;
      onStampsChange([...(stamps || []), { type: selectedType, x: ratio.x, y: ratio.y }]);
    },
    [clientToRatio, disabled, onStampsChange, selectedType, stamps],
  );

  const getTouchDistance = (touches) => {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  };

  const onViewportTouchStart = (e) => {
    if (e.touches.length === 2) {
      pinchRef.current.active = true;
      pinchRef.current.startDist = getTouchDistance(e.touches);
      pinchRef.current.startScale = pinchRef.current.scale;
      e.preventDefault();
    }
  };

  const onViewportTouchMove = (e) => {
    if (pinchRef.current.active && e.touches.length === 2) {
      const dist = getTouchDistance(e.touches);
      if (pinchRef.current.startDist > 0) {
        const next = pinchRef.current.startScale * (dist / pinchRef.current.startDist);
        pinchRef.current.scale = Math.min(4, Math.max(1, next));
        if (viewportRef.current) {
          viewportRef.current.style.transform = `scale(${pinchRef.current.scale})`;
        }
      }
      e.preventDefault();
    }
  };

  const onViewportTouchEnd = (e) => {
    if (e.touches.length < 2) pinchRef.current.active = false;
  };

  const canInteract = bgLoaded && (baseImageUrl || blankCanvas) && !bgError;

  return (
    <div ref={areaRef} className={`relative min-h-0 flex-1 overflow-hidden bg-slate-300 ${className}`}>
      {bgError && !blankCanvas ? (
        <div className="flex h-full items-center justify-center p-6 text-center text-sm font-bold text-slate-600">
          図面の読み込みに失敗しました。
          <br />
          下の「ベース画像をアップロード」から画像を選ぶか、保存済みのURLをご確認ください。
        </div>
      ) : (
        <div
          ref={viewportRef}
          className="absolute inset-0 flex touch-none items-center justify-center"
          style={{ transformOrigin: 'center center' }}
          onTouchStart={onViewportTouchStart}
          onTouchMove={onViewportTouchMove}
          onTouchEnd={onViewportTouchEnd}
        >
          <div ref={wrapRef} className="relative shadow-lg" style={{ lineHeight: 0 }}>
            <canvas
              ref={canvasRef}
              className={`block max-h-full max-w-full touch-none ${
                disabled || !canInteract ? 'cursor-default' : 'cursor-crosshair'
              }`}
              onClick={(e) => canInteract && placeStamp(e.clientX, e.clientY)}
              onTouchStart={(e) => {
                if (canInteract && e.touches.length === 1) e.preventDefault();
              }}
              onTouchEnd={(e) => {
                if (!canInteract) return;
                if (pinchRef.current.active) return;
                if (e.changedTouches.length !== 1) return;
                const t = e.changedTouches[0];
                placeStamp(t.clientX, t.clientY);
                e.preventDefault();
              }}
            />
          </div>
        </div>
      )}

      {baseImageUrl && !bgLoaded && !bgError ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-200/80">
          <span className="text-sm font-bold text-slate-600">図面を読み込み中…</span>
        </div>
      ) : null}
    </div>
  );
});

export function MapStampPalette({ selectedType, onSelectType, disabled }) {
  return (
    <div className="border-t border-slate-200 bg-white px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
      <p className="mb-2 text-[11px] font-bold text-slate-500">スタンプを選んでから、地図をタップして配置</p>
      <div className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {MAP_STAMP_PICKER_DEFS.map((def) => (
          <button
            key={def.type}
            type="button"
            disabled={disabled}
            aria-label={def.label}
            aria-pressed={selectedType === def.type}
            onClick={() => onSelectType(def.type)}
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl border-2 text-2xl transition active:scale-95 disabled:opacity-50 sm:h-16 sm:w-16 sm:text-3xl ${
              selectedType === def.type
                ? 'border-indigo-500 bg-indigo-50 shadow-[0_0_0_3px_rgba(99,102,241,0.25)]'
                : 'border-slate-200 bg-slate-50'
            }`}
          >
            {def.emoji}
          </button>
        ))}
      </div>
    </div>
  );
}
