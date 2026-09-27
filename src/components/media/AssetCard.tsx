'use client';

import { motion } from 'framer-motion';
import { Film } from 'lucide-react';
import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import type { MediaAsset } from '@/lib/types';
import { CATEGORY_LABEL } from '@/lib/analytics';
import { hoverClipUrl, thumbUrl } from '@/lib/cloudinary/media';
import { cachedInsight, describeCropCentre, faceDetections, fetchInsight, type CloudinaryInsight } from '@/lib/cloudinary/insights';
import { formatDuration } from '@/lib/format';
import { captureTimeDisplay } from '@/components/console/library/model';
import { TILE_ASPECT, TILE_SPAN, type TileCell, type TileKind } from '@/components/console/library/mosaic';
import { useDeviceTier } from '@/components/motion/hooks';
import { SEVERITY_COLOR, SeverityDot } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { CloudImage } from './CloudImage';

/**
 * Library tile.
 *
 * The frame is a Cloudinary g_auto crop sized to the tile's span; videos play a
 * short Cloudinary-trimmed clip after a brief hover. Hover or keyboard focus
 * reveals the record and, fetched lazily on first intent, Cloudinary's own AI
 * signals for the frame (fl_getinfo): its face detections and where g_auto
 * placed its crop — crop geometry, never presented as a detected subject. The image drifts toward the pointer via
 * a transform written straight to the DOM — no React render per pointer move.
 * Only the media box carries the shared `media-<id>` layoutId, so opening an
 * asset morphs exactly that frame into the Inspector.
 */

const EASE = [0.16, 1, 0.3, 1] as const;
const MORPH = { duration: 0.46, ease: EASE };
const HOVER_SCALE = 1.06;
const DWELL_MS = 140;

/** Candidate rendition widths per tile kind; the browser picks one via srcset. */
const WIDTHS: Record<TileKind, number[]> = {
  standard: [320, 480, 640, 800],
  tall: [320, 480, 640],
  wide: [640, 960, 1280],
  feature: [640, 960, 1280, 1600],
};
/** Fallback `sizes` for browsers without `sizes="auto"`. */
const FALLBACK_SIZE: Record<TileKind, string> = {
  standard: '300px',
  tall: '300px',
  wide: '600px',
  feature: '600px',
};

type SignalState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; insight: CloudinaryInsight }
  | { status: 'error' };

export interface AssetCardProps {
  asset: MediaAsset;
  now: number;
  kind?: TileKind;
  /** Explicit grid placement from the mosaic planner; without it the tile auto-places with its span. */
  cell?: TileCell;
  onOpen: (asset: MediaAsset) => void;
  /** Called on hover dwell / keyboard focus (`intent`) and on pointer down (`commit`). */
  onIntent?: (asset: MediaAsset, stage: 'intent' | 'commit') => void;
  selected?: boolean;
  /**
   * Set to enable framer layout animation of the tile. Changing the value
   * re-measures (pass the result signature); leave undefined for large sets.
   */
  layoutKey?: string;
  revealDelay?: number;
  ref?: Ref<HTMLDivElement>;
}

