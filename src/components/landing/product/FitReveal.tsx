'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useRef } from 'react';
import { useInViewport } from '@/components/motion/hooks';
import { ConsoleMock } from './ConsoleMock';
import { useFitScale } from './hooks';
import { Intro, LaunchConsoleLink } from './Intro';

/**
 * The width the miniature is laid out at before it is scaled to its card:
 * portrait cards (phones) get the console's phone layout at up to 520px,
 * landscape cards up to a 1000px laptop layout (the console's `lg`, with its
 * sidebar). Never scaled below ~0.69, so type stays legible, and never scaled up.
 */
const layoutWidth = (width: number, portrait: boolean) =>
  Math.max(width, Math.min(portrait ? 520 : 1000, Math.round(width * 1.45)));

/**
 * Phones, small windows and reduced motion: no pinning. The console miniature
 * is scaled to fit its column, appears once, and the way in sits right below.
 */
export function FitReveal({ wide }: { wide: boolean }) {
  const outerRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  useFitScale(outerRef, innerRef, layoutWidth);
  // Only a preview on screen morphs into the console; one scrolled away would fly in from off screen.
  const onScreen = useInViewport(outerRef);

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-20 sm:px-8 sm:py-28">
      <Intro pinned={false} wide={wide} />

      {/* The whole preview is a way in for pointer users; keyboard users get the button below. */}
      <Link href="/console" tabIndex={-1} aria-hidden data-cursor="OPEN" className="mt-10 block sm:mt-14">
        <motion.div
          ref={outerRef}
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '0px 0px -12% 0px' }}
          transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          className="relative aspect-[4/5] w-full overflow-hidden rounded-[10px] border border-line-strong bg-canvas sm:aspect-[3/2]"
        >
          {/* Sized and scaled by useFitScale; the inline size is the pre-hydration layout. */}
          <div ref={innerRef} className="@container absolute left-0 top-0 origin-top-left" style={{ width: 1000, height: 667 }}>
            <ConsoleMock morph={onScreen} />
          </div>
        </motion.div>
      </Link>

      <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
        <LaunchConsoleLink />
      </div>
    </div>
  );
}
