'use client';

import { motion } from 'framer-motion';
import { memo, useMemo, useState } from 'react';
import type { MediaAsset, ResourceType } from '@/lib/types';
import { getMeasurement } from '@/lib/cloudinary/probe';
import { formatBytes, formatMs, pluralize } from '@/lib/format';
import { useReducedMotionPref } from '@/components/motion/hooks';
import { cn } from '@/components/ui/cn';
import { servedUrl, useMeasurementsVersion } from '../hooks';
import { useConsoleActions } from '../store';
import { EASE, PanelTitle, median, niceCeil } from './shared';

interface Point {
  asset: MediaAsset;
  ms: number;
  cache?: 'hit' | 'miss';
  format?: string;
  bytes?: number;
  /** CDN edge time (`cld-*;dur`), present on hits and misses. */
  edgeMs?: number;
  /** Cloudinary origin time (`cloudinary;dur`), present only when the edge missed its cache. */
  originMs?: number;
}

interface Stat {
  label: string;
  value: string;
  note: string;
  /** A second note line, e.g. "origin: all cached". */
  detail?: string;
  /** What the figure is and where it comes from (tooltip). */
  about: string;
}

const LANES: Array<{ type: ResourceType; label: string }> = [
  { type: 'image', label: 'Photos' },
  { type: 'video', label: 'Videos' },
];
const JITTER = [0, -6, 6];

const valuesOf = (points: Point[], key: 'edgeMs' | 'originMs'): number[] =>
  points.map((p) => p[key]).filter((v): v is number => v !== undefined);

/**
 * Delivery latency read from live HEAD probes of the renditions the console
 * serves: round trip from this browser, CDN cache status, the CDN edge's own
 * time and — only when the edge missed its cache — Cloudinary's origin time,
 * all from Cloudinary's Server-Timing header. Nothing is estimated: "—" means
 * no response yet, "n/a" that Cloudinary's responses did not report it.
 */
