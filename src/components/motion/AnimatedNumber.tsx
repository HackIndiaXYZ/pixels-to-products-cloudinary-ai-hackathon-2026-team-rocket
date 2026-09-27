'use client';

import { useEffect, useRef } from 'react';
import { useReducedMotionPref } from './hooks';

/**
 * Counts to `value` when it first scrolls into view (and between later values),
 * writing text directly to the DOM — no React render per frame.
 *
 * Assistive tech always reads the real value: the count-up is aria-hidden and a
 * visually hidden copy carries the final figure.
 */
export function AnimatedNumber({
  value,
  format = (n) => Math.round(n).toLocaleString('en-GB'),
  duration = 900,
  className,
}: {
  value: number;
  format?: (n: number) => string;
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(0);
  const started = useRef(false);
  const reduce = useReducedMotionPref();
  const formatRef = useRef(format);
  useEffect(() => {
    formatRef.current = format;
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const run = () => {
      const from = shown.current;
      const to = value;
      if (reduce || from === to) {
        shown.current = to;
        el.textContent = formatRef.current(to);
        return;
      }
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        shown.current = from + (to - from) * eased;
        el.textContent = formatRef.current(shown.current);
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    };
    if (started.current || reduce) {
      started.current = true;
      run();
      return () => cancelAnimationFrame(raf);
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          started.current = true;
          io.disconnect();
          run();
        }
      },
      { rootMargin: '0px 0px -10% 0px' },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, duration, reduce]);

  return (
    <span className={className}>
      <span className="sr-only">{format(value)}</span>
      <span ref={ref} aria-hidden>
        {format(0)}
      </span>
    </span>
  );
}
