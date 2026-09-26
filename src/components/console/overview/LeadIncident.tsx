'use client';

import { motion } from 'framer-motion';
import { ArrowRight, ScanSearch, Wand2 } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import type { MediaAsset } from '@/lib/types';
import { captureBasisOf, type FindingRecord } from '@/lib/analytics';
import { displayUrl, posterOffset, thumbUrl } from '@/lib/cloudinary/media';
import { IMAGE_ACCEPT } from '@/lib/cloudinary/probe';
import { formatBytes, formatDateTime, formatDuration, formatMs, relativeTime } from '@/lib/format';
import { CloudImage } from '@/components/media/CloudImage';
import { MediaFrame } from '@/components/media/MediaFrame';
import { RegionLayer } from '@/components/media/RegionLayer';
import { useProbe } from '@/components/media/useProbe';
import { useReducedMotionPref } from '@/components/motion/hooks';
import { CategoryTag, SEVERITY_COLOR, SeverityDot, StatusBadge } from '@/components/ui/badges';
import { SERVED_IMAGE_WIDTH, servedUrl } from '../hooks';
import { provenanceLabel } from '../incidents/model';
import { useConsoleActions } from '../store';
import { EASE, firstSentence, transformationOf } from './shared';

/**
 * The single finding that most needs a decision: the worst open record,
 * shown with its evidence first. Everything here is read from the record
 * (its provenance is labelled: sample annotation, recorded at ingest or read
 * from Cloudinary context) or measured live from Cloudinary.
 *
 * Memoised. The callbacks are optional: without them the panel uses the
 * console's stable actions (inspect, openInStudio, navigate), which keeps the
 * memo effective when the parent re-renders.
 */
