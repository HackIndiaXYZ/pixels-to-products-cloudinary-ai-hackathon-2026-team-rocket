'use client';

import type { CSSProperties } from 'react';
import { cn } from '@/components/ui/cn';
import { EditorialMedia, type EditorialMediaProps } from './EditorialMedia';

export type StripItem = Omit<EditorialMediaProps, 'className' | 'frameClassName' | 'style' | 'parallaxY'>;

/** Width ÷ height of a MediaSource aspect string such as "16 / 9". */
function ratioOf(aspect: string): number {
  const [w, h] = aspect.split('/').map((v) => Number.parseFloat(v));
  return w > 0 && h > 0 ? w / h : 1;
}

/**
 * The secondary plates of a domain spread, all at one height and each at its
 * own aspect ratio.
 *
 * - Phones and tablets: a horizontal scroll-snap row running edge to edge, so
 *   a domain costs one row of height however many captures it holds. A plate
 *   wider than the screen is cropped to 84vw by the frame (object-cover).
 * - Desktop: a justified row. Each plate's flex-grow is its aspect ratio, so
 *   every frame shares one height and none is cropped.
 *
 * Layout only; each plate is a regular EditorialMedia (links to the library).
 */
export function PlateStrip({ items, label, className }: { items: StripItem[]; label: string; className?: string }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        '-mx-5 flex snap-x snap-mandatory scroll-px-5 items-start gap-3 overflow-x-auto overscroll-x-contain px-5 [--strip-h:164px] [scrollbar-width:thin]',
        'sm:-mx-8 sm:scroll-px-8 sm:gap-4 sm:px-8 sm:[--strip-h:232px]',
        'lg:mx-0 lg:gap-6 lg:overflow-visible lg:px-0',
        className,
      )}
    >
      {items.map((item) => (
        <EditorialMedia
          key={item.asset.id}
          {...item}
          style={{ '--ar': ratioOf(item.source.aspect) } as CSSProperties}
          className="w-[min(calc(var(--ar)*var(--strip-h)),84vw)] shrink-0 snap-start lg:w-auto lg:min-w-0 lg:shrink lg:flex-[var(--ar)_1_0%]"
          frameClassName="max-lg:aspect-auto! max-lg:h-[var(--strip-h)]"
        />
      ))}
    </div>
  );
}
