'use client';

import type { MotionValue } from 'framer-motion';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  clamp,
  easeInOutCubic,
  progressBetween,
  useDeviceTier,
  useInViewport,
  useRafLoop,
  useReducedMotionPref,
} from '@/components/motion/hooks';
import { cn } from '@/components/ui/cn';
import { FIELD_ATLAS } from './field-atlas';
import { buildFieldInstances } from './field-geometry';
import { createFieldRenderer, type FieldRenderer } from './field-renderer';

/**
 * The hero's "visual data field": ~1,100 image shards (≈300 on low-tier
 * devices) cut from a Cloudinary-composited atlas of the field media, drifting
 * in a shallow 3D volume. The pointer steers a lerped camera parallax and a
 * soft light; as the hero scrolls away (`progress` 0→1) the shards settle
 * into three loose grid blocks — raw data becoming organised.
 *
 * Cost model: one canvas, one texture, one instanced draw per frame. The loop
 * runs only while the field is on screen and the tab is visible; low tier
 * renders at ~30 fps with a 1.25 DPR cap. Reduced motion, missing WebGL2 or a
 * failed context fall back to a dim static mosaic of the same atlas.
 */

const COUNT = { high: 1100, low: 300 } as const;
const DPR_CAP = { high: 1.75, low: 1.25 } as const;
const INTRO_MS = 1900;

const noopSubscribe = () => () => {};
function useHydrated(): boolean {
  return useSyncExternalStore(noopSubscribe, () => true, () => false);
}

const atlasCache = new Map<string, Promise<HTMLImageElement>>();

/** Loads (once per URL) and decodes the atlas off the main thread; CORS-enabled for WebGL. */
function loadAtlas(url: string): Promise<HTMLImageElement> {
  const cached = atlasCache.get(url);
  if (cached) return cached;
  const promise = new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      img
        .decode()
        .catch(() => undefined)
        .then(() => resolve(img));
    };
    img.onerror = () => {
      atlasCache.delete(url);
      reject(new Error('Atlas failed to load'));
    };
    img.src = url;
  });
  atlasCache.set(url, promise);
  return promise;
}

/**
 * Runs `callback` once the page has loaded (the hero frame goes first) and the
 * main thread is idle — or after 1.2 s, whichever comes first.
 */
function whenSettled(callback: () => void): () => void {
  let done = false;
  let idle = 0;
  const run = () => {
    if (done) return;
    done = true;
    callback();
  };
  const schedule = () => {
    if (typeof window.requestIdleCallback === 'function') idle = window.requestIdleCallback(run, { timeout: 700 });
    else window.setTimeout(run, 60);
  };
  const cap = window.setTimeout(run, 1200);
  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
  return () => {
    done = true;
    window.clearTimeout(cap);
    window.removeEventListener('load', schedule);
    if (idle && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idle);
  };
}

interface FieldState {
  renderer: FieldRenderer | null;
  low: boolean;
  introStart: number;
  accumulated: number;
  camX: number;
  camY: number;
  lightX: number;
  lightY: number;
  light: number;
  hasPointer: boolean;
  pointerX: number;
  pointerY: number;
  localX: number;
  localY: number;
  inside: boolean;
}