export const LeadIncident = memo(function LeadIncident({
  lead,
  queue,
  openTotal,
  now,
  onInspect,
  onStudio,
  onAllIncidents,
}: {
  lead: FindingRecord | undefined;
  queue: FindingRecord[];
  /** Findings with status 'open'. */
  openTotal: number;
  now: number;
  onInspect?: (assetId: string) => void;
  onStudio?: (assetId: string) => void;
  onAllIncidents?: () => void;
}) {
  const reduce = useReducedMotionPref();
  const actions = useConsoleActions();
  const inspect = onInspect ?? actions.inspect;
  const toStudio = onStudio ?? actions.openInStudio;
  const toIncidents = onAllIncidents ?? (() => actions.navigate('incidents'));

  if (!lead) {
    return (
      <section className="panel flex flex-col items-start gap-3 px-6 py-10 sm:px-8" aria-label="Lead incident">
        <span className="label">Lead incident</span>
        <p className="type-heading text-[24px] text-ink">No open findings.</p>
        <p className="max-w-[52ch] text-[13.5px] leading-relaxed text-ink-3">
          Every structured record is resolved or under monitoring. New captures appear here as soon as they carry an open finding.
        </p>
        <button type="button" className="btn btn-secondary btn-sm mt-1" onClick={toIncidents}>
          Review incidents <ArrowRight className="h-3.5 w-3.5" />
        </button>
      </section>
    );
  }

  const { finding, asset } = lead;
  const color = SEVERITY_COLOR[finding.severity];
  const isVideo = asset.resourceType === 'video';
  // Never offer more pixels than the original has (c_limit caps them anyway);
  // the largest candidate is exactly the rendition the console serves and measures.
  const servedWidth = Math.min(SERVED_IMAGE_WIDTH, asset.width);
  const srcSet = [
    ...[800, 1200].filter((w) => w < servedWidth).map((w) => `${displayUrl(asset, w)} ${w}w`),
    `${displayUrl(asset, SERVED_IMAGE_WIDTH)} ${servedWidth}w`,
  ].join(', ');
  const provenance = provenanceLabel(asset);

  return (
    <section aria-labelledby="lead-incident-title" className="panel overflow-hidden">
      {/* Severity rule, drawn once on arrival. */}
      <motion.span
        aria-hidden
        className="block h-[2px] w-full"
        style={{ backgroundColor: color, originX: 0 }}
        initial={reduce ? false : { scaleX: 0 }}
        animate={{ scaleX: 1 }}
        transition={{ duration: 0.9, ease: EASE }}
      />
      <div className="grid xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        {/* Evidence */}
        <div className="flex min-w-0 flex-col border-b border-line xl:border-b-0 xl:border-r">
          <button
            type="button"
            onClick={() => inspect(asset.id)}
            data-cursor="OPEN"
            aria-label={`Inspect evidence for ${finding.id}: ${finding.title}`}
            className="survey-grid relative flex min-h-[240px] flex-1 items-center justify-center bg-canvas px-4 pb-11 pt-11 sm:px-8"
          >
            <span className="pointer-events-none absolute left-4 top-3.5 flex items-center gap-2 font-mono text-[10.5px] text-ink-2 sm:left-5">
              <span className="max-w-[180px] truncate">{asset.fileName}</span>
              <span className="num text-ink-3">
                {asset.width}×{asset.height}
              </span>
            </span>
            <span className="label pointer-events-none absolute right-4 top-3.5 sm:right-5">
              {isVideo ? `Video · still at ${formatDuration(posterOffset(asset))}` : 'Photo'}
            </span>

            <motion.div
              className="w-full"
              initial={reduce ? false : { clipPath: 'inset(0% 100% 0% 0%)' }}
              animate={{ clipPath: 'inset(0% 0% 0% 0%)' }}
              transition={{ duration: 0.8, ease: EASE, delay: 0.05 }}
            >
              <MediaFrame
                width={asset.width}
                height={asset.height}
                maxHeight="min(420px, 64vw)"
                className="rounded-[4px] bg-raised ring-1 ring-line"
              >
                <CloudImage
                  src={displayUrl(asset, SERVED_IMAGE_WIDTH)}
                  srcSet={srcSet}
                  sizes="(min-width: 1280px) 46vw, 92vw"
                  alt={asset.title}
                  loading="eager"
                  className="absolute inset-0 h-full w-full object-cover"
                />
                {finding.region && <RegionLayer regions={[finding.region]} variant="annotation" />}
                <span className="reticle" aria-hidden />
              </MediaFrame>
            </motion.div>

            {finding.region && (
              <span className="pointer-events-none absolute bottom-3.5 left-4 flex items-center gap-2 font-mono text-[10.5px] text-ink-3 sm:left-5">
                <span aria-hidden className="h-2 w-2 rounded-[2px] border-[1.5px] border-high" />
                Region · {provenance.toLowerCase()}
              </span>
            )}
          </button>
          <ServedRendition asset={asset} />
        </div>

        {/* Decision */}
        <div className="flex min-w-0 flex-col p-5 sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <span className="label flex items-center gap-2">
              <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
              Lead incident · worst open finding
            </span>
            <span className="font-mono text-[11px] text-ink-3">{finding.id}</span>
          </div>

          <div className="mt-5 overflow-hidden pb-[0.04em]">
            <motion.p
              initial={reduce ? false : { y: '104%' }}
              animate={{ y: '0%' }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.12 }}
              className="type-poster text-[60px] sm:text-[78px]"
              style={{ color }}
            >
              {finding.severity}
            </motion.p>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            <CategoryTag category={finding.category} />
            <StatusBadge status={finding.status} />
          </div>

          <h2 id="lead-incident-title" className="type-heading mt-4 text-balance text-[22px] text-ink sm:text-[26px]">
            {finding.title}
          </h2>
          <p className="mt-2.5 max-w-[58ch] text-[14px] leading-relaxed text-ink-2">{firstSentence(finding.summary)}</p>
          <p className="mt-1.5 font-mono text-[10.5px] text-ink-3">{provenance}</p>

          <dl className="mt-5 grid grid-cols-[92px_minmax(0,1fr)] gap-x-4 gap-y-2.5 border-t border-line pt-4 text-[13px]">
            <dt className="label pt-[3px]">Site</dt>
            <dd className="min-w-0 text-ink">
              {asset.site}
              {asset.zone && <span className="text-ink-3"> · {asset.zone}</span>}
            </dd>
            <dt className="label pt-[3px]">Age</dt>
            <dd className="min-w-0 text-ink">
              {relativeTime(asset.capturedAt, now)}
              <span className="num font-mono text-[11.5px] text-ink-3"> · {captureTimeDetail(asset)}</span>
            </dd>
            <dt className="label pt-[3px]">Source</dt>
            <dd className="min-w-0 truncate text-ink-2">{asset.capturedBy}</dd>
            <dt className="label pt-[3px]">Action</dt>
            <dd className="min-w-0 text-ink">{firstSentence(finding.action)}</dd>
          </dl>

          <div className="mt-auto flex flex-wrap items-center gap-2 pt-6">
            <button type="button" className="btn btn-primary" onClick={() => inspect(asset.id)} data-cursor="OPEN">
              <ScanSearch className="h-4 w-4" /> Inspect
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => toStudio(asset.id)}>
              <Wand2 className="h-4 w-4" /> Open in Studio
            </button>
          </div>
        </div>
      </div>

      {/* Triage queue */}
      {queue.length > 0 && (
        <div className="border-t border-line">
          <div className="flex items-center justify-between gap-3 px-5 py-2.5 sm:px-6">
            <span className="label">Next in queue</span>
            <button
              type="button"
              onClick={toIncidents}
              className="link-underline flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink"
            >
              All {openTotal} open <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <ul className="grid divide-y divide-line border-t border-line md:grid-cols-3 md:divide-x md:divide-y-0">
            {queue.map((record, i) => (
              <motion.li
                key={record.finding.id}
                initial={reduce ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, ease: EASE, delay: 0.35 + i * 0.06 }}
                className="min-w-0"
              >
                <QueueItem record={record} now={now} onInspect={inspect} />
              </motion.li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
});

function QueueItem({ record, now, onInspect }: { record: FindingRecord; now: number; onInspect: (id: string) => void }) {
  const { finding, asset } = record;
  return (
    <button
      type="button"
      onClick={() => onInspect(asset.id)}
      data-cursor="OPEN"
      className="group flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-raised sm:px-6"
    >
      <span className="relative h-11 w-16 shrink-0 overflow-hidden rounded-[4px] border border-line bg-raised">
        <CloudImage
          src={thumbUrl(asset, 128, 88)}
          srcSet={`${thumbUrl(asset, 64, 44)} 1x, ${thumbUrl(asset, 128, 88)} 2x`}
          alt=""
          className="h-full w-full object-cover"
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <SeverityDot severity={finding.severity} />
          <span className="label text-ink-2">{finding.severity}</span>
          <span className="font-mono text-[10.5px] text-ink-3">{finding.id}</span>
        </span>
        <span className="mt-0.5 block truncate text-[13px] font-medium text-ink">{finding.title}</span>
        <span className="block truncate text-[11.5px] text-ink-3">
          {asset.site} · {relativeTime(asset.capturedAt, now)}
        </span>
      </span>
    </button>
  );
}

/**
 * How the capture time was obtained, next to its relative age: sample times are
 * relative to now and say so; fixed footage shows the time burned into it (the
 * camera's own clock), never a converted instant; recorded times show the date.
 */
function captureTimeDetail(asset: MediaAsset): string {
  switch (captureBasisOf(asset)) {
    case 'sample-relative':
      return 'sample time, relative to now';
    case 'fixed':
      return asset.cameraTime ? `camera time ${asset.cameraTime}` : 'time burned into the footage';
    default:
      return formatDateTime(asset.capturedAt);
  }
}

/** Live proof under the evidence: what Cloudinary served for this asset, measured from its response headers. */
function ServedRendition({ asset }: { asset: MediaAsset }) {
  const url = servedUrl(asset);
  const isVideo = asset.resourceType === 'video';
  const result = useProbe(url, { accept: isVideo ? undefined : IMAGE_ACCEPT });
  const transformation = transformationOf(url);

  let body: ReactNode;
  if (!result) {
    body = <span>Measuring…</span>;
  } else if (result.kind === 'processing') {
    body = <span className="text-warn">HTTP 423 · Cloudinary rendering asynchronously</span>;
  } else if (result.kind !== 'ready') {
    // Quote a message as Cloudinary's only when it came from Cloudinary's X-Cld-Error header.
    body = (
      <span>
        {result.kind === 'network'
          ? 'Probe unavailable'
          : result.source === 'x-cld-error'
            ? `HTTP ${result.status} · Cloudinary: ${result.message}`
            : `HTTP ${result.status}`}
      </span>
    );
  } else {
    const m = result.metrics;
    const original = m.originalBytes ?? asset.bytes;
    const saved = original && m.bytes ? 1 - m.bytes / original : undefined;
    body = (
      <>
        <span className="num">
          <span className="uppercase">{m.originalFormat ?? asset.format}</span> {formatBytes(original)}
        </span>
        <ArrowRight aria-hidden className="h-3 w-3" />
        <span className="num text-ink">
          <span className="uppercase">{m.format ?? '—'}</span> {formatBytes(m.bytes)}
        </span>
        {saved !== undefined && saved > 0.005 && <span className="num text-signal">−{Math.round(saved * 100)}%</span>}
        {saved !== undefined && saved < -0.005 && <span className="num text-warn">+{Math.round(-saved * 100)}% vs original</span>}
        {m.cache && <span>CDN {m.cache}</span>}
        <span className="num">{formatMs(m.elapsedMs)}</span>
      </>
    );
  }

  return (
    <div className="flex min-h-[40px] flex-wrap items-center gap-x-2.5 gap-y-1 px-4 py-2.5 font-mono text-[11px] text-ink-3 sm:px-5">
      <span className="text-ink-2">{isVideo ? 'Playback rendition' : 'Served rendition'}</span>
      {body}
      {transformation && (
        <span className="ml-auto hidden max-w-[45%] truncate text-ink-3 lg:inline" title={url}>
          {transformation}
        </span>
      )}
    </div>
  );
}
