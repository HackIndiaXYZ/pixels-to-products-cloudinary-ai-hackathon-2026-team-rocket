'use client';

import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { useEffect, type ReactNode } from 'react';
import { useReducedMotionPref } from '@/components/motion/hooks';

const REST = 96;
const MIN = 88;
const MAX = 108;

/**
 * A single word whose Archivo width axis follows the pointer across the
 * viewport (88 → 108). Driven by a spring motion value — no React renders —
 * and quantised to half-steps so the browser reuses rasterised glyph instances.
 * Fine pointers only; static under reduced motion.
 */
export function KineticWord({ children, className }: { children: ReactNode; className?: string }) {
  const reduce = useReducedMotionPref();
  const target = useMotionValue(REST);
  const width = useSpring(target, { stiffness: 70, damping: 20, mass: 0.7 });
  const settings = useTransform(width, (w) => `"wdth" ${(Math.round(w * 2) / 2).toFixed(1)}`);

  useEffect(() => {
    if (reduce) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const onMove = (event: PointerEvent) => {
      target.set(MIN + (MAX - MIN) * (event.clientX / Math.max(1, window.innerWidth)));
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [reduce, target]);

  return (
    <motion.span className={className} style={{ fontVariationSettings: settings }}>
      {children}
    </motion.span>
  );
}
