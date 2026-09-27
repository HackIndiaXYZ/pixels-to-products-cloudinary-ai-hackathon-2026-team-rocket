'use client';

import { motion } from 'framer-motion';
import { CornerDownLeft, Wand2 } from 'lucide-react';
import { useMemo, type SyntheticEvent } from 'react';
import type { Region } from '@/lib/types';
import type { SearchHit } from '@/lib/search/query';
import { captureTimeNote } from '@/lib/analytics';
import { displayUrl, posterOffset } from '@/lib/cloudinary/media';
import { formatBytes, formatDateTime, formatDuration, relativeTime } from '@/lib/format';
import { MediaFrame } from '@/components/media/MediaFrame';
import { RegionLayer } from '@/components/media/RegionLayer';
import { CategoryTag, SeverityBadge, StatusBadge } from '@/components/ui/badges';
import { ProvenanceBadge } from '@/components/ui/Provenance';
import { cn } from '@/components/ui/cn';
import { aiAnalysed, humanProvenanceDetail } from '../incidents/model';
import { fieldsLabel, highlightSegments, sourcedMatches, termMatches } from './engine';
import { Highlighted } from './EvidenceTile';

function revealOnLoad(event: SyntheticEvent<HTMLImageElement>) {
  event.currentTarget.style.opacity = '1';
}

const MAX_OBJECTS = 6;

/**
 * The selected result, larger: the full Cloudinary frame (not a crop, so the
 * annotated region lands on the right pixels), the finding and its provenance,
 * Cloudinary's AI understanding when the record has been analysed, and — per
 * keyword — whether it matched the human-classified record, the AI, or both.
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
  const ai = aiAnalysed(asset) ? asset.ai : undefined;
  const video = asset.resourceType === 'video';
  // Keywords match descriptors (tags, titles, finding ID, file, site) and Cloudinary's AI fields,
  // never the free-text observation, so the summary is shown as written. Each match names the
  // term that hit and where, so a related-term or AI match is never shown as a literal record match.
  const matched = useMemo(() => sourcedMatches(asset, hit.matched), [asset, hit.matched]);
  const captionSegments = useMemo(
    () => (ai?.caption ? highlightSegments(ai.caption, hit.matched, asset) : []),
    [ai, hit.matched, asset],
  );
  // Detected objects, the ones the question matched first; only matched ones are boxed on the frame.
  const objects = useMemo(() => {
    const flagged = (ai?.objects ?? []).map((o) => ({ ...o, hit: termMatches(o.label.toLowerCase(), hit.matched, asset) }));
    return [...flagged.filter((o) => o.hit), ...flagged.filter((o) => !o.hit)];
  }, [ai, hit.matched, asset]);
  const aiBoxes = useMemo(
    () =>
      video
        ? []
        : objects
            .filter((o): o is typeof o & { box: Region } => o.hit && Boolean(o.box))
            .map((o) => ({ ...o.box, label: `${o.label.toUpperCase()} ${Math.round(o.confidence * 100)}%` })),
    [objects, video],
  );
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
          {aiBoxes.length > 0 && <RegionLayer regions={aiBoxes} variant="ai" />}
          <span className="reticle" />
        </MediaFrame>
      </button>
      {(finding?.region || aiBoxes.length > 0) && (
        <p className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-ink-3">
          {finding?.region && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2 w-3 rounded-[2px] border border-high" />
              marked region · human classified
            </span>
          )}
          {aiBoxes.length > 0 && (
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-2 w-3 rounded-[2px] border border-signal" />
              matched object · AI detected
            </span>
          )}
        </p>
      )}

      {finding ? (
        <div className="mt-3.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <SeverityBadge severity={finding.severity} />
            <StatusBadge status={finding.status} />
            <CategoryTag category={finding.category} />
          </div>
          <h3 className="type-heading mt-2.5 text-[17px] text-ink">{finding.title}</h3>
          <p className="mt-1.5 line-clamp-4 text-[12.5px] leading-relaxed text-ink-2">{finding.summary}</p>
          <div className="mt-2">
            <ProvenanceBadge kind="human" detail={humanProvenanceDetail(asset)} />
          </div>
        </div>
      ) : (
        <div className="mt-3.5">
          <h3 className="type-heading text-[17px] text-ink">{asset.title}</h3>
          <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-3">No finding recorded for this capture yet.</p>
        </div>
      )}

      {ai && (
        <section aria-label="Cloudinary AI understanding" className="mt-3.5 border-t border-line pt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="label">Cloudinary AI</span>
            <ProvenanceBadge kind="ai" detail="Cloudinary" />
          </div>
          {ai.caption && (
            <p className="mt-1.5 line-clamp-3 text-[12.5px] leading-relaxed text-ink-2">
              <Highlighted segments={captionSegments} />
            </p>
          )}
          {objects.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1" aria-label="Detected objects">
              {objects.slice(0, MAX_OBJECTS).map((o, i) => (
                <li
                  key={`${o.label}-${i}`}
                  className={cn(
                    'inline-flex h-[19px] items-center gap-1 rounded-[4px] border px-1.5 font-mono text-[10px]',
                    o.hit
                      ? 'border-[color-mix(in_oklab,var(--color-signal)_45%,transparent)] text-signal'
                      : 'border-line text-ink-2',
                  )}
                  title={`Detected by Cloudinary with ${Math.round(o.confidence * 100)}% confidence`}
                >
                  {o.label}
                  <span className="num text-ink-3">{Math.round(o.confidence * 100)}%</span>
                </li>
              ))}
              {objects.length > MAX_OBJECTS && (
                <li className="inline-flex h-[19px] items-center px-1 font-mono text-[10px] text-ink-3">+{objects.length - MAX_OBJECTS}</li>
              )}
            </ul>
          )}
          {ai.tags.length > 0 && (
            <p className="mt-1.5 truncate font-mono text-[10.5px] text-ink-3" title={ai.tags.join(', ')}>
              auto-tags · <span className="text-ink-2">{ai.tags.join(', ')}</span>
            </p>
          )}
          {(ai.model || ai.analyzedAt) && (
            <p className="mt-1 truncate font-mono text-[10px] text-ink-3">
              {[ai.model, ai.analyzedAt && `analysed ${formatDateTime(ai.analyzedAt)}`].filter(Boolean).join(' · ')}
            </p>
          )}
        </section>
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
        <div className="mt-3 space-y-1.5">
          <span className="label">Matched</span>
          {matched.map((m) => (
            <div key={m.keyword} className="flex min-w-0 flex-wrap items-center gap-1.5">
              <span
                title={m.label}
                className="chip max-w-full border-[color-mix(in_oklab,var(--color-signal)_40%,transparent)] bg-transparent text-signal"
              >
                <span className="min-w-0 truncate">{m.label}</span>
              </span>
              {m.humanFields.length > 0 && (
                <span className="flex min-w-0 items-center gap-1.5">
                  <ProvenanceBadge kind="human" />
                  <span className="truncate text-[11px] text-ink-3">{fieldsLabel(m.humanFields)}</span>
                </span>
              )}
              {m.aiFields.length > 0 && (
                <span className="flex min-w-0 items-center gap-1.5">
                  <ProvenanceBadge kind="ai" />
                  <span className="truncate text-[11px] text-ink-3">{fieldsLabel(m.aiFields)}</span>
                </span>
              )}
            </div>
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
