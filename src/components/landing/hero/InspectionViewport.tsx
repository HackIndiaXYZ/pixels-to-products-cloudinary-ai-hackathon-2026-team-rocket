'use client';

import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from 'framer-motion';
import { ChevronsLeftRight } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Region } from '@/lib/types';
import { evidenceUrl, posterOffset, rawStillUrl } from '@/lib/cloudinary/media';
import { describeCropCentre, fetchInsight, type CloudinaryInsight } from '@/lib/cloudinary/insights';
import { IMAGE_ACCEPT } from '@/lib/cloudinary/probe';
import { transformationFromUrl } from '@/lib/cloudinary/url';
import { RegionLayer } from '@/components/media/RegionLayer';
import { useProbe } from '@/components/media/useProbe';
import { clamp, useDeviceTier, useReducedMotionPref } from '@/components/motion/hooks';
import { cn } from '@/components/ui/cn';
import { landingAsset } from '../landing-data';
import { HeroTelemetry } from './HeroTelemetry';
import styles from './hero.module.css';

const ASSET = landingAsset('vo-demolition-deck');

/*
 * Both images carry the same width ladder and `sizes`, so the browser picks the
 * same rendition width for each and the wipe stays pixel-aligned. The raw side
 * is only resized (no q_auto/f_auto, no effects), keeping the comparison honest.
 */
const WIDTHS = [640, 960, 1280, 1600];
const RAW_SRCSET = WIDTHS.map((w) => `${rawStillUrl(ASSET, w)} ${w}w`).join(', ');
const EVIDENCE_SRCSET = WIDTHS.map((w) => `${evidenceUrl(ASSET, w)} ${w}w`).join(', ');
/** Frame slot: the grid column from lg (capped container from 1440), the padded viewport below. */
const SIZES = '(min-width: 1440px) 630px, (min-width: 1024px) 44vw, (min-width: 640px) calc(100vw - 64px), calc(100vw - 32px)';
const RAW_FALLBACK = rawStillUrl(ASSET, 1600);
const EVIDENCE_FALLBACK = evidenceUrl(ASSET, 1600);
const FRAME_AT = `00:${String(posterOffset(ASSET)).padStart(2, '0')}`;
const SITE = [ASSET.site, ASSET.zone].filter(Boolean).join(' · ');
const REGION = ASSET.finding?.region;

/**
 * Where the divider rests after the intro (percent of frame width showing the
 * raw capture). Narrow frames rest further right so its labels clear the
 * g_auto crop label and region edge on the left.
 */
const restFor = (frameWidth: number) => (frameWidth < 520 ? 68 : 50);
const EASE_OUT = [0.16, 1, 0.3, 1] as const;
const EASE_SCAN = [0.65, 0, 0.35, 1] as const;
const TILT_Y = 6;
const TILT_X = 4;

/*
 * Choreography, from mount. Each step waits for the real operation it depicts:
 *   1.4 s  scan: Cloudinary's evidence rendition (already loaded) replaces the raw frame, top → bottom
 *   2.2 s  the sample annotation and the live g_auto 1:1 crop window (fl_getinfo) draw in;
 *          the divider settles to show raw | Cloudinary side by side
 *   2.8 s  telemetry populates; delivery figures come from a live HEAD probe of the
 *          exact rendition the browser picked from the srcset (its currentSrc)
 */
const SCAN_AT = 1400;
const SCAN_MS = 800;
const TELEMETRY_AFTER = 600;

type Phase = 0 | 1 | 2;
type InsightState = CloudinaryInsight | 'pending' | 'error';

