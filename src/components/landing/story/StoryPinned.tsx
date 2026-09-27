'use client';

import { useMotionValueEvent, useScroll, useSpring } from 'framer-motion';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { clamp, lerp, type DeviceTier } from '@/components/motion/hooks';
import { CATEGORY_LABEL } from '@/lib/analytics';
import type { CloudinaryInsight } from '@/lib/cloudinary/insights';
import type { Region } from '@/lib/types';
import { cn } from '@/components/ui/cn';
import {
  DATASET,
  EVIDENCE_SRC,
  GROUPS_HIGH,
  GROUPS_LOW,
  HERO,
  HERO_ASPECT,
  PRIMARY_HIGH,
  PRIMARY_LOW,
  STAGES,
  TILES_HIGH,
  TILES_LOW,
  WORD_STYLES,
  type TileGroup,
  type TileSpec,
  type WordStyle,
} from './data';
import { useArmed, useReportHash, useStoryInsights } from './hooks';
import { computeLayout, cornerWordScale, WORD_LINE, type Measures, type SceneLayout } from './layout';
import { ActionPanel, InsightLegend, InsightPanel, QueryPanel, RecordPanel, ReportSheet } from './parts';
import { applyLayout, collectSceneDom, createSceneDom, drawScene, put, type SceneDom } from './render';

/**
 * The platform story as ONE pinned scene: a ~6-viewport section with a sticky
 * full-screen stage. Scroll progress drives six connected stages; a single
 * motion-value subscription interpolates precomputed keyframes and writes
 * styles directly, so React never re-renders while scrolling.
 */

const SPRING = { stiffness: 190, damping: 36, mass: 0.55, restDelta: 0.00002 };

/** Where the stage buttons land: each stage's settled moment. */
const JUMP_TARGETS = [0.0, 0.29, 0.47, 0.63, 0.79, 0.975];

/* ------------------------------------------------------------------------ */
/* Scene state (mutable, outside React)                                      */
/* ------------------------------------------------------------------------ */

/*
 * Frame-time governor. The kinetic word axes are the costliest per-frame work
 * (a ~300px word re-shaped and re-rasterised). When the scene cannot hold the
 * frame budget — a rolling mean of animation-frame intervals above ~20ms over
 * 30 frames, as on throttled or low-power laptops the tier check lets through —
 * the word falls back to the static per-stage axes the low tier uses.
 */
const GOVERNOR_FRAMES = 30;
const GOVERNOR_BUDGET_MS = 20;
/** One long frame (an image decode, a GC) counts at most this much, so isolated hitches don't trip it. */
const GOVERNOR_CLIP_MS = 50;
/** Intervals outside this range are not consecutive frames (a pause between gestures, or a repeat paint). */
const GOVERNOR_MIN_MS = 4;
const GOVERNOR_GAP_MS = 120;

interface Scene {
  dom: SceneDom;
  layout: SceneLayout | null;
  p: number;
  /** Per-frame font-axis animation of the stage word (high tier only). */
  kinetic: boolean;
  /** Follow a light spring (mouse wheels step); touch scrolling is already smooth, so it is followed directly. */
  springy: boolean;
  /** Set once the frame-time governor has dropped the kinetic axes; stays set for this mount. */
  governed: boolean;
  /** Governor: ring buffer of recent animation-frame intervals (ms) while the scene paints. */
  frames: Float64Array;
  frameAt: number;
  frameCount: number;
  frameSum: number;
  lastPaint: number;
}

function createScene(): Scene {
  return {
    dom: createSceneDom(),
    layout: null,
    p: 0,
    kinetic: false,
    springy: true,
    governed: false,
    frames: new Float64Array(GOVERNOR_FRAMES),
    frameAt: 0,
    frameCount: 0,
    frameSum: 0,
    lastPaint: 0,
  };
}

function paint(scene: Scene, p: number): void {
  scene.p = p;
  if (scene.layout) drawScene(scene.dom, scene.layout, p, scene.kinetic);
}

