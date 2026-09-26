'use client';

import { Columns2, Maximize2, Minimize2, Minus, Plus, SquareSplitHorizontal, Image as ImageIcon } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/components/ui/cn';
import { ProbedImage } from './Probed';

export type CompareMode = 'slider' | 'side' | 'after';

const ZOOM_STEPS = [1, 1.5, 2, 3, 4];
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/**
 * Before / after comparison for Cloudinary transformations.
 * Slider, side-by-side or output-only; shared zoom (1–4×, wheel/keys/double-click)
 * with panning; true fullscreen; keyboard-accessible slider handle.
 */
export function CompareViewer({
  beforeUrl,
  afterUrl,
  beforeLabel = 'Original',
  afterLabel = 'Cloudinary output',
  aspect,
  mode,
  onModeChange,
  toolbarExtra,
  afterOverlay,
  geometryNote,
}: {
  beforeUrl: string;
  afterUrl: string;
  beforeLabel?: string;
  afterLabel?: string;
  aspect: number;
  mode: CompareMode;
  onModeChange: (mode: CompareMode) => void;
  toolbarExtra?: ReactNode;
  afterOverlay?: ReactNode;
  geometryNote?: string;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const drag = useRef<{ kind: 'slider' | 'pan'; startX: number; startY: number; panX: number; panY: number } | null>(null);

  const clampPan = useCallback(
    (x: number, y: number, z: number) => {
      const el = stageRef.current;
      if (!el || z <= 1) return { x: 0, y: 0 };
      const maxX = ((z - 1) * el.clientWidth) / 2;
      const maxY = ((z - 1) * el.clientHeight) / 2;
      return { x: clamp(x, -maxX, maxX), y: clamp(y, -maxY, maxY) };
    },
    [],
  );

  const setZoomAround = useCallback(
    (next: number, clientX?: number, clientY?: number) => {
      const el = stageRef.current;
      const z = clamp(next, 1, 4);
      if (!el) return;
      if (clientX === undefined || clientY === undefined) {
        setZoom(z);
        setPan((p) => clampPan((p.x * z) / zoom, (p.y * z) / zoom, z));
        return;
      }
      const rect = el.getBoundingClientRect();
      const cx = clientX - rect.left - rect.width / 2;
      const cy = clientY - rect.top - rect.height / 2;
      // Keep the point under the cursor fixed while zooming.
      const nx = cx - ((cx - pan.x) * z) / zoom;
      const ny = cy - ((cy - pan.y) * z) / zoom;
      setZoom(z);
      setPan(clampPan(nx, ny, z));
    },
    [clampPan, pan.x, pan.y, zoom],
  );

  const stepZoom = (dir: 1 | -1) => {
    const idx = ZOOM_STEPS.findIndex((z) => z >= zoom - 0.01);
    const next = ZOOM_STEPS[clamp((idx === -1 ? ZOOM_STEPS.length - 1 : idx) + dir, 0, ZOOM_STEPS.length - 1)];
    setZoomAround(next);
  };

  const sliderFromClientX = (clientX: number) => {
    const el = stageRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    // Account for zoom/pan: map the pointer back into unzoomed image space.
    const localX = (clientX - rect.left - rect.width / 2 - pan.x) / zoom + rect.width / 2;
    setPosition(clamp((localX / rect.width) * 100, 0, 100));
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    const onHandle = (event.target as HTMLElement).closest('[data-handle]');
    const kind: 'slider' | 'pan' = mode === 'slider' && (onHandle || zoom === 1) ? 'slider' : 'pan';
    if (kind === 'pan' && zoom === 1) return;
    drag.current = { kind, startX: event.clientX, startY: event.clientY, panX: pan.x, panY: pan.y };
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    if (kind === 'slider') sliderFromClientX(event.clientX);
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'slider') sliderFromClientX(event.clientX);
    else setPan(clampPan(d.panX + event.clientX - d.startX, d.panY + event.clientY - d.startY, zoom));
  };

  const endDrag = () => {
    drag.current = null;
  };

  // Ctrl/⌘ + wheel (and trackpad pinch) zooms; plain wheel keeps scrolling the page.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      setZoomAround(zoom * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event.clientX, event.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [setZoomAround, zoom]);

  useEffect(() => {
    const onChange = () => setFullscreen(document.fullscreenElement === wrapperRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await wrapperRef.current?.requestFullscreen();
    } catch {
      /* Fullscreen can be blocked (iframes, iOS); the viewer still works inline. */
    }
  };

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      stepZoom(1);
    } else if (event.key === '-') {
      event.preventDefault();
      stepZoom(-1);
    } else if (event.key === '0') {
      setZoom(1);
      setPan({ x: 0, y: 0 });
    }
  };

  const transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;

  return (
    <div
      ref={wrapperRef}
      className={cn('flex flex-col overflow-hidden rounded-[12px] border border-line bg-surface', fullscreen && 'rounded-none border-0')}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
        <Segmented
          size="sm"
          ariaLabel="Comparison mode"
          value={mode}
          onChange={onModeChange}
          options={[
            { value: 'slider', label: <><SquareSplitHorizontal className="h-3.5 w-3.5" />Slider</> },
            { value: 'side', label: <><Columns2 className="h-3.5 w-3.5" />Side by side</> },
            { value: 'after', label: <><ImageIcon className="h-3.5 w-3.5" />Output</> },
          ]}
        />
        <div className="flex items-center gap-1">
          {toolbarExtra}
          <div className="ml-1 flex items-center rounded-[8px] border border-line bg-canvas">
            <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => stepZoom(-1)} aria-label="Zoom out" disabled={zoom <= 1}>
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="num w-11 font-mono text-[11px] text-ink-2 hover:text-ink"
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
              }}
              title="Reset zoom (0)"
            >
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => stepZoom(1)} aria-label="Zoom in" disabled={zoom >= 4}>
              <Plus className="h-3.5 w-3.5" />
            </button>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-sm btn-icon"
            onClick={toggleFullscreen}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            title={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      <div
        ref={stageRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={(event) => setZoomAround(zoom > 1 ? 1 : 2.5, event.clientX, event.clientY)}
        aria-label="Comparison stage. Use + and − to zoom, 0 to reset, drag to pan when zoomed."
        className={cn(
          'checker relative w-full touch-none select-none overflow-hidden outline-none',
          fullscreen ? 'flex-1' : '',
          zoom > 1 ? 'cursor-grab active:cursor-grabbing' : mode === 'slider' ? 'cursor-ew-resize' : 'cursor-zoom-in',
        )}
        style={fullscreen ? undefined : { aspectRatio: `${Math.max(aspect, 0.8)}` , maxHeight: '68vh' }}
      >
        {mode === 'side' ? (
          <div className="absolute inset-0 grid grid-cols-2 gap-px bg-line">
            {[
              { url: beforeUrl, label: beforeLabel },
              { url: afterUrl, label: afterLabel },
            ].map((pane, i) => (
              <div key={i} className="checker relative overflow-hidden">
                <div className="absolute inset-0" style={{ transform, transformOrigin: 'center' }}>
                  <ProbedImage url={pane.url} alt={pane.label} />
                  {i === 1 && afterOverlay}
                </div>
                <PaneLabel side={i === 0 ? 'left' : 'right'} accent={i === 1}>
                  {pane.label}
                </PaneLabel>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="absolute inset-0" style={{ transform, transformOrigin: 'center' }}>
              <ProbedImage url={afterUrl} alt={afterLabel} />
              {afterOverlay}
              {mode === 'slider' && (
                <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - position}% 0 0)` }}>
                  <div className="checker absolute inset-0" />
                  <ProbedImage url={beforeUrl} alt={beforeLabel} showStatus={false} />
                </div>
              )}
            </div>
            {mode === 'slider' && (
              <>
                <div
                  className="pointer-events-none absolute inset-y-0 w-px bg-signal"
                  style={{ left: `calc(${50 + (position - 50) * zoom}% + ${pan.x}px)` }}
                />
                <div
                  data-handle
                  role="slider"
                  tabIndex={0}
                  aria-label="Comparison position"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(position)}
                  onKeyDown={(event) => {
                    const step = event.shiftKey ? 10 : 2;
                    if (event.key === 'ArrowLeft') setPosition((p) => clamp(p - step, 0, 100));
                    else if (event.key === 'ArrowRight') setPosition((p) => clamp(p + step, 0, 100));
                    else if (event.key === 'Home') setPosition(0);
                    else if (event.key === 'End') setPosition(100);
                    else return;
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  className="absolute top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-signal bg-canvas/90 text-signal shadow-[0_4px_20px_rgba(0,0,0,0.5)] backdrop-blur-sm"
                  style={{ left: `calc(${50 + (position - 50) * zoom}% + ${pan.x}px)` }}
                >
                  <SquareSplitHorizontal className="h-4 w-4" />
                </div>
                <PaneLabel side="left">{beforeLabel}</PaneLabel>
                <PaneLabel side="right" accent>
                  {afterLabel}
                </PaneLabel>
              </>
            )}
            {mode === 'after' && (
              <PaneLabel side="right" accent>
                {afterLabel}
              </PaneLabel>
            )}
          </>
        )}
      </div>
      {geometryNote && mode === 'slider' && (
        <p className="border-t border-line px-3 py-2 text-[12px] text-ink-3">{geometryNote}</p>
      )}
    </div>
  );
}

function PaneLabel({ side, accent, children }: { side: 'left' | 'right'; accent?: boolean; children: ReactNode }) {
  return (
    <span
      className={cn(
        'pointer-events-none absolute top-3 rounded-[6px] border px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em] backdrop-blur-sm',
        side === 'left' ? 'left-3' : 'right-3',
        accent ? 'border-[color-mix(in_oklab,var(--color-signal)_45%,transparent)] bg-canvas/85 text-signal' : 'border-line-strong bg-canvas/85 text-ink-2',
      )}
    >
      {children}
    </span>
  );
}
