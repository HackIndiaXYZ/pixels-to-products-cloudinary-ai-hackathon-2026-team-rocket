'use client';

import { AnimatePresence, motion } from 'framer-motion';
import { ArrowUpRight } from 'lucide-react';
import { memo, useMemo, type ReactNode } from 'react';
import type { MediaAsset, Severity } from '@/lib/types';
import { SEVERITIES, type SiteSummary } from '@/lib/analytics';
import { faceDetections } from '@/lib/cloudinary/insights';
import { getMeasurement } from '@/lib/cloudinary/probe';
import { formatBytes } from '@/lib/format';
import { AnimatedNumber } from '@/components/motion/AnimatedNumber';
import { useReducedMotionPref } from '@/components/motion/hooks';
import { SEVERITY_COLOR } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { SERVED_IMAGE_WIDTH, SERVED_VIDEO_WIDTH, servedUrl, useDeliveryTotals, useInsights } from '../hooks';
import { useConsoleActions } from '../store';
import { EASE, Swatch } from './shared';

/**
 * The instrument strip: five readings, one surface, hairline-divided.
 * Record counts come from the dataset ("open" = status open, as everywhere in
 * VisualOps); AI signals and delivery figures are live Cloudinary responses
 * from this session.
 *
 * Memoised: pass stable values (e.g. from a memoised `overviewSummary`). The
 * `onIncidents` / `onLibrary` callbacks are optional — without them the cells
 * navigate through the console's stable actions, which keeps the memo effective.
 */
export const KeyNumbers = memo(function KeyNumbers({
  field,
  openCounts,
  openTotal,
  monitoring,
  resolved,
  sites,
  riskiest,
  onIncidents,
  onLibrary,
}: {
  field: MediaAsset[];
  /** Open (status 'open') findings by severity. */
  openCounts: Record<Severity, number>;
  /** Findings with status 'open'. */
  openTotal: number;
  monitoring: number;
  resolved: number;
  /** Sites with field media. */
  sites: number;
  /** The site with the worst unresolved finding. */
  riskiest: SiteSummary | undefined;
  onIncidents?: () => void;
  onLibrary?: () => void;
}) {
  const { navigate } = useConsoleActions();
  const photos = field.filter((a) => a.resourceType === 'image').length;
  const videos = field.length - photos;

  return (
    <section aria-label="Key numbers" className="panel overflow-hidden">
      <div className="grid grid-cols-2 gap-px bg-line xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.35fr)]">
        {/* Open findings */}
        <Cell
          label="Open findings"
          onClick={onIncidents ?? (() => navigate('incidents'))}
          className="col-span-2 xl:col-span-1"
          value={<AnimatedNumber value={openTotal} />}
          foot={`${monitoring} monitoring · ${resolved} resolved`}
        >
          <SeverityBar counts={openCounts} />
          <span className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1 font-mono text-[10.5px] text-ink-2 sm:grid-cols-4 xl:grid-cols-2">
            {SEVERITIES.map((s) => (
              <span key={s} className="flex min-w-0 items-center gap-1.5">
                <Swatch color={SEVERITY_COLOR[s]} />
                <span className="num">{openCounts[s]}</span>
                <span className="truncate text-ink-3">{s}</span>
              </span>
            ))}
          </span>
        </Cell>

        {/* Media */}
        <Cell
          label="Media processed"
          onClick={onLibrary ?? (() => navigate('library'))}
          value={<AnimatedNumber value={field.length} />}
          foot="Hosted and served by Cloudinary"
        >
          <span className="text-[12.5px] text-ink-2">
            <span className="num">{photos}</span> photos · <span className="num">{videos}</span> videos
          </span>
        </Cell>

        {/* Sites */}
        <Cell label="Sites reporting" value={<AnimatedNumber value={sites} />} foot="Ranked by worst unresolved finding">
          {riskiest?.worst ? (
            <span className="block min-w-0 text-[12.5px]">
              <span className="flex min-w-0 items-center gap-1.5 text-ink-3">
                <Swatch color={SEVERITY_COLOR[riskiest.worst]} />
                <span className="truncate">Highest risk · {riskiest.worst}</span>
              </span>
              <span className="mt-0.5 block truncate text-ink" title={riskiest.site}>
                {riskiest.site}
              </span>
            </span>
          ) : (
            <span className="text-[12.5px] text-ink-3">No unresolved risk</span>
          )}
        </Cell>

        <AiSignals field={field} />
        <Delivery field={field} />
      </div>
    </section>
  );
});

