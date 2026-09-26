'use client';

import { motion } from 'framer-motion';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Category, Severity } from '@/lib/types';
import { CATEGORIES, CATEGORY_LABEL, type MatrixCell } from '@/lib/analytics';
import { pluralize, titleCase } from '@/lib/format';
import { SEVERITY_COLOR, SeverityDot } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { useDeviceTier, useReducedMotionPref } from '@/components/motion/hooks';
import { EASE } from './model';

/** Severity rises to the right, so the hot corner of the matrix reads like any risk chart. */
const COLS: Severity[] = ['low', 'medium', 'high', 'critical'];
const COL_SHORT: Record<Severity, string> = { low: 'Low', medium: 'Med', high: 'High', critical: 'Crit' };
const ROWS = CATEGORIES;
const ROW_H = 40;
/** Diameter of the largest marker in px; smaller counts scale down by area. */
const DOT = 30;
/** The smallest marker still carries its count legibly. */
const MIN_SCALE = 17 / DOT;
/** Opacity of marker dots outside the category/severity filter; their counts switch to light ink instead of fading. */
const DIM = 0.3;

export type MatrixPick = { category: Category; severity: Severity };

/** Marker scale: area ∝ count, against a fixed denominator so narrowing the scope visibly shrinks markers. */
function markerScale(count: number, max: number): number {
  return count ? Math.max(MIN_SCALE, Math.sqrt(count / Math.max(1, max))) : 0;
}

/**
 * Category × severity matrix of real counts — no likelihood axis is invented.
 * It never filters itself: counts respect every filter except its own two
 * axes, and cells outside the current category/severity selection dim.
 * Markers are plotted from the chart origin the first time the matrix is seen,
 * then re-scale in a short wave from the origin whenever the scope changes.
 */
