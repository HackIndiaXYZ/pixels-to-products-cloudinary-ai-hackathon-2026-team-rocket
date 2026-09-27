'use client';

import { AnimatePresence, motion, type Variants } from 'framer-motion';
import { CornerDownRight, FileText, ListFilter, ScanSearch, X } from 'lucide-react';
import { useState } from 'react';
import type { Finding, MediaAsset, Region, Severity } from '@/lib/types';
import { CATEGORY_LABEL } from '@/lib/analytics';
import { faceDetections } from '@/lib/cloudinary/insights';
import { displayUrl, posterOffset } from '@/lib/cloudinary/media';
import { evidenceStillUrl } from '@/lib/report';
import { pluralize, titleCase } from '@/lib/format';
import { MediaFrame } from '@/components/media/MediaFrame';
import { RegionLayer } from '@/components/media/RegionLayer';
import { SEVERITY_COLOR, StatusBadge } from '@/components/ui/badges';
import { ProvenanceBadge } from '@/components/ui/Provenance';
import { cn } from '@/components/ui/cn';
import { useInsight } from '../hooks';
import {
  EASE,
  aiAnalysed,
  aiObjectsLine,
  captureWhen,
  evidenceAtSite,
  firstSentence,
  humanProvenanceDetail,
  type LeadPick,
  type StatusFilter,
  type StatusWiden,
} from './model';

const column: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.055, delayChildren: 0.03 } },
};

const rise: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: EASE } },
};

const letters: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.032 } },
};

const letter: Variants = {
  hidden: { y: '104%' },
  show: { y: '0%', transition: { duration: 0.62, ease: EASE } },
};

/**
 * The lead: the single most consequential open finding in the current filters.
 * Hierarchy does the work — one oversized severity word, one sentence, the
 * facts an operator needs, and the stamped evidence frame from Cloudinary.
 * Every fact carries its source: the finding is human classified (sample
 * annotation or entered at ingest), what Cloudinary's AI saw in the frame is AI
 * detected, and the choice of lead and the evidence count are system derived.
 */
export function LeadFinding({
  lead,
  assets,
  now,
  inView,
  canReset,
  widen,
  onInspect,
  onReport,
  onReset,
  onWiden,
}: {
  lead: LeadPick | null;
  assets: MediaAsset[];
  now: number;
  inView: number;
  canReset: boolean;
  /** Set when the status filter alone empties the view. */
  widen: StatusWiden | null;
  onInspect: (assetId: string) => void;
  onReport: (assetId: string) => void;
  onReset: () => void;
  onWiden: (status: StatusFilter) => void;
}) {
  return (
    <AnimatePresence mode="wait" initial>
      {lead ? (
        <LeadPanel
          key={lead.record.finding.id}
          lead={lead}
          assets={assets}
          now={now}
          onInspect={onInspect}
          onReport={onReport}
        />
      ) : (
        <motion.section
          key="lead-empty"
          aria-label="Lead finding"
          className="panel flex flex-col gap-5 p-5 sm:flex-row sm:items-end sm:justify-between sm:p-7"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.14 } }}
          transition={{ duration: 0.25 }}
        >
          <div className="min-w-0">
            <span className="label">Lead</span>
            <p className="type-poster mt-3 text-[44px] text-ink-3 sm:text-[56px]">{inView ? 'Nothing open' : 'Nothing in view'}</p>
            <p className="mt-3 max-w-[56ch] text-[13.5px] leading-relaxed text-ink-2">
              {inView
                ? `No open or monitoring finding in this view — the ${pluralize(inView, 'finding')} below ${inView === 1 ? 'is' : 'are'} resolved.`
                : (widen?.text ?? 'No findings match these filters. Widen the scope or change the date window.')}
            </p>
          </div>
          {(widen || canReset) && (
            <div className="flex flex-wrap gap-2 self-start sm:self-auto">
              {widen && (
                <button type="button" onClick={() => onWiden(widen.target)} className="btn btn-secondary btn-sm">
                  <ListFilter aria-hidden className="h-3.5 w-3.5" /> {widen.label}
                </button>
              )}
              {canReset && (
                <button type="button" onClick={onReset} className={cn('btn btn-sm', widen ? 'btn-ghost' : 'btn-secondary')}>
                  <X aria-hidden className="h-3.5 w-3.5" /> Reset filters
                </button>
              )}
            </div>
          )}
        </motion.section>
      )}
    </AnimatePresence>
  );
}

