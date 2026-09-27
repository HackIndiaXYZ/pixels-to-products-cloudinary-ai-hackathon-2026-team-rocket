'use client';

import { motion, useMotionValue, useScroll, useSpring, useTransform } from 'framer-motion';
import { useLayoutEffect, useRef } from 'react';
import { easeOutCubic, type DeviceTier } from '@/components/motion/hooks';
import { ConsoleMock } from './ConsoleMock';
import { useNearViewport } from './hooks';
import { Intro, LaunchConsoleLink } from './Intro';

/** Height of the fixed site navigation; the product frame lives below it. */
const NAV_H = 60;
/** Scroll progress at which the frame has fully entered the viewport. */
const ENTER_END = 0.5;

/** Responds from the first pixel of scroll, lands softly at full bleed. */
const easeOutQuad = (t: number) => 1 - (1 - t) * (1 - t);
/** Gentle start and landing, for the frame's travel. */
const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * Desktop choreography: a 260vh track with a sticky stage.
 *
 *   0.00 → 0.50  the framed, tilted console rises from under the headline,
 *                flattens, scales to 1 and loses its frame (radius, border,
 *                shadow) until it fills the viewport below the nav;
 *   0.04 → 0.40  inside it, the lead incident draws in, the queue slides in and
 *                the key numbers count;
 *   0.64 → 0.80  the view dims and "Launch console" appears;
 *   0.80 → 1.00  stillness, then the section scrolls away.
 *
 * Every per-frame value is a motion value (transform, opacity, the frame's
 * clip-path, the counters' text); scrolling never re-renders React.
 *
 * The track, sticky stage and headline mount with the page, so the section's
 * height never changes under an in-page scroll; the frame and the console
 * miniature inside it mount (as a transition) only once the section comes
 * within ~1.5 viewports.
 *
 * Only the miniature's own parts carry view-transition names (see ConsoleMock).
 * The scrim and the call to action are siblings of the frame, so the morph into
 * the console starts from the clean, undimmed preview.
 */
export function PinnedReveal({ tier }: { tier: DeviceTier }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const introRef = useRef<HTMLDivElement>(null);
  const near = useNearViewport(trackRef);

  const { scrollYProgress } = useScroll({ target: trackRef, offset: ['start start', 'end end'] });
  // Wheel steps become continuous motion on capable machines; lower tiers track scroll directly.
  const smoothed = useSpring(scrollYProgress, { stiffness: 260, damping: 38, mass: 0.35, restDelta: 0.0005 });
  const p = tier === 'high' ? smoothed : scrollYProgress;

  // Frame entrance: it widens and stands up first (ease-out) and rises later
  // (ease-in-out), so it never slides over a headline that is still readable.
  const enter = useTransform(p, [0, ENTER_END], [0, 1], { ease: easeOutQuad });
  const rise = useTransform(p, [0, ENTER_END], [0, 1], { ease: smoothstep });
  const restOffset = useMotionValue(0);
  const rigY = useTransform([rise, restOffset], ([r, offset]: number[]) => (1 - r) * offset);
  const scale = useTransform(enter, [0, 1], [0.8, 1]);
  const rotateX = useTransform(enter, [0, 1], [tier === 'high' ? 10 : 0, 0]);
  const radius = useTransform(enter, [0.5, 1], [15, 0]);
  const clipPath = useTransform(radius, (r) => `inset(0px round ${r}px)`);
  const chrome = useTransform(enter, [0.45, 1], [1, 0]);
  // Promote the frame only while it moves, so it re-rasterises crisply at rest.
  const willChange = useTransform(p, (v) => (v > 0.002 && v < ENTER_END ? 'transform' : 'auto'));

  // Headline yields to the rising frame.
  const introY = useTransform(p, [0, 0.24], [0, -80]);
  const introOpacity = useTransform(p, [0.02, 0.15], [1, 0]);

  // Arrival.
  const scrim = useTransform(p, [0.64, 0.78], [0, 0.8]);
  const ctaOpacity = useTransform(p, [0.68, 0.8], [0, 1]);
  const ctaY = useTransform(p, [0.68, 0.8], [18, 0], { ease: easeOutCubic });
  const ctaPointer = useTransform(p, (v) => (v > 0.7 ? 'auto' : 'none'));

  // Where the frame rests before the scroll: just under the headline, but always
  // leaving at least ~45% of the stage for the product. Measured before paint,
  // so a page restored mid-section never shows the frame in the wrong place.
  // (This component only renders on the client — see ProductReveal.)
  useLayoutEffect(() => {
    const intro = introRef.current;
    if (!intro) return;
    const measure = () => {
      const vh = window.innerHeight;
      const gap = Math.min(48, Math.max(24, vh * 0.04));
      const below = intro.offsetTop + intro.offsetHeight + gap - NAV_H;
      restOffset.set(Math.max(0, Math.min(below, (vh - NAV_H) * 0.55)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(intro);
    window.addEventListener('resize', measure, { passive: true });
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [restOffset]);

  return (
    <div ref={trackRef} className="relative h-[260vh]">
      <div className="sticky top-0 h-screen overflow-clip">
        <div aria-hidden className="survey-grid fade-mask-b pointer-events-none absolute inset-0 opacity-40" />

        <motion.div
          ref={introRef}
          style={{ y: introY, opacity: introOpacity }}
          className="relative mx-auto max-w-[1440px] px-8 pt-[calc(60px+clamp(28px,7vh,80px))]"
        >
          <Intro pinned wide />
        </motion.div>

        {/* The rig carries the frame's perspective, scale and travel. */}
        {near && (
          <motion.div
            className="absolute inset-x-0 bottom-0 top-[60px]"
            style={{ y: rigY, scale, rotateX, transformPerspective: 1600, originX: 0.5, originY: 0, willChange }}
          >
            <motion.div
              aria-hidden
              className="absolute inset-0 rounded-[15px] shadow-[0_48px_120px_-56px_rgba(0,0,0,0.8)]"
              style={{ opacity: chrome }}
            />
            <motion.div className="@container absolute inset-0 overflow-hidden bg-canvas" style={{ clipPath }}>
              <ConsoleMock progress={p} />
              <motion.div
                aria-hidden
                className="pointer-events-none absolute inset-0 border border-line-strong"
                style={{ opacity: chrome, borderRadius: radius }}
              />
            </motion.div>

            {/* Arrival — outside the named parts, so neither the dim nor the card enters the morph. */}
            <motion.div aria-hidden className="pointer-events-none absolute inset-0 bg-canvas" style={{ opacity: scrim }} />
            {/* Keyboard users can reach the way in at any point; focusing it reveals it. */}
            <motion.div
              className="pointer-events-none absolute inset-0 flex items-center justify-center focus-within:opacity-100!"
              style={{ opacity: ctaOpacity }}
            >
              <motion.div
                style={{ y: ctaY, pointerEvents: ctaPointer }}
                className="flex flex-col items-center gap-5 rounded-[10px] border border-line-strong bg-canvas px-10 py-8 text-center shadow-[0_24px_64px_-32px_rgba(0,0,0,0.85)]"
              >
                <span className="label">Preview · same dataset as the console</span>
                <LaunchConsoleLink />
              </motion.div>
            </motion.div>
          </motion.div>
        )}
      </div>
    </div>
  );
}
