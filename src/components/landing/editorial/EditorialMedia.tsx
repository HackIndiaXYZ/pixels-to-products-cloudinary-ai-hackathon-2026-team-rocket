'use client';

import { motion, type MotionValue } from 'framer-motion';
import Link from 'next/link';
import { useState, type CSSProperties } from 'react';
import type { MediaAsset } from '@/lib/types';
import { hoverClipUrl, isVideo, posterOffset } from '@/lib/cloudinary/media';
import { useDeviceTier } from '@/components/motion/hooks';
import { SeverityDot } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { EASE_EDITORIAL } from './hooks';
import { timecode, type MediaSource } from './media-sources';

const clampPct = (v: number) => Math.min(88, Math.max(12, v));

/** Hover zooms toward the annotated finding, so the motion points at what matters. */
function focusOrigin(asset: MediaAsset): string {
  const r = asset.finding?.region;
  if (!r) return '50% 50%';
  return `${clampPct(r.x + r.w / 2)}% ${clampPct(r.y + r.h / 2)}%`;
}

type ClipState = 'off' | 'loading' | 'ready';

export interface EditorialMediaProps {
  asset: MediaAsset;
  source: MediaSource;
  className?: string;
  /** Quiet extra caption line — what Cloudinary did to this rendition. */
  note?: string;
  /** Hover preview for video: a 4 s Cloudinary-trimmed clip at [width, height]. Desktop only. */
  clip?: [number, number];
  /** Full-bleed: square edges, caption kept inside the page gutters. */
  bleed?: boolean;
  captionClassName?: string;
  /** Extra classes for the media frame, e.g. a responsive aspect override (`max-sm:aspect-[2/1]!`). */
  frameClassName?: string;
  /** Never render wider than the capture's own pixel width. */
  captureSize?: boolean;
  /** Where the system overlay sits — keep it off burned-in data (e.g. CCTV timestamps). */
  hud?: 'top' | 'bottom';
  /** Scroll-linked offset for the image layer (a MotionValue such as useTransform(scrollYProgress, …)). */
  parallaxY?: MotionValue<string>;
  /** Inline style for the figure (e.g. CSS variables a plate strip sizes it by). */
  style?: CSSProperties;
}

/**
 * An editorial media plate: a Cloudinary rendition revealed by a print-style
 * curtain, a system overlay (finding ID + severity) and a mono caption with
 * site, zone and file name. Hover or focus eases the frame toward the finding
 * and sharpens the caption. Links to the asset in the console library.
 *
 * Motion is transform/opacity only, runs once on entry, and is absent under
 * prefers-reduced-motion.
 */
