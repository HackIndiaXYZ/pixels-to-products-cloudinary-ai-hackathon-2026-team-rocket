'use client';

import { motion } from 'framer-motion';
import { MASK_LINE } from '@/components/motion/RevealText';

const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * The closing line. It rises out of a mask like the headline above it, then a
 * single signal rule is drawn under "searchable" — the one accent in the ending.
 * The mask (on screen) is observed; the clipped line and the rule inherit it.
 */
export function SearchableLine({ className, delay = 0.3 }: { className?: string; delay?: number }) {
  return (
    <p className={className}>
      <motion.span
        className="-mb-[0.1em] block overflow-hidden pb-[0.1em]"
        initial="hidden"
        whileInView="shown"
        viewport={{ once: true, margin: '0px 0px -12% 0px' }}
      >
        <motion.span className="block" variants={MASK_LINE} transition={{ duration: 0.9, delay, ease: EASE }}>
          VisualOps makes them{' '}
          <span className="relative inline-block text-ink">
            searchable
            <motion.span
              aria-hidden
              className="absolute inset-x-0 bottom-[0.02em] block h-[0.065em] origin-left bg-signal"
              variants={{ hidden: { scaleX: 0 }, shown: { scaleX: 1 } }}
              transition={{ duration: 0.7, delay: delay + 0.8, ease: EASE }}
            />
          </span>
          .
        </motion.span>
      </motion.span>
    </p>
  );
}