export function RiskMatrix({
  cells,
  scaleMax,
  category,
  severities,
  lead,
  onPick,
}: {
  cells: MatrixCell[];
  /** Largest cell count across every finding (all statuses) — the fixed size reference. */
  scaleMax: number;
  category: 'all' | Category;
  severities: Severity[];
  lead: MatrixPick | null;
  onPick: (cell: MatrixPick) => void;
}) {
  const plotRef = useRef<HTMLDivElement>(null);
  const [origin, setOrigin] = useState<{ w: number; h: number } | null>(null);
  const tier = useDeviceTier();
  const reduce = useReducedMotionPref();
  const fly = tier === 'high' && !reduce;

  // Plot the markers the first time the matrix is actually seen; the size is read once, from the observer entry.
  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return;
        setOrigin({ w: entry.boundingClientRect.width, h: entry.boundingClientRect.height });
        io.disconnect();
      },
      { rootMargin: '0px 0px -6% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const countOf = new Map(cells.map((c) => [`${c.category}:${c.severity}`, c.count]));
  const count = (c: Category, s: Severity) => countOf.get(`${c}:${s}`) ?? 0;
  const total = cells.reduce((n, c) => n + c.count, 0);
  const rowTotal = (c: Category) => COLS.reduce((n, s) => n + count(c, s), 0);
  const colTotal = (s: Severity) => ROWS.reduce((n, c) => n + count(c, s), 0);
  const inFilter = (c: Category, s: Severity) =>
    (category === 'all' || category === c) && (severities.length === 0 || severities.includes(s));
  const isPicked = (c: Category, s: Severity) => category === c && severities.length === 1 && severities[0] === s;
  const legend = Array.from(new Set([1, Math.ceil(scaleMax / 2), scaleMax])).filter((n) => n >= 1);

  // Keyboard: the plot is one tab stop (roving tabindex). Arrows move between cells, Home/End along the
  // row, Ctrl+Home/End to the corners; Enter or Space filters. The stop defaults to the filtered cell,
  // then the lead's cell, then the first cell with findings.
  const cellRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [lastFocused, setLastFocused] = useState<number | null>(null);
  const indexOf = (c: Category, s: Severity) => ROWS.indexOf(c) * COLS.length + COLS.indexOf(s);
  const pickedIndex = category !== 'all' && severities.length === 1 ? indexOf(category, severities[0]) : -1;
  const leadIndex = lead ? indexOf(lead.category, lead.severity) : -1;
  const firstFilled = ROWS.flatMap((c) => COLS.map((s) => count(c, s))).findIndex((n) => n > 0);
  const tabStop = lastFocused ?? [pickedIndex, leadIndex, firstFilled, 0].find((i) => i >= 0) ?? 0;

  const onGridKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.metaKey || event.shiftKey) return;
    if (event.ctrlKey && event.key !== 'Home' && event.key !== 'End') return;
    const from = cellRefs.current.findIndex((b) => b === event.target);
    if (from < 0) return;
    let row = Math.floor(from / COLS.length);
    let col = from % COLS.length;
    switch (event.key) {
      case 'ArrowRight':
        col = Math.min(COLS.length - 1, col + 1);
        break;
      case 'ArrowLeft':
        col = Math.max(0, col - 1);
        break;
      case 'ArrowDown':
        row = Math.min(ROWS.length - 1, row + 1);
        break;
      case 'ArrowUp':
        row = Math.max(0, row - 1);
        break;
      case 'Home':
        col = 0;
        if (event.ctrlKey) row = 0;
        break;
      case 'End':
        col = COLS.length - 1;
        if (event.ctrlKey) row = ROWS.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
    cellRefs.current[row * COLS.length + col]?.focus();
  };

  return (
    <aside aria-labelledby="risk-matrix-title" className="panel h-fit p-4 xl:sticky xl:top-[68px]">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="risk-matrix-title" className="text-[13.5px] font-semibold">
          Risk matrix
        </h2>
        <span className="label">
          <span className="num">{total}</span> in scope
        </span>
      </div>
      <p id="risk-matrix-help" className="mt-1 text-[12px] text-ink-3">
        Category × severity · select a cell to filter
      </p>

      <div className="mt-4 grid grid-cols-[78px_minmax(0,1fr)_20px] gap-x-2.5">
        {/* Category axis (each cell's label names its category, so this is visual only) */}
        <div aria-hidden className="grid" style={{ gridTemplateRows: `repeat(${ROWS.length}, ${ROW_H}px)` }}>
          {ROWS.map((c) => (
            <span
              key={c}
              className={cn(
                'flex items-center truncate text-[12px] transition-colors',
                category === c ? 'font-medium text-ink' : rowTotal(c) ? 'text-ink-2' : 'text-ink-3',
              )}
            >
              {CATEGORY_LABEL[c]}
            </span>
          ))}
        </div>

        {/* Plot */}
        <div
          ref={plotRef}
          role="grid"
          aria-labelledby="risk-matrix-title"
          aria-describedby="risk-matrix-help"
          onKeyDown={onGridKeyDown}
          className="relative border-b border-l border-line-strong"
        >
          {ROWS.map((c, row) => (
            <div key={c} role="row" className="grid grid-cols-4" style={{ height: ROW_H }}>
              {COLS.map((s, col) => {
                const i = row * COLS.length + col;
                const n = count(c, s);
                const picked = isPicked(c, s);
                const inert = !n && !picked;
                const what = pluralize(n, `${s} ${CATEGORY_LABEL[c].toLowerCase()} finding`);
                return (
                  <div key={s} role="gridcell" className="flex border-r border-t border-line">
                    <button
                      ref={(el) => {
                        cellRefs.current[i] = el;
                      }}
                      type="button"
                      tabIndex={i === tabStop ? 0 : -1}
                      aria-disabled={inert || undefined}
                      aria-pressed={picked}
                      aria-label={`${what}${picked ? ' — clear filter' : inert ? '' : ' — filter to these'}`}
                      title={what}
                      onFocus={() => setLastFocused(i)}
                      onClick={() => {
                        if (!inert) onPick({ category: c, severity: s });
                      }}
                      className={cn(
                        // The focus ring is ink, not signal, so it never reads as the "Filtered cell" outline.
                        'relative h-full w-full transition-colors focus-visible:outline-ink focus-visible:outline-offset-[-3px]',
                        n ? 'hover:bg-raised' : 'cursor-default',
                        picked && 'bg-raised',
                      )}
                    >
                      {picked && <span aria-hidden className="absolute inset-[3px] rounded-[5px] border border-signal" />}
                    </button>
                  </div>
                );
              })}
            </div>
          ))}

          <div aria-hidden className="pointer-events-none absolute inset-0">
            {origin &&
              ROWS.map((c, row) =>
                COLS.map((s, col) => (
                  <Marker
                    key={`${c}:${s}`}
                    severity={s}
                    count={count(c, s)}
                    col={col}
                    row={row}
                    origin={origin}
                    scaleMax={scaleMax}
                    fly={fly}
                    dim={!inFilter(c, s)}
                    isLead={lead?.category === c && lead.severity === s}
                  />
                )),
              )}
          </div>
        </div>

        {/* Row totals */}
        <div className="grid" style={{ gridTemplateRows: `repeat(${ROWS.length}, ${ROW_H}px)` }}>
          {ROWS.map((c) => (
            <span key={c} className="num flex items-center justify-end font-mono text-[11px] text-ink-3">
              <span className="sr-only">{CATEGORY_LABEL[c]} total: </span>
              {rowTotal(c) || <Zero />}
            </span>
          ))}
        </div>

        {/* Severity axis */}
        <span />
        <div className="grid grid-cols-4 pt-2">
          {COLS.map((s) => (
            <span key={s} className="flex flex-col items-center gap-1">
              <span
                className={cn(
                  'flex items-center gap-1 font-mono text-[10px] uppercase tracking-[0.04em] transition-colors',
                  severities.includes(s) ? 'text-ink' : 'text-ink-3',
                )}
              >
                <SeverityDot severity={s} />
                <span aria-hidden>{COL_SHORT[s]}</span>
                <span className="sr-only">{titleCase(s)} total:</span>
              </span>
              <span className="num font-mono text-[11px] text-ink-3">{colTotal(s) || <Zero />}</span>
            </span>
          ))}
        </div>
        <span />
        <span />
        <span aria-hidden className="label mt-1.5 text-right">
          Severity →
        </span>
        <span />
      </div>

      {/* Legend */}
      <div className="mt-4 space-y-2 border-t border-line pt-3 text-[11.5px] text-ink-3">
        <div className="flex items-center gap-1.5">
          {legend.map((n) => {
            const d = Math.round(DOT * markerScale(n, scaleMax));
            return (
              <span
                key={n}
                aria-hidden
                className="num flex shrink-0 items-center justify-center rounded-full bg-ink-3 font-mono text-[9.5px] font-semibold text-signal-ink"
                style={{ width: d, height: d }}
              >
                {n}
              </span>
            );
          })}
          <span className="ml-1.5">Findings per cell · area ∝ count</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          {lead && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="h-3.5 w-3.5 rounded-full border border-ink-2" />
              Lead finding
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-3.5 rounded-[3px] border border-signal" />
            Filtered cell
          </span>
        </div>
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-ink-3">
        Counts of findings, not likelihood. Every filter applies except the matrix’s own axes. Severity and category come
        from each capture’s structured record — sample annotations for the bundled dataset.
      </p>
    </aside>
  );
}

