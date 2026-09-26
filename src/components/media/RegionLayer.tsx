'use client';

import { motion } from 'framer-motion';
import type { Region } from '@/lib/types';
import { cn } from '@/components/ui/cn';

export type RegionVariant = 'annotation' | 'focus' | 'face';

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
};

/**
 * Draws regions (percent coordinates) over a MediaFrame.
 * `annotation` = curated sample annotation; `focus` / `face` = live Cloudinary AI signals.
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
          {showLabels && r.label && (
            <span
              className={cn(
                'absolute -top-[18px] left-[-1.5px] whitespace-nowrap rounded-[3px] px-1.5 py-[1px] font-mono text-[9.5px] font-semibold tracking-[0.06em]',
                style.tag,
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
