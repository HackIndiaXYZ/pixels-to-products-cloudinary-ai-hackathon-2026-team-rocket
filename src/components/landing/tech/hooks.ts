'use client';

import { useEffect, useState, type RefObject } from 'react';
import { describeCropCentre, parseInsight, type CloudinaryInsight } from '@/lib/cloudinary/insights';
import { pushActivity } from '@/lib/cloudinary/probe';
import { useClientValue } from '@/components/motion/hooks';

/**
 * Latches to `true` the first time the element comes within `rootMargin` of the
 * viewport. Used to defer every Cloudinary request in this section until the
 * reader actually gets there.
 */
export function useSeen<T extends Element>(ref: RefObject<T | null>, rootMargin = '240px 0px'): boolean {
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || seen) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [ref, rootMargin, seen]);
  return seen;
}

interface MediaQuerySource {
  read: () => boolean;
  subscribe: (onChange: () => void) => () => void;
}

/** One stable read/subscribe pair per query string (useClientValue needs stable functions). */
const mediaQuerySources = new Map<string, MediaQuerySource>();

function mediaQuerySource(query: string): MediaQuerySource {
  let source = mediaQuerySources.get(query);
  if (!source) {
    source = {
      read: () => window.matchMedia(query).matches,
      subscribe: (onChange) => {
        const mq = window.matchMedia(query);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
      },
    };
    mediaQuerySources.set(query, source);
  }
  return source;
}

/**
 * Media-query match, re-rendering only when the answer changes. Hydration
 * renders `serverValue` (as the server did) and the real answer follows as a
 * transition, instead of the synchronous re-render useSyncExternalStore forces
 * when its server and client snapshots differ.
 */
export function useMediaQuery(query: string, serverValue = false): boolean {
  const { read, subscribe } = mediaQuerySource(query);
  return useClientValue(serverValue, read, subscribe);
}

/* ------------------------------------------------------------------------ */
/* fl_getinfo for an arbitrary crop                                          */
/* ------------------------------------------------------------------------ */

const getInfoCache = new Map<string, Promise<CloudinaryInsight>>();

/**
 * Cloudinary `fl_getinfo` for an exact transformation (the shared
 * `fetchInsight` is fixed to a 1:1 crop). Logged to the session activity feed
 * like every other Cloudinary response. `g_auto_info` is the crop window for
 * the requested aspect ratio, so the log names the crop and where it sits —
 * never a detected subject.
 */
export function fetchGetInfo(url: string): Promise<CloudinaryInsight> {
  const cached = getInfoCache.get(url);
  if (cached) return cached;
  const promise = fetch(url)
    .then(async (res) => {
      if (!res.ok) throw new Error(res.headers.get('x-cld-error') ?? `fl_getinfo returned HTTP ${res.status}`);
      const insight = parseInsight(url, await res.json());
      const focus = insight.focus;
      const ratio = url.match(/(?:^|[/,])ar_([\d.]+:[\d.]+)/)?.[1];
      pushActivity(
        'insight',
        url,
        `fl_getinfo · g_auto${ratio ? ` ${ratio}` : ''} crop ${focus ? describeCropCentre(focus) : 'not reported'}`,
      );
      return insight;
    })
    .catch((error: unknown) => {
      getInfoCache.delete(url);
      throw error;
    });
  getInfoCache.set(url, promise);
  return promise;
}

type InsightState = { url: string; insight: CloudinaryInsight | null; failed: boolean };

/** Resolves a Cloudinary insight once `enabled`; `null` until it arrives. */
export function useInsightFrom(
  load: (() => Promise<CloudinaryInsight>) | null,
  key: string,
  enabled: boolean,
): { insight: CloudinaryInsight | null; failed: boolean } {
  const [state, setState] = useState<InsightState | null>(null);
  useEffect(() => {
    if (!enabled || !load) return;
    let cancelled = false;
    load()
      .then((insight) => {
        if (!cancelled) setState({ url: key, insight, failed: false });
      })
      .catch(() => {
        if (!cancelled) setState({ url: key, insight: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [load, key, enabled]);
  if (!state || state.url !== key) return { insight: null, failed: false };
  return { insight: state.insight, failed: state.failed };
}