export const DeliveryLatency = memo(function DeliveryLatency({
  field,
  onInspect,
}: {
  field: MediaAsset[];
  /** Optional: defaults to the console's stable `inspect` action (keeps the memo effective). */
  onInspect?: (assetId: string) => void;
}) {
  const reduce = useReducedMotionPref();
  const version = useMeasurementsVersion();
  const actions = useConsoleActions();
  const inspect = onInspect ?? actions.inspect;
  const [hovered, setHovered] = useState<string | null>(null);

  const { points, pending, failed } = useMemo(() => {
    void version;
    const out: Point[] = [];
    let waiting = 0;
    let errors = 0;
    for (const asset of field) {
      const r = getMeasurement(servedUrl(asset));
      if (!r || r.kind === 'processing') waiting += 1;
      else if (r.kind !== 'ready') errors += 1;
      else {
        const m = r.metrics;
        out.push({
          asset,
          ms: m.elapsedMs,
          cache: m.cache,
          format: m.format,
          bytes: m.bytes,
          edgeMs: m.edgeMs,
          originMs: m.cloudinaryMs,
        });
      }
    }
    return { points: out, pending: waiting, failed: errors };
  }, [field, version]);

  const med = median(points.map((p) => p.ms));
  const cached = points.filter((p) => p.cache);
  const hits = cached.filter((p) => p.cache === 'hit').length;
  const misses = cached.length - hits;
  const edgeTimes = valuesOf(points, 'edgeMs');
  const originTimes = valuesOf(points, 'originMs');
  const edgeMed = median(edgeTimes);
  const originMed = median(originTimes);
  const axisMax = niceCeil(Math.max(0, ...points.map((p) => p.ms)) * 1.04);
  const focus = points.find((p) => p.asset.id === hovered);
  const waiting = points.length === 0;

  // Origin time exists only for cache misses. When every response was a hit it is
  // not a missing number but a fact about the cache, so it is folded into a note.
  const originNote = originTimes.length
    ? undefined
    : cached.length && misses === 0
      ? 'origin: all cached'
      : misses > 0
        ? 'origin: not reported'
        : undefined;

  const stats: Stat[] = [
    {
      label: 'Round trip',
      value: waiting ? '—' : formatMs(med),
      note: 'median · this browser',
      about: 'Median round trip from this browser to Cloudinary and back (Resource Timing of each HEAD probe)',
    },
    {
      label: 'CDN hit ratio',
      value: cached.length ? `${Math.round((hits / cached.length) * 100)}%` : waiting ? '—' : 'n/a',
      note: cached.length ? `${hits} of ${cached.length} from cache` : waiting ? 'waiting' : 'not reported',
      about: "Share of responses the CDN edge served from its cache (desc=hit|miss in Cloudinary's Server-Timing header)",
    },
  ];
  if (edgeMed !== undefined || !originTimes.length) {
    stats.push({
      label: 'Edge time',
      value: edgeMed !== undefined ? formatMs(edgeMed) : waiting ? '—' : 'n/a',
      note: edgeMed !== undefined || waiting ? 'median · Server-Timing' : 'not in Server-Timing',
      detail: originNote,
      about: "Median time the CDN edge spent on the request (cld-akam / cld-cloudflare dur in Cloudinary's Server-Timing header)",
    });
  }
  if (originTimes.length) {
    stats.push({
      label: 'Origin time',
      value: formatMs(originMed),
      note: `median · ${pluralize(originTimes.length, 'miss', 'misses')}`,
      about: "Median time Cloudinary's origin spent on the requests the CDN edge missed (cloudinary dur in Server-Timing)",
    });
  }
  stats.push({
    label: 'Measured',
    value: `${points.length}/${field.length}`,
    note: pending ? `${pending} in flight` : failed ? `${failed} unavailable` : 'every served rendition',
    about: 'Served renditions with a Cloudinary response so far',
  });

  const focusTiming = focus
    ? [
        focus.edgeMs !== undefined && `edge ${formatMs(focus.edgeMs)}`,
        focus.originMs !== undefined && `origin ${formatMs(focus.originMs)}`,
      ].filter(Boolean)
    : [];

  return (
    <div className="min-w-0 p-4 sm:p-5">
      <PanelTitle
        title="Delivery latency · live"
        meta={
          <>
            HEAD probes<span className="hidden sm:inline"> from this session</span>
          </>
        }
      />

      <dl
        className={cn(
          'mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-[6px] border border-line bg-line',
          stats.length === 5 ? 'md:grid-cols-5' : 'md:grid-cols-4',
        )}
      >
        {stats.map((s, i) => (
          <div
            key={s.label}
            title={s.about}
            className={cn(
              'min-w-0 bg-surface px-3 py-2.5',
              // An odd tile count leaves the last tile alone on its row in the two-column layout: let it span.
              stats.length % 2 === 1 && i === stats.length - 1 && 'col-span-2 md:col-span-1',
            )}
          >
            <dt className="label truncate">{s.label}</dt>
            <dd className="num mt-1.5 text-[20px] font-semibold leading-none tracking-[-0.02em] text-ink">{s.value}</dd>
            <dd className="mt-1.5 truncate text-[11px] text-ink-3">{s.note}</dd>
            {s.detail && <dd className="mt-0.5 truncate text-[11px] text-ink-3">{s.detail}</dd>}
          </div>
        ))}
      </dl>

      <p className="num mt-4 h-4 truncate font-mono text-[11px] text-ink-3" aria-live="polite">
        {focus
          ? [
              focus.asset.fileName,
              `${(focus.format ?? '—').toUpperCase()} ${formatBytes(focus.bytes)}`,
              `CDN ${focus.cache ?? 'n/a'}`,
              formatMs(focus.ms),
              ...focusTiming,
            ].join(' · ')
          : points.length
            ? 'Each dot is one served rendition · hover for its response'
            : 'Waiting for the first Cloudinary response…'}
      </p>

      {/* Strip plot */}
      <div className="mt-3 grid grid-cols-[52px_minmax(0,1fr)] gap-x-3">
        <div aria-hidden className="flex flex-col">
          {LANES.map((lane) => (
            <span key={lane.type} className="label flex h-9 items-center">
              {lane.label}
            </span>
          ))}
        </div>
        <div className="relative overflow-x-clip" onMouseLeave={() => setHovered(null)}>
          {/* Gridlines */}
          {[0, 0.5, 1].map((t) => (
            <span
              key={t}
              aria-hidden
              className="absolute inset-y-0 w-px bg-line"
              style={{ left: t === 1 ? 'calc(100% - 1px)' : `${t * 100}%` }}
            />
          ))}
          {/* Median */}
          {med !== undefined && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute inset-0"
              initial={false}
              animate={{ x: `${(med / axisMax) * 100}%` }}
              transition={{ duration: reduce ? 0 : 0.5, ease: EASE }}
            >
              <span className="absolute inset-y-0 left-0 w-px bg-ink-2" />
            </motion.span>
          )}
          {LANES.map((lane) => {
            const lanePoints = points.filter((p) => p.asset.resourceType === lane.type).sort((a, b) => a.ms - b.ms);
            return (
              <div key={lane.type} className="relative h-9 border-b border-line last:border-b-0">
                {lanePoints.map((p, i) => (
                  <motion.span
                    key={p.asset.id}
                    className="pointer-events-none absolute inset-0"
                    initial={false}
                    animate={{ x: `${(p.ms / axisMax) * 100}%` }}
                    transition={{ duration: reduce ? 0 : 0.5, ease: EASE }}
                  >
                    <motion.button
                      type="button"
                      onClick={() => inspect(p.asset.id)}
                      onMouseEnter={() => setHovered(p.asset.id)}
                      onFocus={() => setHovered(p.asset.id)}
                      onBlur={() => setHovered(null)}
                      aria-label={`${p.asset.fileName}: ${formatMs(p.ms)}, CDN ${p.cache ?? 'unknown'}${
                        p.edgeMs !== undefined ? `, edge ${formatMs(p.edgeMs)}` : ''
                      }`}
                      initial={reduce ? false : { opacity: 0, scale: 0.4 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.35, ease: EASE }}
                      className="pointer-events-auto absolute left-0 top-1/2 -ml-[11px] -mt-[11px] flex h-[22px] w-[22px] items-center justify-center rounded-full"
                      style={{ y: JITTER[i % JITTER.length] }}
                    >
                      <span
                        className={cn(
                          'block h-2.5 w-2.5 rounded-full transition-transform duration-150',
                          hovered === p.asset.id && 'scale-[1.35]',
                          p.cache === 'hit' ? 'bg-signal' : p.cache === 'miss' ? 'bg-surface' : 'bg-ink-3',
                        )}
                        style={{
                          boxShadow:
                            p.cache === 'miss'
                              ? '0 0 0 1.5px var(--color-ink-2) inset, 0 0 0 2px var(--color-surface)'
                              : '0 0 0 2px var(--color-surface)',
                        }}
                      />
                    </motion.button>
                  </motion.span>
                ))}
              </div>
            );
          })}
        </div>
        <span aria-hidden />
        <div aria-hidden className="num relative mt-1.5 h-4 font-mono text-[10px] text-ink-3">
          <span className="absolute left-0">0</span>
          <span className="absolute left-1/2 -translate-x-1/2">{formatMs(axisMax / 2)}</span>
          <span className="absolute right-0">{formatMs(axisMax)}</span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-ink-2">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full bg-signal" />
          CDN hit
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full shadow-[inset_0_0_0_1.5px_var(--color-ink-2)]" />
          CDN miss
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-3 w-px bg-ink-2" />
          Median
        </span>
      </div>
    </div>
  );
});
