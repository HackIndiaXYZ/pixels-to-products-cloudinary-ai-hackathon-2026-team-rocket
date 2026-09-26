'use client';

import { motion, type Variants } from 'framer-motion';
import type { ElementType } from 'react';
import { cn } from '@/components/ui/cn';

/**
 * Masked line reveal variants. The in-view trigger must sit on the *mask*
 * (which is on screen), never on the translated line: a line pushed fully
 * outside an `overflow: hidden` parent is clipped away, so IntersectionObserver
 * would never report it as visible and the text would stay hidden.
 */
export const MASK_LINE: Variants = {
  hidden: { y: '105%' },
  shown: { y: '0%' },
};

/**
 * Editorial headline reveal: each line rises out of a mask the first time it
 * scrolls into view. Pass lines explicitly so line breaks are designed, not
 * accidental. Transform-only, GPU-friendly; static under reduced motion.
 */
export function RevealText({
  lines,
  as: Tag = 'h2',
  className,
  lineClassName,
  delay = 0,
  stagger = 0.08,
}: {
  lines: string[];
  as?: ElementType;
  className?: string;
  lineClassName?: string;
  delay?: number;
  stagger?: number;
}) {
  return (
    <Tag className={className}>
      <span className="sr-only">{lines.join(' ')}</span>
      {lines.map((line, i) => (
        <motion.span
          key={i}
          aria-hidden
          className="block overflow-hidden pb-[0.08em] -mb-[0.08em]"
          initial="hidden"
          whileInView="shown"
          viewport={{ once: true, margin: '0px 0px -12% 0px' }}
        >
          <motion.span
            className={cn('block', lineClassName)}
            variants={MASK_LINE}
            transition={{ duration: 0.9, delay: delay + i * stagger, ease: [0.16, 1, 0.3, 1] }}
          >
            {line}
          </motion.span>
        </motion.span>
      ))}
    </Tag>
  );
}
