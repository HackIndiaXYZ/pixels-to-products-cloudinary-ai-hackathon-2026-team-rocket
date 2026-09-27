'use client';

import { useEffect, useRef } from 'react';

/** Below this size a control is a precise target: the native pointer serves it better than a ring. */
const MIN_TARGET = 40;

/** The nearest element a click on `node` would operate. */
const CONTROL =
  'a[href], button, input, textarea, select, label, summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="slider"], [role="radio"], [role="checkbox"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"]';
const TEXT_ENTRY = 'input, textarea, select, [contenteditable]:not([contenteditable="false"])';

/**
 * Contextual cursor for desktop. It only appears over elements that declare an
 * intent with `data-cursor="VIEW" | "DRAG" | "COMPARE" | "OPEN" | "SEARCH"`,
 * replacing the system cursor there. Everywhere else the native cursor stays,
 * and it also stays over text entry and over controls smaller than 40px, where
 * a ring would hide the very thing being pointed at.
 *
 * The ring is transparent and centred on the hotspot (marked by a small dot), and
 * its label sits outside the ring, so the content under the pointer stays legible.
 *
 * Cost: one fixed element, transform-only updates, at most one style write per
 * frame and only while the ring is shown. Disabled on touch/coarse pointers and
 * under prefers-reduced-motion.
 */
export function ContextCursor() {
  const ref = useRef<HTMLDivElement>(null);
  const labelRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (!fine.matches || reduce.matches) return;
    const el = ref.current;
    const label = labelRef.current;
    if (!el || !label) return;

    const root = document.documentElement;
    root.classList.add('has-context-cursor');
    let x = -100;
    let y = -100;
    let visible = false;
    let flipped = false;
    let raf = 0;
    /** The control currently handed back to the native cursor. */
    let native: Element | null = null;

    const write = () => {
      raf = 0;
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      // Keep the label inside the viewport near the right edge.
      const flip = x > window.innerWidth - 150;
      if (flip !== flipped) {
        flipped = flip;
        el.dataset.flip = flip ? 'true' : 'false';
      }
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(write);
    };

    const setNative = (next: Element | null) => {
      if (next === native) return;
      native?.removeAttribute('data-cursor-native');
      native = next;
      native?.setAttribute('data-cursor-native', '');
    };

    const show = (intent: string) => {
      if (label.textContent !== intent) label.textContent = intent;
      if (!visible) {
        visible = true;
        el.dataset.on = 'true';
      }
    };
    const hide = () => {
      if (!visible) return;
      visible = false;
      el.dataset.on = 'false';
    };

    /** Resolves what the pointer is over: an intent to show, or null for the native pointer. */
    const resolve = (node: Element): string | null => {
      const region = node.closest('[data-cursor]');
      const intent = region?.getAttribute('data-cursor');
      if (!region || !intent) {
        setNative(null);
        return null;
      }
      // Text entry keeps its I-beam (the CSS guard restores it).
      if (node.closest(TEXT_ENTRY)) {
        setNative(null);
        return null;
      }
      // The control the pointer would operate: a nested control inside the region,
      // or the region itself. Small ones get the native pointer back.
      const nested = node.closest(CONTROL);
      const control = nested && region.contains(nested) ? nested : region;
      const box = control.getBoundingClientRect();
      if (box.width < MIN_TARGET || box.height < MIN_TARGET) {
        setNative(control);
        return null;
      }
      setNative(null);
      return intent;
    };

    const onMove = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      if (visible) schedule();
    };
    const onOver = (e: PointerEvent) => {
      if (e.pointerType && e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      const target = e.target instanceof Element ? e.target : null;
      const intent = target ? resolve(target) : null;
      if (intent) {
        x = e.clientX;
        y = e.clientY;
        write();
        show(intent);
      } else {
        hide();
      }
    };
    const onLeave = () => {
      hide();
      setNative(null);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerover', onOver, { passive: true });
    root.addEventListener('pointerleave', onLeave);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerover', onOver);
      root.removeEventListener('pointerleave', onLeave);
      setNative(null);
      root.classList.remove('has-context-cursor');
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden
      data-on="false"
      className="group pointer-events-none fixed left-0 top-0 z-[200] hidden [@media(hover:hover)_and_(pointer:fine)]:block"
      style={{ transform: 'translate3d(-100px,-100px,0)' }}
    >
      {/* Transparent ring centred on the hotspot; a hairline dark edge keeps it visible on paper and bright media. */}
      <span className="absolute -left-6 -top-6 h-12 w-12 scale-50 rounded-full border-[1.5px] border-signal opacity-0 shadow-[0_0_0_1px_rgba(3,19,28,0.28)] transition-[opacity,scale] duration-200 ease-snappy group-data-[on=true]:scale-100 group-data-[on=true]:opacity-100" />
      <span className="absolute -left-[2px] -top-[2px] h-1 w-1 rounded-full bg-signal opacity-0 shadow-[0_0_0_1px_rgba(3,19,28,0.35)] transition-opacity duration-150 group-data-[on=true]:opacity-100" />
      {/* Label outside the ring (lower right, or lower left near the edge), never over the pointed-at content. */}
      <span
        ref={labelRef}
        className="absolute left-[30px] top-[14px] whitespace-nowrap rounded-[4px] border border-signal/40 bg-canvas/90 px-1.5 py-[2px] font-mono text-[10.5px] font-semibold leading-none tracking-[0.12em] text-signal opacity-0 transition-opacity duration-150 group-data-[flip=true]:left-auto group-data-[flip=true]:right-[30px] group-data-[on=true]:opacity-100"
      />
    </div>
  );
}
