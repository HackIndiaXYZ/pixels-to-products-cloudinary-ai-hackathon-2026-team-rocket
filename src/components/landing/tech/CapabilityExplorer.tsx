'use client';

import { motion } from 'framer-motion';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { INTEGRITY_LABEL, type Integrity } from '@/lib/cloudinary/pipeline';
import { useInViewport, useReducedMotionPref } from '@/components/motion/hooks';
import { cn } from '@/components/ui/cn';
import { CAPABILITIES, type Capability } from './capabilities';
import { CapabilityPreview } from './CapabilityPreview';
import { useMediaQuery, useSeen } from './hooks';

const INTEGRITY_TONE: Record<Integrity, string> = {
  evidence: 'text-ink-3',
  'ai-edit': 'text-medium',
  generative: 'text-high',
};

function RowBody({ cap, index, active }: { cap: Capability; index: number; active: boolean }) {
  return (
    <>
      <span
        aria-hidden
        style={{ transform: `scaleY(${active ? 1 : 0})` }}
        className="absolute inset-y-0 left-0 w-[2px] origin-top bg-signal transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)]"
      />
      <span className={cn('num pt-[3px] font-mono text-[11px] transition-colors duration-200', active ? 'text-signal' : 'text-ink-3')}>
        {String(index + 1).padStart(2, '0')}
      </span>
      <span className="min-w-0">
        <span
          className={cn(
            'type-heading block truncate text-[18px] transition-colors duration-200 sm:text-[19px]',
            active ? 'text-ink' : 'text-ink-2 group-hover:text-ink',
          )}
        >
          {cap.title}
        </span>
        <span className={cn('mt-1 block truncate font-mono text-[11.5px] transition-colors duration-200', active ? 'text-ink-2' : 'text-ink-3')}>
          {cap.code}
        </span>
      </span>
      <span className={cn('pt-[4px] font-mono text-[10.5px] uppercase tracking-[0.08em]', INTEGRITY_TONE[cap.integrity])}>
        {INTEGRITY_LABEL[cap.integrity]}
      </span>
    </>
  );
}

const ROW =
  'group relative grid w-full grid-cols-[2.25rem_minmax(0,1fr)_auto] items-start gap-x-2 border-t border-line py-4 pl-4 pr-3 text-left outline-offset-[-2px] transition-colors duration-200';

/**
 * Editorial capability explorer. Desktop: a vertical tab list with one large
 * preview; hovering (with a short intent delay), focusing or clicking selects.
 * Mobile: an accordion with the preview inline. Only the selected capability's
 * media is ever requested.
 */
export function CapabilityExplorer() {
  const rootRef = useRef<HTMLDivElement>(null);
  const seen = useSeen(rootRef, '320px 0px');
  const onScreen = useInViewport(rootRef);
  const desktop = useMediaQuery('(min-width: 1024px)', true);
  const reduce = useReducedMotionPref();
  const [selected, setSelected] = useState<number | null>(0);
  const hoverTimer = useRef<number | undefined>(undefined);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const rowRefs = useRef<Array<HTMLDivElement | null>>([]);
  const lastTapped = useRef<number | null>(null);

  useEffect(() => () => window.clearTimeout(hoverTimer.current), []);

  // Mobile: after an accordion swap, keep the tapped row in view.
  useEffect(() => {
    if (desktop || lastTapped.current === null) return;
    const row = rowRefs.current[lastTapped.current];
    lastTapped.current = null;
    if (!row) return;
    const top = row.getBoundingClientRect().top;
    if (top < 64 || top > window.innerHeight * 0.6) {
      row.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
    }
  }, [selected, desktop, reduce]);

  const active = desktop ? (selected ?? 0) : selected;
  const current = CAPABILITIES[active ?? 0];

  const select = (i: number) => {
    window.clearTimeout(hoverTimer.current);
    setSelected(i);
  };

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const last = CAPABILITIES.length - 1;
    const next =
      e.key === 'ArrowDown' ? (i === last ? 0 : i + 1) : e.key === 'ArrowUp' ? (i === 0 ? last : i - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? last : null;
    if (next === null) return;
    e.preventDefault();
    select(next);
    tabRefs.current[next]?.focus();
  };

  return (
    <div ref={rootRef} className="grid gap-10 lg:grid-cols-12 lg:gap-6">
      <div className="lg:col-span-4">
        {desktop ? (
          <div role="tablist" aria-orientation="vertical" aria-label="Cloudinary capabilities" className="border-b border-line">
            {CAPABILITIES.map((cap, i) => {
              const on = active === i;
              return (
                <button
                  key={cap.id}
                  ref={(el) => {
                    tabRefs.current[i] = el;
                  }}
                  type="button"
                  role="tab"
                  id={`capability-tab-${cap.id}`}
                  aria-selected={on}
                  aria-controls="capability-panel"
                  tabIndex={on ? 0 : -1}
                  onClick={() => select(i)}
                  onFocus={() => select(i)}
                  onKeyDown={(e) => onTabKey(e, i)}
                  onPointerEnter={(e) => {
                    if (e.pointerType !== 'mouse' || on) return;
                    window.clearTimeout(hoverTimer.current);
                    hoverTimer.current = window.setTimeout(() => setSelected(i), 140);
                  }}
                  onPointerLeave={() => window.clearTimeout(hoverTimer.current)}
                  className={cn(ROW, on ? 'bg-surface' : 'hover:bg-surface/50')}
                >
                  <RowBody cap={cap} index={i} active={on} />
                </button>
              );
            })}
          </div>
        ) : (
          <div className="border-b border-line">
            {CAPABILITIES.map((cap, i) => {
              const on = active === i;
              return (
                <div
                  key={cap.id}
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  className="scroll-mt-20"
                >
                  <button
                    type="button"
                    aria-expanded={on}
                    aria-controls={`capability-panel-${cap.id}`}
                    onClick={() => {
                      lastTapped.current = i;
                      setSelected(on ? null : i);
                    }}
                    className={cn(ROW, on && 'bg-surface')}
                  >
                    <RowBody cap={cap} index={i} active={on} />
                  </button>
                  {on && (
                    <motion.div
                      id={`capability-panel-${cap.id}`}
                      role="region"
                      aria-label={cap.title}
                      initial={reduce ? false : { opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                      className="pb-8 pt-2"
                    >
                      <CapabilityPreview cap={cap} enabled={seen} playing={onScreen} />
                    </motion.div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-6 hidden lg:block">
          <p className="max-w-[34ch] text-[13px] leading-relaxed text-ink-3">
            Chain any of these — with crops, redaction and audit stamps — in the Pipeline Studio. The URL you build is the URL you ship.
          </p>
          <Link href="/console#studio" className="link-underline mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink">
            Open Pipeline Studio <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      </div>

      {desktop && (
        <div
          role="tabpanel"
          id="capability-panel"
          aria-labelledby={`capability-tab-${current.id}`}
          className="lg:col-span-8"
        >
          <CapabilityPreview cap={current} enabled={seen} playing={onScreen} />
        </div>
      )}

      <div className="lg:hidden">
        <Link href="/console#studio" className="link-underline inline-flex items-center gap-1.5 text-[13px] font-medium text-ink">
          Chain them in Pipeline Studio <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  );
}
