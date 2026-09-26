'use client';

import { useEffect, useState, type RefObject } from 'react';
import type { MediaAsset } from '@/lib/types';
import { useClientValue } from '@/components/motion/hooks';
import { fetchInsight, type CloudinaryInsight } from '@/lib/cloudinary/insights';
import { sha256Hex } from '@/lib/report';
import { reportJson } from './data';

/* ------------------------------------------------------------------------ */
/* Hydration-safe environment                                                */
/* ------------------------------------------------------------------------ */

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
const readReduced = () => window.matchMedia(REDUCED_QUERY).matches;
function subscribeReduced(onChange: () => void) {
  const mq = window.matchMedia(REDUCED_QUERY);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

/**
 * prefers-reduced-motion for the landing story and statement. Hydration renders
 * false, as the server did; the real preference then applies in a transition,
 * so swapping the pinned scene for the static narrative is time-sliced instead
 * of the synchronous re-render a differing useSyncExternalStore server snapshot
 * forces. Layout that must be right on the very first paint uses the CSS
 * `motion-reduce:` / `motion-safe:` variants (same media query) instead.
 */
export function useReducedPref(): boolean {
  return useClientValue(false, readReduced, subscribeReduced);
}

/* ------------------------------------------------------------------------ */
/* Data                                                                      */
/* ------------------------------------------------------------------------ */

/** Latches to true the first time the element comes within `rootMargin` of the viewport. */
export function useArmed<T extends Element>(ref: RefObject<T | null>, rootMargin = '100% 0px'): boolean {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || armed) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setArmed(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, armed]);
  return armed;
}

/**
 * Live Cloudinary AI signals (fl_getinfo: the g_auto 1:1 crop window and face
 * detections) for each capture, fetched once the story is near. Failures simply
 * show no box.
 */
export function useStoryInsights(assets: MediaAsset[], active: boolean): Record<string, CloudinaryInsight> {
  const [insights, setInsights] = useState<Record<string, CloudinaryInsight>>({});
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    Promise.allSettled(assets.map((a) => fetchInsight(a))).then((results) => {
      if (cancelled) return;
      const next: Record<string, CloudinaryInsight> = {};
      results.forEach((r, i) => {
        if (r.status === 'fulfilled') next[assets[i].id] = r.value;
      });
      setInsights(next);
    });
    return () => {
      cancelled = true;
    };
  }, [assets, active]);
  return insights;
}

/** SHA-256 of the report payload, computed once in the browser. */
export function useReportHash(evidenceUrl: string | null): string | null {
  const [hash, setHash] = useState<string | null>(null);
  useEffect(() => {
    if (!evidenceUrl) return;
    let cancelled = false;
    sha256Hex(reportJson(evidenceUrl))
      .then((h) => {
        if (!cancelled) setHash(h);
      })
      .catch(() => {
        // Web Crypto needs a secure context; say so instead of faking a digest.
        if (!cancelled) setHash('');
      });
    return () => {
      cancelled = true;
    };
  }, [evidenceUrl]);
  return hash;
}

/** `null` while computing, `''` when Web Crypto is unavailable. */
export function shortHash(hash: string | null): string {
  if (hash === null) return 'computing…';
  if (hash === '') return 'unavailable in this context';
  return `${hash.slice(0, 16)}…${hash.slice(-6)}`;
}
