'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import Link from 'next/link';
import { ArrowDown, ArrowRight, ArrowUpRight } from 'lucide-react';
import { useRef, type CSSProperties } from 'react';
import { clamp, useReducedMotionPref } from '@/components/motion/hooks';
import { cn } from '@/components/ui/cn';
import { DataField } from './gl/DataField';
import { FIELD_ATLAS, FIELD_ATLAS_SOURCES } from './gl/field-atlas';
import { BrandBand } from './hero/BrandBand';
import { DeliveryProof } from './hero/DeliveryProof';
import { InspectionViewport } from './hero/InspectionViewport';
import { KineticWord } from './hero/KineticWord';
import styles from './hero/hero.module.css';

/** Entrance delay for the CSS choreography (see hero.module.css). */
const at = (ms: number) => ({ '--d': `${ms}ms` }) as CSSProperties;

/* Legibility scrims: the field stays visible, the type always wins. Static layers. */
const SCRIM_WIDE =
  'linear-gradient(90deg, color-mix(in oklab, var(--color-canvas) 78%, transparent) 0%, color-mix(in oklab, var(--color-canvas) 58%, transparent) 34%, transparent 58%), linear-gradient(to top, var(--color-canvas) 0%, transparent 26%)';
const SCRIM_NARROW =
  'linear-gradient(to bottom, color-mix(in oklab, var(--color-canvas) 62%, transparent) 0%, color-mix(in oklab, var(--color-canvas) 45%, transparent) 48%, transparent 70%), linear-gradient(to top, var(--color-canvas) 0%, transparent 18%)';

/**
 * Landing hero — "you entered the VisualOps system".
 *
 * Reveal order follows the hierarchy: headline → message and actions → the
 * product (a live Cloudinary inspection frame) → the VISUALOPS brand band that
 * the whole composition stands on → its technical telemetry. Behind it all, a
 * WebGL field built from the same Cloudinary media settles from scatter into
 * order as the page moves on.
 */
export function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const reduce = useReducedMotionPref();
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ['start start', 'end start'] });

  // Scroll exit: transform/opacity only, bound to motion values (no React renders).
  const copyY = useTransform(scrollYProgress, (v) => (reduce ? 0 : v * -72));
  const copyOpacity = useTransform(scrollYProgress, (v) => (reduce ? 1 : 1 - clamp((v - 0.12) / 0.5) * 0.8));
  const stageY = useTransform(scrollYProgress, (v) => (reduce ? 0 : v * -36));
  const stageScale = useTransform(scrollYProgress, (v) => (reduce ? 1 : 1 - v * 0.04));
  const fieldY = useTransform(scrollYProgress, (v) => `${(reduce ? 0 : v * 38).toFixed(2)}%`);

  return (
    <section
      ref={sectionRef}
      aria-labelledby="hero-title"
      className="relative isolate flex min-h-[100svh] flex-col overflow-hidden border-b border-line bg-canvas pt-[60px]"
    >
      {/* Environment */}
      <motion.div aria-hidden className="pointer-events-none absolute inset-0 -z-20" style={{ y: fieldY }}>
        <DataField progress={scrollYProgress} />
      </motion.div>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 hidden lg:block" style={{ background: SCRIM_WIDE }} />
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 lg:hidden" style={{ background: SCRIM_NARROW }} />

      <div className="relative mx-auto grid w-full max-w-[1440px] flex-1 content-center items-center gap-x-14 gap-y-12 px-4 pb-8 pt-9 sm:px-8 sm:pt-12 lg:grid-cols-[minmax(0,1.06fr)_minmax(0,1fr)] lg:pb-6 xl:gap-x-20">
        {/* 1 Brand · 2 Message */}
        <motion.div className="relative" style={{ y: copyY, opacity: copyOpacity }}>
          <p className={cn('label flex items-center gap-2.5', styles.fade)} style={at(40)}>
            <span aria-hidden className="h-[5px] w-[5px] shrink-0 bg-signal" />
            <span>
              Field media <span aria-hidden>→</span>
              <span className="sr-only">to</span> evidence, on Cloudinary
            </span>
          </p>

          <h1
            id="hero-title"
            className="type-display mt-6 text-[clamp(48px,7.1vw,104px)] text-ink max-[369px]:text-[12.6vw] sm:mt-8"
          >
            <span className="sr-only">Turn visual data into operational intelligence.</span>
            <span aria-hidden className="block">
              <span className={styles.mask}>
                <span className={cn(styles.rise, 'whitespace-nowrap')} style={at(120)}>
                  Turn visual data
                </span>
              </span>
              <span className={styles.mask}>
                <span className={cn(styles.rise, 'whitespace-nowrap')} style={at(210)}>
                  into operational
                </span>
              </span>
              <span className={styles.mask}>
                <span className={cn(styles.rise, 'whitespace-nowrap')} style={at(300)}>
                  <KineticWord>intelligence</KineticWord>
                  <span className="text-signal">.</span>
                </span>
              </span>
            </span>
          </h1>

          <p
            className={cn('mt-7 max-w-[34rem] text-[16px] leading-[1.6] text-ink-2 sm:mt-8 sm:text-[17px]', styles.settle)}
            style={at(210)}
          >
            Scattered field photos, drone footage and CCTV become searchable, structured operational evidence. Every frame is
            processed end to end by Cloudinary.
          </p>

          <div className={cn('mt-8 flex flex-wrap items-center gap-1.5 sm:mt-9 sm:gap-3', styles.fadeUp)} style={at(760)}>
            <Link href="/console" data-cursor="OPEN" className="group btn btn-primary btn-lg">
              Launch console
              <ArrowRight aria-hidden className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <a href="#platform" className="btn btn-ghost btn-lg max-sm:px-3.5">
              See how it works
              <ArrowDown aria-hidden className="h-4 w-4" />
            </a>
          </div>
        </motion.div>

        {/* 3 Product · 4 Technical detail */}
        <motion.div className="relative" style={{ y: stageY, scale: stageScale }}>
          <div className={styles.frameIn} style={at(420)}>
            <InspectionViewport />
          </div>
        </motion.div>
      </div>

      {/* Brand band: stands on the proof rail, behind the copy and the frame. */}
      <div className="relative -z-[5] mx-auto w-full max-w-[1440px] px-4 sm:px-8">
        <BrandBand progress={scrollYProgress} areaRef={sectionRef} />
      </div>

      {/* Proof rail */}
      <div className={cn('relative border-t border-line', styles.fade)} style={at(1000)}>
        <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-2 px-4 py-4 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:gap-10">
          <DeliveryProof />
          <a
            href={FIELD_ATLAS.url}
            target="_blank"
            rel="noreferrer"
            data-cursor="VIEW"
            className="group hidden shrink-0 items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3 transition-colors hover:text-ink-2 lg:inline-flex"
          >
            Field texture · {FIELD_ATLAS_SOURCES} images composited by Cloudinary in one request
            <ArrowUpRight aria-hidden className="h-3 w-3 transition-transform duration-200 group-hover:-translate-y-px group-hover:translate-x-px" />
          </a>
        </div>
      </div>
    </section>
  );
}
