'use client';

import { motion } from 'framer-motion';
import { Play } from 'lucide-react';
import { memo, useMemo, type CSSProperties, type SyntheticEvent } from 'react';
import type { SearchHit } from '@/lib/search/query';
import { thumbUrl } from '@/lib/cloudinary/media';
import { formatDuration, relativeTime } from '@/lib/format';
import { SeverityBadge } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { highlightSegments, matchLabel, termMatches, type Segment } from './engine';
import { EASE, flightId, stripThumbUrl } from './IndexStrip';

const MEDIA = { w: 136, h: 85 };
const MAX_TAGS = 4;

function revealOnLoad(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.opacity = '1';
}

export function Highlighted({ segments }: { segments: Segment[] }) {
  return (
    <>
      {segments.map((s, i) =>
        s.hit ? (
          <mark key={i} className="rounded-[2px] bg-[color-mix(in_oklab,var(--color-signal)_18%,transparent)] px-[2px] text-ink">
            {s.text}
          </mark>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/**
 * One result: Cloudinary still, severity, capture file, finding, site and tags,
 * with the words the question matched highlighted by the search's own matcher.
 * The media box shares a layoutId with its strip thumbnail, so it flies out of
 * the visual index when the result is committed.
 */
export const EvidenceTile = memo(function EvidenceTile({
  hit,
  index,
  active,
  keywords,
  now,
  flight,
  placeholder,
  scope,
  entrance,
  onHover,
  onOpen,
}: {
  hit: SearchHit;
  index: number;
  active: boolean;
  keywords: string[];
  now: number;
  /** Shared-layout flight from the strip (high tier only). */
  flight: boolean;
  /** Show the (already cached) strip thumbnail underneath while the larger rendition loads. */
  placeholder: boolean;
  scope: string;
  /** Simple fade/rise entrance when flights are off; false under reduced motion. */
  entrance: boolean;
  onHover: (index: number) => void;
  onOpen: (id: string) => void;
}) {
  const { asset, matched } = hit;
  const finding = asset.finding;
  const title = finding?.title ?? asset.title;

  const titleSegments = useMemo(() => highlightSegments(title, keywords, asset), [title, keywords, asset]);
  const tags = useMemo(() => {
    const flagged = asset.tags.map((tag) => ({ tag, hit: termMatches(tag, keywords, asset) }));
    return [...flagged.filter((t) => t.hit), ...flagged.filter((t) => !t.hit)];
  }, [asset, keywords]);
  const shownTags = tags.slice(0, MAX_TAGS);
  const titleHasMatch = titleSegments.some((s) => s.hit);
  const delay = Math.min(index, 12) * 0.028;

  return (
    <motion.button
      layout={flight ? 'position' : false}
      transition={{ layout: { duration: 0.45, ease: EASE } }}
      id={`ask-hit-${asset.id}`}
      type="button"
      role="option"
      aria-selected={active}
      onPointerMove={() => onHover(index)}
      onClick={() => onOpen(asset.id)}
      className={cn(
        'relative flex w-full items-stretch gap-3 rounded-[8px] border p-2 text-left transition-colors duration-150 sm:gap-3.5',
        active ? 'border-line-strong bg-raised' : 'border-transparent',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute bottom-3 left-[-1px] top-3 w-[2px] rounded-full bg-signal transition-opacity duration-150',
          active ? 'opacity-100' : 'opacity-0',
        )}
      />

      <motion.span
        layoutId={flight ? flightId(scope, asset.id) : undefined}
        transition={{ layout: { duration: 0.52, ease: EASE, delay } }}
        initial={entrance ? { opacity: 0, y: 6 } : false}
        animate={{ opacity: 1, y: 0 }}
        data-cursor="OPEN"
        style={{ borderRadius: 5 }}
        className="relative block aspect-[16/10] w-[104px] shrink-0 overflow-hidden border border-line bg-raised sm:w-[136px]"
      >
        {placeholder && (
          // eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition (the cached strip thumbnail)
          <img src={stripThumbUrl(asset)} alt="" decoding="async" draggable={false} className="absolute inset-0 h-full w-full select-none object-cover" />
        )}
        {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
        <img
          src={thumbUrl(asset, MEDIA.w * 2, MEDIA.h * 2)}
          srcSet={`${thumbUrl(asset, MEDIA.w, MEDIA.h)} ${MEDIA.w}w, ${thumbUrl(asset, MEDIA.w * 2, MEDIA.h * 2)} ${MEDIA.w * 2}w`}
          sizes={`${MEDIA.w}px`}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={revealOnLoad}
          className="absolute inset-0 h-full w-full select-none object-cover opacity-0 transition-opacity duration-300"
        />
        {asset.resourceType === 'video' && (
          <span className="absolute bottom-[6px] left-[7px] inline-flex items-center gap-1 rounded-[3px] bg-canvas/85 px-1 py-[1px] font-mono text-[9.5px] uppercase tracking-[0.06em] text-ink">
            <Play className="h-2.5 w-2.5 fill-current" />
            {asset.duration ? formatDuration(asset.duration) : 'Video'}
          </span>
        )}
        {active && <span className="reticle" style={{ inset: 3, '--reticle-size': '8px' } as CSSProperties} />}
      </motion.span>

      <motion.span
        initial={entrance || flight ? { opacity: 0 } : false}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.3, delay: flight ? 0.16 + delay : delay }}
        className="flex min-w-0 flex-1 flex-col justify-center gap-1 py-0.5"
      >
        <span className="flex min-w-0 items-center gap-2">
          {finding ? <SeverityBadge severity={finding.severity} /> : <span className="chip bg-transparent">Unannotated</span>}
          <span className="min-w-0 truncate font-mono text-[11px] text-ink-3">{asset.fileName}</span>
          <span className="num ml-auto hidden shrink-0 font-mono text-[10.5px] text-ink-3 sm:inline">{relativeTime(asset.capturedAt, now)}</span>
        </span>
        <span className="line-clamp-2 text-[14px] font-medium leading-snug tracking-[-0.005em] text-ink [overflow-wrap:anywhere] sm:line-clamp-1">
          <Highlighted segments={titleSegments} />
        </span>
        <span className="block truncate text-[12px] text-ink-3">
          {asset.site}
          {asset.zone && <> · {asset.zone}</>}
        </span>
        {/* One line of whole tags: a tag that does not fit wraps onto the clipped second line instead of being cut. */}
        <span className="flex h-[19px] min-w-0 flex-wrap content-start items-center gap-1 overflow-hidden">
          {/* Matched somewhere not shown (file name, location, category): say which term hit, first so it is always visible. */}
          {matched.length > 0 && !titleHasMatch && !tags.some((t) => t.hit) && (
            <span className="min-w-0 max-w-full truncate font-mono text-[10px] leading-[15px] text-signal">
              matched {matched.map((m) => matchLabel(asset, m)).join(' · ')}
            </span>
          )}
          {shownTags.map(({ tag, hit: tagHit }) => (
            <span
              key={tag}
              className={cn(
                'max-w-full shrink-0 truncate rounded-[4px] border px-1.5 py-[1px] font-mono text-[10px] leading-[15px] tracking-[0.02em]',
                tagHit
                  ? 'border-[color-mix(in_oklab,var(--color-signal)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-signal)_10%,transparent)] text-signal'
                  : 'border-line text-ink-3',
              )}
            >
              {tag}
            </span>
          ))}
          {tags.length > MAX_TAGS && (
            <span className="num hidden shrink-0 font-mono text-[10px] leading-[15px] text-ink-3 sm:inline">+{tags.length - MAX_TAGS}</span>
          )}
        </span>
      </motion.span>
    </motion.button>
  );
});
