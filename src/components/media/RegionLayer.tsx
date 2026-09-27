'use client';

import { motion } from 'framer-motion';
import type { Region } from '@/lib/types';
import { cn } from '@/components/ui/cn';

export type RegionVariant = 'annotation' | 'focus' | 'face' | 'ai';

const VARIANT_STYLE: Record<RegionVariant, { box: string; tag: string }> = {
  annotation: {
    box: 'border-[1.5px] border-high bg-[color-mix(in_oklab,var(--color-high)_10%,transparent)]',
    tag: 'bg-high text-signal-ink',
  },
  focus: {
    box: 'border-[1.5px] border-dashed border-signal',
    tag: 'bg-signal text-signal-ink',
  },
  face: {
    box: 'border-[1.5px] border-signal bg-[color-mix(in_oklab,var(--color-signal)_12%,transparent)]',
    tag: 'bg-signal text-signal-ink',
  },
  // Object detections: a hairline outline with solid corner brackets and an outlined tag, so they read
  // apart from the human annotation (solid, filled), the g_auto crop (dashed) and face detections (filled).
  ai: {
    box: 'border border-[color-mix(in_oklab,var(--color-signal)_45%,transparent)]',
    tag: 'border border-signal bg-canvas/90 text-signal',
  },
};

/** Corner brackets for the `ai` variant: two borders each, no fills. */
const CORNERS = [
  'left-[-1.5px] top-[-1.5px] border-l-2 border-t-2 rounded-tl-[3px]',
  'right-[-1.5px] top-[-1.5px] border-r-2 border-t-2 rounded-tr-[3px]',
  'bottom-[-1.5px] left-[-1.5px] border-b-2 border-l-2 rounded-bl-[3px]',
  'bottom-[-1.5px] right-[-1.5px] border-b-2 border-r-2 rounded-br-[3px]',
] as const;

/**
 * Draws regions (percent coordinates) over a MediaFrame.
 * `annotation` = human annotation (sample or ingest); `focus` / `face` = live Cloudinary fl_getinfo
 * signals; `ai` = Cloudinary AI object detections (AI Content Analysis, coco_v2).
 */
export function RegionLayer({
  regions,
  variant,
  showLabels = true,
  className,
}: {
  regions: Region[];
  variant: RegionVariant;
  showLabels?: boolean;
  className?: string;
}) {
  const style = VARIANT_STYLE[variant];
  return (
    <div aria-hidden className={cn('pointer-events-none absolute inset-0', className)}>
      {regions.map((r, i) => (
        <motion.div
          key={`${variant}-${i}-${r.x}-${r.y}`}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.35, delay: 0.05 * i, ease: [0.16, 1, 0.3, 1] }}
          className={cn('absolute rounded-[3px]', style.box)}
          style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }}
        >
          {/* <i>, not <span>: callers hide labels on narrow frames with [&_span]:hidden, and the brackets must stay. */}
          {variant === 'ai' &&
            CORNERS.map((corner) => <i key={corner} className={cn('absolute block h-[min(12px,40%)] w-[min(12px,40%)] border-signal', corner)} />)}
          {showLabels && r.label && (
            <span
              className={cn(
                'absolute -top-[18px] left-[-1.5px] whitespace-nowrap rounded-[3px] px-1.5 py-[1px] font-mono text-[10.5px] font-semibold leading-[14px] tracking-[0.06em]',
                style.tag,
                variant === 'ai' && 'leading-[12px]',
                r.y < 6 && 'top-[2px] left-[2px]',
              )}
            >
              {r.label}
            </span>
          )}
        </motion.div>
      ))}
    </div>
  );
}