function AssetCardImpl({ asset, now, kind = 'standard', cell, onOpen, onIntent, selected = false, layoutKey, revealDelay = 0, ref }: AssetCardProps) {
  const tier = useDeviceTier();
  const parallax = tier === 'high';
  const animated = layoutKey !== undefined;
  const isVideo = asset.resourceType === 'video';
  const finding = asset.finding;
  const severity = finding?.severity;
  const span = TILE_SPAN[kind];
  const large = kind === 'feature';

  const buttonRef = useRef<HTMLButtonElement>(null);
  const driftRef = useRef<HTMLSpanElement>(null);
  const pointer = useRef({ x: 0, y: 0, rect: null as DOMRect | null, frame: 0, dwell: 0 });
  const [signal, setSignal] = useState<SignalState>(() => {
    const cached = cachedInsight(asset);
    return cached ? { status: 'ready', insight: cached } : { status: 'idle' };
  });
  const [clip, setClip] = useState(false);

  useEffect(() => {
    const p = pointer.current;
    return () => {
      window.clearTimeout(p.dwell);
      cancelAnimationFrame(p.frame);
    };
  }, []);

  const intent = () => {
    onIntent?.(asset, 'intent');
    if (isVideo) setClip(true);
    const cached = cachedInsight(asset);
    if (cached) {
      if (signal.status !== 'ready') setSignal({ status: 'ready', insight: cached });
      return;
    }
    if (signal.status === 'loading') return;
    setSignal({ status: 'loading' });
    fetchInsight(asset)
      .then((insight) => setSignal({ status: 'ready', insight }))
      .catch(() => setSignal({ status: 'error' }));
  };

  const drift = () => {
    const p = pointer.current;
    p.frame = 0;
    const el = driftRef.current;
    if (!el || !p.rect) return;
    // Stay inside the slack the hover scale creates, so edges never show.
    const slackX = (p.rect.width * (HOVER_SCALE - 1)) / 2;
    const slackY = (p.rect.height * (HOVER_SCALE - 1)) / 2;
    el.style.transform = `translate3d(${(p.x * 1.6 * slackX).toFixed(2)}px, ${(p.y * 1.6 * slackY).toFixed(2)}px, 0) scale(${HOVER_SCALE})`;
  };

  const onPointerEnter = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.pointerType === 'touch') return;
    const p = pointer.current;
    p.rect = event.currentTarget.getBoundingClientRect();
    window.clearTimeout(p.dwell);
    p.dwell = window.setTimeout(intent, DWELL_MS);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!parallax || event.pointerType === 'touch') return;
    const p = pointer.current;
    if (!p.rect) return;
    p.x = Math.max(-0.5, Math.min(0.5, (event.clientX - p.rect.left) / p.rect.width - 0.5));
    p.y = Math.max(-0.5, Math.min(0.5, (event.clientY - p.rect.top) / p.rect.height - 0.5));
    if (!p.frame) p.frame = requestAnimationFrame(drift);
  };

  const onPointerLeave = () => {
    const p = pointer.current;
    window.clearTimeout(p.dwell);
    cancelAnimationFrame(p.frame);
    p.frame = 0;
    p.rect = null;
    if (driftRef.current) driftRef.current.style.transform = '';
    if (clip && document.activeElement !== buttonRef.current) setClip(false);
  };

  // Lift the tile above its neighbours while its media flies back from the Inspector.
  const raise = () => {
    if (buttonRef.current) buttonRef.current.style.zIndex = '30';
  };
  const lower = () => {
    if (buttonRef.current) buttonRef.current.style.zIndex = '';
  };

  const aspect = TILE_ASPECT[kind];
  const widths = WIDTHS[kind].filter((w) => w <= Math.max(asset.width, 1) * 1.25);
  const usable = widths.length ? widths : [WIDTHS[kind][0]];
  const srcSet = usable.map((w) => `${thumbUrl(asset, w, Math.round(w / aspect))} ${w}w`).join(', ');
  const srcWidth = usable[Math.min(1, usable.length - 1)];
  const clipWidth = kind === 'wide' || large ? 800 : 480;
  const clipHeight = Math.round(clipWidth / aspect / 2) * 2;
  const title = finding?.title ?? asset.title;
  const place = `${asset.site}${asset.zone ? ` · ${asset.zone}` : ''}`;
  const tags = asset.tags.slice(0, large || kind === 'tall' ? 5 : 3);
  const captured = captureTimeDisplay(asset, now);
  const label = [
    title,
    severity ? `${severity} severity${finding ? `, ${CATEGORY_LABEL[finding.category]}` : ''}` : 'no finding recorded',
    place,
    `captured ${captured.time}${captured.camera ? ' (camera time)' : ''}`,
    isVideo ? 'video' : 'photo',
  ].join('. ');
  const placement = cell
    ? { gridColumn: `${cell.col + 1} / span ${cell.cols}`, gridRow: `${cell.row + 1} / span ${cell.rows}` }
    : { gridColumn: `span ${span.cols}`, gridRow: `span ${span.rows}` };

  return (
    <motion.div
      ref={ref}
      layout={animated ? 'position' : false}
      layoutDependency={layoutKey}
      initial={animated ? { opacity: 0, y: 12 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.18, ease: EASE } }}
      transition={{
        opacity: { duration: 0.4, delay: revealDelay, ease: EASE },
        y: { duration: 0.5, delay: revealDelay, ease: EASE },
        layout: { duration: 0.42, ease: EASE },
      }}
      className="relative min-h-0 min-w-0"
      style={placement}
    >
      <button
        ref={buttonRef}
        type="button"
        data-cursor="OPEN"
        data-asset-id={asset.id}
        aria-label={label}
        onClick={() => onOpen(asset)}
        onPointerEnter={onPointerEnter}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        onPointerDown={(event) => {
          // Touch pointer-downs are mostly scroll gestures: never prefetch on those.
          if (event.pointerType !== 'touch') onIntent?.(asset, 'commit');
        }}
        onFocus={(event) => {
          if (event.currentTarget.matches(':focus-visible')) intent();
        }}
        onBlur={() => {
          if (clip && !pointer.current.rect) setClip(false);
        }}
        className="group/tile @container absolute inset-0 block rounded-[8px] text-left active:scale-[0.992] motion-safe:transition-transform motion-safe:duration-200"
      >
        {/* Media — the only element that morphs into the Inspector. */}
        <motion.span
          layoutId={`media-${asset.id}`}
          layoutDependency={animated ? `${layoutKey}|${selected}` : selected}
          transition={{ layout: MORPH }}
          onLayoutAnimationStart={raise}
          onLayoutAnimationComplete={lower}
          className="absolute inset-0 block overflow-hidden bg-raised"
          style={{ borderRadius: 8 }}
        >
          <span
            ref={driftRef}
            className="absolute inset-0 block origin-center motion-safe:transition-transform motion-safe:duration-700 motion-safe:ease-[cubic-bezier(0.16,1,0.3,1)] motion-safe:group-focus-visible/tile:scale-[1.035]"
          >
            <CloudImage
              src={thumbUrl(asset, srcWidth, Math.round(srcWidth / aspect))}
              srcSet={srcSet}
              sizes={`auto, ${FALLBACK_SIZE[kind]}`}
              alt=""
              draggable={false}
              className="absolute inset-0 h-full w-full object-cover"
            />
            {isVideo && clip && !selected && (
              <video
                src={hoverClipUrl(asset, clipWidth, clipHeight)}
                autoPlay
                muted
                loop
                playsInline
                preload="auto"
                aria-hidden
                onPlaying={(event) => {
                  event.currentTarget.style.opacity = '1';
                }}
                className="absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300"
              />
            )}
          </span>
        </motion.span>

        {/* Hairline frame + legibility scrims (not part of the morph). */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[8px] border border-line transition-colors duration-300 group-hover/tile:border-line-strong"
        />
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 rounded-b-[8px] bg-linear-to-t from-canvas/90 via-canvas/40 to-transparent',
            large ? 'h-[52%]' : 'h-[68%]',
          )}
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[8px] bg-linear-to-t from-canvas/95 via-canvas/70 via-45% to-canvas/5 opacity-0 transition-opacity duration-300 group-hover/tile:opacity-100 group-focus-visible/tile:opacity-100"
        />

        {/* Corner markers */}
        <span aria-hidden className="pointer-events-none absolute inset-x-2.5 top-2.5 flex items-start justify-between gap-2">
          {large && severity ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-[5px] bg-canvas/85 px-1.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.08em]"
              style={{ color: SEVERITY_COLOR[severity] }}
            >
              <SeverityDot severity={severity} />
              {severity}
            </span>
          ) : (
            <span />
          )}
          <span className="flex items-center gap-1">
            {asset.source !== 'sample' && (
              <span className="rounded-[5px] bg-signal px-1.5 py-0.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.06em] text-signal-ink">
                {asset.source === 'upload' ? 'Uploaded' : 'Synced'}
              </span>
            )}
            {isVideo && (
              <span className="num inline-flex items-center gap-1 rounded-[5px] bg-canvas/85 px-1.5 py-0.5 font-mono text-[10px] text-ink-2">
                <Film className="h-3 w-3" />
                {asset.duration ? formatDuration(asset.duration) : 'Video'}
              </span>
            )}
          </span>
        </span>

        {/* Resting caption */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-0 bottom-0 block transition-[opacity,translate] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/tile:-translate-y-1 group-hover/tile:opacity-0 group-focus-visible/tile:opacity-0',
            large ? 'p-4 @min-[520px]:p-5' : 'p-3',
          )}
        >
          <span className="flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.02em] text-ink-2">
            {severity && !large && <SeverityDot severity={severity} />}
            <span className="truncate">{finding?.id ?? asset.fileName}</span>
          </span>
          <span
            className={cn(
              'mt-1 block text-ink',
              large
                ? 'type-heading line-clamp-3 text-[20px] @min-[420px]:text-[24px] @min-[560px]:text-[28px]'
                : 'line-clamp-2 text-[13px] font-medium leading-snug tracking-[-0.005em] @max-[200px]:line-clamp-1',
            )}
          >
            {title}
          </span>
          {large && <span className="mt-1.5 block truncate text-[12.5px] text-ink-2">{place}</span>}
        </span>

        {/* Hover / focus detail */}
        <span
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-0 flex translate-y-2 flex-col justify-end opacity-0 transition-[opacity,translate] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/tile:translate-y-0 group-hover/tile:opacity-100 group-focus-visible/tile:translate-y-0 group-focus-visible/tile:opacity-100',
            large ? 'p-4 @min-[520px]:p-5' : 'p-3',
          )}
        >
          <span className={cn('flex min-w-0 gap-4', kind === 'wide' ? 'items-end' : 'flex-col')}>
            <span className="block min-w-0 flex-1">
              <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
                {severity ? (
                  <>
                    <SeverityDot severity={severity} />
                    <span style={{ color: SEVERITY_COLOR[severity] }}>{severity}</span>
                    <span aria-hidden>·</span>
                    <span className="truncate">{finding ? CATEGORY_LABEL[finding.category] : ''}</span>
                  </>
                ) : (
                  <span>No finding recorded</span>
                )}
              </span>
              <span
                className={cn(
                  'mt-1.5 block text-ink',
                  large ? 'type-heading line-clamp-2 text-[20px] @min-[420px]:text-[24px]' : 'line-clamp-2 text-[13.5px] font-medium leading-snug',
                )}
              >
                {title}
              </span>
              <span className="mt-1 block truncate text-[12px] text-ink-2">{place}</span>
              <span className="num mt-1 block truncate font-mono text-[10.5px] text-ink-3 @max-[210px]:hidden">
                {captured.time} · {captured.detail} · {asset.fileName}
              </span>
              {kind === 'wide' && (
                <span className="mt-2 block @min-[460px]:hidden">
                  <SignalLine signal={signal} />
                </span>
              )}
            </span>

            <span className={cn('block min-w-0', kind === 'wide' ? 'hidden w-[44%] shrink-0 @min-[460px]:block' : '')}>
              {tags.length > 0 && kind !== 'standard' && (
                <span className="mb-2 flex flex-wrap gap-1">
                  {tags.map((tag) => (
                    <span key={tag} className="rounded-[4px] border border-line-strong bg-canvas/60 px-1.5 py-px font-mono text-[10px] text-ink-2">
                      {tag}
                    </span>
                  ))}
                </span>
              )}
              <SignalLine signal={signal} />
            </span>
          </span>
        </span>
      </button>
    </motion.div>
  );
}

/** Cloudinary's fl_getinfo answer in one line: face detections first (the privacy signal), then where g_auto placed its crop. */
function signalText(insight: CloudinaryInsight): string {
  const crop = insight.focus ? `g_auto crop ${describeCropCentre(insight.focus)}` : 'no g_auto crop';
  return `${faceDetections(insight.faces.length)} · ${crop}`;
}

function SignalLine({ signal }: { signal: SignalState }) {
  return (
    <span className="flex min-w-0 items-center gap-1.5 border-t border-line-strong/70 pt-2 font-mono text-[10px] tracking-[0.02em] text-ink-3 @max-[210px]:hidden">
      <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-full bg-signal', signal.status !== 'ready' && 'opacity-50')} />
      <span className="shrink-0 uppercase tracking-[0.08em]">Cloudinary</span>
      <span className="num min-w-0 truncate text-ink-2">
        {signal.status === 'ready'
          ? signalText(signal.insight)
          : signal.status === 'error'
            ? 'signals unavailable'
            : 'reading fl_getinfo…'}
      </span>
    </span>
  );
}

/** Memoised: tiles re-render only when their own inputs change, never on sibling hover. */
export const AssetCard = memo(AssetCardImpl);
