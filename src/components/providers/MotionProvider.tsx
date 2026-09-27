'use client';

import { MotionConfig } from 'framer-motion';
import type { ReactNode } from 'react';

/** Every framer-motion animation in the app honours `prefers-reduced-motion`. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}>
      {children}
    </MotionConfig>
  );
}
