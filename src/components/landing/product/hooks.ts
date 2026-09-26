'use client';

import { startTransition, useEffect, useState, type RefObject } from 'react';
import { useClientValue } from '@/components/motion/hooks';

const WIDE_QUERY = '(min-width: 820px)';

const readWide = () => window.matchMedia(WIDE_QUERY).matches;

function subscribeWide(onChange: () => void) {
  const mq = window.matchMedia(WIDE_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/**
 * True on viewports wide enough for the pinned reveal. False on the server and
 * during hydration; the upgrade after hydration is a transition, so swapping in
 * the pinned stage is time-sliced instead of a forced synchronous re-render.
 */
export function useWideViewport(): boolean {
  return useClientValue(false, readWide, subscribeWide);
}

/**
 * Latches to true the first time `ref` comes within `rootMargin` of the viewport
 * (default: 1.5 viewport heights above or below), then stops observing. Coming
 * near is a transition, so whatever it mounts renders in interruptible slices;
 * only an element already on screen (a restored scroll, a jump link) applies at once.
 */
export function useNearViewport<T extends Element>(ref: RefObject<T | null>, rootMargin = '150% 0px'): boolean {
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || near) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        const { top, bottom } = entry.boundingClientRect;
        if (top < window.innerHeight && bottom > 0) setNear(true);
        else startTransition(() => setNear(true));
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, near]);
  return near;
}

/**
 * Lays `inner` out at a console-like width and scales it down to fit `outer`,
 * so the miniature keeps real proportions (and legible type) on any screen.
 *
 * `layoutWidth(width, portrait)` picks the width to lay out at from the outer
 * box's width and orientation (the aspect ratio itself comes from CSS); the
 * inner height then fills the outer box exactly. Sizes are written straight to
 * the DOM from a ResizeObserver — no React render on resize.
 */
export function useFitScale(
  outerRef: RefObject<HTMLElement | null>,
  innerRef: RefObject<HTMLElement | null>,
  layoutWidth: (width: number, portrait: boolean) => number,
): void {
  useEffect(() => {
    const outer = outerRef.current;
    const inner = innerRef.current;
    if (!outer || !inner) return;
    const apply = (width: number, height: number) => {
      if (!width || !height) return;
      const layout = Math.max(width, layoutWidth(width, height > width));
      const scale = width / layout;
      inner.style.width = `${layout}px`;
      inner.style.height = `${height / scale}px`;
      inner.style.transform = `scale(${scale})`;
    };
    apply(outer.clientWidth, outer.clientHeight);
    const ro = new ResizeObserver(([entry]) => apply(entry.contentRect.width, entry.contentRect.height));
    ro.observe(outer);
    return () => ro.disconnect();
  }, [outerRef, innerRef, layoutWidth]);
}
