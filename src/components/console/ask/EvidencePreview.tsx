'use client';

import { motion } from 'framer-motion';
import { CornerDownLeft, Wand2 } from 'lucide-react';
import { useMemo, type SyntheticEvent } from 'react';
import type { SearchHit } from '@/lib/search/query';
import { captureTimeNote } from '@/lib/analytics';
import { displayUrl, posterOffset } from '@/lib/cloudinary/media';
import { formatBytes, formatDateTime, formatDuration, relativeTime } from '@/lib/format';
import { MediaFrame } from '@/components/media/MediaFrame';
import { RegionLayer } from '@/components/media/RegionLayer';
import { CategoryTag, SeverityBadge, StatusBadge } from '@/components/ui/badges';
import { provenanceLabel } from '../incidents/model';
import { matchLabel } from './engine';

function revealOnLoad(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.opacity = '1';
}

/**
 * The selected result, larger: the full Cloudinary frame (not a crop, so the
 * annotated region lands on the right pixels), the finding and its provenance.
 */
export function EvidencePreview({
  hit,
  still,
  now,
  onInspect,
  onStudio,
}: {
  hit: SearchHit;
  /** Reduced motion: swap instantly. */
  still: boolean;
  now: number;
  onInspect: () => void;
  onStudio: () => void;
}) {
  const { asset } = hit;
  const finding = asset.finding;
  const video = asset.resourceType === 'video';
  // Keywords match descriptors (tags, titles, file, site), never free-text observations,
  // so the summary is shown as written rather than highlighted. Each match names the
  // term that actually hit, so a related-term match is never shown as a literal one.
  const matched = useMemo(() => hit.matched.map((k) => ({ keyword: k, label: matchLabel(asset, k) })), [hit.matched, asset]);
  // The camera's own clock where the footage carries one; otherwise the stored instant.
  const captured = asset.cameraTime ?? `${formatDateTime(asset.capturedAt)} · ${relativeTime(asset.capturedAt, now)}`;

  const meta: Array<[string, string, string?]> = [
    ['File', asset.fileName],
    ['Site', asset.zone ? `${asset.site} · ${asset.zone}` : asset.site],
    ['Captured', captured, asset.cameraTime ? 'Camera time · burned into the footage' : captureTimeNote(asset)],
    ['Source', asset.capturedBy],
    [
      'Media',
      `${video ? 'Video' : 'Image'} · ${asset.width}×${asset.height}${asset.bytes ? ` · ${formatBytes(asset.bytes)}` : ''}${
        video && asset.duration ? ` · ${formatDuration(asset.duration)}` : ''
      }`,
    ],
  ];

  return (
    <motion.div
      key={asset.id}
      initial={still ? false : { opacity: 0.4, y: 3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col"
    >
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="label">Evidence</span>
        <span className="num font-mono text-[10.5px] text-ink-3">
          {video && <>Frame at {formatDuration(posterOffset(asset))}</>}
          {video && finding && ' · '}
          {finding?.id}
        </span>
      </div>

      <button
        type="button"
        onClick={onInspect}
        data-cursor="VIEW"
        aria-label={`Inspect ${asset.fileName}`}
        className="relative block overflow-hidden rounded-[6px] border border-line bg-canvas"
      >
        <MediaFrame width={asset.width} height={asset.height} maxHeight="216px">
          {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
          <img
            key={asset.id}
            src={displayUrl(asset, 720)}
            srcSet={`${displayUrl(asset, 400)} 400w, ${displayUrl(asset, 720)} 720w`}
            sizes="360px"
            alt={`${asset.fileName} — ${asset.title}`}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={revealOnLoad}
            className="h-full w-full select-none object-cover opacity-0 transition-opacity duration-300"
          />
          {finding?.region && <RegionLayer regions={[finding.region]} variant="annotation" />}
          <span className="reticle" />
        </MediaFrame>
      </button>

      {finding ? (
        <div className="mt-3.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <SeverityBadge severity={finding.severity} />
            <StatusBadge status={finding.status} />
            <CategoryTag category={finding.category} />
          </div>
          <h3 className="type-heading mt-2.5 text-[17px] text-ink">{finding.title}</h3>
          <p className="mt-1.5 line-clamp-4 text-[12.5px] leading-relaxed text-ink-2">{finding.summary}</p>
          <p className="mt-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3/80">
            {provenanceLabel(asset)}
            {finding.region ? ' · finding and marked region' : ''}
          </p>
        </div>
      ) : (
        <div className="mt-3.5">
          <h3 className="type-heading text-[17px] text-ink">{asset.title}</h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">No finding recorded for this capture yet.</p>
        </div>
      )}

      <dl className="mt-4 grid grid-cols-[64px_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-t border-line pt-3">
        {meta.map(([k, v, note]) => (
          <div key={k} className="contents">
            <dt className="label pt-[2px]">{k}</dt>
            <dd className="min-w-0 text-[12px] text-ink-2">
              <span className="block truncate" title={v}>
                {v}
              </span>
              {note && <span className="mt-0.5 block truncate text-[11px] text-ink-3">{note}</span>}
            </dd>
          </div>
        ))}
      </dl>

      {matched.length > 0 && (
        <div className="mt-3 flex min-w-0 flex-wrap items-center gap-1.5">
          <span className="label mr-0.5">Matched</span>
          {matched.map((m) => (
            <span
              key={m.keyword}
              title={m.label}
              className="chip max-w-full border-[color-mix(in_oklab,var(--color-signal)_40%,transparent)] bg-transparent text-signal"
            >
              <span className="min-w-0 truncate">{m.label}</span>
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button type="button" onClick={onInspect} className="btn btn-secondary btn-sm flex-1">
          Inspect <CornerDownLeft className="h-3.5 w-3.5 text-ink-3" />
        </button>
        <button type="button" onClick={onStudio} className="btn btn-ghost btn-sm">
          <Wand2 className="h-3.5 w-3.5" /> Studio
        </button>
      </div>
    </motion.div>
  );
}