function Cell({
  label,
  value,
  children,
  foot,
  onClick,
  className,
}: {
  label: ReactNode;
  value: ReactNode;
  children?: ReactNode;
  foot?: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  const body = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="label">{label}</span>
        {onClick && (
          <ArrowUpRight
            aria-hidden
            className="h-3.5 w-3.5 text-ink-3 opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100"
          />
        )}
      </span>
      <span className="num mt-3 block text-[34px] font-semibold leading-none tracking-[-0.035em] text-ink">{value}</span>
      <span className="mt-3 block min-w-0">{children}</span>
      {foot && <span className="mt-auto block pt-3 text-[11.5px] text-ink-3">{foot}</span>}
    </>
  );
  const base = cn('group flex min-w-0 flex-col bg-surface p-4 text-left sm:p-5', className);
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(base, 'transition-colors hover:bg-raised')}>
      {body}
    </button>
  ) : (
    <div className={base}>{body}</div>
  );
}

/** Severity distribution of open findings; draws itself once (scaleX). */
function SeverityBar({ counts }: { counts: Record<Severity, number> }) {
  const reduce = useReducedMotionPref();
  const total = SEVERITIES.reduce((n, s) => n + counts[s], 0);
  if (!total) return <span className="block h-2 w-full rounded-[2px] bg-raised" />;
  return (
    <motion.span
      className="flex h-2 w-full gap-[2px]"
      style={{ originX: 0 }}
      initial={reduce ? false : { scaleX: 0 }}
      whileInView={{ scaleX: 1 }}
      viewport={{ once: true }}
      transition={{ duration: 0.8, ease: EASE, delay: 0.2 }}
      role="img"
      aria-label={SEVERITIES.map((s) => `${counts[s]} ${s}`).join(', ')}
    >
      {SEVERITIES.map((s) =>
        counts[s] ? (
          <span
            key={s}
            className="h-full first:rounded-l-[2px] last:rounded-r-[2px]"
            style={{ flexGrow: counts[s], flexBasis: 0, backgroundColor: SEVERITY_COLOR[s] }}
          />
        ) : null,
      )}
    </motion.span>
  );
}

/**
 * Cloudinary fl_getinfo responses for every field asset: the g_auto crop window
 * and Cloudinary's automatic face detections (which can include false positives,
 * so they are counted as detections, never as people).
 */
function AiSignals({ field }: { field: MediaAsset[] }) {
  const insights = useInsights(field);
  const values = Object.values(insights);
  const ready = values.filter((i) => i && i !== 'error');
  const failed = values.filter((i) => i === 'error').length;
  const faces = ready.reduce((n, i) => n + (i && i !== 'error' ? i.faces.length : 0), 0);
  const withFaces = ready.filter((i) => i && i !== 'error' && i.faces.length > 0).length;
  const pending = field.length - ready.length - failed;

  return (
    <Cell
      label="AI signals · live"
      value={
        <>
          <AnimatedNumber value={ready.length} />
          <span className="text-ink-3">/{field.length}</span>
        </>
      }
      foot={
        pending > 0
          ? `Requesting fl_getinfo · ${pending} pending`
          : failed
            ? `fl_getinfo · ${failed} unavailable`
            : 'fl_getinfo · g_auto crop + face detections'
      }
    >
      <span className="block text-[12.5px] text-ink-2">
        {ready.length ? (
          <>
            <span className="num block">{faceDetections(faces)}</span>
            <span className="num mt-0.5 block text-[11.5px] text-ink-3">
              automatic{withFaces ? ` · ${withFaces} ${withFaces === 1 ? 'capture' : 'captures'}` : ''}
            </span>
          </>
        ) : (
          <span className="text-ink-3">Waiting for Cloudinary…</span>
        )}
      </span>
    </Cell>
  );
}