function govern(scene: Scene): void {
  if (!scene.kinetic) return;
  const now = performance.now();
  const dt = now - scene.lastPaint;
  scene.lastPaint = now;
  if (dt < GOVERNOR_MIN_MS || dt > GOVERNOR_GAP_MS) return;
  const v = Math.min(dt, GOVERNOR_CLIP_MS);
  scene.frameSum += v - scene.frames[scene.frameAt];
  scene.frames[scene.frameAt] = v;
  scene.frameAt = (scene.frameAt + 1) % GOVERNOR_FRAMES;
  if (scene.frameCount < GOVERNOR_FRAMES) {
    scene.frameCount += 1;
    return;
  }
  if (scene.frameSum / GOVERNOR_FRAMES > GOVERNOR_BUDGET_MS) {
    scene.governed = true;
    scene.kinetic = false;
    if (scene.layout) applyLayout(scene.dom, scene.layout, false);
    if (scene.dom.stage) scene.dom.stage.dataset.kinetic = 'governed';
  }
}

function attach(scene: Scene, root: HTMLElement, kinetic: boolean): void {
  scene.kinetic = kinetic && !scene.governed;
  scene.springy = window.matchMedia('(pointer: fine)').matches;
  collectSceneDom(scene.dom, root);
}

function currentProgress(scene: Scene, smoothed: number, raw: number): number {
  return scene.springy ? smoothed : raw;
}

function detach(scene: Scene): void {
  scene.layout = null;
}

function evidenceArrived(scene: Scene, img: HTMLImageElement): void {
  scene.dom.evidence = img;
  scene.dom.evidenceReady = true;
  paint(scene, scene.p);
}

/* ------------------------------------------------------------------------ */
/* Measurement (resize only)                                                 */
/* ------------------------------------------------------------------------ */

function wordSettings(s: WordStyle, kinetic: boolean): { wdth: number; track: number; wght: number } {
  return kinetic
    ? { wdth: Math.max(...s.wdth), track: Math.max(...s.track), wght: Math.max(...s.wght) }
    : { wdth: Math.round(lerp(s.wdth[0], s.wdth[1], 0.5)), track: lerp(s.track[0], s.track[1], 0.5), wght: Math.max(...s.wght) };
}

/** Widest rendering of a stage word at the current font size. */
function measureWord(el: HTMLElement | null, s: WordStyle, kinetic: boolean, fontPx: number): number {
  if (!el) return fontPx * 5;
  const prevV = el.style.getPropertyValue('font-variation-settings');
  const prevT = el.style.getPropertyValue('letter-spacing');
  const { wdth, track, wght } = wordSettings(s, kinetic);
  el.style.setProperty('font-variation-settings', `"wdth" ${wdth}, "wght" ${wght}`);
  el.style.setProperty('letter-spacing', `${track}em`);
  const w = el.offsetWidth;
  el.style.setProperty('font-variation-settings', prevV);
  el.style.setProperty('letter-spacing', prevT);
  return w;
}