function LeadPanel({
  lead,
  assets,
  now,
  onInspect,
  onReport,
}: {
  lead: LeadPick;
  assets: MediaAsset[];
  now: number;
  onInspect: (assetId: string) => void;
  onReport: (assetId: string) => void;
}) {
  const { finding, asset } = lead.record;
  const evidence = evidenceAtSite(assets, asset.site, finding.category);
  const when = captureWhen(asset, now);
  const titleId = `lead-${finding.id}`;
  const ai = aiAnalysed(asset) ? asset.ai : undefined;
  const objects = aiObjectsLine(asset);

  return (
    <motion.section
      aria-labelledby={titleId}
      className="panel overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.14 } }}
      transition={{ duration: 0.2 }}
    >
      <div className="grid lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <motion.div className="@container flex min-w-0 flex-col p-5 sm:p-7" variants={column} initial="hidden" animate="show">
          <motion.div variants={rise} className="flex items-center justify-between gap-3">
            <span className="label">
              Lead · most severe {lead.basis} finding<span className="hidden sm:inline"> in view</span>
            </span>
            <span className="flex shrink-0 items-center gap-2">
              <ProvenanceBadge kind="system" detail="ranked" className="hidden sm:inline-flex" />
              <span className="font-mono text-[11px] text-ink-3">{finding.id}</span>
            </span>
          </motion.div>

          <SeverityWord severity={finding.severity} />

          <motion.div variants={rise} className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="text-[13.5px] font-medium text-ink">{CATEGORY_LABEL[finding.category]}</span>
            <span aria-hidden className="h-3.5 w-px bg-line-strong" />
            <StatusBadge status={finding.status} />
          </motion.div>

          <motion.h2 variants={rise} id={titleId} className="type-heading mt-6 max-w-[26ch] text-[24px] text-ink sm:text-[29px]">
            {finding.title}
          </motion.h2>

          <motion.div variants={rise} className="mt-3 max-w-[60ch]">
            <p className="text-[14.5px] leading-relaxed text-ink-2">{firstSentence(finding.summary)}</p>
            <p className="mt-2.5 flex gap-2 text-[13px] leading-relaxed text-ink-3">
              <CornerDownRight aria-hidden className="mt-[3px] h-3.5 w-3.5 shrink-0 text-ink-3" />
              <span>
                <span className="text-ink-2">Next · </span>
                {firstSentence(finding.action)}
              </span>
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-2">
              <ProvenanceBadge kind="human" detail={humanProvenanceDetail(asset)} />
              <span className="text-[11.5px] text-ink-3">
                title, severity, category, status{finding.region ? ', observation and marked region' : ' and observation'}
              </span>
            </div>
          </motion.div>

          {ai && (ai.caption || objects) && (
            <motion.div variants={rise} className="mt-4 max-w-[60ch] rounded-[8px] border border-line px-3 py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="label">What Cloudinary sees</span>
                <ProvenanceBadge kind="ai" detail="Cloudinary" />
              </div>
              {ai.caption && <p className="mt-1.5 text-[13px] leading-relaxed text-ink-2">{ai.caption}</p>}
              {objects && (
                <p className="mt-1 truncate font-mono text-[11px] text-ink-3" title="Objects Cloudinary detected, with its confidence">
                  {objects}
                </p>
              )}
            </motion.div>
          )}

          <div aria-hidden className="min-h-5 flex-1" />

          <motion.dl variants={rise} className="grid grid-cols-2 gap-x-4 gap-y-3.5 border-t border-line pt-4 @xl:grid-cols-4">
            <Fact label="Location" value={asset.site} sub={asset.zone ?? '—'} />
            <Fact
              label="Evidence"
              value={pluralize(evidence.total, 'media record')}
              sub={`${CATEGORY_LABEL[finding.category]} · this site`}
              subTitle="System derived: records at this site whose finding shares this category"
            />
            <Fact
              label="Captured"
              value={when.relative}
              sub={when.note ?? when.absolute}
              subTitle={when.title}
              mono
            />
            <Fact label="Source" value={asset.fileName} sub={asset.capturedBy} mono />
          </motion.dl>

          <motion.div variants={rise} className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={() => onInspect(asset.id)}>
              <ScanSearch className="h-4 w-4" /> Inspect
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => onReport(asset.id)}>
              <FileText className="h-4 w-4" /> Report
            </button>
          </motion.div>
        </motion.div>

        <LeadMedia asset={asset} finding={finding} onInspect={() => onInspect(asset.id)} />
      </div>
    </motion.section>
  );
}

/** The severity word as structure: condensed poster type, letters rising out of a mask. */
function SeverityWord({ severity }: { severity: Severity }) {
  return (
    // The mask is sized in the word's own em so the rising letters clear it exactly.
    <div className="mt-3 overflow-hidden" style={{ fontSize: 'min(144px, 23cqw)', padding: '0.06em 0 0.02em' }}>
      <span className="sr-only">{titleCase(severity)} severity</span>
      <motion.span
        aria-hidden
        variants={letters}
        className="type-poster block whitespace-nowrap"
        style={{
          color: SEVERITY_COLOR[severity],
          fontVariationSettings: '"wdth" 66, "wght" 820',
          lineHeight: 0.88,
        }}
      >
        {severity
          .toUpperCase()
          .split('')
          .map((ch, i) => (
            <motion.span key={`${ch}-${i}`} variants={letter} className="inline-block">
              {ch}
            </motion.span>
          ))}
      </motion.span>
    </div>
  );
}

