'use client';

import {
  ChevronLeft,
  ChevronRight,
  Columns2,
  Image as ImageIcon,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  SquareSplitHorizontal,
} from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { easeInOutCubic, useReducedMotionPref } from '@/components/motion/hooks';
import { Segmented } from '@/components/ui/Segmented';
import { cn } from '@/components/ui/cn';
import { IMAGE_ACCEPT, getMeasurement } from '@/lib/cloudinary/probe';
import { ProbedImage } from './Probed';
import { useProbe } from './useProbe';

export type CompareMode = 'slider' | 'side' | 'after';

const ZOOM_STEPS = [1, 1.5, 2, 3, 4];
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Divider smoothing time constant (s): it closes ~95% of the gap to the pointer in 3τ. */
const TAU_DIVIDER = 0.05;
/** Zoom / pan smoothing time constant (s). */
const TAU_VIEW = 0.085;
const INTRO_MS = 700;
const INTRO_DELAY_MS = 160;
/**
 * Sweep anyway if both renditions have not loaded after this long (the status overlay then shows why) —
 * unless Cloudinary is still rendering the output: then keep waiting, so the sweep never plays over a
 * stale or blank output (generative results can take several seconds).
 */
const INTRO_FALLBACK_MS = 2600;
const INTRO_RECHECK_MS = 1000;
/** Touch drags must travel this far horizontally before they move the divider (vertical scroll stays native). */
const TOUCH_SLOP = 6;

/** Keys (an asset, or one generative result) whose intro sweep already played in this session. */
const introPlayed = new Set<string>();

type Slot = 'layer0' | 'layer1' | 'clip' | 'line' | 'handle' | 'split' | 'zoom';
type ZoomBand = 'min' | 'mid' | 'max';

const bandOf = (z: number): ZoomBand => (z <= MIN_ZOOM + 0.001 ? 'min' : z >= MAX_ZOOM - 0.001 ? 'max' : 'mid');

/**
 * Imperative render engine for the comparison stage. Pointer, wheel and key
 * input only move *targets*; a rAF loop (running only while something is
 * settling) eases the divider and the view toward them and writes
 * clip-path / transforms straight to the DOM. React never re-renders per frame.
 *
 * The intro sweep starts on the full output (divider at 0: the original is
 * clipped away) and settles on the 50 / 50 split, so what the pipeline produced
 * is the first thing shown — never hidden under the original.
 */
