'use client';

import { AnimatePresence, LayoutGroup } from 'framer-motion';
import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { MediaAsset } from '@/lib/types';
import { AssetCard } from '@/components/media/AssetCard';
import { useReducedMotionPref } from '@/components/motion/hooks';
import { GRID_GAP, ROW_RATIO, columnsFor, planMosaic } from './mosaic';
import { publishLibraryDisplayOrder } from './sequence';

/** framer layout / presence animation only for short result sets. */
export const LAYOUT_LIMIT = 30;

function guessWidth(): number {
  if (typeof window === 'undefined') return 1100;
  const w = window.innerWidth;
  // Console chrome: 220px sidebar + 64px padding on large screens, 32–48px gutters below.
  if (w >= 1024) return Math.min(w - 284, 1376);
  return w - (w >= 640 ? 48 : 32);
}

/** Column count from the grid's measured width; state changes only when the count changes. */
function useColumns(ref: RefObject<HTMLDivElement | null>): number {
  const [cols, setCols] = useState(() => columnsFor(guessWidth()));
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const next = columnsFor(entry.contentRect.width);
      setCols((prev) => (prev === next ? prev : next));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return cols;
}

/**
 * The Library mosaic. Every tile is placed explicitly at the cell the planner
 * computed and rendered in reading order, so the DOM (Tab order, screen
 * readers) and the Inspector's ← / → sequence follow exactly what is on screen.
 */
export const LibraryGrid = memo(function LibraryGrid({
  assets,
  now,
  selectedId,
  onOpen,
  onIntent,
}: {
  assets: MediaAsset[];
  now: number;
  selectedId: string | null;
  onOpen: (asset: MediaAsset) => void;
  onIntent: (asset: MediaAsset, stage: 'intent' | 'commit') => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const cols = useColumns(wrapRef);
  const reduced = useReducedMotionPref();
  const plan = useMemo(() => planMosaic(assets, cols), [assets, cols]);
  const animated = assets.length <= LAYOUT_LIMIT;
  // Changes whenever the arrangement changes, so every tile re-measures together.
  const layoutKey = useMemo(
    () => (animated ? `${cols}:${assets.map((a, i) => `${a.id}/${plan.kinds[i]}`).join(',')}` : undefined),
    [animated, assets, cols, plan],
  );

  // Publish the on-screen order for the Inspector's ← / →; withdraw it when the grid goes away.
  const displayIds = useMemo(() => plan.order.map((i) => assets[i].id), [assets, plan]);
  useEffect(() => {
    publishLibraryDisplayOrder(displayIds);
  }, [displayIds]);
  useEffect(() => () => publishLibraryDisplayOrder([]), []);

  const style: CSSProperties = {
    gap: GRID_GAP,
    gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
    // Row height follows the column width, so every tile keeps its proportions at any size.
    gridAutoRows: `calc((100cqw - ${(cols - 1) * GRID_GAP}px) / ${cols} * ${ROW_RATIO})`,
  };

  const cards = plan.order.map((index, position) => {
    const asset = assets[index];
    return (
      <AssetCard
        key={asset.id}
        asset={asset}
        now={now}
        kind={plan.kinds[index]}
        cell={plan.cells[index]}
        onOpen={onOpen}
        onIntent={onIntent}
        selected={selectedId === asset.id}
        layoutKey={layoutKey}
        revealDelay={animated && !reduced ? Math.min(position, 10) * 0.028 : 0}
      />
    );
  });

  return (
    <div ref={wrapRef} className="@container">
      <div className="relative grid" style={style}>
        {animated ? (
          <LayoutGroup>
            <AnimatePresence mode="popLayout">{cards}</AnimatePresence>
          </LayoutGroup>
        ) : (
          cards
        )}
      </div>
    </div>
  );
});

/** Auto-loads the next page when it nears the viewport; the button is the manual fallback. */
export function LoadMore({ remaining, page, onMore }: { remaining: number; page: number; onMore: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => entry.isIntersecting && onMore(), { rootMargin: '0px 0px 600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [onMore]);
  return (
    <div ref={ref} className="flex items-center justify-center gap-3 pt-2">
      <span className="h-px flex-1 bg-line" />
      <button type="button" className="btn btn-ghost btn-sm" onClick={onMore}>
        Show <span className="num">{Math.min(page, remaining)}</span> more
        <span className="num font-mono text-[11px] text-ink-3">· {remaining} left</span>
      </button>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