export function DataField({ progress, className }: { progress?: MotionValue<number>; className?: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const hydrated = useHydrated();
  const tier = useDeviceTier();
  const reduce = useReducedMotionPref();
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const inView = useInViewport(hostRef, '80px');
  const state = useRef<FieldState>({
    renderer: null,
    low: false,
    introStart: -1,
    accumulated: 0,
    camX: 0,
    camY: 0,
    lightX: 0,
    lightY: 0,
    light: 0,
    hasPointer: false,
    pointerX: 0,
    pointerY: 0,
    localX: 0,
    localY: 0,
    inside: false,
  });

  const mode: 'pending' | 'gl' | 'static' = !hydrated
    ? 'pending'
    : reduce || failed || !('WebGL2RenderingContext' in window)
      ? 'static'
      : 'gl';

  // GL lifecycle: canvas, context, atlas texture, resize. The canvas is created
  // here (not by React) so every mount owns a fresh context it can release.
  useEffect(() => {
    if (mode !== 'gl') return;
    const host = hostRef.current;
    if (!host) return;
    const s = state.current;
    const cap = DPR_CAP[tier];
    const count = COUNT[tier];
    s.low = tier === 'low';
    let disposed = false;
    let gl: WebGL2RenderingContext | null = null;
    let atlas: HTMLImageElement | null = null;
    let cssWidth = host.clientWidth;
    let cssHeight = host.clientHeight;

    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none';
    host.appendChild(canvas);

    const applySize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, cap);
      const width = Math.max(1, Math.round(cssWidth * dpr));
      const height = Math.max(1, Math.round(cssHeight * dpr));
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      s.renderer?.setSize(cssWidth, cssHeight, dpr);
    };

    const build = () => {
      if (disposed || !atlas) return;
      gl =
        gl ??
        canvas.getContext('webgl2', {
          alpha: true,
          antialias: false,
          depth: false,
          stencil: false,
          premultipliedAlpha: true,
          preserveDrawingBuffer: false,
          powerPreference: 'low-power',
        });
      const renderer = gl
        ? createFieldRenderer(
            gl,
            atlas,
            buildFieldInstances({
              count,
              cols: FIELD_ATLAS.cols,
              rows: FIELD_ATLAS.rows,
              viewAspect: cssWidth / Math.max(1, cssHeight),
            }),
          )
        : null;
      if (!renderer) {
        setFailed(true);
        return;
      }
      s.renderer = renderer;
      applySize();
      setReady(true);
    };

    const observer = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (!box) return;
      cssWidth = box.width;
      cssHeight = box.height;
      applySize();
    });
    observer.observe(host);

    const onLost = (event: Event) => {
      event.preventDefault();
      s.renderer = null;
    };
    const onRestored = () => build();
    canvas.addEventListener('webglcontextlost', onLost);
    canvas.addEventListener('webglcontextrestored', onRestored);

    const cancel = whenSettled(() => {
      loadAtlas(FIELD_ATLAS.url)
        .then((image) => {
          atlas = image;
          build();
        })
        .catch(() => {
          if (!disposed) setFailed(true);
        });
    });

    return () => {
      disposed = true;
      cancel();
      observer.disconnect();
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      s.renderer?.dispose();
      s.renderer = null;
      s.introStart = -1;
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
      canvas.remove();
    };
  }, [mode, tier]);

  // Pointer: camera parallax + light. Fine pointers only; no layout reads per frame
  // (the host rect is re-read at most once per pointer move after a scroll/resize).
  useEffect(() => {
    if (mode !== 'gl') return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const s = state.current;
    let rect: DOMRect | null = null;
    const invalidate = () => {
      rect = null;
    };
    const onMove = (event: PointerEvent) => {
      const host = hostRef.current;
      if (!host) return;
      s.hasPointer = true;
      s.pointerX = (event.clientX / window.innerWidth) * 2 - 1;
      s.pointerY = (event.clientY / window.innerHeight) * 2 - 1;
      rect ??= host.getBoundingClientRect();
      s.localX = event.clientX - rect.left;
      s.localY = event.clientY - rect.top;
      s.inside = s.localX >= 0 && s.localY >= 0 && s.localX <= rect.width && s.localY <= rect.height;
    };
    const onLeave = () => {
      s.inside = false;
    };
    const root = document.documentElement;
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('scroll', invalidate, { passive: true });
    window.addEventListener('resize', invalidate, { passive: true });
    root.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', invalidate);
      window.removeEventListener('resize', invalidate);
      root.removeEventListener('pointerleave', onLeave);
    };
  }, [mode]);

  useRafLoop(
    (now, delta) => {
      const s = state.current;
      const renderer = s.renderer;
      if (!renderer) return;
      let dt = delta;
      if (s.low) {
        // ~30 fps is plenty for slow drift and halves the cost on phones.
        s.accumulated += delta;
        if (s.accumulated < 30) return;
        dt = s.accumulated;
        s.accumulated = 0;
      }
      if (s.introStart < 0) s.introStart = now;
      const intro = clamp((now - s.introStart) / INTRO_MS);

      // Camera: follows the pointer; on touch, a very slow autonomous sway.
      let targetX = 0;
      let targetY = 0;
      if (s.hasPointer) {
        targetX = s.pointerX;
        targetY = s.pointerY;
      } else if (s.low) {
        const seconds = now / 1000;
        targetX = Math.sin(seconds * 0.11) * 0.25;
        targetY = Math.cos(seconds * 0.08) * 0.18;
      }
      const follow = 1 - Math.exp(-dt / 280);
      s.camX += (targetX - s.camX) * follow;
      s.camY += (targetY - s.camY) * follow;

      // Light: snaps to the pointer when dark, then trails it softly.
      if (s.light < 0.02) {
        s.lightX = s.localX;
        s.lightY = s.localY;
      }
      const trail = 1 - Math.exp(-dt / 110);
      s.lightX += (s.localX - s.lightX) * trail;
      s.lightY += (s.localY - s.lightY) * trail;
      s.light += ((s.inside ? 1 : 0) - s.light) * (1 - Math.exp(-dt / 380));

      const scrolled = progress ? progress.get() : 0;
      renderer.draw({
        time: now / 1000,
        camX: s.camX,
        camY: s.camY,
        lightX: s.lightX,
        lightY: s.lightY,
        light: s.light,
        order: easeInOutCubic(progressBetween(scrolled, 0.05, 0.55)),
        intro,
      });
    },
    mode === 'gl' && ready && inView,
  );

  if (mode === 'static') return <StaticMosaic className={className} />;
  return <div ref={hostRef} aria-hidden className={cn('pointer-events-none absolute inset-0', className)} />;
}

const MOSAIC_MASK = 'radial-gradient(closest-side, #000 25%, transparent 100%)';
const MOSAIC_GAPS =
  'linear-gradient(to right, var(--color-canvas) 3px, transparent 3px), linear-gradient(to bottom, var(--color-canvas) 3px, transparent 3px)';

/** Reduced motion / no WebGL2: the same Cloudinary atlas as a dim, still contact sheet. */
function StaticMosaic({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0 hidden overflow-hidden sm:block', className)}>
      <div
        className="absolute right-[-10%] top-1/2 aspect-square h-[118%] -translate-y-1/2 opacity-[0.15]"
        style={{ maskImage: MOSAIC_MASK, WebkitMaskImage: MOSAIC_MASK }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
        <img
          src={FIELD_ATLAS.url}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
          style={{ filter: 'saturate(0.55)' }}
        />
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: MOSAIC_GAPS,
            backgroundSize: `${100 / FIELD_ATLAS.cols}% ${100 / FIELD_ATLAS.rows}%`,
          }}
        />
      </div>
    </div>
  );
}