export function EditorialMedia({
  asset,
  source,
  className,
  note,
  clip,
  bleed = false,
  captionClassName,
  frameClassName,
  captureSize = false,
  hud = 'top',
  parallaxY,
  style,
}: EditorialMediaProps) {
  const tier = useDeviceTier();
  const [clipState, setClipState] = useState<ClipState>('off');
  const video = isVideo(asset);
  const finding = asset.finding;
  const at = video ? ` @ ${timecode(posterOffset(asset))}` : '';

  const startClip = () => {
    if (!clip || !video || tier !== 'high') return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    setClipState('loading');
  };

  return (
    <motion.figure
      className={cn('group/media relative', className)}
      style={captureSize ? { ...style, maxWidth: asset.width } : style}
      initial="hidden"
      whileInView="shown"
      viewport={{ once: true, margin: '0px 0px -10% 0px' }}
    >
      <Link
        href={`/console#library/${asset.id}`}
        prefetch={false}
        data-cursor="VIEW"
        aria-label={`${asset.title} — ${asset.fileName}. Open in the media library`}
        className={cn('relative block overflow-hidden bg-raised', !bleed && 'rounded-[4px]', frameClassName)}
        style={{ aspectRatio: source.aspect }}
        onPointerEnter={startClip}
        onPointerLeave={() => setClipState('off')}
      >
        {/* Reveal layer: settles from a slight over-scale as the curtain lifts. */}
        <motion.div
          className={cn('absolute inset-x-0 motion-reduce:[transform:none]!', parallaxY ? '-inset-y-[7%]' : 'inset-y-0')}
          variants={{ hidden: { scale: 1.08 }, shown: { scale: 1 } }}
          transition={{ duration: 1.25, ease: EASE_EDITORIAL }}
          style={parallaxY ? { y: parallaxY } : undefined}
        >
          {/* Hover layer: CSS transform only, eased toward the finding region. */}
          <div
            className="absolute inset-0 transition-transform duration-[900ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover/media:scale-[1.045] group-focus-within/media:scale-[1.045] motion-reduce:transition-none"
            style={{ transformOrigin: focusOrigin(asset) }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
            <img
              src={source.src}
              srcSet={source.srcSet}
              sizes={source.sizes}
              alt={asset.title}
              loading="lazy"
              decoding="async"
              draggable={false}
              className="absolute inset-0 h-full w-full select-none object-cover"
            />
            {clipState !== 'off' && clip && (
              <video
                src={hoverClipUrl(asset, clip[0], clip[1])}
                muted
                playsInline
                autoPlay
                loop
                preload="auto"
                aria-hidden
                onPlaying={() => setClipState('ready')}
                onError={() => setClipState('off')}
                className={cn(
                  'absolute inset-0 h-full w-full object-cover opacity-0 transition-opacity duration-300',
                  clipState === 'ready' && 'opacity-100',
                )}
              />
            )}
          </div>
        </motion.div>

        {/* Print-style curtain in the section's own paper colour. */}
        <motion.span
          aria-hidden
          className="pointer-events-none absolute inset-0 origin-bottom bg-canvas motion-reduce:hidden"
          variants={{ hidden: { scaleY: 1 }, shown: { scaleY: 0 } }}
          transition={{ duration: 0.95, ease: [0.76, 0, 0.24, 1] }}
        />

        {/* System overlay: the record this frame belongs to. */}
        <motion.div
          aria-hidden
          className={cn(
            'pointer-events-none absolute inset-x-2.5 flex gap-2 font-mono text-[10px] font-medium uppercase leading-none tracking-[0.07em] text-white',
            hud === 'top' ? 'top-2.5 items-start justify-between' : 'bottom-2.5 items-end justify-start',
          )}
          variants={{ hidden: { opacity: 0 }, shown: { opacity: 1 } }}
          transition={{ duration: 0.4, delay: 0.55 }}
        >
          {finding ? (
            <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap rounded-[3px] bg-[#0a1120]/85 px-1.5 py-[5px]">
              <SeverityDot severity={finding.severity} className="h-1.5 w-1.5 shrink-0" />
              {finding.id}
              <span className="text-white/60">{finding.severity}</span>
            </span>
          ) : (
            <span />
          )}
          {video && (
            <span className="inline-flex items-center gap-1.5 rounded-[3px] bg-[#0a1120]/85 px-1.5 py-[5px]">
              <span
                className={cn(
                  'h-1.5 w-1.5 rounded-full transition-colors duration-300',
                  clipState === 'ready' ? 'bg-signal' : 'bg-white/45',
                )}
              />
              {clipState === 'ready' ? 'Clip · du_4' : 'Video'}
            </span>
          )}
        </motion.div>

        <span
          aria-hidden
          className="reticle opacity-0 transition-opacity duration-300 group-hover/media:opacity-100 group-focus-within/media:opacity-100"
          style={{ '--reticle-color': 'rgba(255,255,255,0.9)' } as CSSProperties}
        />
      </Link>

      <figcaption
        className={cn(
          'mt-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-line pt-2.5 font-mono text-[10.5px] leading-[1.5] tracking-[0.02em] text-ink-3 transition-colors duration-300 group-hover/media:border-line-strong group-hover/media:text-ink group-focus-within/media:border-line-strong group-focus-within/media:text-ink',
          captionClassName,
        )}
      >
        <span className="min-w-0 break-words">
          {asset.site}
          {asset.zone ? ` · ${asset.zone}` : ''}
        </span>
        <span className="min-w-0 break-words">
          {asset.fileName}
          {at}
        </span>
        {note && (
          <span className="basis-full text-ink-3 transition-colors duration-300 group-hover/media:text-ink-2 group-focus-within/media:text-ink-2">
            {note}
          </span>
        )}
      </figcaption>
    </motion.figure>
  );
}
