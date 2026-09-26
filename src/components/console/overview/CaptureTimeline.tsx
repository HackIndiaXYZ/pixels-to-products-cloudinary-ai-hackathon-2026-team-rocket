'use client';

import { motion } from 'framer-motion';
import { memo, useMemo, useState } from 'react';
import { captureBasisOf, fieldAssets } from '@/lib/analytics';
import { useReducedMotionPref } from '@/components/motion/hooks';
import { cn } from '@/components/ui/cn';
import { useConsoleData } from '../store';
import { EASE, PanelTitle, Swatch } from './shared';

export interface DayBucket {
  day: number;
  count: number;
  /** High or critical findings on that day's captures that are not resolved. */
  critical: number;
}

const NEUTRAL = 'color-mix(in oklab, var(--color-ink-3) 62%, var(--color-surface))';
const NEUTRAL_ACTIVE = 'var(--color-ink-2)';
const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short' });
const weekdayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short' });
const SAMPLE_TIMES_NOTE = 'Sample dataset: capture times are set relative to now, not recorded by a camera';

/**
 * Captures per day for the last seven days, with unresolved high/critical findings stacked at the base.
 * The chart grows to fill its panel (the row is as tall as its tallest sibling), with a 150 px floor.
 */
export const CaptureTimeline = memo(function CaptureTimeline({ days, totalCaptures }: { days: DayBucket[]; totalCaptures: number }) {
  const reduce = useReducedMotionPref();
  const { assets } = useConsoleData();
  // Bundled samples place their captures relative to now; say so wherever those times are charted.
  const sampleTimes = useMemo(() => fieldAssets(assets).some((a) => captureBasisOf(a) === 'sample-relative'), [assets]);
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(1, ...days.map((d) => d.count));
  const inWindow = days.reduce((n, d) => n + d.count, 0);
  const highInWindow = days.reduce((n, d) => n + d.critical, 0);
  const focus = active !== null ? days[active] : undefined;

  return (
    <div className="flex h-full min-w-0 flex-col p-4 sm:p-5">
      <PanelTitle
        title="Captures · last 7 days"
        meta={
          <>
            {inWindow} of {totalCaptures} in window
          </>
        }
      />
      <p className="num mt-1 h-4 truncate font-mono text-[11px] text-ink-3" aria-live="polite">
        {focus
          ? `${dayFmt.format(focus.day)} · ${focus.count} ${focus.count === 1 ? 'capture' : 'captures'}${
              focus.critical ? ` · ${focus.critical} high+ unresolved` : ''
            }`
          : `${highInWindow} high/critical unresolved this week`}
      </p>

      <ul
        className="relative mt-4 grid min-h-[150px] flex-1 grid-cols-7 gap-1 border-b border-line-strong"
        aria-label="Captures per day"
        onMouseLeave={() => setActive(null)}
      >
        {days.map((d, i) => {
          const isActive = active === i;
          const rest = d.count - d.critical;
          return (
            <li
              key={d.day}
              tabIndex={0}
              aria-label={`${dayFmt.format(d.day)}: ${d.count} captures, ${d.critical} high or critical unresolved`}
              onMouseEnter={() => setActive(i)}
              onFocus={() => setActive(i)}
              onBlur={() => setActive(null)}
              className="relative flex h-full flex-col items-center justify-end outline-offset-0"
            >
              <span
                aria-hidden
                className={cn(
                  'absolute inset-0 rounded-t-[4px] bg-raised transition-opacity duration-200',
                  isActive ? 'opacity-100' : 'opacity-0',
                )}
              />
              <span
                className={cn(
                  'num relative mb-1.5 font-mono text-[10.5px] transition-colors',
                  isActive ? 'text-ink' : d.count ? 'text-ink-2' : 'text-ink-3',
                )}
              >
                {d.count}
              </span>
              <motion.span
                aria-hidden
                className="relative flex w-full max-w-[24px] flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px]"
                style={{ height: `calc((100% - 24px) * ${d.count / max})`, originY: 1 }}
                initial={reduce ? false : { scaleY: 0 }}
                whileInView={{ scaleY: 1 }}
                viewport={{ once: true, margin: '0px 0px -8% 0px' }}
                transition={{ duration: 0.65, ease: EASE, delay: 0.1 + i * 0.05 }}
              >
                {d.critical > 0 && (
                  <span className="block" style={{ flexGrow: d.critical, flexBasis: 0, backgroundColor: 'var(--color-high)' }} />
                )}
                {rest > 0 && (
                  <span
                    className="block transition-colors duration-200"
                    style={{ flexGrow: rest, flexBasis: 0, backgroundColor: isActive ? NEUTRAL_ACTIVE : NEUTRAL }}
                  />
                )}
              </motion.span>
            </li>
          );
        })}
      </ul>

      <div className="mt-2 grid grid-cols-7 gap-1" aria-hidden>
        {days.map((d, i) => (
          <span
            key={d.day}
            className={cn(
              'text-center font-mono text-[10px]',
              i === days.length - 1 ? 'text-ink' : active === i ? 'text-ink-2' : 'text-ink-3',
            )}
          >
            {i === days.length - 1 ? 'Today' : weekdayFmt.format(d.day)}
          </span>
        ))}
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 pt-4 text-[11.5px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <Swatch color={NEUTRAL} />
          Captures
        </span>
        <span className="flex items-center gap-1.5">
          <Swatch color="var(--color-high)" />
          High or critical, unresolved
        </span>
        {sampleTimes && (
          <span className="text-ink-3" title={SAMPLE_TIMES_NOTE}>
            <span aria-hidden>Sample times · relative to now</span>
            <span className="sr-only">{SAMPLE_TIMES_NOTE}</span>
          </span>
        )}
      </div>
    </div>
  );
});
