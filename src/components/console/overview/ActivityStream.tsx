'use client';

import { motion } from 'framer-motion';
import { memo, useMemo, useState, useSyncExternalStore } from 'react';
import type { MediaAsset } from '@/lib/types';
import {
  getActivity,
  getServerActivity,
  subscribeActivity,
  type ActivityEvent,
  type ActivityKind,
} from '@/lib/cloudinary/probe';
import { useReducedMotionPref } from '@/components/motion/hooks';
import { LiveDot } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { EASE, publicIdTail, shortAge } from './shared';

const KINDS: ActivityKind[] = ['delivered', 'insight', 'processing', 'error'];
const KIND_META: Record<ActivityKind, { label: string; color: string }> = {
  delivered: { label: 'Delivered', color: 'var(--color-signal)' },
  insight: { label: 'Insight', color: 'var(--color-indigo)' },
  processing: { label: 'Processing', color: 'var(--color-warn)' },
  error: { label: 'Error', color: 'var(--color-critical)' },
};
const VISIBLE_ROWS = 12;

/*
 * One shared 1 Hz wall clock for relative ages. Only the tiny <Age> text nodes
 * subscribe, so ticking never re-renders the rows (or their layout animations).
 * It runs only while an age is on screen and skips ticks in hidden tabs.
 */
let clockNow = 0;
let clockTimer: number | undefined;
const clockListeners = new Set<() => void>();

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (clockListeners.size === 1) {
    clockNow = Date.now();
    clockTimer = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      clockNow = Date.now();
      clockListeners.forEach((l) => l());
    }, 1000);
    listener();
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size === 0) window.clearInterval(clockTimer);
  };
}

const getClock = () => clockNow;
const getServerClock = () => 0;

function Age({ at }: { at: number }) {
  const now = useSyncExternalStore(subscribeClock, getClock, getServerClock);
  return <>{now ? shortAge(now - at) : 'now'}</>;
}

const ROW_SHOWN = { opacity: 1, y: 0 };
const ROW_ENTER = { opacity: 0, y: -10 };
const ROW_TRANSITION = { duration: 0.4, ease: EASE };

/**
 * Real Cloudinary traffic from this browser session: delivery probes (with
 * the response Cloudinary gave), asynchronous renders (HTTP 423), fl_getinfo
 * insight requests and errors. Each row links to the exact URL.
 *
 * Cost model: the activity store notifies at most once per frame, so a burst of
 * responses is one render here. Rows that fall out of the 12-row window leave at
 * once (no exit animation to pile up), new rows slide in, and the survivors'
 * position animation is measured only when the head of the list changes.
 */
export const ActivityStream = memo(function ActivityStream({ assets, className }: { assets: MediaAsset[]; className?: string }) {
  const events = useSyncExternalStore(subscribeActivity, getActivity, getServerActivity);
  const reduce = useReducedMotionPref();
  const rows = events.slice(0, VISIBLE_ROWS);
  const head = rows[0]?.id;
  // Rows already in the log when the panel mounts are shown as they are; only new arrivals animate in.
  const [arrivedBefore] = useState(() => new Set(rows.map((e) => e.id)));

  const byTail = useMemo(() => new Map(assets.map((a) => [publicIdTail(a.publicId), a])), [assets]);
  const counts = useMemo(() => {
    const out: Record<ActivityKind, number> = { delivered: 0, insight: 0, processing: 0, error: 0 };
    events.forEach((e) => {
      out[e.kind] += 1;
    });
    return out;
  }, [events]);

  return (
    <section aria-labelledby="activity-title" className={cn('min-w-0', className)}>
      <div className="panel flex flex-col overflow-hidden xl:absolute xl:inset-0">
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id="activity-title" className="flex items-center gap-2 text-[13px] font-semibold text-ink">
            <LiveDot />
            Live Cloudinary activity
          </h2>
          <span className="num font-mono text-[11px] text-ink-3">
            {events.length} {events.length === 1 ? 'event' : 'events'}
          </span>
        </header>
        <div className="flex flex-wrap gap-x-3.5 gap-y-1 border-b border-line px-4 py-2 font-mono text-[10.5px] text-ink-3">
          {KINDS.map((k) => (
            <span key={k} className="flex items-center gap-1.5">
              <span aria-hidden className="h-[7px] w-[7px] rounded-[2px]" style={{ backgroundColor: KIND_META[k].color }} />
              <span className="text-ink-2">{KIND_META[k].label}</span>
              <span className="num">{counts[k]}</span>
            </span>
          ))}
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-1 flex-col items-start justify-center gap-2 px-4 py-10">
            <span className="label">Session log</span>
            <p className="max-w-[34ch] text-[13px] leading-relaxed text-ink-2">Activity appears as VisualOps talks to Cloudinary.</p>
          </div>
        ) : (
          <div className="relative min-h-0 flex-1">
            <motion.ul layoutScroll className="h-full divide-y divide-line overflow-y-auto overscroll-contain" aria-live="off">
              {rows.map((event) => (
                <motion.li
                  key={event.id}
                  layout={reduce ? false : 'position'}
                  layoutDependency={head}
                  initial={reduce || arrivedBefore.has(event.id) ? false : ROW_ENTER}
                  animate={ROW_SHOWN}
                  transition={ROW_TRANSITION}
                >
                  <Row event={event} asset={byTail.get(publicIdTail(event.subject))} />
                </motion.li>
              ))}
            </motion.ul>
            {rows.length > 6 && (
              <span
                aria-hidden
                className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-10 xl:block"
                style={{ backgroundImage: 'linear-gradient(to bottom, transparent, var(--color-surface))' }}
              />
            )}
          </div>
        )}

        <footer className="border-t border-line px-4 py-2.5 text-[11px] leading-relaxed text-ink-3">
          This session only. Every row is a real response from res.cloudinary.com — open one to verify it.
        </footer>
      </div>
    </section>
  );
});

const Row = memo(function Row({ event, asset }: { event: ActivityEvent; asset: MediaAsset | undefined }) {
  const meta = KIND_META[event.kind];
  const tail = publicIdTail(event.subject);
  return (
    <a
      href={event.url}
      target="_blank"
      rel="noreferrer"
      data-cursor="OPEN"
      title={event.url}
      className="grid grid-cols-[7px_minmax(0,1fr)_auto] gap-x-3 px-4 py-2.5 transition-colors hover:bg-raised"
    >
      <span aria-hidden className="mt-[5px] h-[7px] w-[7px] rounded-[2px]" style={{ backgroundColor: meta.color }} />
      <span className="min-w-0">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="label shrink-0 text-ink-2">{meta.label}</span>
          <span className="truncate font-mono text-[11.5px] text-ink">{tail}</span>
          {asset && <span className="hidden max-w-[45%] truncate text-[11px] text-ink-3 sm:block">{asset.fileName}</span>}
        </span>
        <span className="mt-0.5 block truncate text-[11.5px] text-ink-2">{event.detail}</span>
        {event.transformation && (
          <span className="mt-0.5 block truncate font-mono text-[10.5px] text-ink-3">{event.transformation}</span>
        )}
      </span>
      <span className="num pt-px font-mono text-[10.5px] text-ink-3">
        <Age at={event.at} />
      </span>
    </a>
  );
});
