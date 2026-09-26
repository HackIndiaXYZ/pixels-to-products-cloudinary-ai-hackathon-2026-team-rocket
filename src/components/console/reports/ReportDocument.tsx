'use client';

import { motion, type Variants } from 'framer-motion';
import { AlertTriangle } from 'lucide-react';
import { Fragment, memo, useEffect, useState, type ReactNode } from 'react';
import type { AssetSource, MediaAsset, Severity } from '@/lib/types';
import {
  CATEGORIES,
  CATEGORY_LABEL,
  SEVERITIES,
  STATUS_LABEL,
  captureBasisOf,
  siteSummaries,
  statusCounts,
  type FindingRecord,
} from '@/lib/analytics';
import { formatBytes, formatDuration, isoDay, formatDateTime, pluralize, titleCase } from '@/lib/format';
import { ANNOTATION_AUTHOR, REPORT_KINDS, ageHours } from '@/lib/report';
import type { DeliveryMetrics } from '@/lib/cloudinary/probe';
import type { CloudinaryInsight } from '@/lib/cloudinary/insights';
import { LogoMark } from '@/components/brand/Logo';
import { SEVERITY_COLOR } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { useDeviceTier, useReducedMotionPref } from '@/components/motion/hooks';
import { markRevealed, wasRevealed, type EvidenceProbe, type ReportSnapshot } from './job';
import {
  SECTION_TITLE,
  captureText,
  documentId,
  exportBase,
  formatWork,
  frameRedaction,
  groupHash,
  provenance,
  redactionCaption,
  type FrameRedaction,
} from './format';

/* ------------------------------------------------------------------------ */
/* Motion: the sheet unfolds once per issued report                          */
/* ------------------------------------------------------------------------ */

const EASE = [0.16, 1, 0.3, 1] as const;

const SHEET: Variants = {
  folded: { opacity: 0, y: 28 },
  open: { opacity: 1, y: 0, transition: { duration: 0.6, ease: EASE, staggerChildren: 0.075, delayChildren: 0.08 } },
};
const COVER_FOLD: Variants = {
  folded: { opacity: 0, rotateX: -22, transformPerspective: 1200 },
  open: { opacity: 1, rotateX: 0, transformPerspective: 1200, transition: { duration: 0.7, ease: EASE } },
};
const BLOCK: Variants = {
  folded: { opacity: 0, y: 16 },
  open: { opacity: 1, y: 0, transition: { duration: 0.55, ease: EASE } },
};
const RULE: Variants = {
  folded: { scaleX: 0 },
  open: { scaleX: 1, transition: { duration: 0.7, ease: EASE, delay: 0.25 } },
};

/**
 * The issued report as an industrial audit document. Rendered from a frozen
 * snapshot — nothing on this sheet changes after the package is sealed.
 */
