'use client';

import { motion } from 'framer-motion';
import { memo } from 'react';
import type { MediaAsset } from '@/lib/types';
import { thumbUrl } from '@/lib/cloudinary/media';
import { SEVERITY_COLOR } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { STAGE_MS } from './engine';

/**
 * The visual index: every field record as a small Cloudinary thumbnail, newest
 * first. As a question runs, records that fall out dim; matches lift, then
 * leave the strip (a hollow slot remains) and fly into the results below.
 *
 * Cost: ≤ STRIP_CAP thumbnails, opacity/transform only, one sweep element.
 */

export type ThumbState = 'idle' | 'scan' | 'candidate' | 'dim' | 'hit' | 'faint' | 'lifted';

export const STRIP_THUMB = { w: 128, h: 80 };
export const EASE = [0.16, 1, 0.3, 1] as const;

/** Same rendition as the strip, reused (from cache) as the placeholder while a larger one loads. */
export function stripThumbUrl(asset: MediaAsset): string {
  return thumbUrl(asset, STRIP_THUMB.w, STRIP_THUMB.h);
}

/**
 * Shared-layout id for a record's media. Scoped per palette session so a new
 * session never resumes from the last session's positions.
 */
export function flightId(scope: string, id: string): string {
  return `ask-evidence-${scope}-${id}`;
}

const SLOT_STATE: Record<Exclude<ThumbState, 'lifted'>, string> = {
  idle: 'opacity-100',
  scan: 'opacity-70',
  candidate: 'opacity-100',
  dim: 'opacity-30',
  hit: 'opacity-100 -translate-y-[3px]',
  faint: 'opacity-20',
};

export const IndexStrip = memo(function IndexStrip({
  records,
  total,
  states,
  flight,
  scope,
  epoch,
  sweepKey,
  summary,
  onOpen,
  onFocusHit,
}: {
  records: MediaAsset[];
  total: number;
  states: Record<string, ThumbState>;
  flight: boolean;
  scope: string;
  /** Changes when results are committed: the only renders where thumbnails need re-measuring. */
  epoch: number;
  /** Run id while the index is being read (stage 1); null otherwise. */
  sweepKey: number | null;
  summary: string;
  onOpen: (id: string) => void;
  onFocusHit: (id: string) => void;
}) {
  return (
    <section aria-label="Visual index" className="px-4 pb-3 pt-3.5 sm:px-5">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="label">Visual index</span>
        <span className="num truncate font-mono text-[10.5px] text-ink-3">
          {summary}
          {total > records.length && <> · newest {records.length} of {total} shown</>}
        </span>
      </div>

      <div className="relative">
        <div className="grid gap-[3px] sm:gap-1" style={{ gridTemplateColumns: `repeat(${Math.max(records.length, 8)}, minmax(0, 1fr))` }}>
          {records.map((asset) => {
            const state = states[asset.id] ?? 'idle';
            const severity = asset.finding?.severity;
            if (state === 'lifted') {
              return (
                <button
                  key={asset.id}
                  type="button"
                  tabIndex={-1}
                  aria-label={`${asset.fileName}: shown in results`}
                  title={`${asset.fileName} · in results`}
                  onClick={() => onFocusHit(asset.id)}
                  className="relative aspect-[16/10] rounded-[3px] border border-dashed border-[color-mix(in_oklab,var(--color-signal)_50%,transparent)] bg-[color-mix(in_oklab,var(--color-signal)_6%,transparent)]"
                />
              );
            }
            return (
              <div
                key={asset.id}
                className={cn(
                  'relative aspect-[16/10] transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]',
                  SLOT_STATE[state],
                )}
              >
                <motion.button
                  layoutId={flight ? flightId(scope, asset.id) : undefined}
                  layoutDependency={epoch}
                  transition={{ layout: { duration: 0.45, ease: EASE } }}
                  type="button"
                  tabIndex={-1}
                  data-cursor="OPEN"
                  aria-label={`Open ${asset.fileName}`}
                  title={`${asset.fileName} · ${asset.site}`}
                  onClick={() => onOpen(asset.id)}
                  style={{ borderRadius: 3 }}
                  className={cn(
                    'absolute inset-0 block overflow-hidden border bg-raised',
                    state === 'hit' ? 'border-signal' : 'border-line',
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
                  <img
                    src={stripThumbUrl(asset)}
                    alt=""
                    width={STRIP_THUMB.w}
                    height={STRIP_THUMB.h}
                    loading="lazy"
                    decoding="async"
                    draggable={false}
                    className="h-full w-full select-none object-cover"
                  />
                  {severity && (
                    <span aria-hidden className="absolute inset-x-0 bottom-0 h-[2px]" style={{ backgroundColor: SEVERITY_COLOR[severity] }} />
                  )}
                </motion.button>
              </div>
            );
          })}
        </div>

        {/* Index read: a single transform-only sweep across the strip. */}
        <span aria-hidden className="pointer-events-none absolute -inset-y-1 inset-x-0 overflow-hidden">
          {sweepKey !== null && (
            <motion.span
              key={sweepKey}
              className="absolute inset-y-0 left-0 block w-full"
              initial={{ x: '-100%' }}
              animate={{ x: '0%' }}
              transition={{ duration: (STAGE_MS / 1000) * 0.95, ease: [0.65, 0, 0.35, 1] }}
            >
              <span className="absolute inset-y-0 right-0 w-20 bg-linear-to-l from-[color-mix(in_oklab,var(--color-signal)_16%,transparent)] to-transparent" />
              <span className="absolute inset-y-0 right-0 w-px bg-signal" />
            </motion.span>
          )}
        </span>
      </div>

      <div aria-hidden className="mt-1.5 flex justify-between font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3/70">
        <span>Newest</span>
        <span>Oldest</span>
      </div>
    </section>
  );
});