function Fact({
  label,
  value,
  sub,
  subTitle,
  mono,
}: {
  label: string;
  value: string;
  sub: string;
  subTitle?: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <dt className="label">{label}</dt>
      <dd className={cn('mt-1.5 truncate text-[13.5px] font-medium text-ink', mono && 'num font-mono text-[12.5px]')} title={value}>
        {value}
      </dd>
      <dd className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-ink-3" title={subTitle ?? sub}>
        {sub}
      </dd>
    </div>
  );
}

/**
 * Stamped evidence still rendered by Cloudinary (exposure correction, face
 * pixelation, audit stamp — nothing generative), with the annotated region
 * drawn over the exact frame and Cloudinary's live face count beside it.
 */
function LeadMedia({ asset, finding, onInspect }: { asset: MediaAsset; finding: Finding; onInspect: () => void }) {
  const evidenceSrc = evidenceStillUrl(asset, true, 900);
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const src = failed === evidenceSrc ? displayUrl(asset, 900) : evidenceSrc;
  const ready = loaded === src;
  const { insight, error } = useInsight(asset);
  const video = asset.resourceType === 'video';
  // Objects Cloudinary's AI detected, boxed on the frame (photos: the boxes are in the frame's own percent).
  const aiBoxes: Region[] = video
    ? []
    : (asset.ai?.objects ?? [])
        .filter((o): o is typeof o & { box: Region } => Boolean(o.box))
        .slice(0, 4)
        .map((o) => ({ ...o.box, label: `${o.label.toUpperCase()} ${Math.round(o.confidence * 100)}%` }));

  return (
    <div className="flex min-w-0 flex-col border-t border-line bg-canvas lg:border-l lg:border-t-0">
      <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <span className="label">{failed === evidenceSrc ? 'Delivered still' : 'Evidence still'}</span>
        <span className="truncate font-mono text-[11px] text-ink-3">
          {asset.fileName}
          {video ? ` · frame ${posterOffset(asset).toFixed(1)} s` : ''}
        </span>
      </div>

      <button
        type="button"
        data-cursor="OPEN"
        onClick={onInspect}
        aria-label={`Inspect evidence: ${finding.title}`}
        className="survey-grid relative flex min-h-[260px] flex-1 items-center justify-center p-4 sm:min-h-[340px] sm:p-6"
      >
        <MediaFrame width={asset.width} height={asset.height} maxHeight="380px" className="rounded-[4px] bg-raised">
          {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
          <img
            key={src}
            src={src}
            alt={`Evidence frame: ${finding.title}`}
            decoding="async"
            onLoad={() => setLoaded(src)}
            onError={() => {
              if (src === evidenceSrc) setFailed(evidenceSrc);
            }}
            className={cn(
              'h-full w-full select-none object-cover transition-[opacity,scale] duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]',
              ready ? 'scale-100 opacity-100' : 'scale-[1.015] opacity-0',
            )}
          />
          {ready && finding.region && <RegionLayer regions={[finding.region]} variant="annotation" />}
          {ready && aiBoxes.length > 0 && <RegionLayer regions={aiBoxes} variant="ai" />}
          <span aria-hidden className="reticle" />
          {!ready && (
            <span className="absolute inset-0 flex items-center justify-center">
              <span className="label">Fetching from Cloudinary…</span>
            </span>
          )}
        </MediaFrame>
      </button>

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-line px-4 py-2.5 font-mono text-[10.5px] text-ink-3">
        <span className="truncate" title="Cloudinary transformations applied to this frame">
          {failed === evidenceSrc ? 'c_limit · q_auto · f_auto' : 'e_improve · e_pixelate_faces · audit stamp · f_auto'}
        </span>
        <span className="flex items-center gap-3">
          {finding.region && (
            <span className="flex items-center gap-1.5" title={`Marked region · human classified · ${humanProvenanceDetail(asset)}`}>
              <span aria-hidden className="inline-block h-2 w-3 rounded-[2px] border border-high" />
              marked · human
            </span>
          )}
          {aiBoxes.length > 0 && (
            <span className="flex items-center gap-1.5" title="Objects detected by Cloudinary AI (coco_v2)">
              <span aria-hidden className="inline-block h-2 w-3 rounded-[2px] border border-signal" />
              objects · AI
            </span>
          )}
          <span className="num flex items-center gap-1.5" title="Face detections reported by Cloudinary (fl_getinfo), fetched live">
            <ProvenanceBadge kind="ai" detail="fl_getinfo" className="py-0 text-[9.5px]" />
            {insight ? (
              <span className="text-ink-2">{faceDetections(insight.faces.length)}</span>
            ) : (
              <span>
                face detections · <span className="text-ink-2">{error ? 'n/a' : '…'}</span>
              </span>
            )}
          </span>
        </span>
      </div>
    </div>
  );
}
