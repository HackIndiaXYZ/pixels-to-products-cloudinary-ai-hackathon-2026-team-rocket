'use client';

import { motion } from 'framer-motion';
import { cn } from '@/components/ui/cn';

/** Hand-off travel time. Presentational only; the next stage starts after the runner's 220 ms pause. */
const TRAVEL_S = 0.3;
const TRAVEL_EASE = [0.65, 0, 0.35, 1] as const;

/**
 * The track between two stages. When the upstream stage hands off, a small
 * packet travels along it and the traversed section lights, then settles to
 * a dim trace. Transform and opacity only; nothing loops.
 */
export function Connector({
  lit,
  runId,
  horizontal,
  reduce,
}: {
  lit: boolean;
  runId: number;
  horizontal: boolean;
  reduce: boolean;
}) {
  const key = `${runId}-${horizontal ? 'h' : 'v'}`;
  return (
    <span aria-hidden className="relative my-2 block w-[10px] flex-1 xl:mx-2 xl:my-0 xl:h-[10px] xl:w-auto">
      {/* Static track follows the CSS breakpoint; only the animated trace and packet need the JS orientation. */}
      <span className="absolute inset-y-0 left-[4.5px] w-px bg-line-strong xl:inset-x-0 xl:inset-y-auto xl:left-0 xl:top-[4.5px] xl:h-px xl:w-auto" />
      {lit && (
        <motion.span
          key={`trace-${key}`}
          className={cn('absolute bg-signal', horizontal ? 'inset-x-0 top-[4.5px] h-px origin-left' : 'inset-y-0 left-[4.5px] w-px origin-top')}
          initial={reduce ? { opacity: 0.4 } : horizontal ? { scaleX: 0, opacity: 1 } : { scaleY: 0, opacity: 1 }}
          animate={horizontal ? { scaleX: 1, opacity: 0.4 } : { scaleY: 1, opacity: 0.4 }}
          transition={{
            scaleX: { duration: TRAVEL_S, ease: TRAVEL_EASE },
            scaleY: { duration: TRAVEL_S, ease: TRAVEL_EASE },
            opacity: { duration: 0.55, delay: reduce ? 0 : TRAVEL_S, ease: 'easeOut' },
          }}
        />
      )}
      {lit && !reduce && (
        <span className="absolute inset-0 overflow-hidden">
          <motion.span
            key={`packet-${key}`}
            className="absolute inset-0"
            initial={horizontal ? { x: '-100%', opacity: 1 } : { y: '-100%', opacity: 1 }}
            animate={horizontal ? { x: '0%', opacity: 0 } : { y: '0%', opacity: 0 }}
            transition={{
              x: { duration: TRAVEL_S, ease: TRAVEL_EASE },
              y: { duration: TRAVEL_S, ease: TRAVEL_EASE },
              opacity: { duration: 0.16, delay: TRAVEL_S, ease: 'linear' },
            }}
          >
            <span
              className={cn(
                'absolute rounded-full bg-signal',
                horizontal ? 'right-0 top-[3.5px] h-[3px] w-3' : 'bottom-0 left-[3.5px] h-3 w-[3px]',
              )}
            />
          </motion.span>
        </span>
      )}
    </span>
  );
}