function createEngine(introKey: string | undefined) {
  const intro = { key: introKey, state: (introKey ? 'waiting' : 'off') as 'off' | 'waiting' | 'running' | 'done', t0: 0 };
  const cur = { pos: introKey ? 0 : 50, z: 1, x: 0, y: 0 };
  const tgt = { ...cur };
  const els: Record<Slot, HTMLElement | null> = { layer0: null, layer1: null, clip: null, line: null, handle: null, split: null, zoom: null };
  let w = 0;
  let h = 0;
  let raf = 0;
  let last = 0;
  let reduced = false;
  let shownPos = -1;
  let shownZoom = -1;

  const clampPan = (x: number, y: number, z: number) => {
    if (z <= 1) return { x: 0, y: 0 };
    const mx = ((z - 1) * w) / 2;
    const my = ((z - 1) * h) / 2;
    return { x: clamp(x, -mx, mx), y: clamp(y, -my, my) };
  };

  const write = () => {
    const transform = `translate3d(${cur.x}px, ${cur.y}px, 0) scale(${cur.z})`;
    if (els.layer0) els.layer0.style.transform = transform;
    if (els.layer1) els.layer1.style.transform = transform;
    if (els.clip) els.clip.style.clipPath = `inset(0 ${100 - cur.pos}% 0 0)`;
    const lineX = w * (0.5 + (cur.pos / 100 - 0.5) * cur.z) + cur.x;
    const lineTransform = `translate3d(${lineX}px, 0, 0)`;
    if (els.line) els.line.style.transform = lineTransform;
    if (els.handle) els.handle.style.transform = lineTransform;

    const pos = Math.round(cur.pos);
    if (pos !== shownPos) {
      shownPos = pos;
      if (els.handle) {
        els.handle.setAttribute('aria-valuenow', String(pos));
        els.handle.setAttribute('aria-valuetext', `Original ${pos}%, output ${100 - pos}%`);
      }
      if (els.split) els.split.textContent = `${pos}`;
    }
    const zoomPct = Math.round(cur.z * 100);
    if (zoomPct !== shownZoom) {
      shownZoom = zoomPct;
      if (els.zoom) els.zoom.textContent = `${zoomPct}%`;
    }
  };

  const finishIntro = () => {
    intro.state = 'done';
    if (intro.key) introPlayed.add(intro.key);
  };

  const frame = (now: number) => {
    const dt = clamp((now - last) / 1000, 0, 0.064);
    last = now;
    let moving = false;

    if (intro.state === 'running') {
      const p = clamp((now - intro.t0) / INTRO_MS, 0, 1);
      cur.pos = tgt.pos = 50 * easeInOutCubic(p);
      if (p < 1) moving = true;
      else finishIntro();
    } else {
      const a = reduced ? 1 : 1 - Math.exp(-dt / TAU_DIVIDER);
      cur.pos += (tgt.pos - cur.pos) * a;
      if (Math.abs(tgt.pos - cur.pos) < 0.01) cur.pos = tgt.pos;
      else moving = true;
    }

    const b = reduced ? 1 : 1 - Math.exp(-dt / TAU_VIEW);
    cur.z += (tgt.z - cur.z) * b;
    cur.x += (tgt.x - cur.x) * b;
    cur.y += (tgt.y - cur.y) * b;
    if (Math.abs(tgt.z - cur.z) < 0.0005 && Math.abs(tgt.x - cur.x) < 0.05 && Math.abs(tgt.y - cur.y) < 0.05) {
      cur.z = tgt.z;
      cur.x = tgt.x;
      cur.y = tgt.y;
    } else {
      moving = true;
    }

    write();
    raf = moving ? requestAnimationFrame(frame) : 0;
  };

  const kick = () => {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };

  return {
    /** Registers (or clears) a DOM element the engine writes to. */
    attach(slot: Slot, el: HTMLElement | null) {
      els[slot] = el;
      if (!el) return;
      // A freshly mounted element starts from React's markup: force the readouts to resync.
      if (slot === 'handle' || slot === 'split') shownPos = -1;
      if (slot === 'zoom') shownZoom = -1;
      write();
    },
    write,
    setReduced(value: boolean) {
      reduced = value;
    },
    setSize(width: number, height: number) {
      w = width;
      h = height;
      const t = clampPan(tgt.x, tgt.y, tgt.z);
      tgt.x = t.x;
      tgt.y = t.y;
      const c = clampPan(cur.x, cur.y, cur.z);
      cur.x = c.x;
      cur.y = c.y;
      write();
    },
    /** Target divider position (0–100). */
    pos: () => tgt.pos,
    setPos(value: number, immediate = false) {
      tgt.pos = clamp(value, 0, 100);
      if (immediate) cur.pos = tgt.pos;
      if (immediate) write();
      kick();
    },
    /** Target view (zoom, pan). */
    view: () => ({ z: tgt.z, x: tgt.x, y: tgt.y }),
    setView(z: number, x: number, y: number, immediate = false) {
      const zz = clamp(z, MIN_ZOOM, MAX_ZOOM);
      const p = clampPan(x, y, zz);
      tgt.z = zz;
      tgt.x = p.x;
      tgt.y = p.y;
      if (immediate) {
        cur.z = zz;
        cur.x = p.x;
        cur.y = p.y;
      }
      kick();
      return zz;
    },
    introPending: () => intro.state === 'waiting' || intro.state === 'running',
    /**
     * Re-arms the sweep for a new key (e.g. a new generative result) that has not
     * played yet. The divider stays put while the result renders; startIntro()
     * snaps it to the full output once both renditions have loaded.
     */
    arm(key: string) {
      if (key === intro.key) return;
      intro.key = key;
      if (introPlayed.has(key)) {
        if (intro.state === 'waiting' || intro.state === 'running') {
          intro.state = 'done';
          tgt.pos = 50;
          kick();
        }
        return;
      }
      intro.state = 'waiting';
    },
    startIntro() {
      if (intro.state !== 'waiting') return;
      if (reduced) {
        cur.pos = tgt.pos = 50;
        finishIntro();
        write();
        return;
      }
      intro.state = 'running';
      intro.t0 = performance.now() + INTRO_DELAY_MS;
      kick();
    },
    cancelIntro() {
      if (intro.state === 'waiting' || intro.state === 'running') finishIntro();
    },
    destroy() {
      cancelAnimationFrame(raf);
      raf = 0;
    },
  };
}

