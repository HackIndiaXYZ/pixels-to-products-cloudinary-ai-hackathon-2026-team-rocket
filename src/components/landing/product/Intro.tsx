'use client';

import Link from 'next/link';
import { ArrowDown, ArrowRight } from 'lucide-react';
import { RevealText } from '@/components/motion/RevealText';
import { cn } from '@/components/ui/cn';

const SUBHEAD =
  'Findings ranked by risk, grouped by site, and each one tied to the Cloudinary rendition that shows it.';

/**
 * Section opener: headline with a narrow subhead column beside it on large
 * screens, stacked below. Wide viewports get two designed lines, phones three.
 * `pinned` adds the scroll cue used by the desktop stage.
 */
export function Intro({ pinned, wide }: { pinned: boolean; wide: boolean }) {
  const twoLines = pinned || wide;
  return (
    <div className="grid gap-x-8 gap-y-6 lg:grid-cols-12 xl:gap-x-10">
      <div className="lg:col-span-8 xl:col-span-9">
        <div className="label flex items-center gap-3">
          <span aria-hidden className="h-px w-8 bg-signal" />
          Command Center
        </div>
        <RevealText
          lines={twoLines ? ['One console for everything', 'your cameras see.'] : ['One console for', 'everything your', 'cameras see.']}
          className={cn(
            'type-display mt-5 text-ink',
            twoLines ? 'text-[clamp(36px,4.4vw,68px)]' : 'text-[clamp(36px,8.4vw,68px)]',
          )}
        />
      </div>
      <div className="flex flex-col justify-end gap-5 lg:col-span-4 lg:pb-1.5 xl:col-span-3">
        <p className="max-w-[40ch] text-[15px] leading-relaxed text-ink-2">{SUBHEAD}</p>
        {pinned && (
          <span className="label hidden items-center gap-2 lg:flex">
            <ArrowDown className="h-3 w-3" aria-hidden />
            Scroll to enter
          </span>
        )}
      </div>
    </div>
  );
}

/** The way into the console. Same label as every other link to /console. */
export function LaunchConsoleLink({ className }: { className?: string }) {
  return (
    <Link href="/console" className={cn('btn btn-primary btn-lg', className)} data-cursor="OPEN">
      Launch console
      <ArrowRight className="h-4 w-4" aria-hidden />
    </Link>
  );
}