/** A quiet dot for an empty total; assistive tech hears "0". */
function Zero() {
  return (
    <>
      <span aria-hidden>·</span>
      <span className="sr-only">0</span>
    </>
  );
}

function Marker({
  severity,
  count,
  col,
  row,
  origin,
  scaleMax,
  fly,
  dim,
  isLead,
}: {
  severity: Severity;
  count: number;
  col: number;
  row: number;
  origin: { w: number; h: number };
  scaleMax: number;
  fly: boolean;
  dim: boolean;
  isLead: boolean;
}) {
  const fx = (col + 0.5) / COLS.length;
  const fy = (row + 0.5) / ROWS.length;
  const scale = markerScale(count, scaleMax);
  // A wave from the origin (bottom-left): nearer cells land first; the farthest starts 224 ms after the nearest.
  const delay = (col + (ROWS.length - 1 - row)) * 0.028;

  return (
    <motion.div
      className="absolute h-0 w-0"
      style={{ left: `${fx * 100}%`, top: `${fy * 100}%` }}
      initial={fly ? { x: -fx * origin.w, y: (1 - fy) * origin.h } : false}
      animate={{ x: 0, y: 0 }}
      transition={{ duration: 0.75, delay, ease: EASE }}
    >
      {isLead && (
        <motion.span
          className="absolute block rounded-full border border-ink-2"
          style={{ width: DOT + 8, height: DOT + 8, left: -(DOT + 8) / 2, top: -(DOT + 8) / 2 }}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: count ? (scale * DOT + 8) / (DOT + 8) : 0, opacity: count ? (dim ? DIM : 1) : 0 }}
          transition={{ scale: { duration: 0.5, delay: delay + 0.12, ease: EASE }, opacity: { duration: 0.3 } }}
        />
      )}
      {/* Dimming fades the dot only; the count switches to light ink so it stays legible (≥7:1) on the faded dot. */}
      <motion.span
        className="absolute block rounded-full"
        style={{ width: DOT, height: DOT, left: -DOT / 2, top: -DOT / 2, backgroundColor: SEVERITY_COLOR[severity] }}
        initial={{ scale: 0, opacity: 1 }}
        animate={{ scale, opacity: dim ? DIM : 1 }}
        transition={{ scale: { duration: 0.55, delay, ease: EASE }, opacity: { duration: 0.3 } }}
      />
      <motion.span
        className={cn(
          'num absolute left-0 top-0 -translate-x-1/2 -translate-y-1/2 font-mono text-[10.5px] font-semibold leading-none',
          dim ? 'text-ink' : 'text-signal-ink',
        )}
        initial={{ opacity: 0 }}
        animate={{ opacity: count ? 1 : 0 }}
        transition={{ duration: 0.25, delay: count ? delay + 0.22 : 0 }}
      >
        {count || ''}
      </motion.span>
    </motion.div>
  );
}