/**
 * Original bytes vs the bytes Cloudinary actually delivered for the rendition the
 * console serves, from live HEAD probes. The saving includes the resize to the
 * served width (c_limit), not only q_auto / f_auto, and the cell says so.
 */
function Delivery({ field }: { field: MediaAsset[] }) {
  const totals = useDeliveryTotals(field);
  const reduce = useReducedMotionPref();
  const settled = useMemo(() => {
    void totals;
    return field.filter((a) => {
      const r = getMeasurement(servedUrl(a));
      return r !== undefined && r.kind !== 'processing';
    }).length;
  }, [field, totals]);

  const original = totals.imageOriginal + totals.videoOriginal;
  const delivered = totals.imageDelivered + totals.videoDelivered;
  const complete = settled >= totals.total && totals.total > 0;
  const saved = original ? 1 - delivered / original : 0;
  const pct = Math.round(Math.abs(saved) * 100);
  const failed = settled - totals.measured;

  return (
    <div className="flex min-w-0 flex-col bg-surface p-4 sm:p-5">
      <span className="label">Delivered vs originals</span>
      <span className="relative mt-3 block h-[34px]">
        <AnimatePresence initial={false} mode="wait">
          {complete && totals.measured > 0 ? (
            <motion.span
              key="saved"
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, ease: EASE }}
              className={cn(
                'num absolute inset-0 text-[34px] font-semibold leading-none tracking-[-0.035em]',
                saved >= 0 ? 'text-signal' : 'text-warn',
              )}
            >
              {saved >= 0 ? '−' : '+'}
              <AnimatedNumber value={pct} />%
            </motion.span>
          ) : (
            <motion.span
              key="measuring"
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.2 }}
              className="absolute inset-0 flex items-end gap-2 font-mono text-[13px] leading-none text-ink-2"
            >
              {complete ? 'unavailable' : 'measuring'}
              <span className="num text-ink-3">
                {totals.measured}/{totals.total}
              </span>
            </motion.span>
          )}
        </AnimatePresence>
      </span>
      <span className="mt-3 block text-[12.5px] text-ink-2">
        {totals.measured ? (
          <span className="num">
            {formatBytes(original)} originals <span className="text-ink-3">→</span> {formatBytes(delivered)} delivered
          </span>
        ) : (
          <span className="text-ink-3">HEAD-probing each served rendition…</span>
        )}
      </span>
      <span className="mt-auto block pt-3">
        <span className="block h-px w-full overflow-hidden bg-line">
          <motion.span
            className="block h-full w-full bg-signal"
            style={{ originX: 0 }}
            initial={false}
            animate={{ scaleX: totals.total ? settled / totals.total : 0 }}
            transition={{ duration: 0.5, ease: EASE }}
          />
        </span>
        <span className="num mt-2 block text-[11.5px] leading-snug text-ink-3">
          <span className="block">{resizeNote(field)}</span>
          <span className="block">
            {totals.measured}/{totals.total} measured live
            {failed > 0 ? ` · ${failed} unavailable` : ''}
          </span>
        </span>
      </span>
    </div>
  );
}

/** What the served renditions include besides q_auto/f_auto: the c_limit resize to the served width. */
function resizeNote(field: MediaAsset[]): string {
  const photos = field.some((a) => a.resourceType === 'image');
  const videos = field.some((a) => a.resourceType === 'video');
  const parts = [photos && `≤${SERVED_IMAGE_WIDTH} px`, videos && `≤${SERVED_VIDEO_WIDTH} px video`].filter(Boolean);
  return parts.length ? `Incl. resize to ${parts.join(' / ')}` : 'Incl. resize to the served width';
}
