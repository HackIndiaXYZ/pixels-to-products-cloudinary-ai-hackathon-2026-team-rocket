'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { CATEGORY_LABEL, STATUS_LABEL } from '@/lib/analytics';
import { fetchInsight } from '@/lib/cloudinary/insights';
import { transformationFromUrl } from '@/lib/cloudinary/url';
import { reportPayload, sha256Hex } from '@/lib/report';
import { IntegrityBadge, SeverityBadge } from '@/components/ui/badges';
import { cn } from '@/components/ui/cn';
import { useInsightFrom, useSeen } from '../tech/hooks';
import { REPORT_ASSET as ASSET, REPORT_FRAME_URL, REPORT_MODEL as MODEL } from './report-sample';

const FINDING = ASSET.finding!;

/** The payload the console exports for this report (deterministic: fixed clock, sample data). */
const PAYLOAD = reportPayload(MODEL);
const PAYLOAD_JSON = JSON.stringify(PAYLOAD, null, 2);
const SCHEMA = PAYLOAD.schema.replace(/^visualops\./, '');

/** Human-readable recipe of the evidence frame, read back from its Cloudinary URL. */
const FRAME_RECIPE = transformationFromUrl(REPORT_FRAME_URL)
  .map((c) => (c.includes('l_text:') ? 'l_text (audit stamp)' : c))
  .join(' / ');

type HashState = { status: 'pending' } | { status: 'ready'; hex: string } | { status: 'unavailable' };

/**
 * A report page rendered as paper: header, scope, a Cloudinary-stamped
 * evidence frame with faces pixelated, the finding row and a SHA-256
 * fingerprint of the report payload computed in the browser (Web Crypto).
 *
 * The face count is Cloudinary's own fl_getinfo answer for this photo, fetched
 * once the sheet is near the viewport. `sheetClassName` lets the section add a
 * blank top margin to the sheet (the Evidence headline is set across it).
 */
export function ReportPaper({ className, sheetClassName }: { className?: string; sheetClassName?: string }) {
  const rootRef = useRef<HTMLElement>(null);
  const seen = useSeen(rootRef, '200px 0px');
  const loadFaces = useCallback(() => fetchInsight(ASSET), []);
  const { insight, failed } = useInsightFrom(loadFaces, ASSET.id, seen);
  const [hash, setHash] = useState<HashState>({ status: 'pending' });

  useEffect(() => {
    let cancelled = false;
    sha256Hex(PAYLOAD_JSON)
      .then((hex) => {
        if (!cancelled) setHash({ status: 'ready', hex });
      })
      .catch(() => {
        if (!cancelled) setHash({ status: 'unavailable' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const faces = insight
    ? insight.faces.length
      ? `${insight.faces.length} detected · pixelated`
      : 'None detected'
    : failed
      ? 'Pixelation on'
      : 'Pixelated if detected';

  return (
    <article
      ref={rootRef}
      aria-label={`Report preview: inspection report for finding ${FINDING.id}`}
      className={cn('relative', className)}
    >
      {/* Print registration marks around the sheet. */}
      <span
        aria-hidden
        className="reticle"
        style={{ inset: '-14px', '--reticle-color': 'var(--color-line-strong)', '--reticle-size': '12px' } as CSSProperties}
      />
      <div
        className={cn(
          'relative rounded-[4px] border border-line-strong bg-surface px-5 pb-6 pt-5 text-ink shadow-[0_1px_2px_rgba(13,20,36,0.05),0_28px_56px_-36px_rgba(13,20,36,0.32)] sm:px-8 sm:pb-8 sm:pt-7',
          sheetClassName,
        )}
      >
        <header className="flex items-center justify-between gap-4">
          <span className="font-display text-[15px] font-semibold tracking-[-0.02em]">VisualOps</span>
          <span className="label text-right">
            {MODEL.title}
            <span className="hidden sm:inline"> · page 1 of 1</span>
          </span>
        </header>
        <div aria-hidden className="mt-4 h-[2px] bg-ink" />

        <div className="mt-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div className="min-w-0">
            <h3 className="type-heading text-[24px] sm:text-[28px]">{ASSET.site}</h3>
            <p className="mt-1 text-[13px] text-ink-2">{ASSET.zone}</p>
          </div>
          <IntegrityBadge integrity="evidence" />
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3.5 border-y border-line py-4 sm:grid-cols-4">
          <div>
            <dt className="label">Findings</dt>
            <dd className="num mt-1.5 text-[13px] text-ink">
              {MODEL.records.length} · {MODEL.open} open
            </dd>
          </div>
          <div>
            <dt className="label">Captured</dt>
            <dd className="mt-1.5 text-[13px] text-ink">Sample time</dd>
          </div>
          <div>
            <dt className="label">Faces</dt>
            <dd className="num mt-1.5 text-[13px] text-ink">{faces}</dd>
          </div>
          <div>
            <dt className="label">Schema</dt>
            <dd className="mt-1.5 font-mono text-[12px] text-ink">{SCHEMA}</dd>
          </div>
        </dl>

        <figure className="mt-5">
          <div className="relative overflow-hidden rounded-[3px] bg-raised" style={{ aspectRatio: `${ASSET.width} / ${ASSET.height}` }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- Cloudinary rendition */}
            <img
              src={REPORT_FRAME_URL}
              alt={`Evidence frame for ${FINDING.id}: exposure-corrected, faces detected by Cloudinary pixelated, audit stamp burned in`}
              loading="lazy"
              decoding="async"
              className="absolute inset-0 h-full w-full object-cover"
            />
          </div>
          <figcaption className="mt-2.5 font-mono text-[10.5px] leading-[1.6] text-ink-3">
            <span className="text-ink">Fig. 1</span> · {ASSET.fileName} · {FRAME_RECIPE}
          </figcaption>
        </figure>

        <section aria-label="Finding" className="mt-5 border-t border-line pt-4">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 font-mono text-[11px]">
            <span className="text-ink">{FINDING.id}</span>
            <SeverityBadge severity={FINDING.severity} />
            <span className="text-ink-3">
              {CATEGORY_LABEL[FINDING.category]} · {STATUS_LABEL[FINDING.status]}
            </span>
            <span className="label ml-auto normal-case tracking-[0.02em]">Sample annotation</span>
          </div>
          <h4 className="mt-2.5 text-[16px] font-semibold leading-snug tracking-[-0.01em]">{FINDING.title}</h4>
          <p className="mt-1.5 line-clamp-3 text-[13px] leading-relaxed text-ink-2">{FINDING.summary}</p>
          <p className="mt-3 border-l-2 border-ink pl-3 text-[13px] leading-relaxed text-ink">
            <span className="font-semibold">Action · </span>
            {FINDING.action}
          </p>
        </section>

        <footer className="mt-6 border-t border-line pt-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <span className="label text-ink">SHA-256 · report payload</span>
            <span className="label normal-case tracking-[0.02em]">computed in this browser</span>
          </div>
          <p className="num mt-2 font-mono text-[11px] leading-[1.7] text-ink-2">
            <span className="sr-only">SHA-256 digest: </span>
            {hash.status === 'ready'
              ? hash.hex.match(/.{1,8}/g)?.join(' ')
              : hash.status === 'unavailable'
                ? 'Unavailable — Web Crypto needs a secure (https) context.'
                : '…'}
          </p>
        </footer>
      </div>
    </article>
  );
}