type Engine = ReturnType<typeof createEngine>;

/** A stable callback ref that hands an element to the engine. */
function useSlot(engine: Engine, slot: Slot) {
  return useCallback((el: HTMLElement | null) => engine.attach(slot, el), [engine, slot]);
}

interface DragState {
  kind: 'slider' | 'pan' | 'pending';
  id: number;
  startX: number;
  startY: number;
  panX: number;
  panY: number;
  left: number;
  width: number;
  /** Grab offset (in %) so taking hold of the handle never makes the divider jump. */
  offset: number;
}

/**
 * Before / after comparison for Cloudinary transformations.
 * Slider, side-by-side or output-only; shared zoom (1–4×, wheel/keys/double-click)
 * with panning; true fullscreen; keyboard-accessible slider handle. The divider
 * follows the pointer through a frame-rate-independent lerp, written via refs.
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
  components,
  introKey,
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
  /** Transformation components of the output, shown in the metadata strip. */
  components?: string[];
  /**
   * Plays a one-time sweep from the full output to the 50 / 50 split the first
   * time this key is shown in slider mode. A new key (e.g. one per generative
   * result) re-arms it without remounting the viewer.
   */
  introKey?: string;
}) {
  const reduce = useReducedMotionPref();
  // Shares the output's probe with its ProbedImage (deduplicated). Without an output there is nothing to compare.
  const afterAnswer = useProbe(afterUrl, { accept: IMAGE_ACCEPT });
  const outputFailed = afterAnswer?.kind === 'error' || afterAnswer?.kind === 'network';
  const [intro] = useState(() => (introKey && mode === 'slider' && !reduce && !introPlayed.has(introKey) ? introKey : undefined));
  const [engine] = useState<Engine>(() => createEngine(intro));
  const initialPos = intro ? 0 : 50;
  const layer0Ref = useSlot(engine, 'layer0');
  const layer1Ref = useSlot(engine, 'layer1');
  const clipRef = useSlot(engine, 'clip');
  const lineRef = useSlot(engine, 'line');
  const handleRef = useSlot(engine, 'handle');
  const splitRef = useSlot(engine, 'split');
  const zoomTextRef = useSlot(engine, 'zoom');
  const wrapperRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);
  const [band, setBand] = useState<ZoomBand>('min');
  const [fullscreen, setFullscreen] = useState(false);

  useEffect(() => engine.setReduced(reduce), [engine, reduce]);
  useEffect(() => () => engine.destroy(), [engine]);

  // Elements that mount on a mode switch pick up the current view before paint.
  useLayoutEffect(() => {
    engine.write();
  });

  // Cache the stage size (no layout reads inside the frame loop).
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measureStage = () => engine.setSize(stage.clientWidth, stage.clientHeight);
    measureStage();
    const ro = new ResizeObserver(measureStage);
    ro.observe(stage);
    return () => ro.disconnect();
  }, [engine]);

  // Intro sweep: once both renditions have loaded (load events are captured from the <img>s inside the stage).
  // A new introKey shown in the slider re-arms it first (reduced motion never sweeps).
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    if (introKey && mode === 'slider' && !reduce) engine.arm(introKey);
    if (!engine.introPending()) return;
    const loaded = new Set<string>();
    const check = (img: HTMLImageElement) => {
      const src = img.getAttribute('src');
      if (!src || !img.complete || img.naturalWidth === 0) return;
      if (src === beforeUrl || src === afterUrl) loaded.add(src);
      if (loaded.has(beforeUrl) && loaded.has(afterUrl)) engine.startIntro();
    };
    const onLoad = (event: Event) => {
      if (event.target instanceof HTMLImageElement) check(event.target);
    };
    stage.addEventListener('load', onLoad, true);
    stage.querySelectorAll('img').forEach(check);
    let timer = 0;
    const fallback = () => {
      const answer = getMeasurement(afterUrl);
      if (!answer || answer.kind === 'processing') {
        timer = window.setTimeout(fallback, INTRO_RECHECK_MS);
        return;
      }
      engine.startIntro();
    };
    timer = window.setTimeout(fallback, INTRO_FALLBACK_MS);
    return () => {
      stage.removeEventListener('load', onLoad, true);
      window.clearTimeout(timer);
    };
  }, [engine, beforeUrl, afterUrl, introKey, mode, reduce]);

  // Leaving the slider before the intro played: settle on the centre.
  useEffect(() => {
    if (mode !== 'slider' && engine.introPending()) {
      engine.cancelIntro();
      engine.setPos(50, true);
    }
  }, [engine, mode]);

  const applyView = useCallback(
    (z: number, x: number, y: number) => {
      const next = engine.setView(z, x, y);
      setBand(bandOf(next));
    },
    [engine],
  );

  const zoomAround = useCallback(
    (next: number, clientX?: number, clientY?: number) => {
      const v = engine.view();
      const z = clamp(next, MIN_ZOOM, MAX_ZOOM);
      let x = (v.x * z) / v.z;
      let y = (v.y * z) / v.z;
      const stage = stageRef.current;
      if (stage && clientX !== undefined && clientY !== undefined) {
        const rect = stage.getBoundingClientRect();
        const cx = clientX - rect.left - rect.width / 2;
        const cy = clientY - rect.top - rect.height / 2;
        // Keep the point under the cursor fixed while zooming.
        x = cx - ((cx - v.x) * z) / v.z;
        y = cy - ((cy - v.y) * z) / v.z;
      }
      applyView(z, x, y);
    },
    [engine, applyView],
  );

  const stepZoom = (dir: 1 | -1) => {
    const z = engine.view().z;
    const idx = ZOOM_STEPS.findIndex((s) => s >= z - 0.01);
    zoomAround(ZOOM_STEPS[clamp((idx === -1 ? ZOOM_STEPS.length - 1 : idx) + dir, 0, ZOOM_STEPS.length - 1)]);
  };

  const resetZoom = () => applyView(1, 0, 0);

  /** Pointer x → divider position (%) in unzoomed image space. */
  const pointerPos = (clientX: number, left: number, width: number) => {
    const v = engine.view();
    const localX = (clientX - left - width / 2 - v.x) / v.z + width / 2;
    return (localX / width) * 100;
  };

  const sliderTo = (clientX: number) => {
    const d = drag.current;
    if (!d || d.width === 0) return;
    engine.setPos(pointerPos(clientX, d.left, d.width) - d.offset);
  };

  const beginSlider = (stage: HTMLElement, pointerId: number) => {
    engine.cancelIntro();
    stage.setPointerCapture(pointerId);
    stage.dataset.dragging = 'slider';
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const stage = event.currentTarget;
    const onHandle = Boolean((event.target as HTMLElement).closest('[data-handle]'));
    const zoomed = engine.view().z > MIN_ZOOM + 0.001;
    let kind: DragState['kind'];
    if (mode === 'slider' && outputFailed && !zoomed) return; // no output to compare; the divider stays put
    if (mode === 'slider' && (onHandle || !zoomed)) kind = onHandle || event.pointerType === 'mouse' ? 'slider' : 'pending';
    else if (zoomed) kind = 'pan';
    else return;

    const rect = stage.getBoundingClientRect();
    const v = engine.view();
    drag.current = {
      kind,
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      panX: v.x,
      panY: v.y,
      left: rect.left,
      width: rect.width,
      offset: onHandle && rect.width > 0 ? pointerPos(event.clientX, rect.left, rect.width) - engine.pos() : 0,
    };
    if (kind === 'slider') {
      beginSlider(stage, event.pointerId);
      sliderTo(event.clientX);
    } else if (kind === 'pan') {
      stage.setPointerCapture(event.pointerId);
      stage.dataset.dragging = 'pan';
    }
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const dx = event.clientX - d.startX;
    const dy = event.clientY - d.startY;
    if (d.kind === 'pending') {
      if (Math.abs(dx) > TOUCH_SLOP && Math.abs(dx) > Math.abs(dy)) {
        d.kind = 'slider';
        beginSlider(event.currentTarget, event.pointerId);
      } else if (Math.abs(dy) > TOUCH_SLOP) {
        drag.current = null; // a vertical scroll — leave it to the browser
        return;
      } else {
        return;
      }
    }
    if (d.kind === 'slider') sliderTo(event.clientX);
    else {
      const v = engine.view();
      engine.setView(v.z, d.panX + dx, d.panY + dy, true);
    }
  };

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    // On touch the <img> under the finger holds the implicit pointer capture. When a swipe turns into a
    // slider drag the stage takes the capture over, and the <img>'s lostpointercapture bubbles up here:
    // only the stage's own capture loss ends a drag.
    if (event.type === 'lostpointercapture' && event.target !== event.currentTarget) return;
    const d = drag.current;
    if (d?.kind === 'pending' && event.type === 'pointerup') {
      // A tap on touch sets the divider where it landed.
      engine.cancelIntro();
      sliderTo(event.clientX);
    }
    drag.current = null;
    delete event.currentTarget.dataset.dragging;
  };

  // Ctrl/⌘ + wheel (and trackpad pinch) zooms; plain wheel keeps scrolling the page.
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;
      event.preventDefault();
      zoomAround(engine.view().z * (event.deltaY < 0 ? 1.15 : 1 / 1.15), event.clientX, event.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [engine, zoomAround]);

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
      resetZoom();
    }
  };

  const onHandleKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 2;
    const p = engine.pos();
    let next: number;
    if (event.key === 'ArrowLeft') next = p - step;
    else if (event.key === 'ArrowRight') next = p + step;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 100;
    else return;
    event.preventDefault();
    event.stopPropagation();
    engine.cancelIntro();
    engine.setPos(next);
  };

  const zoomed = band !== 'min';
  const layer = 'absolute inset-0 origin-center will-change-transform';

  return (
    <div
      ref={wrapperRef}
      className={cn('flex flex-col overflow-hidden rounded-[10px] border border-line bg-surface', fullscreen && 'rounded-none border-0')}
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
            <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => stepZoom(-1)} aria-label="Zoom out" disabled={band === 'min'}>
              <Minus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="num w-11 font-mono text-[11px] text-ink-2 hover:text-ink"
              onClick={resetZoom}
              title="Reset zoom (0)"
              aria-label="Reset zoom"
            >
              <span ref={zoomTextRef} />
            </button>
            <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => stepZoom(1)} aria-label="Zoom in" disabled={band === 'max'}>
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
        data-cursor={zoomed ? 'DRAG' : mode === 'slider' ? 'COMPARE' : undefined}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
        onDoubleClick={(event) => zoomAround(engine.view().z > MIN_ZOOM + 0.001 ? 1 : 2.5, event.clientX, event.clientY)}
        aria-label="Comparison stage. Use + and − to zoom, 0 to reset, drag to pan when zoomed."
        className={cn(
          'group/stage checker relative isolate w-full select-none overflow-hidden',
          // Keyboard focus ring. The panel clips anything outside the stage and the positioned image layers
          // paint over an inset outline, so the ring is an inset shadow on a pseudo-element above the layers.
          "focus-visible:outline-none after:pointer-events-none after:absolute after:inset-0 after:z-20 after:content-[''] focus-visible:after:shadow-[inset_0_0_0_2px_var(--color-signal)]",
          fullscreen ? 'flex-1' : '',
          zoomed ? 'touch-none cursor-grab data-[dragging=pan]:cursor-grabbing' : 'touch-pan-y',
          !zoomed && (mode === 'slider' ? 'cursor-ew-resize' : 'cursor-zoom-in'),
        )}
        style={fullscreen ? undefined : { aspectRatio: `${Math.max(aspect, 0.8)}`, maxHeight: '68vh' }}
      >
        {mode === 'side' ? (
          <div className="absolute inset-0 grid grid-cols-2 gap-px bg-line">
            {[
              { url: beforeUrl, label: beforeLabel },
              { url: afterUrl, label: afterLabel },
            ].map((pane, i) => (
              <div key={i} className="checker relative overflow-hidden">
                <div ref={i === 0 ? layer0Ref : layer1Ref} className={layer}>
                  <ProbedImage url={pane.url} alt={pane.label} context={i === 1 ? 'pipeline' : 'asset'} />
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
            <div ref={layer0Ref} className={layer}>
              {/* The output's status (423 rendering, Cloudinary's error) is lifted above the original's clip layer,
                  so the slider never hides why the output is missing. */}
              <ProbedImage url={afterUrl} alt={afterLabel} context="pipeline" className="[&>:not(img)]:z-10" />
              {afterOverlay}
              {mode === 'slider' && (
                <div ref={clipRef} className="absolute inset-0">
                  <div className="checker absolute inset-0" />
                  <ProbedImage url={beforeUrl} alt={beforeLabel} showStatus={false} />
                </div>
              )}
            </div>
            {mode === 'slider' && (
              <>
                <div
                  ref={lineRef}
                  aria-hidden
                  className={cn('pointer-events-none absolute inset-y-0 left-0 w-px will-change-transform', outputFailed && 'invisible')}
                >
                  <span className="absolute inset-y-0 -left-[2px] w-[5px] bg-signal opacity-0 transition-opacity duration-200 group-data-[dragging=slider]/stage:opacity-20" />
                  <span className="absolute inset-0 bg-signal" />
                </div>
                <div
                  ref={handleRef}
                  data-handle
                  data-cursor="DRAG"
                  role="slider"
                  tabIndex={0}
                  aria-label="Comparison position"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={initialPos}
                  onKeyDown={onHandleKeyDown}
                  className={cn(
                    'group/handle absolute left-0 top-1/2 -ml-[18px] -mt-[24px] flex h-12 w-9 cursor-ew-resize touch-none items-center justify-center will-change-transform',
                    outputFailed && 'invisible',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-11 w-[26px] items-center justify-center rounded-[7px] border border-signal bg-canvas text-signal shadow-[0_1px_8px_rgba(3,8,18,0.45)]',
                      'transition-[scale,background-color,color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
                      'group-hover/handle:scale-[1.06] group-focus-visible/handle:scale-[1.06]',
                      'group-data-[dragging=slider]/stage:scale-[1.06] group-data-[dragging=slider]/stage:bg-signal group-data-[dragging=slider]/stage:text-signal-ink',
                    )}
                  >
                    <ChevronLeft className="-mr-[3px] h-3 w-3" strokeWidth={2.5} />
                    <ChevronRight className="-ml-[3px] h-3 w-3" strokeWidth={2.5} />
                  </span>
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

      {components && (
        <div className="flex items-center gap-3 border-t border-line px-3 py-2">
          <span className="label shrink-0">Output</span>
          <div className="scrollbar-none min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-[10.5px] text-ink-2" title={components.join(' / ')}>
            {components.length === 0 ? (
              <span className="text-ink-3">No transformation — the original as stored</span>
            ) : (
              components.map((c, i) => (
                <span key={`${i}-${c}`}>
                  {i > 0 && <span className="px-1.5 text-ink-3">/</span>}
                  {c}
                </span>
              ))
            )}
          </div>
          {mode === 'slider' && (
            <span className="num hidden shrink-0 font-mono text-[10.5px] text-ink-3 sm:inline" aria-hidden>
              split <span ref={splitRef} className="text-ink-2" />%
            </span>
          )}
        </div>
      )}
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
        'pointer-events-none absolute top-3 rounded-[6px] border px-2 py-1 font-mono text-[10.5px] uppercase tracking-[0.06em]',
        side === 'left' ? 'left-3' : 'right-3',
        accent ? 'border-[color-mix(in_oklab,var(--color-signal)_45%,transparent)] bg-canvas/90 text-signal' : 'border-line-strong bg-canvas/90 text-ink-2',
      )}
    >
      {children}
    </span>
  );
}