function measure(scene: Scene): Measures | null {
  const d = scene.dom;
  const stage = d.stage;
  if (!stage || !d.sheet || !d.slot) return null;
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  if (!W || !H) return null;
  const narrow = W < 900 || W / H < 1.1;
  // Short phones: panels drop their secondary rows (see the `in-data-[dense=true]` classes in parts.tsx).
  const dense = narrow && H < 800;
  if (stage.dataset.narrow !== String(narrow)) stage.dataset.narrow = String(narrow);
  if (stage.dataset.dense !== String(dense)) stage.dataset.dense = String(dense);
  const M = narrow ? 16 : Math.round(clamp(W * 0.028, 24, 48));
  const topY = narrow ? 72 : 88;
  const colW = narrow ? W - M * 2 : Math.round(clamp(W * 0.29, 300, 420));

  put(d.hud, 'left', `${M}px`);
  put(d.hud, 'bottom', `${narrow ? 14 : M}px`);
  put(d.hud, 'width', `${colW}px`);
  put(d.query, 'width', `${colW}px`);
  put(d.insight, 'width', `${narrow ? colW : colW - 12}px`);
  put(d.action, 'width', `${colW}px`);

  const fontPx = Math.round(clamp(W * (narrow ? 0.24 : 0.2), 90, 380));
  put(d.rig, 'font-size', `${fontPx}px`);
  const wordW = WORD_STYLES.map((s, k) => measureWord(d.words[k] ?? null, s, scene.kinetic, fontPx));

  const hud = d.hud
    ? { x: d.hud.offsetLeft, y: d.hud.offsetTop, w: d.hud.offsetWidth, h: d.hud.offsetHeight }
    : { x: M, y: H - 150, w: colW, h: 130 };

  // Report sheet: as wide as the layout allows, narrowed until it fits the height.
  const wordH5 = fontPx * WORD_LINE * cornerWordScale({ W, H, narrow, colW, wordW, fontPx }, 5);
  const availH = narrow ? hud.y - 12 - (topY + wordH5 + 12) : H - topY - M;
  const gridW = W - M - (M + colW + clamp(W * 0.035, 32, 64));
  let sheetW = narrow ? Math.min(W - M * 2, 440) : Math.round(Math.min(clamp(W * 0.36, 340, 520), gridW));
  for (let k = 0; k < 4; k++) {
    put(d.sheet, 'width', `${sheetW}px`);
    const sh = d.sheet.offsetHeight;
    if (sh <= availH) break;
    const lose = Math.min(d.slot.offsetHeight - 80, sh - availH + 2);
    if (lose <= 0) break;
    sheetW = Math.max(220, Math.floor(sheetW - lose * HERO_ASPECT));
  }
  // The slot relative to the sheet, in the sheet's own (unscaled) pixels: the sheet may
  // currently carry a fit-to-room scale from the previous layout.
  const sheetRect = d.sheet.getBoundingClientRect();
  const slotRect = d.slot.getBoundingClientRect();
  const k = sheetRect.width / Math.max(1, d.sheet.offsetWidth) || 1;

  return {
    W,
    H,
    narrow,
    M,
    topY,
    colW,
    fontPx,
    wordW,
    hud,
    queryH: d.query?.offsetHeight ?? 120,
    insightH: d.insight?.offsetHeight ?? 200,
    sheetW: d.sheet.offsetWidth,
    sheetH: d.sheet.offsetHeight,
    slot: {
      x: (slotRect.left - sheetRect.left) / k,
      y: (slotRect.top - sheetRect.top) / k,
      w: slotRect.width / k,
      h: slotRect.height / k,
    },
  };
}

function relayout(scene: Scene, tiles: TileSpec[], groups: TileGroup[], p: number): void {
  const m = measure(scene);
  if (!m) return;
  const layout = computeLayout(m, tiles, groups, HERO_ASPECT);
  scene.layout = layout;
  applyLayout(scene.dom, layout, scene.kinetic);
  paint(scene, p);
}

/* ------------------------------------------------------------------------ */
/* Component                                                                 */
/* ------------------------------------------------------------------------ */

const pad = (n: number) => String(n).padStart(2, '0');

