import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { RevealText } from '@/components/motion/RevealText';
import { LANDING_ASSETS } from './landing-data';
import { DriftStrip } from './tech/DriftStrip';
import { SearchableLine } from './tech/SearchableLine';

const FIELD_CAPTURES = LANDING_ASSETS.filter((a) => a.collection === 'field').length;

/**
 * The ending: a large negative-space statement, two ways forward, and — very
 * dim, behind it — the field captures the whole page has been about.
 */
export function FinalCta() {
  return (
    <section id="cta" aria-label="Get started" className="relative isolate overflow-hidden border-t border-line bg-canvas">
      <DriftStrip className="top-[38%] -z-10 sm:top-[40%]" />

      <div className="mx-auto max-w-[1320px] px-4 pb-24 pt-32 sm:px-6 lg:pb-36 lg:pt-48">
        <p className="label">Start with the media you already have</p>

        <RevealText
          as="h2"
          lines={['Your field media', 'already contains', 'the answers.']}
          className="type-display mt-8 max-w-[14ch] text-[clamp(48px,8.8vw,144px)] text-ink"
          stagger={0.09}
        />
        <SearchableLine delay={0.34} className="type-display mt-7 text-[clamp(28px,4.2vw,64px)] text-ink-3" />

        <div className="mt-14 flex flex-wrap items-center gap-3 lg:mt-20">
          {/* Primary action first, as in the hero and the Evidence section. */}
          <Link href="/console" data-cursor="OPEN" className="group btn btn-primary btn-lg">
            Open Command Center
            <ArrowRight aria-hidden className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
          <Link href="/#platform" className="btn btn-secondary btn-lg">
            Explore VisualOps
          </Link>
        </div>

        <p className="mt-8 font-mono text-[11px] leading-relaxed text-ink-3">
          Runs on Cloudinary · <span className="num">{FIELD_CAPTURES}</span> sample field captures · no account needed
        </p>
      </div>
    </section>
  );
}
