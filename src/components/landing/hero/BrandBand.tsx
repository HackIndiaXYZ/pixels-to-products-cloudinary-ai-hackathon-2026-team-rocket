'use client';

import type { MotionValue } from 'framer-motion';
import { useEffect, useRef, type CSSProperties, type RefObject } from 'react';
import { clamp, useReducedMotionPref } from '@/components/motion/hooks';
import { cn } from '@/components/ui/cn';
import styles from './hero.module.css';

const LETTERS = [...'VISUALOPS'];

/* Pointer lens, as fractions of the band's width. */
const SIGMA = 0.14; // lens radius
const SWELL = 0.2; // extra width for the letter under the pointer
const PINCH = 0.05; // width given up by letters away from it
const PUSH = 0.018; // tracking opened on either side of the pointer
/* Scroll exit: tracking added at the ends of the word, as a fraction of its width. */
const EXIT_SPREAD = 0.04;
/* Springs (per second). Position is slightly under-damped, presence critically damped. */
const K_X = 90;
const D_X = 16;
const K_A = 36;
const D_A = 12;

/**
 * The VISUALOPS brand band: an oversized poster wordmark that sits on the hero's
 * baseline, behind the copy and the inspection frame, at low contrast so the
 * headline still leads.
 *
 * Kinetic, transform-only: each letter is its own span, and a pointer spring
 * drives a lens across the word — the letter under the pointer widens
 * (scaleX) and the tracking opens around it (translateX) — and as the hero
 * scrolls away the tracking spreads, from the moment the band is fully on
 * screen (at load on desktop, further down on phones). No font
 * variations are animated (on a word this large they would re-lay-out text
 * every frame), no React state changes per frame, and the loop runs only while
 * a spring is settling and the band is on screen. The entrance is CSS, so it
 * plays before hydration. Static under reduced motion.
 */
export function BrandBand({
  progress,
  areaRef,
  className,
}: {
  /** Hero scroll progress, 0 at rest → 1 once the hero has left the viewport. */
  progress: MotionValue<number>;
  /** Element whose pointer movement drives the lens (the hero section). */
  areaRef: RefObject<HTMLElement | null>;
  className?: string;
}) {
  const reduce = useReducedMotionPref();
  const rowRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const row = rowRef.current;
    const area = areaRef.current;
    if (reduce || !row || !area) return;
    const letters = Array.from(row.children) as HTMLElement[];

    const s = {
      x: 0.5,
      vx: 0,
      tx: 0.5,
      a: 0,
      va: 0,
      ta: 0,
      progress: progress.get(),
      /** Hero progress at which the whole band is on screen: the exit starts there. */
      enter: 0,
      raf: 0,
      last: 0,
      left: 0,
      width: 1,
      midY: 0,
      centres: letters.map(() => 0.5),
      inView: false,
    };

    const measure = () => {
      const rect = row.getBoundingClientRect();
      const hero = area.getBoundingClientRect();
      s.left = rect.left;
      s.width = Math.max(1, rect.width);
      s.midY = rect.top + window.scrollY + rect.height / 2;
      s.centres = letters.map((el) => (el.offsetLeft + el.offsetWidth / 2) / s.width);
      s.enter = clamp((rect.bottom - hero.top - window.innerHeight) / Math.max(1, hero.height), 0, 0.9);
    };

    // Last transform written per letter: unchanged letters cost no style write.
    const written = letters.map(() => '');
    const apply = () => {
      const { x, a, width, centres } = s;
      const exit = clamp((s.progress - s.enter) / (1 - s.enter));
      for (let i = 0; i < letters.length; i += 1) {
        const d = (centres[i] - x) / SIGMA;
        const g = Math.exp(-d * d);
        const scale = 1 + a * (SWELL * g - PINCH * (1 - g));
        const shift = a * PUSH * width * d * Math.exp(-0.5 * d * d) + exit * EXIT_SPREAD * width * (centres[i] - 0.5) * 2;
        const next =
          Math.abs(scale - 1) < 0.0005 && Math.abs(shift) < 0.05
            ? ''
            : `translate3d(${shift.toFixed(1)}px,0,0) scaleX(${scale.toFixed(3)})`;
        if (next !== written[i]) {
          written[i] = next;
          letters[i].style.transform = next;
        }
      }
    };

    const step = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.001, (now - s.last) / 1000));
      s.last = now;
      s.vx += ((s.tx - s.x) * K_X - s.vx * D_X) * dt;
      s.x += s.vx * dt;
      s.va += ((s.ta - s.a) * K_A - s.va * D_A) * dt;
      s.a += s.va * dt;
      const settled =
        Math.abs(s.tx - s.x) < 1e-4 && Math.abs(s.vx) < 1e-3 && Math.abs(s.ta - s.a) < 1e-4 && Math.abs(s.va) < 1e-3;
      if (settled) {
        s.x = s.tx;
        s.a = s.ta;
        s.vx = 0;
        s.va = 0;
        s.raf = 0;
        apply();
        return;
      }
      apply();
      s.raf = requestAnimationFrame(step);
    };
    const kick = () => {
      if (s.raf) return;
      s.last = performance.now();
      s.raf = requestAnimationFrame(step);
    };
    const halt = () => {
      cancelAnimationFrame(s.raf);
      s.raf = 0;
      s.a = s.ta = s.va = s.vx = 0;
      s.x = s.tx;
      apply();
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse' || !s.inView || document.visibilityState !== 'visible') return;
      s.tx = clamp((event.clientX - s.left) / s.width, -0.15, 1.15);
      // Always present while the pointer is in the hero; strongest near the band.
      const near = clamp(1 - Math.abs(event.pageY - s.midY) / (window.innerHeight * 0.75));
      s.ta = 0.45 + 0.55 * near;
      kick();
    };
    const onLeave = () => {
      s.ta = 0;
      if (s.inView) kick();
    };

    const unsubscribe = progress.on('change', (v) => {
      s.progress = v;
      if (!s.raf) apply();
    });

    const resize = new ResizeObserver(() => {
      measure();
      apply();
    });
    resize.observe(row);
    letters.forEach((el) => resize.observe(el));

    const io = new IntersectionObserver(([entry]) => {
      s.inView = entry.isIntersecting;
      if (!s.inView) halt();
      else measure();
    });
    io.observe(row);

    const onVisibility = () => {
      if (document.visibilityState !== 'visible') halt();
    };
    document.addEventListener('visibilitychange', onVisibility);
    area.addEventListener('pointermove', onMove, { passive: true });
    area.addEventListener('pointerleave', onLeave);
    measure();
    apply();

    return () => {
      cancelAnimationFrame(s.raf);
      unsubscribe();
      resize.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      area.removeEventListener('pointermove', onMove);
      area.removeEventListener('pointerleave', onLeave);
      letters.forEach((el) => {
        el.style.transform = '';
      });
    };
  }, [reduce, progress, areaRef]);

  return (
    <div aria-hidden className={cn(styles.band, className)}>
      <span className={cn('type-poster', styles.bandMask)}>
        <span ref={rowRef} className={styles.bandRow}>
          {LETTERS.map((letter, i) => (
            <span key={i} className={styles.bandLetter}>
              <span className={styles.bandGlyph} style={{ '--d': `${620 + i * 45}ms` } as CSSProperties}>
                {letter}
              </span>
            </span>
          ))}
        </span>
      </span>
    </div>
  );
}