export function StoryPinned({ tier }: { tier: DeviceTier }) {
  const high = tier === 'high';
  const tiles = high ? TILES_HIGH : TILES_LOW;
  const groups = high ? GROUPS_HIGH : GROUPS_LOW;
  const primaries = high ? PRIMARY_HIGH : PRIMARY_LOW;

  const [scene] = useState(createScene);
  const sectionRef = useRef<HTMLElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const armed = useArmed(sectionRef, '120% 0px');
  const insights = useStoryInsights(primaries, armed);
  const hash = useReportHash(armed ? EVIDENCE_SRC : null);

  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end end'] });
  const smooth = useSpring(scrollYProgress, SPRING);

  // Fine pointers get a light spring over wheel steps; touch devices follow the finger directly.
  useMotionValueEvent(smooth, 'change', (v) => {
    if (!scene.springy) return;
    govern(scene);
    paint(scene, v);
  });
  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    if (scene.springy) return;
    govern(scene);
    paint(scene, v);
  });

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    attach(scene, stage, high);
    let raf = 0;
    let alive = true;
    const run = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (alive) relayout(scene, tiles, groups, currentProgress(scene, smooth.get(), scrollYProgress.get()));
      });
    };
    const ro = new ResizeObserver(run);
    ro.observe(stage);
    // The caption block's height feeds the layout (tiles, panels and the report sheet keep
    // clear of it) and changes after mount: web fonts, and the live fl_getinfo legend.
    if (scene.dom.hud) ro.observe(scene.dom.hud);
    document.fonts?.ready.then(run).catch(() => undefined);
    run();
    return () => {
      alive = false;
      ro.disconnect();
      cancelAnimationFrame(raf);
      detach(scene);
    };
  }, [scene, tiles, groups, high, smooth, scrollYProgress]);

  const jumpTo = (k: number) => {
    const el = sectionRef.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const range = el.offsetHeight - window.innerHeight;
    window.scrollTo({ top: top + range * JUMP_TARGETS[k], behavior: 'smooth' });
  };

  return (
    <section
      ref={sectionRef}
      id="platform"
      aria-label="The VisualOps platform, in six stages"
      className={cn('relative bg-canvas', high ? 'h-[620vh]' : 'h-[560vh]')}
    >
      <ol className="sr-only">
        {STAGES.map((s, k) => (
          <li key={s.id}>
            Stage {k + 1} of {STAGES.length}, {s.title}: {s.body} ({s.tech})
          </li>
        ))}
      </ol>

      <div ref={stageRef} data-kinetic={high ? 'axes' : 'static'} className="sticky top-0 h-[100svh] overflow-hidden">
        {/* Environment: a survey grid that surfaces only while the media is structured. */}
        <div data-sc="grid-bg" aria-hidden className="survey-grid pointer-events-none invisible absolute inset-0 opacity-0" />

        {/* Kinetic stage word (structural layer, behind the media). */}
        <div
          data-sc="rig"
          aria-hidden
          className="pointer-events-none invisible absolute left-0 top-0 z-[2] origin-top-left text-[200px] opacity-0 [contain:layout_style]"
        >
          <div className="absolute left-0 top-0 h-[0.9em] w-0 [clip-path:inset(0_-400vw)]">
            {STAGES.map((s, k) => (
              <span
                key={s.id}
                data-sc="word"
                className={cn(
                  'type-poster invisible absolute left-0 top-0 block whitespace-nowrap leading-[0.9]',
                  // Recessed behind the hero on wide screens; a normal corner word on phones.
                  WORD_STYLES[k].dim ? 'text-line-strong max-[899px]:text-ink' : 'text-ink',
                )}
              >
                {s.word}
              </span>
            ))}
          </div>
        </div>

        {/* Category headers for the structured grid. */}
        <div data-sc="headers" aria-hidden className="pointer-events-none invisible absolute inset-0 z-[5] opacity-0">
          {groups.map((g) => (
            <div
              key={g.category}
              data-sc="header"
              className="absolute left-0 top-0 flex items-baseline justify-between gap-2 border-b border-line-strong pb-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3"
            >
              <span className="truncate text-ink-2">{CATEGORY_LABEL[g.category]}</span>
              <span className="num">{pad(g.records)}</span>
            </div>
          ))}
        </div>

        {/* Report sheet (below the tiles, so the evidence tile lands on it). */}
        <div data-sc="sheet" className="invisible absolute left-0 top-0 z-[8] origin-top-left opacity-0">
          <ReportSheet
            evidenceSrc={armed ? EVIDENCE_SRC : null}
            hash={hash}
            live
            onEvidenceLoad={(img) => evidenceArrived(scene, img)}
          />
        </div>

        {/* Media layer. */}
        <div data-sc="tiles" aria-hidden className="pointer-events-none absolute inset-0 z-10">
          {tiles.map((spec, i) => (
            <Tile
              key={spec.key}
              spec={spec}
              armed={armed}
              insight={insights[spec.asset.id]}
              z={spec.hero ? tiles.length + 5 : ((i * 7) % tiles.length) + 1}
            />
          ))}
        </div>

        {/* UNDERSTAND scan line. */}
        <div data-sc="scan" aria-hidden className="pointer-events-none invisible absolute inset-x-0 top-0 z-20 h-px bg-signal/70 opacity-0">
          <span className="absolute -top-4 right-4 font-mono text-[9.5px] tracking-[0.08em] text-signal">fl_getinfo · g_auto</span>
        </div>

        {/* STRUCTURE record (wide layouts). */}
        <div data-sc="record" className="pointer-events-none invisible absolute left-0 top-0 z-30 opacity-0">
          <RecordPanel />
        </div>

        {/* SEARCH panel. */}
        <div data-sc="query" className="pointer-events-none invisible absolute left-0 top-0 z-30 opacity-0">
          <QueryPanel live />
        </div>

        {/* INSIGHT panel. */}
        <div data-sc="insight" className="pointer-events-none invisible absolute left-0 top-0 z-30 opacity-0">
          <InsightPanel />
        </div>

        {/* ACTION panel. */}
        <div data-sc="action" className="pointer-events-none invisible absolute left-0 top-0 z-30 opacity-0">
          <ActionPanel />
        </div>

        {/* Caption block: dataset, counter, stage navigation, title, sentence, technology. */}
        <div data-sc="hud" className="absolute bottom-4 left-4 z-40">
          {/* The column under the stage word is free in every stage; the top band above the grid is not. */}
          <p className="label mb-0.5 hidden sm:block">
            Sample dataset · {DATASET.captures} captures
            {/* One line in the narrowest caption column (900–1279px wide layouts). */}
            <span className="min-[900px]:max-xl:hidden"> · {DATASET.videos} videos</span> · {DATASET.sites} sites
          </p>
          <div className="flex items-center gap-4">
            <span className="num flex shrink-0 items-baseline whitespace-nowrap font-mono text-[12px] tracking-[0.04em]" aria-hidden>
              <span className="relative inline-block h-[1.25em] overflow-hidden text-signal">
                <span data-sc="counter" className="flex flex-col leading-[1.25em]">
                  {STAGES.map((s, k) => (
                    <span key={s.id}>{pad(k + 1)}</span>
                  ))}
                </span>
              </span>
              <span className="ml-1.5 text-ink-3">/ {pad(STAGES.length)}</span>
            </span>
            <div className="flex items-center gap-1" role="group" aria-label="Jump to a stage">
              {STAGES.map((s, k) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => jumpTo(k)}
                  aria-label={`Stage ${k + 1}: ${s.title}`}
                  title={s.title}
                  className="group relative h-10 w-7 sm:w-9"
                >
                  <span className="absolute inset-x-0 top-1/2 h-px bg-line-strong transition-colors duration-200 group-hover:bg-ink-3" />
                  <span data-sc="seg" className="absolute inset-x-0 top-1/2 h-px origin-left bg-signal" style={{ transform: 'scaleX(0)' }} />
                </button>
              ))}
            </div>
          </div>
          <div className="relative mt-0.5 grid" aria-hidden>
            {STAGES.map((s, k) => (
              <div key={s.id} data-sc="block" className={cn('[grid-area:1/1]', k > 0 && 'invisible opacity-0')}>
                <p className="type-heading text-[17px] text-ink">{s.title}</p>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-2">{s.body}</p>
                <p className="mt-2 hidden font-mono text-[10.5px] leading-snug text-ink-3 sm:block">{s.tech}</p>
                {k === 1 && <InsightLegend insights={insights} />}
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------------ */
/* Tile                                                                      */
/* ------------------------------------------------------------------------ */

function Tile({
  spec,
  armed,
  insight,
  z,
}: {
  spec: TileSpec;
  armed: boolean;
  insight: CloudinaryInsight | undefined;
  z: number;
}) {
  return (
    <div
      data-sc="tile"
      className={cn('invisible absolute left-0 top-0 opacity-0', !spec.hero && 'will-change-transform')}
      style={{ zIndex: z }}
    >
      <div className="relative h-full w-full overflow-hidden rounded-[3px] bg-raised">
        {armed && (
          // eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition
          <img src={spec.src} alt="" decoding="async" draggable={false} className="absolute inset-0 h-full w-full object-cover" />
        )}
        {/* Overlays start hidden; the renderer writes their opacity directly (see render.ts `overlay`). */}
        {spec.primary && (
          <div data-sc="ai" className="absolute inset-0" style={HIDDEN}>
            {spec.region && <Box region={spec.region} tone="annotation" label={spec.region.label} />}
            {insight?.focus && <Box region={insight.focus} tone="crop" />}
            {insight?.faces.map((face, i) => (
              <Box key={i} region={face} tone="face" />
            ))}
          </div>
        )}
        {spec.match && (
          <div
            data-sc="hit"
            className="absolute inset-0 rounded-[3px]"
            style={{ ...HIDDEN, boxShadow: 'inset 0 0 0 var(--ring, 1.5px) var(--color-signal)' }}
          />
        )}
        {spec.hero && <HeroAnnotation region={HERO.finding?.region} />}
        <div className="absolute inset-0 rounded-[3px] ring-1 ring-inset ring-white/10" />
      </div>
      <div
        className="absolute left-0 top-full mt-[0.45em] whitespace-nowrap font-mono leading-none text-ink-3"
        style={{ fontSize: 'var(--cap-fs, 9px)', opacity: 'var(--cap, 1)' }}
      >
        {spec.caption}
      </div>
    </div>
  );
}

const HIDDEN: CSSProperties = { opacity: 0, visibility: 'hidden' };

const BOX_TONE = {
  annotation: 'border-high/90 bg-high/10',
  /** Cloudinary's g_auto 1:1 crop window (crop geometry, not a subject box). */
  crop: 'border-dashed border-signal',
  /** Cloudinary face detection (automatic; can include false positives). */
  face: 'border-signal bg-signal/15',
} as const;

function Box({ region, tone, label }: { region: Region; tone: keyof typeof BOX_TONE; label?: string }) {
  const style: CSSProperties = {
    left: `${region.x}%`,
    top: `${region.y}%`,
    width: `${region.w}%`,
    height: `${region.h}%`,
    borderWidth: 'var(--bd, 1px)',
  };
  return (
    <div className={cn('absolute rounded-[2px]', BOX_TONE[tone])} style={style}>
      {label && (
        <span
          className={cn(
            'absolute left-0 whitespace-nowrap rounded-[2px] bg-high px-[0.4em] py-[0.2em] font-mono font-semibold leading-none tracking-[0.06em] text-signal-ink',
            region.y < 10 ? 'top-0' : 'bottom-full mb-[0.25em]',
          )}
          style={{ fontSize: 'var(--chip-fs, 7.5px)' }}
        >
          {label}
        </span>
      )}
    </div>
  );
}

/**
 * The critical finding's annotation, shown at the INSIGHT stage. The tile is laid
 * out at its largest (base) size and scaled down by transform, so the text sizes
 * are multiplied by `--ann-k` (base ÷ INSIGHT size) to read at 10–10.5px there.
 */
function HeroAnnotation({ region }: { region: Region | undefined }) {
  const f = HERO.finding;
  return (
    <div data-sc="ann" className="absolute inset-0" style={HIDDEN}>
      {region && (
        <div
          className="absolute rounded-[3px] border-2 border-critical bg-critical/10"
          style={{ left: `${region.x}%`, top: `${region.y}%`, width: `${region.w}%`, height: `${region.h}%` }}
        >
          <span
            className="absolute bottom-full left-[-2px] mb-[0.5em] whitespace-nowrap rounded-[3px] bg-critical px-[0.6em] py-[0.3em] font-mono font-semibold leading-none tracking-[0.06em] text-white"
            style={{ fontSize: 'calc(10px * var(--ann-k, 1))' }}
          >
            {region.label} · {f?.severity.toUpperCase()}
          </span>
        </div>
      )}
      <span className="reticle" />
      {/* Bottom-left, inside the reticle corner: the photo's own credit line sits bottom-right. */}
      <span
        className="absolute bottom-[1.2em] left-[3em] whitespace-nowrap rounded-[3px] bg-canvas/80 px-[0.55em] py-[0.3em] font-mono leading-none text-ink-2"
        style={{ fontSize: 'calc(10.5px * var(--ann-k, 1))' }}
      >
        {/* Phones show the file name in the panel below; the chip keeps the provenance. */}
        <span className="in-data-[narrow=true]:hidden">{HERO.fileName} · </span>sample annotation
      </span>
    </div>
  );
}