export const ReportDocument = memo(function ReportDocument({
  report,
  stale,
  onInspect,
}: {
  report: ReportSnapshot;
  stale: boolean;
  onInspect: (assetId: string) => void;
}) {
  const reduced = useReducedMotionPref();
  const tier = useDeviceTier();
  // Unfold only the first time this report is shown (not on every return to the view).
  const [unfold] = useState(() => !reduced && !wasRevealed(report.runId));
  useEffect(() => {
    markRevealed(report.runId);
  }, [report.runId]);
  const rich = unfold && tier === 'high';

  const { model, hash } = report;
  const docId = documentId(hash);
  const kindMeta = REPORT_KINDS.find((k) => k.kind === model.kind);
  const delivered = report.evidence.filter((e) => e.state === 'delivered').length;
  const statuses = model.kind === 'incident' ? model.scope.statuses.filter((s) => s !== 'resolved') : model.scope.statuses;
  const findingsLed = model.kind === 'inspection' || model.kind === 'incident';
  const status = statusCounts(model.records);
  const dataset = report.payload.dataset;

  const hasManifest = report.evidence.length > 0;

  const meta: Array<[string, ReactNode]> = [
    ['Document', <span key="d" className="font-mono text-[11.5px]">{docId}</span>],
    ['Generated', formatDateTime(model.generatedAt)],
    ['Scope', model.scopeLabel],
    ['Filters', `${titleCase(model.scope.minSeverity)}${model.scope.minSeverity === 'critical' ? '' : ' and above'} · ${statuses.map((s) => STATUS_LABEL[s]).join(', ') || 'no statuses'}`],
    ['Records', `${pluralize(model.records.length, 'finding')} · ${pluralize(model.assets.length, 'asset')}`],
    [
      'Evidence',
      report.evidence.length
        ? `${delivered}/${pluralize(report.evidence.length, 'frame')} delivered by Cloudinary (HTTP 200)`
        : 'No frames in scope',
    ],
    ['Redaction', redactionSummary(report)],
    ['SHA-256', <span key="h" className="font-mono text-[11.5px]">{hash.slice(0, 16)}…</span>],
  ];

  return (
    <div className={cn('transition-opacity duration-300', stale && 'opacity-60')}>
      <motion.article
        variants={SHEET}
        initial={unfold ? 'folded' : false}
        animate="open"
        aria-label={`${model.title} ${docId}`}
        className="print-root theme-light @container relative overflow-hidden rounded-[6px] border border-line-strong text-ink [-webkit-print-color-adjust:exact] [print-color-adjust:exact] print:bg-white!"
      >
        {/* Masthead */}
        <motion.div variants={BLOCK} className="flex items-center justify-between gap-4 px-6 pb-3 pt-4 sm:px-10">
          <span className="flex items-center gap-2 text-[13px] font-semibold tracking-[-0.01em]">
            <LogoMark className="h-4 w-4 text-ink" /> VisualOps
          </span>
          <span className="truncate font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2">
            Evidence package · <span className="text-ink">{docId}</span>
          </span>
        </motion.div>
        <motion.div variants={unfold ? RULE : undefined} className="mx-6 h-[2px] origin-left bg-ink sm:mx-10" aria-hidden />

        {/* Cover */}
        <motion.header variants={rich ? COVER_FOLD : BLOCK} style={{ transformOrigin: '50% 0%' }} className="relative px-6 pb-4 pt-8 sm:px-10">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
            Issued · {isoDay(model.generatedAt)}
          </p>
          <h2 className="type-poster mt-5 text-[clamp(40px,10.5cqw,96px)] text-ink">{model.title}</h2>
          <div className="mt-8 grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(250px,300px)] lg:gap-12">
            <div className="max-w-[48ch] space-y-5">
              {kindMeta && <p className="text-[14px] leading-relaxed text-ink-2">{kindMeta.description}</p>}
              {/* The same dataset note the JSON and Markdown exports carry. */}
              {dataset && (
                <p className="border-l-2 border-ink pl-3.5 text-[12.5px] leading-relaxed text-ink-2">
                  <b className="font-semibold text-ink">Sample dataset.</b> {dataset.note}.
                  {dataset.sampleRecords > 0 && ` ${sampleShare(dataset.sampleRecords, model.records.length)}`}
                </p>
              )}
            </div>
            <dl className="self-end text-[12px] lg:col-start-2">
              {meta.map(([k, v], i) => (
                <div
                  key={k}
                  className={cn('grid grid-cols-[84px_minmax(0,1fr)] gap-3 py-1.5', i === 0 ? 'border-t-2 border-ink' : 'border-t border-line')}
                >
                  <dt className="pt-[2px] font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-3">{k}</dt>
                  <dd className="min-w-0 break-words leading-snug text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          {stale && <SupersededStamp />}
        </motion.header>

        {/* 01 Summary */}
        <Section
          index={1}
          title="Summary"
          note={
            findingsLed
              ? [`${status.open} open`, `${status.monitoring} monitoring`, model.kind === 'incident' ? '' : `${status.resolved} resolved`]
                  .filter(Boolean)
                  .join(' · ')
              : undefined
          }
        >
          {findingsLed ? <SeveritySummary report={report} /> : <MediaSummary report={report} />}
        </Section>

        {/* 02 Kind-specific body */}
        <Section index={2} title={SECTION_TITLE[model.kind]} note={bodyNote(report)}>
          {model.kind === 'inspection' &&
            (model.records.length ? (
              <div>
                {model.records.map((record, i) => (
                  <FindingEntry
                    key={record.finding.id}
                    record={record}
                    probe={report.evidence[i]}
                    redact={model.scope.redactFaces}
                    eager={i < 2}
                    stampPress={rich && i < 6}
                    onInspect={onInspect}
                  />
                ))}
              </div>
            ) : (
              <Empty />
            ))}
          {model.kind === 'incident' && (model.records.length ? <IncidentRegister report={report} onInspect={onInspect} /> : <Empty />)}
          {model.kind === 'media' && (model.assets.length ? <MediaTable report={report} /> : <Empty />)}
          {model.kind === 'asset' && (model.assets.length ? <AssetInventory report={report} /> : <Empty />)}
        </Section>

        {/* 03 Evidence manifest */}
        {hasManifest && (
          <Section
            index={3}
            title="Evidence manifest"
            note={`${delivered}/${report.evidence.length} delivered · ${formatBytes(report.evidenceBytes)}`}
          >
            <EvidenceManifest report={report} />
          </Section>
        )}

        {/* 04 Integrity */}
        <Section index={hasManifest ? 4 : 3} title="Integrity">
          <Integrity report={report} />
        </Section>

        <motion.footer
          variants={BLOCK}
          className="mx-6 mt-12 flex flex-wrap items-center justify-between gap-2 border-t-2 border-ink py-4 font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3 sm:mx-10"
        >
          <span>
            {docId} · {model.title}
          </span>
          <span>End of document</span>
        </motion.footer>
      </motion.article>
    </div>
  );
});

function sampleShare(samples: number, total: number): string {
  if (samples === total) return total === 1 ? 'The finding in this report is a sample annotation.' : `All ${total} findings in this report are sample annotations.`;
  return `${samples} of the ${pluralize(total, 'finding')} in this report ${samples === 1 ? 'is a sample annotation' : 'are sample annotations'}.`;
}

/**
 * The cover's Redaction line, from Cloudinary's own face detections on the frames in this report (fl_getinfo,
 * the detector e_pixelate_faces uses) — never a blanket claim that faces were hidden.
 */
function redactionSummary(report: ReportSnapshot): string {
  const { model, evidence } = report;
  const redact = model.scope.redactFaces;
  if (!evidence.length) return redact ? 'Faces Cloudinary detects are pixelated · no frames in scope' : 'None applied';
  // One evidence frame per record, in record order (see the attach stage).
  const frames = model.records.map((r, i) => frameRedaction(r.asset, evidence[i], redact));
  const read = frames.filter((f) => f.faces);
  const regions = read.reduce((n, f) => n + (f.faces?.length ?? 0), 0);
  const withFaces = read.filter((f) => f.faces?.length).length;
  const unknown = frames.length - read.length;
  const flagged = frames.filter((f) => f.checks.length).length;

  if (!redact) {
    return regions
      ? `None applied · Cloudinary detected ${pluralize(regions, 'possible face')} in ${pluralize(withFaces, 'frame')}`
      : 'None applied';
  }
  const parts = ['Faces Cloudinary detects are pixelated'];
  if (read.length) {
    parts.push(
      regions
        ? `${pluralize(regions, 'region')} in ${pluralize(withFaces, 'frame')}`
        : `none detected in ${read.length === 1 ? 'this frame' : 'these frames'}`,
    );
  }
  if (unknown) parts.push(`detections unavailable for ${pluralize(unknown, 'frame')}`);
  if (flagged) parts.push(`${pluralize(flagged, 'frame')} to check — see ${model.kind === 'inspection' ? 'figure notes' : 'the evidence manifest'}`);
  return parts.join(' · ');
}

function bodyNote(report: ReportSnapshot): string | undefined {
  const { model } = report;
  if (model.kind === 'inspection') return model.records.length ? 'Worst first · stamped evidence per finding' : undefined;
  if (model.kind === 'incident') return 'Open and monitoring · worst first · age since capture';
  if (model.kind === 'media') {
    const measured = Object.values(report.delivery).filter(Boolean).length;
    return `Delivery measured for ${measured}/${pluralize(model.assets.length, 'asset')} during this run`;
  }
  return pluralize(model.assets.length, 'asset');
}

/* ------------------------------------------------------------------------ */
/* Building blocks                                                           */
/* ------------------------------------------------------------------------ */

function Section({ index, title, note, children }: { index: number; title: string; note?: string; children: ReactNode }) {
  return (
    <motion.section variants={BLOCK} className="px-6 pt-10 sm:px-10">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-t-2 border-ink pt-3">
        <span className="num font-mono text-[11px] text-ink-3">{String(index).padStart(2, '0')}</span>
        <h3 className="type-heading text-[22px] text-ink">{title}</h3>
        {note && <p className="ml-auto text-[12px] text-ink-3">{note}</p>}
      </div>
      <div className="mt-5">{children}</div>
    </motion.section>
  );
}

function SeverityTag({ severity }: { severity: Severity }) {
  return (
    <span className="inline-flex items-center gap-1.5 border border-[color-mix(in_oklab,var(--color-ink)_28%,transparent)] px-1.5 py-[3px] font-mono text-[10px] font-medium uppercase leading-none tracking-[0.1em] text-ink">
      <span aria-hidden className="h-2 w-2" style={{ backgroundColor: SEVERITY_COLOR[severity] }} />
      {severity}
    </span>
  );
}

// On paper the cells tighten so the tables fit an A4 column instead of being clipped by their scroll box.
const TH = 'py-2 pr-4 text-left font-mono text-[9.5px] font-normal uppercase tracking-[0.12em] text-ink-3 print:pr-2';
const TD = 'py-2.5 pr-4 align-top print:pr-2';

function Empty() {
  return (
    <p className="border-y border-line py-10 text-center text-[13px] text-ink-3">
      Nothing in scope. Widen the site, severity, date or status filters and regenerate.
    </p>
  );
}

function SupersededStamp() {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.3 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
      style={{ rotate: -5 }}
      className="pointer-events-none absolute right-5 top-3 border-[3px] border-critical bg-[color-mix(in_oklab,var(--color-canvas)_80%,transparent)] px-3 py-1.5 text-critical sm:right-10"
      role="note"
    >
      <div className="type-poster text-[30px] leading-none">Superseded</div>
      <div className="mt-1 font-mono text-[9px] uppercase tracking-[0.14em]">Scope changed after issue</div>
    </motion.div>
  );
}

/* ------------------------------------------------------------------------ */
/* Summary                                                                   */
/* ------------------------------------------------------------------------ */

function SeveritySummary({ report }: { report: ReportSnapshot }) {
  const { model } = report;
  const total = model.records.length;
  const sites = siteSummaries(model.records);
  return (
    <div>
      <div className="grid grid-cols-5 border-y border-line">
        {SEVERITIES.map((s) => (
          <div key={s} className="border-r border-line px-2 py-3 sm:px-4">
            <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3 sm:text-[9.5px]">
              <span aria-hidden className="h-2 w-2 shrink-0" style={{ backgroundColor: SEVERITY_COLOR[s] }} />
              <span className="truncate">{s}</span>
            </div>
            <div className="type-display num mt-2 text-[30px] text-ink sm:text-[42px]">{model.counts[s]}</div>
          </div>
        ))}
        {/* Status 'open', the same count the console calls open. Monitoring and resolved are in the section note. */}
        <div className="px-2 py-3 sm:px-4">
          <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3 sm:text-[9.5px]">Open</div>
          <div className="type-display num mt-2 text-[30px] text-ink sm:text-[42px]">{model.open}</div>
        </div>
      </div>

      <div className="mt-3 flex h-[5px] w-full overflow-hidden bg-line" aria-hidden>
        {total > 0 &&
          SEVERITIES.map((s) =>
            model.counts[s] ? <span key={s} style={{ width: `${(model.counts[s] / total) * 100}%`, backgroundColor: SEVERITY_COLOR[s] }} /> : null,
          )}
      </div>

      {sites.length > 0 && (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full min-w-[520px] text-[12.5px] print:min-w-0">
            <thead>
              <tr className="border-b border-ink">
                <th className={TH}>Site</th>
                <th className={cn(TH, 'text-right')}>Findings</th>
                <th className={cn(TH, 'text-right')}>Open</th>
                <th className={cn(TH, 'text-right')}>Monitoring</th>
                <th className={TH}>Worst open</th>
              </tr>
            </thead>
            <tbody>
              {sites.map((s) => (
                <tr key={s.site} className="border-b border-line">
                  <td className={cn(TD, 'font-medium')}>{s.site}</td>
                  <td className={cn(TD, 'num text-right font-mono text-[11.5px]')}>{s.total}</td>
                  <td className={cn(TD, 'num text-right font-mono text-[11.5px]')}>{s.open}</td>
                  <td className={cn(TD, 'num text-right font-mono text-[11.5px]')}>{s.monitoring}</td>
                  <td className={TD}>{s.worstOpen ? <SeverityTag severity={s.worstOpen} /> : <span className="text-ink-3">None open</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function deliveryTotals(report: ReportSnapshot) {
  let original = 0;
  let delivered = 0;
  let measured = 0;
  for (const a of report.model.assets) {
    const m = report.delivery[a.id];
    const o = originalBytes(a, m);
    if (!m?.bytes || !o) continue;
    measured += 1;
    original += o;
    delivered += m.bytes;
  }
  return { original, delivered, measured };
}

function originalBytes(asset: MediaAsset, metrics: DeliveryMetrics | undefined): number | undefined {
  // Images: Cloudinary reports the original size in Server-Timing. Video originals are recorded at ingest.
  return asset.resourceType === 'image' ? (metrics?.originalBytes ?? asset.bytes) : asset.bytes;
}

function MediaSummary({ report }: { report: ReportSnapshot }) {
  const { model } = report;
  const photos = model.assets.filter((a) => a.resourceType === 'image').length;
  const sites = new Set(model.assets.map((a) => a.site)).size;
  const totals = deliveryTotals(report);
  const cells: Array<[string, string]> =
    model.kind === 'media'
      ? [
          ['Assets', String(model.assets.length)],
          ['Photos', String(photos)],
          ['Videos', String(model.assets.length - photos)],
          ['Original', totals.measured ? formatBytes(totals.original) : '—'],
          ['Delivered', totals.measured ? formatBytes(totals.delivered) : '—'],
        ]
      : [
          ['Assets', String(model.assets.length)],
          ['Photos', String(photos)],
          ['Videos', String(model.assets.length - photos)],
          ['Sites', String(sites)],
          ['Findings', String(model.records.length)],
        ];
  return (
    <div>
      <div className="grid grid-cols-5 border-y border-line">
        {cells.map(([k, v], i) => (
          <div key={k} className={cn('px-2 py-3 sm:px-4', i < cells.length - 1 && 'border-r border-line')}>
            <div className="font-mono text-[9px] uppercase tracking-[0.1em] text-ink-3 sm:text-[9.5px]">{k}</div>
            <div className="type-display num mt-2 truncate text-[22px] text-ink sm:text-[34px]">{v}</div>
          </div>
        ))}
      </div>
      {model.kind === 'media' && totals.measured > 0 && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-ink-2">
          Across the {pluralize(totals.measured, 'asset')} measured in this run, Cloudinary delivered{' '}
          <b className="font-medium text-ink">{formatBytes(totals.delivered)}</b> for{' '}
          <b className="font-medium text-ink">{formatBytes(totals.original)}</b> of originals
          {totals.original > 0 &&
            ` (${Math.abs(Math.round((1 - totals.delivered / totals.original) * 100))}% ${totals.delivered <= totals.original ? 'smaller' : 'larger'})`}
          .
        </p>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Inspection: finding entries with stamped evidence                          */
/* ------------------------------------------------------------------------ */

function FindingEntry({
  record,
  probe,
  redact,
  eager,
  stampPress,
  onInspect,
}: {
  record: FindingRecord;
  probe: EvidenceProbe | undefined;
  redact: boolean;
  eager: boolean;
  stampPress: boolean;
  onInspect: (assetId: string) => void;
}) {
  const { finding, asset } = record;
  const captured = captureText(asset);
  const sample = asset.source === 'sample';
  return (
    <article className="print-break grid gap-6 border-t border-line py-8 first:border-t-0 first:pt-2 md:grid-cols-[minmax(0,250px)_minmax(0,1fr)] md:gap-8">
      <EvidenceFigure asset={asset} findingId={finding.id} probe={probe} redact={redact} eager={eager} stampPress={stampPress} onInspect={onInspect} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <button
            type="button"
            onClick={() => onInspect(asset.id)}
            className="link-underline font-mono text-[12px] font-semibold text-ink"
            data-cursor="OPEN"
          >
            {finding.id}
          </button>
          <SeverityTag severity={finding.severity} />
          <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
            {CATEGORY_LABEL[finding.category]} · {STATUS_LABEL[finding.status]}
          </span>
          <span className="ml-auto font-mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3">{provenance(asset)}</span>
        </div>
        <h4 className="type-heading mt-2.5 text-[21px] text-ink">{finding.title}</h4>

        <dl className="mt-4 grid grid-cols-[92px_minmax(0,1fr)] gap-y-1 text-[12px]">
          <dt className="font-mono text-[9.5px] uppercase leading-[18px] tracking-[0.12em] text-ink-3">Location</dt>
          <dd className="text-ink">
            {asset.site}
            {asset.zone ? ` · ${asset.zone}` : ''}
          </dd>
          <dt className="font-mono text-[9.5px] uppercase leading-[18px] tracking-[0.12em] text-ink-3">Captured</dt>
          <dd className="text-ink">
            {captured.when} · {asset.capturedBy}
            {captured.basis && <span className="block text-[11.5px] text-ink-3">{titleCase(captured.basis)}</span>}
          </dd>
          <dt className="font-mono text-[9.5px] uppercase leading-[18px] tracking-[0.12em] text-ink-3">Source</dt>
          <dd className="min-w-0 truncate font-mono text-[11.5px] text-ink">
            {asset.fileName} · {asset.resourceType === 'video' ? `video${asset.duration ? ` ${formatDuration(asset.duration)}` : ''}, frame at ${asset.posterOffset ?? 1} s` : `${asset.width}×${asset.height}`}
          </dd>
        </dl>

        <div className="mt-5">
          {/* Labelled as the Markdown export labels it, so screen and download carry the same provenance. */}
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3">
            {sample ? 'Annotation (sample, team-written)' : `Observed (${ANNOTATION_AUTHOR[asset.source]})`}
          </div>
          <p className="mt-1.5 max-w-[64ch] text-[13.5px] leading-relaxed text-ink-2">{finding.summary}</p>
        </div>
        <div className="mt-4 border-l-2 border-ink pl-3.5">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink">Required action</div>
          <p className="mt-1.5 max-w-[64ch] text-[13.5px] font-medium leading-relaxed text-ink">{finding.action}</p>
        </div>
      </div>
    </article>
  );
}

function EvidenceFigure({
  asset,
  findingId,
  probe,
  redact,
  eager,
  stampPress,
  onInspect,
}: {
  asset: MediaAsset;
  findingId: string;
  probe: EvidenceProbe | undefined;
  redact: boolean;
  eager: boolean;
  stampPress: boolean;
  onInspect: (assetId: string) => void;
}) {
  if (!probe) return null;
  const m = probe.metrics;
  const ok = probe.state === 'delivered';
  const redaction = frameRedaction(asset, probe, redact);
  return (
    <figure className="self-start">
      <div className="relative">
        <div className="relative overflow-hidden rounded-[2px] border border-line-strong bg-raised">
          <span className="absolute inset-0 grid place-items-center p-3 text-center font-mono text-[10px] uppercase leading-relaxed tracking-[0.1em] text-ink-3">
            {ok ? 'Loading from Cloudinary' : `Not delivered · ${failureText(probe)}`}
          </span>
          <button
            type="button"
            onClick={() => onInspect(asset.id)}
            className="relative block w-full"
            aria-label={`Open ${findingId} in the inspector`}
            data-cursor="OPEN"
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
            <img
              src={probe.url}
              width={asset.width}
              height={asset.height}
              alt={`Evidence frame for ${findingId}, rendered and stamped by Cloudinary`}
              loading={eager ? 'eager' : 'lazy'}
              decoding="async"
              className="block h-auto w-full"
              onError={(e) => {
                e.currentTarget.style.visibility = 'hidden';
              }}
            />
          </button>
        </div>

        {/* Delivery stamp: the result of this run's HEAD request for exactly this rendition. Anchored top-right,
            clear of the audit text Cloudinary burns in at the bottom left. */}
        <motion.div
          initial={stampPress ? { opacity: 0, scale: 1.35 } : false}
          whileInView={stampPress ? { opacity: 1, scale: 1 } : undefined}
          viewport={{ once: true, margin: '0px 0px -12% 0px' }}
          transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1], delay: 0.15 }}
          style={{
            rotate: -3,
            borderColor: ok ? 'var(--color-signal)' : 'var(--color-critical)',
            color: ok ? 'var(--color-signal)' : 'var(--color-critical)',
          }}
          className="pointer-events-none absolute -top-3 right-2 border-[1.5px] bg-canvas px-1.5 py-1 font-mono uppercase leading-none"
        >
          <div className="text-[9.5px] font-semibold tracking-[0.18em]">{ok ? 'Delivered' : 'Not delivered'}</div>
          <div className="num mt-[3px] text-[8.5px] tracking-[0.08em]">
            {ok
              ? `HTTP ${probe.httpStatus ?? 200} · ${(m?.format ?? '').toUpperCase()} ${formatBytes(m?.bytes)}`
              : probe.httpStatus
                ? `HTTP ${probe.httpStatus}`
                : 'No answer'}
          </div>
        </motion.div>
      </div>

      <figcaption className="mt-4 font-mono text-[10px] leading-relaxed text-ink-3">
        <span className="text-ink">Fig. {probe.fig}</span> · Cloudinary evidence rendition · e_improve · audit stamp · no generative edits
        <span className="mt-1 block">{redactionCaption(redaction, redact)}</span>
        <RedactionChecks redaction={redaction} />
      </figcaption>
    </figure>
  );
}

function RedactionChecks({ redaction, className }: { redaction: FrameRedaction; className?: string }) {
  if (!redaction.checks.length) return null;
  return (
    <span className={cn('mt-1.5 block space-y-1', className)}>
      {redaction.checks.map((c) => (
        <span key={c} className="flex items-start gap-1.5 font-sans text-[11.5px] leading-snug text-warn">
          <AlertTriangle aria-hidden className="mt-[2px] h-3 w-3 shrink-0" />
          {c}
        </span>
      ))}
    </span>
  );
}

/** Why a frame was not delivered, without putting words in Cloudinary's mouth (see EvidenceProbe.reason). */
function failureText(probe: EvidenceProbe): string {
  if (probe.reason) return probe.reason;
  return probe.httpStatus ? `HTTP ${probe.httpStatus}` : 'no answer';
}

/* ------------------------------------------------------------------------ */
/* Incident register                                                         */
/* ------------------------------------------------------------------------ */

function IncidentRegister({ report, onInspect }: { report: ReportSnapshot; onInspect: (assetId: string) => void }) {
  const { model } = report;
  const issued = new Date(model.generatedAt).getTime();
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[12.5px] print:min-w-0">
        <thead>
          <tr className="border-b border-ink">
            <th className={TH}>#</th>
            <th className={TH}>ID</th>
            <th className={TH}>Severity</th>
            <th className={TH}>Finding</th>
            <th className={TH}>Location</th>
            <th className={cn(TH, 'text-right')}>Age</th>
            <th className={TH}>Status</th>
            <th className={cn(TH, 'pr-0 print:pr-0')}>Required action</th>
          </tr>
        </thead>
        <tbody>
          {model.records.map(({ finding, asset }, i) => (
            <tr key={finding.id} className="print-break border-b border-line">
              <td className={cn(TD, 'num font-mono text-[11px] text-ink-3')}>{report.evidence[i]?.fig ?? i + 1}</td>
              <td className={TD}>
                <button type="button" onClick={() => onInspect(asset.id)} className="link-underline font-mono text-[11.5px] font-semibold" data-cursor="OPEN">
                  {finding.id}
                </button>
              </td>
              <td className={TD}>
                <SeverityTag severity={finding.severity} />
              </td>
              <td className={cn(TD, 'max-w-[220px] font-medium')}>{finding.title}</td>
              <td className={cn(TD, 'text-ink-2')}>
                {asset.site}
                {asset.zone && <span className="block text-[11.5px] text-ink-3">{asset.zone}</span>}
              </td>
              <td className={cn(TD, 'num text-right font-mono text-[11.5px]')}>{ageHours(asset.capturedAt, issued)} h</td>
              <td className={cn(TD, 'text-ink-2')}>{STATUS_LABEL[finding.status]}</td>
              <td className={cn(TD, 'max-w-[280px] pr-0 print:pr-0 text-ink-2')}>{finding.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
        Age is measured from capture to the time this report was generated
        {captureBasisNote(model.records.map((r) => r.asset))}. Finding text: {provenanceSummary(model.records)}.
      </p>
    </div>
  );
}

/** Qualifies ages and capture times that are not real capture metadata (sample-relative) or are camera-local. */
function captureBasisNote(assets: MediaAsset[]): string {
  const bases = new Set(assets.map(captureBasisOf));
  const notes: string[] = [];
  if (bases.has('sample-relative')) notes.push('sample capture times are set relative to the viewer’s clock, so their ages are illustrative');
  if (bases.has('fixed')) notes.push('camera times are shown as burned into the footage');
  return notes.length ? `; ${notes.join('; ')}` : '';
}

/** Who wrote the findings in this report, in the exports' words (ANNOTATION_AUTHOR). */
function findingAuthors(records: FindingRecord[]): string {
  if (!records.length) return 'No findings in scope.';
  const by = new Map<AssetSource, number>();
  for (const r of records) by.set(r.asset.source, (by.get(r.asset.source) ?? 0) + 1);
  const phrase: Record<AssetSource, (n: number) => string> = {
    sample: (n) => `${pluralize(n, 'sample annotation')} written by the VisualOps team`,
    upload: (n) => `${pluralize(n, 'finding')} entered at ingest in VisualOps`,
    sync: (n) => `${pluralize(n, 'finding')} from Cloudinary context metadata (synced)`,
  };
  const parts = Array.from(by, ([source, n]) => phrase[source](n));
  return `${parts.join(' · ')}.${by.has('sample') ? ' Sample annotations describe only what is visible in each frame.' : ''}`;
}

function provenanceSummary(records: FindingRecord[]): string {
  const kinds = Array.from(new Set(records.map((r) => provenance(r.asset).toLowerCase())));
  return kinds.length ? kinds.join(' and ') : 'none in scope';
}

/* ------------------------------------------------------------------------ */
/* Media analysis                                                            */
/* ------------------------------------------------------------------------ */

function MediaTable({ report }: { report: ReportSnapshot }) {
  const { model } = report;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[12.5px] print:min-w-0">
        <thead>
          <tr className="border-b border-ink">
            <th className={TH}>File</th>
            <th className={TH}>Type</th>
            <th className={cn(TH, 'text-right')}>Original</th>
            <th className={cn(TH, 'text-right')}>Delivered</th>
            <th className={cn(TH, 'text-right')}>Change</th>
            <th className={TH}>CDN</th>
            <th className={cn(TH, 'pr-0 print:pr-0 text-right')}>Face detections</th>
          </tr>
        </thead>
        <tbody>
          {model.assets.map((a) => (
            <MediaRow key={a.id} asset={a} metrics={report.delivery[a.id]} insight={report.insights[a.id]} />
          ))}
        </tbody>
      </table>
      <p className="mt-3 max-w-[80ch] text-[11.5px] leading-relaxed text-ink-3">
        Delivered size and format are read from Cloudinary’s Server-Timing header for the rendition the console serves (images: c_limit
        1600 · q_auto · f_auto; videos: c_limit 1280 · q_auto · vc_auto), so the change includes resizing, not only compression. Face
        detections are Cloudinary’s automatic ones from fl_getinfo and can include false positives or miss
        people. Video originals are the sizes recorded at ingest.
      </p>
    </div>
  );
}

function MediaRow({ asset, metrics, insight }: { asset: MediaAsset; metrics?: DeliveryMetrics; insight?: CloudinaryInsight | 'error' }) {
  const original = originalBytes(asset, metrics);
  const change = original && metrics?.bytes ? metrics.bytes / original - 1 : undefined;
  return (
    <tr className="print-break border-b border-line">
      <td className={cn(TD, 'font-mono text-[11.5px]')}>
        {asset.fileName}
        <span className="block font-sans text-[11.5px] text-ink-3">{asset.site}</span>
      </td>
      <td className={cn(TD, 'text-ink-2')}>{asset.resourceType === 'image' ? 'Photo' : 'Video'}</td>
      <td className={cn(TD, 'num whitespace-nowrap text-right font-mono text-[11.5px]')}>
        {asset.format.toUpperCase()} {formatBytes(original)}
      </td>
      <td className={cn(TD, 'num whitespace-nowrap text-right font-mono text-[11.5px]')}>
        {metrics ? `${(metrics.format ?? '').toUpperCase()} ${formatBytes(metrics.bytes)}` : <span className="text-ink-3">not measured</span>}
      </td>
      <td className={cn(TD, 'num text-right font-mono text-[11.5px]', change !== undefined && change < 0 && 'text-signal')}>
        {change !== undefined ? `${change < 0 ? '−' : '+'}${Math.abs(Math.round(change * 100))}%` : '—'}
      </td>
      <td className={cn(TD, 'font-mono text-[11px] uppercase text-ink-2')}>{metrics?.cache ?? '—'}</td>
      <td className={cn(TD, 'num pr-0 print:pr-0 text-right font-mono text-[11.5px]')}>
        {insight && insight !== 'error' ? insight.faces.length : insight === 'error' ? 'n/a' : '—'}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------------ */
/* Asset inventory                                                           */
/* ------------------------------------------------------------------------ */

function AssetInventory({ report }: { report: ReportSnapshot }) {
  const { model } = report;
  const sites = Array.from(new Set(model.assets.map((a) => a.site))).sort();
  return (
    <div className="space-y-8">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-[12.5px] print:min-w-0">
          <thead>
            <tr className="border-b border-ink">
              <th className={TH}>Site</th>
              <th className={cn(TH, 'text-right')}>Photos</th>
              <th className={cn(TH, 'text-right')}>Videos</th>
              <th className={cn(TH, 'text-right')}>Findings</th>
              <th className={cn(TH, 'pr-0 print:pr-0')}>Categories</th>
            </tr>
          </thead>
          <tbody>
            {sites.map((site) => {
              const rows = model.assets.filter((a) => a.site === site);
              const cats = CATEGORIES.filter((c) => rows.some((a) => a.finding?.category === c));
              return (
                <tr key={site} className="border-b border-line">
                  <td className={cn(TD, 'font-medium')}>{site}</td>
                  <td className={cn(TD, 'num text-right font-mono text-[11.5px]')}>{rows.filter((a) => a.resourceType === 'image').length}</td>
                  <td className={cn(TD, 'num text-right font-mono text-[11.5px]')}>{rows.filter((a) => a.resourceType === 'video').length}</td>
                  <td className={cn(TD, 'num text-right font-mono text-[11.5px]')}>{model.records.filter((r) => r.asset.site === site).length}</td>
                  <td className={cn(TD, 'pr-0 print:pr-0 text-ink-2')}>{cats.map((c) => CATEGORY_LABEL[c]).join(', ') || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-[12.5px] print:min-w-0">
          <thead>
            <tr className="border-b border-ink">
              <th className={TH}>File</th>
              <th className={TH}>Type</th>
              <th className={cn(TH, 'text-right')}>Dimensions</th>
              <th className={TH}>Location</th>
              <th className={cn(TH, 'pr-0 print:pr-0')}>Captured</th>
            </tr>
          </thead>
          <tbody>
            {model.assets.map((a) => (
              <InventoryRow key={a.id} asset={a} />
            ))}
          </tbody>
        </table>
        <p className="mt-3 max-w-[80ch] text-[11.5px] leading-relaxed text-ink-3">
          Captured times are local to this browser{captureBasisNote(model.assets)}.
        </p>
      </div>
    </div>
  );
}

function InventoryRow({ asset: a }: { asset: MediaAsset }) {
  const captured = captureText(a);
  return (
    <tr className="print-break border-b border-line">
      <td className={cn(TD, 'max-w-[220px] truncate font-mono text-[11.5px]')}>{a.fileName}</td>
      <td className={cn(TD, 'text-ink-2')}>
        {a.resourceType === 'image' ? 'Photo' : `Video${a.duration ? ` · ${formatDuration(a.duration)}` : ''}`}
      </td>
      <td className={cn(TD, 'num whitespace-nowrap text-right font-mono text-[11.5px]')}>
        {a.width}×{a.height}
      </td>
      <td className={cn(TD, 'text-ink-2')}>
        {a.site}
        {a.zone ? ` · ${a.zone}` : ''}
      </td>
      <td className={cn(TD, 'whitespace-nowrap pr-0 print:pr-0 text-ink-2')}>
        {captured.when}
        {captured.short && <span className="block text-[11px] text-ink-3">{captured.short}</span>}
      </td>
    </tr>
  );
}

/* ------------------------------------------------------------------------ */
/* Evidence manifest and integrity                                           */
/* ------------------------------------------------------------------------ */

function EvidenceManifest({ report }: { report: ReportSnapshot }) {
  const { model } = report;
  const redact = model.scope.redactFaces;
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[12.5px] print:min-w-0">
        <thead>
          <tr className="border-b border-ink">
            <th className={TH}>{model.kind === 'inspection' ? 'Fig' : '#'}</th>
            <th className={TH}>Finding</th>
            <th className={TH}>Source file</th>
            <th className={cn(TH, 'text-right')}>Delivered</th>
            <th className={cn(TH, 'text-right')}>Frame</th>
            <th className={TH}>HTTP · CDN</th>
            <th className={cn(TH, 'text-right')}>Round-trip</th>
            <th className={cn(TH, 'pr-0 print:pr-0')}>Faces</th>
          </tr>
        </thead>
        <tbody>
          {report.evidence.map((e, i) => {
            const record = model.records[i];
            const m = e.metrics;
            const ok = e.state === 'delivered';
            const redaction = record ? frameRedaction(record.asset, e, redact) : undefined;
            const flagged = Boolean(redaction?.checks.length);
            return (
              <Fragment key={e.findingId}>
                <tr className={cn('print-break', flagged ? '' : 'border-b border-line')}>
                  <td className={cn(TD, 'num font-mono text-[11px] text-ink-3')}>{e.fig}</td>
                  <td className={cn(TD, 'whitespace-nowrap font-mono text-[11.5px] font-semibold')}>{e.findingId}</td>
                  <td className={cn(TD, 'max-w-[180px] truncate font-mono text-[11.5px] text-ink-2 print:max-w-[120px]')}>{record?.asset.fileName}</td>
                  <td className={cn(TD, 'num whitespace-nowrap text-right font-mono text-[11.5px]')}>
                    {ok ? (
                      `${(m?.format ?? '').toUpperCase()} ${formatBytes(m?.bytes)}`
                    ) : (
                      <span className="text-critical">Not delivered · {failureText(e)}</span>
                    )}
                  </td>
                  <td className={cn(TD, 'num whitespace-nowrap text-right font-mono text-[11.5px] text-ink-2')}>
                    {m?.width && m.height ? `${m.width}×${m.height}` : '—'}
                  </td>
                  <td className={cn(TD, 'num whitespace-nowrap font-mono text-[11.5px]')}>
                    <span className={ok ? 'text-ink' : 'text-critical'}>{e.httpStatus ?? '—'}</span>
                    <span className="text-[11px] uppercase text-ink-2"> · {m?.cache ?? '—'}</span>
                  </td>
                  <td className={cn(TD, 'num whitespace-nowrap text-right font-mono text-[11.5px] text-ink-2')}>
                    {m ? `${Math.round(m.elapsedMs)} ms` : '—'}
                  </td>
                  <td className={cn(TD, 'whitespace-nowrap pr-0 print:pr-0 font-mono text-[11.5px] print:whitespace-normal', flagged ? 'text-warn' : 'text-ink-2')}>
                    {flagged && <AlertTriangle aria-hidden className="-mt-0.5 mr-1 inline h-3 w-3" />}
                    {redaction ? manifestFaces(redaction, redact) : '—'}
                  </td>
                </tr>
                {flagged && redaction && (
                  <tr className="print-break border-b border-line">
                    <td className="pb-2.5" />
                    <td colSpan={7} className="pb-2.5 pr-0">
                      <RedactionChecks redaction={redaction} className="mt-0" />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 max-w-[80ch] text-[11.5px] leading-relaxed text-ink-3">
        Each evidence frame was requested from Cloudinary during this run; “delivered” means Cloudinary answered HTTP 200 for exactly that
        rendition. Format, size, dimensions and cache status are read from Cloudinary’s own response headers. Faces counts Cloudinary’s
        automatic face detections for the same frame (fl_getinfo), the detections e_pixelate_faces pixelates; they can include false
        positives or miss people. The JSON, CSV and Markdown exports link the same frames at 1200 px.
      </p>
    </div>
  );
}

/** The manifest's Faces cell: what face redaction did to the frame, from Cloudinary's detections. */
function manifestFaces(redaction: FrameRedaction, redact: boolean): string {
  const n = redaction.faces?.length;
  if (n === undefined) return 'n/a';
  if (!redact) return n ? `off · ${n} detected` : 'off';
  return n ? `${n} pixelated` : 'none detected';
}

function Integrity({ report }: { report: ReportSnapshot }) {
  const { model } = report;
  const base = exportBase(model.kind, model.generatedAt);
  const facts: Array<[string, string]> = [
    ['Schema', report.payload.schema],
    ['Payload', `${formatBytes(report.jsonBytes)} JSON`],
    ['Records', `${pluralize(report.payload.findings.length, 'finding')} · ${pluralize(report.payload.assets.length, 'asset')}`],
    ['Algorithm', 'SHA-256 · Web Crypto'],
    ['Work time', formatWork(report.workMs)],
  ];
  return (
    <div>
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(220px,280px)]">
        <div className="min-w-0">
          <div className="font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3">SHA-256 of the JSON export</div>
          <p className="num mt-2 break-all font-mono text-[15px] leading-[1.7] tracking-[0.02em] text-ink sm:text-[17px]">{groupHash(report.hash)}</p>
          <p className="mt-4 max-w-[62ch] text-[12.5px] leading-relaxed text-ink-2">
            Computed in the browser when this package was built. The JSON export contains exactly the hashed bytes — verify it with{' '}
            <code className="whitespace-nowrap border border-line bg-raised px-1 py-[1px] font-mono text-[11.5px] text-ink">shasum -a 256 {base}.json</code>.
            Any change to scope, records or evidence links yields a different digest.
          </p>
        </div>
        <dl className="self-start text-[12px]">
          {facts.map(([k, v], i) => (
            <div key={k} className={cn('grid grid-cols-[84px_minmax(0,1fr)] gap-3 py-1.5', i === 0 ? 'border-t-2 border-ink' : 'border-t border-line')}>
              <dt className="pt-[2px] font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-3">{k}</dt>
              <dd className="min-w-0 break-words font-mono text-[11.5px] text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      <ul className="mt-8 grid gap-5 border-t border-line pt-5 text-[12px] leading-relaxed text-ink-2 sm:grid-cols-3">
        <li>
          <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink">Evidence frames</span>
          Rendered by Cloudinary with exposure correction (e_improve)
          {model.scope.redactFaces ? ', pixelation of the faces Cloudinary detects (e_pixelate_faces)' : ''} and a burned-in audit stamp.
          No generative edits.
        </li>
        <li>
          <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink">Findings</span>
          {findingAuthors(model.records)} The JSON, CSV and Markdown exports record the same author for every finding.
        </li>
        <li>
          <span className="mb-1 block font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink">Measurements</span>
          Sizes, formats, dimensions and cache status come from Cloudinary’s Server-Timing and response headers, read during this run.
        </li>
      </ul>
    </div>
  );
}
