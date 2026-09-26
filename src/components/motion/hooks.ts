'use client';

import { startTransition, useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';

/**
 * Performance-first motion primitives.
 *
 * Rules every animated component follows:
 *  - never set React state per animation frame (write styles through refs or motion values);
 *  - run requestAnimationFrame only while the element is on screen and the tab is visible;
 *  - scale effect density with `useDeviceTier()`; render a still frame under reduced motion.
 */

/* ------------------------------------------------------------------------ */
/* Hydration-aware client values                                             */
/* ------------------------------------------------------------------------ */

const noopSubscribe = () => () => undefined;

/**
 * Set by the snapshot React picks for the mount below: the server snapshot while
 * it hydrates server HTML, the client snapshot for client-only mounts. Both return
 * the same constant, so — unlike `useSyncExternalStore(…, () => false, () => true)` —
 * nothing differs after hydration and React never forces a synchronous re-render.
 */
let hydratingMount = false;
const clientMount = () => {
  hydratingMount = false;
  return 0;
};
const serverMount = () => {
  hydratingMount = true;
  return 0;
};

/** True when this mount is hydrating server-rendered HTML; false for client-only mounts. Read it once, at mount. */
function useHydratingMount(): boolean {
  useSyncExternalStore(noopSubscribe, clientMount, serverMount);
  return hydratingMount;
}

/**
 * A browser-only value that is safe to use in server-rendered components.
 *
 * - Hydration renders `serverValue` (matching the server HTML), then upgrades to
 *   the real value in a transition, so the follow-up render is time-sliced and
 *   interruptible instead of the SyncLane re-render `useSyncExternalStore` forces
 *   when its server and client snapshots differ.
 * - Client-only mounts (client navigations, the console) read the real value
 *   immediately — no second render.
 * - Later changes (resize, media-query flips) also arrive as transitions; pass
 *   `urgent: true` for values that must apply at once (e.g. reduced motion).
 *
 * `read` and `subscribe` must be stable (module-level) functions.
 */
export function useClientValue<T>(
  serverValue: T,
  read: () => T,
  subscribe: (onChange: () => void) => () => void,
  { urgent = false }: { urgent?: boolean } = {},
): T {
  const hydrating = useHydratingMount();
  const [value, setValue] = useState<T>(() => (hydrating ? serverValue : read()));
  useEffect(() => {
    const sync = () => {
      const next = read();
      if (urgent) setValue(next);
      else startTransition(() => setValue(next));
    };
    sync();
    return subscribe(sync);
  }, [read, subscribe, urgent]);
  return value;
}

/* ------------------------------------------------------------------------ */
/* Device tier and reduced motion                                            */
/* ------------------------------------------------------------------------ */

export type DeviceTier = 'high' | 'low';

function computeTier(): DeviceTier {
  if (typeof window === 'undefined') return 'low';
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const small = window.innerWidth < 820;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const weakCpu = (nav.hardwareConcurrency ?? 8) <= 4;
  const weakMemory = (nav.deviceMemory ?? 8) <= 4;
  const saveData = Boolean(nav.connection?.saveData);
  return coarse || small || reduced || weakCpu || weakMemory || saveData ? 'low' : 'high';
}

function subscribeTier(onChange: () => void) {
  window.addEventListener('resize', onChange);
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  mq.addEventListener('change', onChange);
  const coarse = window.matchMedia('(pointer: coarse)');
  coarse.addEventListener('change', onChange);
  return () => {
    window.removeEventListener('resize', onChange);
    mq.removeEventListener('change', onChange);
    coarse.removeEventListener('change', onChange);
  };
}

/**
 * 'high' on capable desktops; 'low' on touch, small, weak or data-saving devices
 * (and on the server). The post-hydration upgrade to 'high' is a transition, so
 * swapping in the richer scenes never blocks the main thread in one piece.
 */
export function useDeviceTier(): DeviceTier {
  return useClientValue<DeviceTier>('low', computeTier, subscribeTier);
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
const readReduced = () => window.matchMedia(REDUCED_QUERY).matches;
function subscribeReduced(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/**
 * True when the user prefers reduced motion. Hydration renders false (as the
 * server did) and the real preference applies right after; it also follows
 * live changes of the OS setting. Applied urgently: stopping motion must not wait.
 */
export function useReducedMotionPref(): boolean {
  return useClientValue(false, readReduced, subscribeReduced, { urgent: true });
}

function subscribeVisibility(onChange: () => void) {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribeVisibility, () => document.visibilityState === 'visible', () => true);
}

/** Whether an element intersects the viewport (state changes only on enter/leave). */
export function useInViewport<T extends Element>(ref: RefObject<T | null>, rootMargin = '0px'): boolean {
  const [inView, setInView] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { rootMargin });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin]);
  return inView;
}

/**
 * Runs `callback(timeMs, deltaMs)` every animation frame while `active` and the
 * tab is visible. The callback is read from a ref, so it may close over fresh values
 * without restarting the loop.
 */
export function useRafLoop(callback: (time: number, delta: number) => void, active: boolean): void {
  const cb = useRef(callback);
  useEffect(() => {
    cb.current = callback;
  });
  const visible = usePageVisible();
  useEffect(() => {
    if (!active || !visible) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const delta = Math.min(64, now - last);
      last = now;
      cb.current(now, delta);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, visible]);
}

/** Pointer position normalised to -1…1 around the viewport centre, updated without re-rendering. */
export function usePointerRef(active = true): RefObject<{ x: number; y: number; moved: boolean }> {
  const ref = useRef({ x: 0, y: 0, moved: false });
  useEffect(() => {
    if (!active) return;
    const onMove = (e: PointerEvent) => {
      ref.current.x = (e.clientX / window.innerWidth) * 2 - 1;
      ref.current.y = (e.clientY / window.innerHeight) * 2 - 1;
      ref.current.moved = true;
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [active]);
  return ref;
}

export const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Maps `v` from [a, b] to [0, 1], clamped. */
export const progressBetween = (v: number, a: number, b: number) => clamp((v - a) / (b - a));
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
