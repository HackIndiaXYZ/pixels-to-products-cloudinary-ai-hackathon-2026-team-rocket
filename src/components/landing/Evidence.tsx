'use client';

import { motion, useScroll, useTransform } from 'framer-motion';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useRef } from 'react';
import { RevealText } from '@/components/motion/RevealText';
import { useDeviceTier, useReducedMotionPref } from '@/components/motion/hooks';
import { IntegrityTable } from './editorial/IntegrityTable';
import { ReportPaper } from './editorial/ReportPaper';
import { EASE_EDITORIAL } from './editorial/hooks';

/**
 * Evidence — opens on the artefact itself: a report page rendered as paper at
 * large scale, with the headline set across its top edge. Beside it, the
 * integrity principle as a specification table. The sheet drifts slightly
 * against the headline with scroll (transform only, desktop tier); everything
 * is static under reduced motion and on touch devices.
 *
 * The sheet carries a blank top margin (`sheetClassName`) deeper than the
 * headline overlap plus the drift, so the headline never touches its content.
 */
export function Evidence() {
  const paperRef = useRef<HTMLDivElement>(null);
  const tier = useDeviceTier();
  const reduce = useReducedMotionPref();
  const { scrollYProgress } = useScroll({ target: paperRef, offset: ['start end', 'end start'] });
  const drift = tier === 'high' && !reduce;
  const paperY = useTransform(scrollYProgress, [0, 1], drift ? [32, -32] : [0, 0]);

  return (
    <section id="evidence" aria-label="Evidence integrity" className="theme-light relative scroll-mt-[60px] overflow-hidden">
      <div className="mx-auto max-w-[1440px] px-5 pb-24 pt-24 sm:px-8 sm:pb-32 sm:pt-32 lg:pb-40 lg:pt-36">
        <div className="flex items-baseline justify-between gap-6 border-t border-ink pt-4">
          <p className="label whitespace-nowrap text-ink">Evidence integrity</p>
          <p className="label hidden text-right sm:block">Three classes · one reaches a report</p>
        </div>

        <RevealText
          as="h2"
          lines={['Evidence you can', 'hand to anyone.']}
          className="type-display relative z-10 mt-10 text-[42px] text-ink min-[400px]:text-[46px] sm:mt-14 sm:text-[72px] md:text-[88px] lg:text-[94px] xl:text-[118px] 2xl:text-[134px]"
        />

        <div className="grid gap-y-14 sm:gap-y-16 lg:grid-cols-12 lg:gap-x-8">
          {/* The report sheet leads; pulled up under the headline so its last line sits across the sheet's top edge. */}
          <div
            ref={paperRef}
            className="relative -mt-6 min-w-0 sm:-mt-9 md:-mt-11 lg:col-span-6 lg:-mt-12 xl:-mt-[60px] 2xl:-mt-[68px]"
          >
            <motion.div style={{ y: paperY }}>
              <ReportPaper sheetClassName="pt-14 sm:pt-20 md:pt-24 lg:pt-28 xl:pt-32" />
            </motion.div>
          </div>

          <div className="min-w-0 lg:col-span-5 lg:col-start-8 lg:pt-16 xl:pt-[68px]">
            <motion.p
              className="max-w-[44ch] text-pretty text-[16px] leading-[1.6] text-ink-2 sm:text-[17px]"
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '0px 0px -10% 0px' }}
              transition={{ duration: 0.6, delay: 0.1, ease: EASE_EDITORIAL }}
            >
              Every transformation VisualOps runs through Cloudinary is classed by what it does to the pixels. Reports carry only the
              first class — corrected, redacted and stamped, with nothing generated — so what you send still shows what was captured.
            </motion.p>

            <IntegrityTable stacked className="mt-12 min-w-0" />

            <div className="mt-10 grid gap-6 border-t border-line pt-6">
              <p className="max-w-[58ch] text-[13px] leading-[1.65] text-ink-3">
                Findings on this page are sample annotations written by the VisualOps team. The evidence frame — exposure correction,
                pixelation of the faces Cloudinary detects, and the audit stamp — is rendered live by Cloudinary; the fingerprint is
                computed in your browser over this sample report payload, built by the same code the console uses for its exports.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Link href="/console#reports" className="group btn btn-primary btn-lg" data-cursor="OPEN">
                  Build a report <ArrowRight aria-hidden className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
                <Link href="/console#studio" className="btn btn-ghost btn-lg" data-cursor="OPEN">
                  Open the studio
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