export function InspectionViewport({ className }: { className?: string }) {
  const reduce = useReducedMotionPref();
  const tier = useDeviceTier();
  const frameRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);
  const evidenceRef = useRef<HTMLImageElement>(null);
  const [phase, setPhase] = useState<Phase>(0);
  const [engaged, setEngaged] = useState(false);
  const [insight, setInsight] = useState<InsightState>('pending');
  const [evidenceFailed, setEvidenceFailed] = useState(false);
  // The evidence rendition the browser actually requested (its srcset pick), so
  // the transformation strip and the delivery probe describe what is on screen.
  const [shownUrl, setShownUrl] = useState<string | null>(null);
  const probe = useProbe(shownUrl, { accept: IMAGE_ACCEPT });
  const components = transformationFromUrl(shownUrl ?? EVIDENCE_FALLBACK);

  // 0…1: how far the Cloudinary rendition has been revealed top → bottom.
  const scan = useMotionValue(0);
  // 0…100: divider position; raw capture to its left, Cloudinary to its right.
  const split = useMotionValue(0);
  const clipPath = useTransform([scan, split], ([s, p]: number[]) => `inset(0 0 ${((1 - s) * 100).toFixed(2)}% ${p.toFixed(2)}%)`);
  const scanY = useTransform(scan, (v) => `${(v - 1) * 100}%`);
  const scanOpacity = useTransform(scan, [0, 0.04, 0.9, 1], [0, 1, 1, 0]);
  const dividerX = useTransform(split, (v) => `${v}%`);

  const tookOver = useRef(false);
  const tilt = useRef({ x: 0, y: 0, tx: 0, ty: 0, raf: 0 });
  const ariaValue = useRef(-1);

  // Which srcset candidate the browser chose (re-read if it switches, e.g. after a resize to a larger slot).
  useEffect(() => {
    const image = evidenceRef.current;
    if (!image) return;
    let cancelled = false;
    const read = () => {
      if (!cancelled && image.currentSrc) setShownUrl(image.currentSrc);
    };
    // Settled before hydration: no load event is coming.
    if (image.complete) void Promise.resolve().then(read);
    image.addEventListener('load', read);
    image.addEventListener('error', read);
    return () => {
      cancelled = true;
      image.removeEventListener('load', read);
      image.removeEventListener('error', read);
    };
  }, []);

  // Live Cloudinary AI signal: where g_auto places a 1:1 crop of this frame.
  useEffect(() => {
    let cancelled = false;
    fetchInsight(ASSET)
      .then((result) => {
        if (!cancelled) setInsight(result);
      })
      .catch(() => {
        if (!cancelled) setInsight('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const timers: number[] = [];
    const running: Array<ReturnType<typeof animate>> = [];
    let cancelled = false;
    const started = performance.now();
    const at = (ms: number, run: () => void) => {
      timers.push(window.setTimeout(run, Math.max(0, ms - (performance.now() - started))));
    };
    const cleanup = () => {
      cancelled = true;
      timers.forEach((t) => window.clearTimeout(t));
      running.forEach((a) => a.stop());
    };
    const rest = restFor(frameRef.current?.clientWidth ?? 640);

    if (reduce) {
      // Final state, no sequence.
      scan.set(1);
      if (!tookOver.current) split.set(rest);
      at(0, () => setPhase(2));
      return cleanup;
    }

    const image = evidenceRef.current;
    // Loaded and decoded, so the sweep reveals real pixels, never an empty frame.
    const arrived = new Promise<void>((resolve) => {
      if (!image || image.complete) {
        resolve();
        return;
      }
      image.addEventListener('load', () => resolve(), { once: true });
      image.addEventListener('error', () => resolve(), { once: true });
    }).then(() => (image && image.naturalWidth > 0 ? image.decode().catch(() => undefined) : undefined));

    const annotate = () => {
      if (cancelled) return;
      setPhase(1);
      if (!tookOver.current) running.push(animate(split, rest, { duration: 0.9, ease: EASE_OUT }));
      timers.push(window.setTimeout(() => setPhase(2), TELEMETRY_AFTER));
    };

    void arrived.then(() => {
      if (cancelled) return;
      at(SCAN_AT, () => {
        // No rendition, no scan: never depict work that did not happen.
        if (!image || image.naturalWidth === 0) {
          scan.set(1);
          annotate();
          return;
        }
        const sweep = animate(scan, 1, { duration: SCAN_MS / 1000, ease: EASE_SCAN });
        running.push(sweep);
        void sweep.then(annotate);
      });
    });

    return cleanup;
  }, [reduce, scan, split]);

  useEffect(() => {
    const state = tilt.current;
    return () => cancelAnimationFrame(state.raf);
  }, []);

  // Keep the slider's accessible value in step without re-rendering.
  useMotionValueEvent(split, 'change', (value) => {
    const el = frameRef.current;
    const rounded = Math.round(value);
    if (!el || rounded === ariaValue.current) return;
    ariaValue.current = rounded;
    el.setAttribute('aria-valuenow', String(rounded));
    el.setAttribute('aria-valuetext', `${rounded}% raw capture, ${100 - rounded}% Cloudinary evidence rendition`);
  });

  const canTilt = tier === 'high' && !reduce;

  const stepTilt = () => {
    const t = tilt.current;
    const el = tiltRef.current;
    if (!el) {
      t.raf = 0;
      return;
    }
    t.x += (t.tx - t.x) * 0.1;
    t.y += (t.ty - t.y) * 0.1;
    if (Math.abs(t.tx - t.x) < 0.004 && Math.abs(t.ty - t.y) < 0.004) {
      t.x = t.tx;
      t.y = t.ty;
      el.style.transform = t.x === 0 && t.y === 0 ? '' : `perspective(1400px) rotateX(${t.y}deg) rotateY(${t.x}deg)`;
      t.raf = 0;
      return;
    }
    el.style.transform = `perspective(1400px) rotateX(${t.y.toFixed(3)}deg) rotateY(${t.x.toFixed(3)}deg)`;
    t.raf = requestAnimationFrame(stepTilt);
  };
  const kickTilt = () => {
    if (!tilt.current.raf) tilt.current.raf = requestAnimationFrame(stepTilt);
  };

  const takeOver = () => {
    if (tookOver.current) return;
    tookOver.current = true;
    split.stop();
    setEngaged(true);
  };

  const onPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = clamp((event.clientX - rect.left) / rect.width);
    const y = clamp((event.clientY - rect.top) / rect.height);
    takeOver();
    split.set(x * 100);
    if (canTilt && event.pointerType === 'mouse') {
      tilt.current.tx = (x - 0.5) * 2 * TILT_Y;
      tilt.current.ty = (0.5 - y) * 2 * TILT_X;
      kickTilt();
    }
  };

  const onPointerLeave = () => {
    tilt.current.tx = 0;
    tilt.current.ty = 0;
    if (canTilt) kickTilt();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 10 : 4;
    let next: number | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = split.get() - step;
    else if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = split.get() + step;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 100;
    if (next === null) return;
    event.preventDefault();
    takeOver();
    void animate(split, clamp(next, 0, 100), { duration: reduce ? 0 : 0.25, ease: EASE_OUT });
  };

  const focus = typeof insight === 'object' ? insight.focus : undefined;
  const annotated = phase >= 1;

  return (
    <div className={cn('relative', className)}>
      <div
        ref={frameRef}
        role="slider"
        tabIndex={0}
        aria-label="Compare the raw drone frame with Cloudinary's evidence rendition"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={0}
        aria-valuetext="Cloudinary evidence rendition"
        data-cursor="COMPARE"
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={onPointerLeave}
        onKeyDown={onKeyDown}
        className="relative touch-pan-y select-none rounded-[8px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-signal"
      >
        <div
          ref={tiltRef}
          className="relative aspect-video w-full overflow-hidden rounded-[8px] border border-line-strong bg-raised"
        >
          {/* Sits beneath the images: visible only until Cloudinary answers. */}
          <span className="absolute inset-0 grid place-items-center font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
            Requesting frame {FRAME_AT} from Cloudinary…
          </span>

          {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
          <img
            src={RAW_FALLBACK}
            srcSet={RAW_SRCSET}
            sizes={SIZES}
            alt=""
            width={1600}
            height={900}
            loading="eager"
            decoding="async"
            fetchPriority="high"
            draggable={false}
            className="absolute inset-0 h-full w-full object-cover"
          />

          {!evidenceFailed && (
            <motion.div className="absolute inset-0" style={{ clipPath }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
              <img
                ref={evidenceRef}
                src={EVIDENCE_FALLBACK}
                srcSet={EVIDENCE_SRCSET}
                sizes={SIZES}
                alt=""
                width={1600}
                height={900}
                loading="eager"
                decoding="async"
                fetchPriority="low"
                draggable={false}
                onError={() => setEvidenceFailed(true)}
                className="absolute inset-0 h-full w-full object-cover"
              />
            </motion.div>
          )}

          {/* One-shot scan: rides the edge of the Cloudinary rendition as it replaces the raw frame. */}
          <motion.div aria-hidden className="pointer-events-none absolute inset-0" style={{ y: scanY, opacity: scanOpacity }}>
            <div className="absolute inset-x-0 bottom-0 h-[34%] bg-[linear-gradient(to_bottom,transparent,color-mix(in_oklab,var(--color-signal)_13%,transparent))]" />
            <div className="absolute inset-x-0 bottom-0 h-px bg-signal" />
            <span className="absolute bottom-2 right-3 font-mono text-[9.5px] font-semibold tracking-[0.06em] text-signal">
              e_improve · e_sharpen:60
            </span>
          </motion.div>

          {annotated && REGION && <RegionLayer regions={[REGION]} variant="annotation" />}
          {annotated && focus && <CropWindow region={focus} />}

          {/* Divider: translated, never re-laid-out. */}
          <motion.div
            aria-hidden
            data-on={annotated || engaged}
            className={cn('pointer-events-none absolute inset-0', styles.state)}
            style={{ x: dividerX }}
          >
            <div className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-signal" />
            <div className="absolute left-0 top-3 font-mono text-[9.5px] font-semibold leading-none tracking-[0.08em]">
              <span className="absolute right-[6px] top-0 rounded-[3px] bg-[color-mix(in_oklab,var(--color-canvas)_86%,transparent)] px-1.5 py-[4px] text-ink-2">
                RAW
              </span>
              <span className="absolute left-[6px] top-0 rounded-[3px] bg-signal px-1.5 py-[4px] text-signal-ink">CLOUDINARY</span>
            </div>
            <div className="absolute left-0 top-1/2 grid h-7 w-[18px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[4px] border border-signal bg-[color-mix(in_oklab,var(--color-canvas)_86%,transparent)] text-signal">
              <ChevronsLeftRight className="h-3 w-3" strokeWidth={2.2} />
            </div>
          </motion.div>

          <span className="reticle" />
        </div>
      </div>

      <div
        data-on={annotated}
        className={cn(
          'mt-3 flex flex-wrap items-center justify-between gap-x-5 gap-y-1.5 text-[11.5px] text-ink-3',
          styles.state,
        )}
      >
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-[2px] border-[1.5px] border-high" />
            Sample annotation
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className={cn('h-2.5 w-2.5 shrink-0', styles.cropSwatch)} />
            {focus ? (
              <>
                Cloudinary g_auto 1:1 crop · live
                <span className="sr-only">, {describeCropCentre(focus)}</span>
              </>
            ) : insight === 'error' ? (
              'Cloudinary g_auto unavailable'
            ) : (
              'Reading g_auto…'
            )}
          </span>
        </div>
        <span className="font-mono text-[10.5px] uppercase tracking-[0.08em]">
          <span className="hidden [@media(pointer:fine)]:inline">Move across the frame to compare</span>
          <span className="[@media(pointer:fine)]:hidden">Drag across the frame to compare</span>
        </span>
      </div>

      <HeroTelemetry
        className="mt-3"
        on={phase >= 2}
        fileName={ASSET.fileName}
        frame={FRAME_AT}
        site={SITE}
        source={ASSET}
        components={components}
        probe={probe}
      />
    </div>
  );
}

/**
 * The window g_auto chose for a 1:1 crop of this frame, drawn as a crop (crop
 * marks, dashed edges, a centre tick) rather than a detection box: its size is
 * set by the requested aspect ratio; only its position is Cloudinary's content
 * signal.
 */
function CropWindow({ region }: { region: Region }) {
  return (
    <div
      aria-hidden
      className={styles.crop}
      style={{ left: `${region.x}%`, top: `${region.y}%`, width: `${region.w}%`, height: `${region.h}%` }}
    >
      <span className="absolute left-[7px] top-[7px] whitespace-nowrap rounded-[3px] bg-signal px-1.5 py-[1px] font-mono text-[10.5px] font-semibold leading-[14px] tracking-[0.06em] text-signal-ink">
        g_auto CROP
      </span>
    </div>
  );
}
